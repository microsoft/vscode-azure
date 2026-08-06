/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import * as path from 'node:path';
import { mock as nodeMock } from 'node:test';
import type * as vscode from 'vscode';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { resolveWindowsProjectPath } from '../../../src/commands/staticWebApps/deploymentRouting';
import { DetermineStaticWebAppDeploymentRouteStep } from '../../../src/commands/staticWebApps/steps/DetermineStaticWebAppDeploymentRouteStep';
import type { GitRemoteInfo, IGitRemoteService } from '../../../src/staticWebApps/GitRemoteService';
import { createMockAzdService } from '../../azd/MockAzdService';

function createStep(remote: GitRemoteInfo | undefined, options: { readonly azdVersionOk?: boolean; readonly conflictingWorkflowPath?: string; readonly azureYaml?: string } = {}) {
    const { vscode: code, fs } = createMockVsCode();
    // Every test uses /workspace as the iacFolder; register it as a real directory so
    // resolveStaticWebAppServiceProjectFolder's workspace.fs.stat check succeeds for `project: .`.
    fs.directories.add('/workspace');
    if (options.conflictingWorkflowPath) {
        fs.addFile(MockUri.file(options.conflictingWorkflowPath), 'trigger: none');
    }
    if (options.azureYaml !== undefined) {
        fs.addFile(MockUri.file('/workspace/azure.yaml'), options.azureYaml);
    }
    const getRemoteInfo = nodeMock.fn(() => Promise.resolve(remote));
    const gitRemote = { getRemoteInfo } as unknown as IGitRemoteService;
    const azd = createMockAzdService();
    azd.checkVersion.mock.mockImplementation(() => Promise.resolve(options.azdVersionOk ?? true));
    azd.findAzureYaml.mock.mockImplementation(async (dir: vscode.Uri) => {
        const candidate = code.Uri.joinPath(dir, 'azure.yaml');
        try {
            await code.workspace.fs.stat(candidate);
            return [candidate];
        } catch {
            return [];
        }
    });
    const step = new DetermineStaticWebAppDeploymentRouteStep(code, gitRemote, azd);
    return { step, azd, getRemoteInfo, fs, code };
}

function baseContext(overrides: Partial<CreateStaticWebAppContext> = {}): CreateStaticWebAppContext {
    return {
        mode: 'basic',
        job: 'deploy',
        iacFolder: MockUri.file('/workspace'),
        buildPresetSelection: 'react',
        outputLocation: 'build',
        ...overrides,
    };
}

const githubPushed: GitRemoteInfo = { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true, branch: 'main' };
const githubNotPushed: GitRemoteInfo = { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: false };
const unsupported: GitRemoteInfo = { provider: 'unsupported', url: 'https://gitlab.com/o/r.git', hasUpstream: true };

