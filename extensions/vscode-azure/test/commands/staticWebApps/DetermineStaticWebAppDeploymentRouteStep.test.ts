/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock as nodeMock } from 'node:test';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { DetermineStaticWebAppDeploymentRouteStep } from '../../../src/commands/staticWebApps/steps/DetermineStaticWebAppDeploymentRouteStep';
import type { GitRemoteInfo, IGitRemoteService } from '../../../src/staticWebApps/GitRemoteService';
import { createMockAzdService } from '../../azd/MockAzdService';

function createStep(remote: GitRemoteInfo | undefined, options: { readonly azdVersionOk?: boolean; readonly conflictingWorkflowPath?: string } = {}) {
    const { vscode: code, fs } = createMockVsCode();
    if (options.conflictingWorkflowPath) {
        fs.addFile(MockUri.file(options.conflictingWorkflowPath), 'trigger: none');
    }
    const getRemoteInfo = nodeMock.fn(() => Promise.resolve(remote));
    const gitRemote = { getRemoteInfo } as unknown as IGitRemoteService;
    const azd = createMockAzdService();
    azd.checkVersion.mock.mockImplementation(() => Promise.resolve(options.azdVersionOk ?? true));
    const step = new DetermineStaticWebAppDeploymentRouteStep(code, gitRemote, azd);
    return { step, azd, getRemoteInfo };
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

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifact: true });
            expect(getRemoteInfo.mock.callCount()).to.equal(0);
        });

        it('should block on "." and "/" output locations the same way', async () => {
            const { step } = createStep(githubPushed);

            expect(await step.prompt(baseContext({ outputLocation: '.' }))).to.deep.equal({ deploy: false, deploymentUnsupportedArtifact: true });
            expect(await step.prompt(baseContext({ outputLocation: '/' }))).to.deep.equal({ deploy: false, deploymentUnsupportedArtifact: true });
        });

        it('should block Next.js hybrid/SSR even when a non-empty custom output location is given', async () => {
            // The user overrode the output away from the empty default -- canAzdDeployStaticWebApp
            // alone would say "distinct from source", but the framework itself is still SSR and
            // cannot be served by a static deploy or by a generated azd-deploy-only CI workflow.
            const { step, getRemoteInfo } = createStep(githubPushed);

            const result = await step.prompt(baseContext({ buildPresetSelection: 'nextjs', outputLocation: 'build' }));

            expect(result).to.deep.equal({ deploy: false, deploymentUnsupportedArtifact: true });
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
});
