/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { DetermineStaticWebAppDeploymentRouteStep } from '../../../src/commands/staticWebApps/steps/DetermineStaticWebAppDeploymentRouteStep';
import type { GitRemoteInfo, IGitRemoteService } from '../../../src/staticWebApps/GitRemoteService';
import { createMockAzdService } from '../../azd/MockAzdService';

function createStep(remote: GitRemoteInfo | undefined, azdVersionOk = true) {
    const gitRemote = { getRemoteInfo: () => Promise.resolve(remote) } as unknown as IGitRemoteService;
    const azd = createMockAzdService();
    azd.checkVersion.mock.mockImplementation(() => Promise.resolve(azdVersionOk));
    const step = new DetermineStaticWebAppDeploymentRouteStep(gitRemote, azd);
    return { step, azd };
}

function baseContext(overrides: Partial<CreateStaticWebAppContext> = {}): CreateStaticWebAppContext {
    return {
        mode: 'basic',
        job: 'deploy',
        iacFolder: MockUri.file('/workspace'),
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

    describe('static/export-capable apps (canDirectDeploy = true)', () => {
        it('should retain the direct-deploy fallback with no remote', async () => {
            const { step } = createStep(undefined);
            const result = await step.prompt(baseContext());
            expect(result).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback with an unsupported remote', async () => {
            const { step } = createStep(unsupported);
            const result = await step.prompt(baseContext());
            expect(result).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback when the branch is not pushed', async () => {
            const { step } = createStep(githubNotPushed);
            const result = await step.prompt(baseContext());
            expect(result).to.deep.equal({});
        });

        it('should retain the direct-deploy fallback when azd is below the pipeline version gate', async () => {
            const { step } = createStep(githubPushed, false);
            const result = await step.prompt(baseContext());
            expect(result).to.deep.equal({});
        });

        it('should route to CI/CD when supported, pushed, and version-gated ok', async () => {
            const { step } = createStep(githubPushed);
            const result = await step.prompt(baseContext());
            expect(result).to.deep.equal({
                deploy: false,
                deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
            });
        });
    });

    describe('hybrid/SSR apps (canDirectDeploy = false)', () => {
        const hybridContext = () => baseContext({ outputLocation: '' });

        it('should block with reason noRemote', async () => {
            const { step } = createStep(undefined);
            const result = await step.prompt(hybridContext());
            expect(result).to.deep.equal({ deploy: false, deploymentBlockedReason: 'noRemote' });
        });

        it('should block with reason unsupportedRemote', async () => {
            const { step } = createStep(unsupported);
            const result = await step.prompt(hybridContext());
            expect(result).to.deep.equal({ deploy: false, deploymentBlockedReason: 'unsupportedRemote' });
        });

        it('should block with reason notPushed', async () => {
            const { step } = createStep(githubNotPushed);
            const result = await step.prompt(hybridContext());
            expect(result).to.deep.equal({ deploy: false, deploymentBlockedReason: 'notPushed' });
        });

        it('should block with reason azdVersionTooLow', async () => {
            const { step } = createStep(githubPushed, false);
            const result = await step.prompt(hybridContext());
            expect(result).to.deep.equal({ deploy: false, deploymentBlockedReason: 'azdVersionTooLow' });
        });

        it('should route to CI/CD when supported, pushed, and version-gated ok (same as static apps)', async () => {
            const { step } = createStep(githubPushed);
            const result = await step.prompt(hybridContext());
            expect(result).to.deep.equal({
                deploy: false,
                deploymentRoute: { provider: 'github', repositoryUrl: githubPushed.url, branch: githubPushed.branch },
            });
        });
    });
});