describe('DetermineStaticWebAppDeploymentRouteStep (unit)', () => {
    it('should no-op for the createNew job', () => {
        const { step } = createStep(githubPushed);
        expect(step.shouldPrompt(baseContext({ job: 'createNew' }))).to.be.false;
    });

    it('should no-op when iacFolder is not set', () => {
        const { step } = createStep(githubPushed);
        expect(step.shouldPrompt(baseContext({ iacFolder: undefined }))).to.be.false;
    });

    describe('unsupported artifact shapes -- direct deploy AND CI/CD are both unavailable', () => {
        it('should block on an empty output location without even inspecting the Git remote', async () => {
            const { step, getRemoteInfo } = createStep(githubPushed);

            const result = await step.prompt(baseContext({ outputLocation: '' }));

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should block on "." and "/" output locations the same way', async () => {
            const { step } = createStep(githubPushed);

            expect(await step.prompt(baseContext({ outputLocation: '.' }))).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            expect(await step.prompt(baseContext({ outputLocation: '/' }))).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
        });

        it('should block Next.js hybrid/SSR even when a non-empty custom output location is given', async () => {
            // The user overrode the output away from the empty default -- canAzdDeployStaticWebApp
            // alone would say "distinct from source", but the framework itself is still SSR and
            // cannot be served by a static deploy or by a generated azd-deploy-only CI workflow.
            const { step, getRemoteInfo } = createStep(githubPushed);

            const result = await step.prompt(baseContext({ buildPresetSelection: 'nextjs', outputLocation: 'build' }));

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'hybridSsr' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should not block Next.js static export', async () => {
            const { step } = createStep(undefined);

            const result = await step.prompt(baseContext({ buildPresetSelection: 'nextjs-export', outputLocation: 'out' }));

            expect(result).to.deep.equal({});
        });
    });

    describe('supported artifact shapes -- CI/CD vs. direct-deploy routing', () => {
        it('should retain the direct-deploy fallback with no remote', async () => {
            const { step } = createStep(undefined);
            expect(await step.prompt(baseContext())).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback with an unsupported remote', async () => {
            const { step } = createStep(unsupported);
            expect(await step.prompt(baseContext())).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback when the branch is not pushed', async () => {
            const { step } = createStep(githubNotPushed);
            expect(await step.prompt(baseContext())).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback when azd is below the pipeline version gate', async () => {
            const { step } = createStep(githubPushed, { azdVersionOk: false });
            expect(await step.prompt(baseContext())).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback when a conflicting provider workflow already exists', async () => {
            const { step } = createStep(githubPushed, { conflictingWorkflowPath: '/workspace/.azdo/pipelines/azure-dev.yml' });
            expect(await step.prompt(baseContext())).to.deep.equal({});
        });

        it('should route to CI/CD when supported, pushed, version-gated ok, and no provider conflict', async () => {
            const { step } = createStep(githubPushed);

            const result = await step.prompt(baseContext());

            expect(result).to.deep.equal({
                deploy: false,
                deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
            });
        });
    });

    describe('hydrated/existing projects (outputLocation not captured this run)', () => {
        function hydratedContext(overrides: Partial<CreateStaticWebAppContext> = {}): CreateStaticWebAppContext {
            return baseContext({ outputLocation: undefined, ...overrides });
        }

        it('should not classify a hydrated project as unsupported when its existing SWA service has a valid dist and a non-hybrid framework', async () => {
            const { step, getRemoteInfo } = createStep(undefined, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: build\n',
            });

            const result = await step.prompt(hydratedContext());

            // Falls through to the normal (no remote) direct-deploy-fallback path -- proves it
            // was NOT classified as an unsupported artifact.
            expect(result).to.deep.equal({});
            expect(getRemoteInfo.mock.callCount()).to.equal(1);
        });

        it('should block (invalidServiceConfig) a hydrated project whose existing SWA service has an invalid dist', async () => {
            const { step, getRemoteInfo } = createStep(githubPushed, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: ""\n',
            });

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should block (invalidServiceConfig) when no existing SWA service can be found at all (no positive evidence of eligibility)', async () => {
            // No azure.yaml at all -- there is no valid deploy target to route direct deploy or
            // CI/CD against, so this must be treated as unsupported, not silently preserved as
            // eligible. The Git remote must not even be inspected once this is already decided.
            const { step, getRemoteInfo } = createStep(githubPushed);

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should block (invalidServiceConfig) when azure.yaml exists but declares no host: staticwebapp service', async () => {
            const { step, getRemoteInfo } = createStep(githubPushed, {
                azureYaml: 'services:\n  api:\n    host: function\n',
            });

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should block (invalidServiceConfig) when the existing service dist is missing', async () => {
            const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n' });
            expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
        });

        it('should block (invalidServiceConfig) when the existing service dist is "."', async () => {
            const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: "."\n' });
            expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
        });

        it('should block (invalidServiceConfig) when the existing service dist is "/"', async () => {
            const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: "/"\n' });
            expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
        });

        it('should block (invalidServiceConfig) when the existing service dist is a non-string value', async () => {
            const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: 123\n' });
            expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
        });

        describe('invalid service project paths (azd path semantics)', () => {
            it('should block (invalidServiceConfig) when the existing service project field is missing entirely', async () => {
                const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    dist: build\n' });
                expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            it('should block (invalidServiceConfig) when the existing service project is a non-string value', async () => {
                const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: 123\n    dist: build\n' });
                expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            it('should block (invalidServiceConfig) when the existing service project is an empty string', async () => {
                const { step } = createStep(githubPushed, { azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ""\n    dist: build\n' });
                expect(await step.prompt(hydratedContext())).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            it('should split a project path on the host-native separator, whatever character that is on this platform', async () => {
                // Host-adaptive: builds the fixture with path.sep (the actual separator this
                // platform's `path` module recognizes) rather than hardcoding a POSIX or
                // Windows-specific character.
                const { step, fs } = createStep(githubPushed, {
                    azureYaml: `services:\n  web:\n    host: staticwebapp\n    project: frontend${path.sep}app\n    dist: build\n`,
                });
                fs.directories.add('/workspace/frontend/app');
                fs.addFile(MockUri.file('/workspace/frontend/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                const result = await step.prompt(hydratedContext());

                expect(result).to.deep.equal({
                    deploy: false,
                    deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                });
            });

            if (process.platform === 'win32') {
                it('should treat a backslash in project as a path separator on Windows', async () => {
                    const { step, fs } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: frontend\\app\n    dist: build\n',
                    });
                    fs.directories.add('/workspace/frontend/app');
                    fs.addFile(MockUri.file('/workspace/frontend/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({
                        deploy: false,
                        deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                    });
                });
            } else {
                it('should treat a backslash in project as a literal character, not a separator, on POSIX', async () => {
                    const { step, fs } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: literal\\name\n    dist: build\n',
                    });
                    // Only the (incorrectly) split two-segment form exists -- the literal,
                    // unsplit "literal\name" single segment azd/Node would actually look for on
                    // POSIX was never registered, so this must be invalid, proving backslash was
                    // not treated as a separator.
                    fs.directories.add('/workspace/literal/name');
                    fs.addFile(MockUri.file('/workspace/literal/name/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
                });
            }

            it('should block (invalidServiceConfig) when the existing service project path does not exist', async () => {
                const { step } = createStep(githubPushed, {
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./doesnotexist\n    dist: build\n',
                });

                const result = await step.prompt(hydratedContext());

                expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            it('should block (invalidServiceConfig) when the existing service project path resolves to a file, not a directory', async () => {
                const { step, fs } = createStep(githubPushed, {
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./config.json\n    dist: build\n',
                });
                fs.addFile(MockUri.file('/workspace/config.json'), '{}');

                const result = await step.prompt(hydratedContext());

                expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            it('should accept a project path that traverses above iacFolder via ".." when it resolves to an existing directory, mirroring azd\'s filepath.Join', async () => {
                // azd's ServiceConfig.Path() resolves relative paths via filepath.Join, which
                // (like Uri.joinPath) permits ".." to traverse above the project root rather than
                // rejecting it -- /workspace/../outside resolves to the sibling folder /outside.
                const { step, fs } = createStep(githubPushed, {
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ../outside\n    dist: build\n',
                });
                fs.directories.add('/outside');
                fs.addFile(MockUri.file('/outside/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                const result = await step.prompt(hydratedContext());

                expect(result).to.deep.equal({
                    deploy: false,
                    deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                });
            });

            it('should block (invalidServiceConfig) when a ".." project path resolves outside iacFolder but the target does not exist', async () => {
                const { step } = createStep(githubPushed, {
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ../doesnotexist\n    dist: build\n',
                });

                const result = await step.prompt(hydratedContext());

                expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
            });

            if (process.platform === 'win32') {
                it('should treat a rooted-without-volume path ("/opt/app") as relative on Windows, joining it under iacFolder rather than treating it as OS-root-absolute (Go: filepath.IsAbs("/opt/app") is false on Windows)', async () => {
                    const { step, fs, code } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/app\n    dist: build\n',
                    });
                    const projectUri = code.Uri.file(resolveWindowsProjectPath(code.Uri.file('/workspace').fsPath, '/opt/app'));
                    fs.directories.add(projectUri.path);
                    fs.addFile(code.Uri.joinPath(projectUri, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({
                        deploy: false,
                        deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                    });
                });
            } else {
                it('should accept an absolute POSIX-style project path ("/opt/app") used unchanged, not anchored under iacFolder', async () => {
                    // On POSIX, a leading-slash path is absolute per both Node's path.posix and
                    // Go's filepath.IsAbs -- no divergence to correct, unlike on Windows.
                    const { step, fs } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/app\n    dist: build\n',
                    });
                    fs.directories.add('/opt/app');
                    fs.addFile(MockUri.file('/opt/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({
                        deploy: false,
                        deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                    });
                });

                it('should block (invalidServiceConfig) when an absolute POSIX-style project path does not exist', async () => {
                    const { step } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/doesnotexist\n    dist: build\n',
                    });

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'invalidServiceConfig' });
                });
            }

            if (process.platform === 'win32') {
                it('should accept a Windows drive-absolute project path (e.g. C:\\...) used unchanged, not anchored under iacFolder', async () => {
                    const { step, fs, code } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: C:\\opt\\app\n    dist: build\n',
                    });
                    // Derive the resolved path the same way the production code does (via
                    // resolveWindowsProjectPath + Uri.file), rather than hand-guessing the URI's
                    // case-normalized representation.
                    const projectUri = code.Uri.file(resolveWindowsProjectPath(code.Uri.file('/workspace').fsPath, 'C:\\opt\\app'));
                    fs.directories.add(projectUri.path);
                    fs.addFile(code.Uri.joinPath(projectUri, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({
                        deploy: false,
                        deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                    });
                });
            } else {
                it('should treat a Windows drive-letter form (e.g. C:\\...) as a plain relative path segment under iacFolder on POSIX, not a drive-absolute path', async () => {
                    // On POSIX, "C:\opt\app" has no leading "/" so path.isAbsolute is false, and
                    // backslash is a literal character -- it resolves as ONE relative path
                    // segment under iacFolder, not an absolute Windows path.
                    const { step, fs } = createStep(githubPushed, {
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: C:\\opt\\app\n    dist: build\n',
                    });
                    fs.directories.add('/workspace/C:\\opt\\app');
                    fs.addFile(MockUri.file('/workspace/C:\\opt\\app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    const result = await step.prompt(hydratedContext());

                    expect(result).to.deep.equal({
                        deploy: false,
                        deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
                    });
                });
            }
        });

        it('should block (hybridSsr) a hydrated project with a valid dist whose framework is detected as Next.js at the service project path, before any remote lookup', async () => {
            // buildPresetSelection is unavailable for a hydrated project (PickBuildPresetStep also
            // skips with hasInfra) -- this proves the framework is independently (re-)detected, not
            // assumed non-hybrid just because buildPresetSelection is undefined.
            const { step, fs, getRemoteInfo } = createStep(githubPushed, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: build\n',
            });
            fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'hybridSsr' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should remain eligible for a hydrated project with a valid dist and a non-hybrid framework', async () => {
            const { step, fs } = createStep(githubPushed, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: build\n',
            });
            fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({
                deploy: false,
                deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
            });
        });

        it('should detect the framework at the service\'s configured project path, not repository-wide', async () => {
            // A Next.js package.json sits at the repo root (outside the service's declared
            // `project` folder) -- must not cause a false hybridSsr classification, proving
            // detection is scoped to the service's project path rather than repository-wide.
            const { step, fs } = createStep(githubPushed, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./frontend\n    dist: build\n',
            });
            fs.directories.add('/workspace/frontend');
            fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
            fs.addFile(MockUri.file('/workspace/frontend/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({
                deploy: false,
                deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
            });
        });

        it('should detect a hybrid/SSR framework nested under the service\'s configured project path', async () => {
            const { step, fs, getRemoteInfo } = createStep(githubPushed, {
                azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./frontend\n    dist: build\n',
            });
            fs.directories.add('/workspace/frontend');
            fs.addFile(MockUri.file('/workspace/frontend/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

            const result = await step.prompt(hydratedContext());

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifactReason: 'hybridSsr' });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });
    });
});
