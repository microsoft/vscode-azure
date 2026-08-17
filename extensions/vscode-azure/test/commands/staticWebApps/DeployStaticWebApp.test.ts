/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import * as path from 'node:path';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { resolveWindowsProjectPath } from '../../../src/commands/staticWebApps/deploymentRouting';
import { DeployStaticWebApp, type DeployStaticWebAppArgs } from '../../../src/commands/staticWebApps/DeployStaticWebApp';
import type { GitRemoteInfo, IGitRemoteService } from '../../../src/staticWebApps/GitRemoteService';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockCodeProvider } from '../../tree/activity/MockActivityProviders';

const azureYaml = 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: build\n';

function createMockGitRemoteService(info: GitRemoteInfo | undefined): IGitRemoteService & { getRemoteInfo: ReturnType<typeof mock.fn> } {
    return { getRemoteInfo: mock.fn(() => Promise.resolve(info)) } as never;
}

function createCommand(options: { readonly remote?: GitRemoteInfo; readonly azdVersionOk?: boolean; readonly azureYaml?: string | null } = {}) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const actionContext = createActionContext('test');
    const azd = createMockAzdService();
    azd.checkVersion.mock.mockImplementation(() => Promise.resolve(options.azdVersionOk ?? true));
    azd.findAzureYaml.mock.mockImplementation(async (dir: vscode.Uri) => {
        const candidate = ctx.code.Uri.joinPath(dir, 'azure.yaml');
        try {
            await ctx.code.workspace.fs.stat(candidate);
            return [candidate];
        } catch {
            return [];
        }
    });
    // Every test uses /workspace as the iacFolder; register it as a real directory so
    // resolveStaticWebAppServiceProjectFolder's workspace.fs.stat check succeeds for `project: .`.
    mockResult.fs.directories.add('/workspace');
    // Defaults to a valid `host: staticwebapp` service at /workspace/azure.yaml so tests that
    // don't care about artifact-detection details (most "pre-filled args" tests) aren't
    // incidentally blocked by the dist-validity check. Pass `azureYaml: null` to simulate no
    // azure.yaml at all, or a custom string to simulate an invalid/absent service.
    if (options.azureYaml !== null) {
        mockResult.fs.addFile(MockUri.file('/workspace/azure.yaml'), options.azureYaml ?? azureYaml);
    }
    const gitRemote = createMockGitRemoteService(options.remote);
    const codeProvider = createMockCodeProvider();

    const command = new DeployStaticWebApp(actionContext, ctx, azd, gitRemote, codeProvider);
    return { command, ctx, mockResult, actionContext, azd, gitRemote, codeProvider };
}

function setupWorkspaceProject(mockResult: ReturnType<typeof createMockCodeContext>['mock'], folderPath: string, folderName: string, hasStaticWebApp = true) {
    mockResult.workspaceFolders.push({ uri: MockUri.file(folderPath), name: folderName, index: mockResult.workspaceFolders.length });
    mockResult.fs.directories.add(folderPath);
    mockResult.fs.addFile(MockUri.file(`${folderPath}/azure.yaml`), hasStaticWebApp ? azureYaml : 'services:\n  api:\n    host: function\n');
}

function mockShowQuickPick(ctx: ReturnType<typeof createMockCodeContext>['ctx'], returnLabel: string | undefined) {
    const showQuickPick = mock.fn((items: readonly { readonly label: string }[]) =>
        Promise.resolve(items.find(item => item.label === returnLabel)));
    (ctx.code.window as unknown as { showQuickPick: unknown }).showQuickPick = showQuickPick;
    return showQuickPick;
}

describe('DeployStaticWebApp (unit)', () => {
    const args: DeployStaticWebAppArgs = { iacFolder: MockUri.file('/workspace') };

    describe('with pre-filled args (launched from creation)', () => {
        it('should deploy directly when no remote is known', async () => {
            const { command, azd } = createCommand();

            await command.execute(args);

            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should configure CI/CD when a github provider is pre-filled (skipping remote resolution)', async () => {
            const { command, azd, gitRemote } = createCommand();

            await command.execute({ ...args, provider: 'github', environmentName: 'dev' });

            expect(gitRemote.getRemoteInfo.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.calls[0].arguments).to.deep.equal([args.iacFolder, 'github', 'dev']);
            expect(azd.deploy.mock.callCount()).to.equal(0);
        });

        it('should configure CI/CD when an azdo provider is pre-filled', async () => {
            const { command, azd } = createCommand();

            await command.execute({ ...args, provider: 'azdo' });

            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.calls[0].arguments[1]).to.equal('azdo');
        });

        it('should show a success message (not a deployed claim) once CI/CD is configured', async () => {
            const { command, mockResult } = createCommand();

            await command.execute({ ...args, provider: 'github' });

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            const [message] = mockResult.window.showInformationMessage.mock.calls[0].arguments as unknown as [string];
            expect(message).to.include('CI/CD configured');
            expect(message).to.not.include('deployed');
        });

        it('should force fresh remote resolution when args omit provider, even with iacFolder pre-filled', async () => {
            const { command, azd, gitRemote } = createCommand({
                remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true },
            });

            await command.execute(args); // args has iacFolder but no provider

            expect(gitRemote.getRemoteInfo.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
        });

        it('should never call azd.deploy or azd.pipelineConfig for a Next.js hybrid/SSR project, even with a supported, pushed remote', async () => {
            const { command, azd, mockResult, gitRemote } = createCommand({
                remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true },
            });
            mockResult.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

            await command.execute({ ...args, provider: 'github' });

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            expect(gitRemote.getRemoteInfo.mock.callCount()).to.equal(0); // short-circuits before any remote check
            expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
            const [message] = mockResult.window.showErrorMessage.mock.calls[0].arguments as unknown as [string];
            expect(message).to.not.include('deployed');
            expect(message).to.include('Next.js');
        });

        describe('fresh detection combines framework AND the existing service dist (artifactSupportsAutoDeploy omitted)', () => {
            it('should block when no azure.yaml exists at all', async () => {
                const { command, azd, mockResult } = createCommand({ azureYaml: null });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
                expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
                expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
            });

            it('should block when azure.yaml has no host: staticwebapp service at all', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  api:\n    host: function\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
                expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            });

            it('should show configuration guidance (not Next.js wording) for a malformed static service', async () => {
                // A perfectly ordinary (non-hybrid) static app whose azure.yaml is just
                // misconfigured -- must never be told it's a Next.js SSR problem.
                const { command, mockResult } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: ""\n' });

                await command.execute(args);

                expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
                const [message] = mockResult.window.showErrorMessage.mock.calls[0].arguments as unknown as [string];
                expect(message).to.not.include('Next.js');
                expect(message.toLowerCase()).to.include('configuration');
            });

            it('should block when the service dist is missing', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
            });

            it('should block when the service dist is an empty string', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: ""\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
            });

            it('should block when the service dist is "."', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: "."\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
            });

            it('should block when the service dist is "/"', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: "/"\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
            });

            it('should block when the service dist is a non-string value', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: 123\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
            });

            describe('invalid service project paths (azd path semantics)', () => {
                it('should block when the service project field is missing entirely', async () => {
                    const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    dist: build\n' });

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                    expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
                });

                it('should block when the service project is a non-string value', async () => {
                    const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: 123\n    dist: build\n' });

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                });

                it('should block when the service project is an empty string', async () => {
                    const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ""\n    dist: build\n' });

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                });

                it('should split a project path on the host-native separator, whatever character that is on this platform', async () => {
                    // Host-adaptive: builds the fixture with path.sep (the actual separator this
                    // platform's `path` module recognizes) rather than hardcoding a POSIX or
                    // Windows-specific character.
                    const { command, azd, mockResult } = createCommand({
                        azureYaml: `services:\n  web:\n    host: staticwebapp\n    project: frontend${path.sep}app\n    dist: build\n`,
                    });
                    mockResult.fs.directories.add('/workspace/frontend/app');
                    mockResult.fs.addFile(MockUri.file('/workspace/frontend/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(1);
                });

                if (process.platform === 'win32') {
                    it('should treat a backslash in project as a path separator on Windows', async () => {
                        const { command, azd, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: frontend\\app\n    dist: build\n',
                        });
                        mockResult.fs.directories.add('/workspace/frontend/app');
                        mockResult.fs.addFile(MockUri.file('/workspace/frontend/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(1);
                    });
                } else {
                    it('should treat a backslash in project as a literal character, not a separator, on POSIX', async () => {
                        const { command, azd, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: literal\\name\n    dist: build\n',
                        });
                        // Only the (incorrectly) split two-segment form exists -- the literal,
                        // unsplit "literal\name" single segment azd/Node would actually look for
                        // on POSIX was never registered, so this must be invalid, proving
                        // backslash was not treated as a separator.
                        mockResult.fs.directories.add('/workspace/literal/name');
                        mockResult.fs.addFile(MockUri.file('/workspace/literal/name/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(0);
                    });
                }

                it('should block when the service project path does not exist', async () => {
                    const { command, azd } = createCommand({
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./doesnotexist\n    dist: build\n',
                    });

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                    expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
                });

                it('should block when the service project path resolves to a file, not a directory', async () => {
                    const { command, azd, mockResult } = createCommand({
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./config.json\n    dist: build\n',
                    });
                    mockResult.fs.addFile(MockUri.file('/workspace/config.json'), '{}');

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                });

                it('should accept a project path that traverses above iacFolder via ".." when it resolves to an existing directory, mirroring azd\'s filepath.Join', async () => {
                    const { command, azd, mockResult } = createCommand({
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ../outside\n    dist: build\n',
                    });
                    mockResult.fs.directories.add('/outside');
                    mockResult.fs.addFile(MockUri.file('/outside/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(1);
                });

                it('should block when a ".." project path resolves outside iacFolder but the target does not exist', async () => {
                    const { command, azd } = createCommand({
                        azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ../doesnotexist\n    dist: build\n',
                    });

                    await command.execute(args);

                    expect(azd.deploy.mock.callCount()).to.equal(0);
                });

                if (process.platform === 'win32') {
                    it('should treat a rooted-without-volume path ("/opt/app") as relative on Windows, joining it under iacFolder rather than treating it as OS-root-absolute (Go: filepath.IsAbs("/opt/app") is false on Windows)', async () => {
                        const { command, azd, ctx, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/app\n    dist: build\n',
                        });
                        const projectUri = ctx.code.Uri.file(resolveWindowsProjectPath(ctx.code.Uri.file('/workspace').fsPath, '/opt/app'));
                        mockResult.fs.directories.add(projectUri.path);
                        mockResult.fs.addFile(ctx.code.Uri.joinPath(projectUri, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(1);
                    });
                } else {
                    it('should accept an absolute POSIX-style project path ("/opt/app") used unchanged, not anchored under iacFolder', async () => {
                        // On POSIX, a leading-slash path is absolute per both Node's path.posix
                        // and Go's filepath.IsAbs -- no divergence to correct, unlike on Windows.
                        const { command, azd, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/app\n    dist: build\n',
                        });
                        mockResult.fs.directories.add('/opt/app');
                        mockResult.fs.addFile(MockUri.file('/opt/app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(1);
                    });

                    it('should block when an absolute POSIX-style project path does not exist', async () => {
                        const { command, azd } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: /opt/doesnotexist\n    dist: build\n',
                        });

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(0);
                    });
                }

                if (process.platform === 'win32') {
                    it('should accept a Windows drive-absolute project path (e.g. C:\\...) used unchanged, not anchored under iacFolder', async () => {
                        const { command, azd, ctx, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: C:\\opt\\app\n    dist: build\n',
                        });
                        // Derive the resolved path the same way the production code does (via
                        // resolveWindowsProjectPath + Uri.file), rather than hand-guessing the
                        // URI's case-normalized representation.
                        const projectUri = ctx.code.Uri.file(resolveWindowsProjectPath(ctx.code.Uri.file('/workspace').fsPath, 'C:\\opt\\app'));
                        mockResult.fs.directories.add(projectUri.path);
                        mockResult.fs.addFile(ctx.code.Uri.joinPath(projectUri, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(1);
                    });
                } else {
                    it('should treat a Windows drive-letter form (e.g. C:\\...) as a plain relative path segment under iacFolder on POSIX, not a drive-absolute path', async () => {
                        // On POSIX, "C:\opt\app" has no leading "/" so path.isAbsolute is false,
                        // and backslash is a literal character -- it resolves as ONE relative
                        // path segment under iacFolder, not an absolute Windows path.
                        const { command, azd, mockResult } = createCommand({
                            azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: C:\\opt\\app\n    dist: build\n',
                        });
                        mockResult.fs.directories.add('/workspace/C:\\opt\\app');
                        mockResult.fs.addFile(MockUri.file('/workspace/C:\\opt\\app/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                        await command.execute(args);

                        expect(azd.deploy.mock.callCount()).to.equal(1);
                    });
                }
            });

            it('should proceed when the service has a valid dist and the framework is not hybrid/SSR', async () => {
                const { command, azd } = createCommand({ azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: build\n' });

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(1);
            });

            it('should detect the framework at the service\'s configured project path, not repository-wide', async () => {
                const { command, azd, mockResult } = createCommand({
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./frontend\n    dist: build\n',
                });
                mockResult.fs.directories.add('/workspace/frontend');
                mockResult.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
                mockResult.fs.addFile(MockUri.file('/workspace/frontend/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(1);
            });

            it('should detect a hybrid/SSR framework nested under the service\'s configured project path', async () => {
                const { command, azd, mockResult } = createCommand({
                    azureYaml: 'services:\n  web:\n    host: staticwebapp\n    project: ./frontend\n    dist: build\n',
                });
                mockResult.fs.directories.add('/workspace/frontend');
                mockResult.fs.addFile(MockUri.file('/workspace/frontend/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

                await command.execute(args);

                expect(azd.deploy.mock.callCount()).to.equal(0);
                const [message] = mockResult.window.showErrorMessage.mock.calls[0].arguments as unknown as [string];
                expect(message).to.include('Next.js');
            });
        });

        it('should trust artifactSupportsAutoDeploy=true from creation and skip re-detection (avoids monorepo/override contradictions)', async () => {
            const { command, azd, mockResult } = createCommand();
            // Present a Next.js package.json that a fresh heuristic scan would classify as
            // hybrid/SSR -- creation already confirmed this project supports auto-deploy (e.g. a
            // monorepo where the actual deployed folder differs, or output was overridden), so
            // this command must trust that decision rather than re-detecting and contradicting it.
            mockResult.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

            await command.execute({ ...args, provider: 'github', artifactSupportsAutoDeploy: true });

            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
            expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(0);
        });

        it('should trust artifactSupportsAutoDeploy=false from creation and skip re-detection', async () => {
            const { command, azd, mockResult } = createCommand();
            // No Next.js markers present -- a fresh scan would NOT block this, proving the
            // explicit false is what caused the block (detection was skipped, not re-run).

            await command.execute({ ...args, provider: 'github', artifactSupportsAutoDeploy: false });

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
        });

        it('should use the pre-filled branch (not "default branch") in the CI/CD success message', async () => {
            const { command, mockResult } = createCommand();

            await command.execute({ ...args, provider: 'github', branch: 'release' });

            const [message] = mockResult.window.showInformationMessage.mock.calls[0].arguments as unknown as [string];
            expect(message).to.include('"release"');
            expect(message).to.not.include('default branch');
        });

        it('should say "configured branch" (not "default branch") when no branch is known', async () => {
            const { command, mockResult } = createCommand();

            await command.execute({ ...args, provider: 'github' });

            const [message] = mockResult.window.showInformationMessage.mock.calls[0].arguments as unknown as [string];
            expect(message).to.include('configured branch');
            expect(message).to.not.include('default branch');
        });
    });

    describe('routing via real no-args resolution (command palette)', () => {
        function createResolvedCommand(options: { readonly remote?: GitRemoteInfo; readonly azdVersionOk?: boolean } = {}) {
            const created = createCommand(options);
            setupWorkspaceProject(created.mockResult, '/workspace', 'workspace');
            return created;
        }

        it('should deploy directly for an unsupported remote', async () => {
            const { command, azd } = createResolvedCommand({ remote: { provider: 'unsupported', url: 'https://gitlab.com/x/y.git', hasUpstream: true } });

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should explain and offer a direct-deploy fallback when the branch is not pushed', async () => {
            const { command, azd, mockResult } = createResolvedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: false } });
            mockResult.messageResponses.push('Deploy Directly Instead');

            await command.execute();

            expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should not deploy at all when the not-pushed fallback is declined', async () => {
            const { command, azd, mockResult } = createResolvedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: false } });
            mockResult.messageResponses.push(undefined);

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should offer a direct-deploy fallback when azd is below the pipeline version gate', async () => {
            const { command, azd, mockResult } = createResolvedCommand({
                remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true },
                azdVersionOk: false,
            });
            mockResult.messageResponses.push('Deploy Directly Instead');

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should configure CI/CD for a supported, pushed, version-gated-ok remote', async () => {
            const { command, azd, gitRemote } = createResolvedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true } });

            await command.execute();

            expect(gitRemote.getRemoteInfo.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(0);
        });

        it('should use the tracked remote\'s branch (not "default branch") in the success message when resolved fresh', async () => {
            const { command, mockResult } = createResolvedCommand({
                remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true, branch: 'feature/x' },
            });

            await command.execute();

            const [message] = mockResult.window.showInformationMessage.mock.calls[0].arguments as unknown as [string];
            expect(message).to.include('"feature/x"');
            expect(message).to.not.include('default branch');
        });

        it('should never route Next.js hybrid/SSR to CI/CD or direct deploy, even with a supported, pushed remote', async () => {
            const { command, azd, mockResult, gitRemote } = createResolvedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true } });
            mockResult.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            expect(gitRemote.getRemoteInfo.mock.callCount()).to.equal(0);
            expect(mockResult.window.showErrorMessage.mock.callCount()).to.equal(1);
        });

        it('should block via real no-args resolution when the recognized existing service has an invalid dist', async () => {
            // hasStaticWebAppService (used to filter resolveProject candidates) only recognizes
            // the service's *existence* -- this proves its *value* is still checked afterward,
            // rather than being ignored once the project is recognized as "a SWA project".
            const { command, azd, mockResult } = createResolvedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true } });
            mockResult.fs.addFile(MockUri.file('/workspace/azure.yaml'), 'services:\n  web:\n    host: staticwebapp\n    project: .\n    dist: ""\n');

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });
    });

    describe('provider-switch guard', () => {
        function createGuardedCommand(options: { readonly remote?: GitRemoteInfo } = {}) {
            const created = createCommand(options);
            setupWorkspaceProject(created.mockResult, '/workspace', 'workspace');
            return created;
        }

        it('should require confirmation when the other provider workflow already exists, and abort on cancel', async () => {
            const { command, azd, mockResult } = createGuardedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true } });
            mockResult.fs.addFile(MockUri.file('/workspace/.azdo/pipelines/azure-dev.yml'), 'trigger: none');
            mockResult.messageResponses.push(undefined);

            await command.execute();

            expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
            expect(azd.deploy.mock.callCount()).to.equal(0);
        });

        it('should proceed when the user confirms the provider switch', async () => {
            const { command, azd, mockResult } = createGuardedCommand({ remote: { provider: 'github', url: 'https://github.com/o/r.git', hasUpstream: true } });
            mockResult.fs.addFile(MockUri.file('/workspace/.azuredevops/pipelines/azure-dev.yaml'), 'trigger: none');
            mockResult.messageResponses.push('Continue');

            await command.execute();

            expect(azd.pipelineConfig.mock.callCount()).to.equal(1);
        });
    });

    describe('without args (command palette)', () => {
        it('should explain when no Static Web Apps project is open', async () => {
            const { command, azd, mockResult } = createCommand();

            await command.execute();

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(0);
            expect(azd.pipelineConfig.mock.callCount()).to.equal(0);
        });

        it('should explain when azure.yaml exists but declares no staticwebapp service', async () => {
            const { command, azd, mockResult } = createCommand();
            setupWorkspaceProject(mockResult, '/workspace', 'workspace', false);

            await command.execute();

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(0);
        });

        it('should proceed directly with the single matching project', async () => {
            const { command, azd, mockResult } = createCommand();
            setupWorkspaceProject(mockResult, '/workspace', 'workspace');

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(1);
        });

        it('should prompt with a QuickPick when multiple projects match, and use the selection', async () => {
            const { command, azd, ctx, mockResult } = createCommand();
            setupWorkspaceProject(mockResult, '/workspace-a', 'a');
            setupWorkspaceProject(mockResult, '/workspace-b', 'b');
            const showQuickPick = mockShowQuickPick(ctx, 'b');

            await command.execute();

            expect(showQuickPick.mock.callCount()).to.equal(1);
            expect(azd.deploy.mock.callCount()).to.equal(1);
            const deployedFolder = (azd.deploy.mock.calls[0].arguments[0] as vscode.Uri).path;
            expect(deployedFolder).to.equal('/workspace-b');
        });

        it('should do nothing when the QuickPick is dismissed', async () => {
            const { command, azd, ctx, mockResult } = createCommand();
            setupWorkspaceProject(mockResult, '/workspace-a', 'a');
            setupWorkspaceProject(mockResult, '/workspace-b', 'b');
            mockShowQuickPick(ctx, undefined);

            await command.execute();

            expect(azd.deploy.mock.callCount()).to.equal(0);
        });
    });
});
