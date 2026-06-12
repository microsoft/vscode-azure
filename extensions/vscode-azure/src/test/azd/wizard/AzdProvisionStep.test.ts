/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { delay } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../../azd/TempDirManager';
import { AzdProvisionStep } from '../../../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep(options?: { subscriptionId?: string }) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const armProvider = { trackDeployment: mock.fn() } as never;
    const sub = options?.subscriptionId ? makeSubscription({ subscriptionId: options.subscriptionId }) : undefined;
    const subscriptionResolver = mock.fn((id: string) =>
        Promise.resolve(sub?.subscriptionId.toLowerCase() === id.toLowerCase() ? sub : undefined));
    const tempDirManager = new TempDirManager(ctx);
    const step = new AzdProvisionStep(ctx, azd, output, armProvider, subscriptionResolver, tempDirManager);
    return {
        azd,
        step,
        subscriptionResolver,
        armProvider: armProvider as unknown as { trackDeployment: ReturnType<typeof mock.fn> },
        output,
        fs: mockResult.fs,
    };
}

/** Builds a JSONL string from an array of deployment IDs. */
function makeJsonl(...deploymentIds: string[]): string {
    return deploymentIds.map(id => JSON.stringify({ deploymentId: id })).join('\n') + '\n';
}

describe('AzdProvisionStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when provision is true and iacFolder is set', () => {
            const { step } = createStep();

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when provision is false', () => {
            const { step } = createStep();

            const context = {
                provision: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when provision is undefined', () => {
            const { step } = createStep();

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { step } = createStep();

            const context = {
                provision: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { step } = createStep();

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd.provision with the iac folder and AZD_DEPLOYMENT_ID_FILE env', async () => {
            const { azd, step } = createStep();
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.provision.mock.callCount()).to.equal(1);
            expect((azd.provision.mock.calls[0].arguments[0] as vscode.Uri).path).to.equal('/project');
            const env = azd.provision.mock.calls[0].arguments[1] as Record<string, string>;
            expect(env).to.have.property('AZD_DEPLOYMENT_ID_FILE');
            expect(env.AZD_DEPLOYMENT_ID_FILE).to.include('.jsonl');
        });

        it('should track a deployment from the JSONL file after provision completes', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep({ subscriptionId: 'sub-1' });

            // Make provision write the JSONL file before resolving
            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            // Let microtasks settle (the final readAndTrack is in the finally block)
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[0]).to.equal(deploymentId);
        });

        it('should use context.subscription without calling the resolver when it matches', async () => {
            const deploymentId = '/subscriptions/sub-ctx/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, subscriptionResolver, fs } = createStep();
            const subscription = makeSubscription({ subscriptionId: 'sub-ctx' });

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                subscription,
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(subscriptionResolver.mock.callCount()).to.equal(0);
            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.equal(subscription);
        });

        it('should fall back to the resolver when context.subscription does not match the deployment', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, subscriptionResolver, fs } = createStep({ subscriptionId: 'sub-1' });
            // Context carries a different subscription than the deployment's.
            const otherSubscription = makeSubscription({ subscriptionId: 'sub-other' });

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                subscription: otherSubscription,
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(subscriptionResolver.mock.callCount()).to.be.greaterThan(0);
            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect((armProvider.trackDeployment.mock.calls[0].arguments[1] as { subscriptionId: string }).subscriptionId).to.equal('sub-1');
        });


        it('should track multiple deployments from JSONL', async () => {
            const id1 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const id2 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-2';
            const { azd, step, armProvider, fs } = createStep({ subscriptionId: 'sub-1' });

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(id1, id2));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(2);
            const tracked = [
                armProvider.trackDeployment.mock.calls[0].arguments[0] as string,
                armProvider.trackDeployment.mock.calls[1].arguments[0] as string,
            ];
            expect(tracked).to.include(id1);
            expect(tracked).to.include(id2);
        });

        it('should not track when no JSONL file is written', async () => {
            const { step, armProvider } = createStep({ subscriptionId: 'sub-1' });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(0);
        });

        it('should not track when subscription cannot be resolved', async () => {
            const deploymentId = '/subscriptions/unknown-sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            // No subscriptions configured — resolveSubscription returns undefined
            const { azd, step, armProvider, fs } = createStep();

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(0);
        });

        it('should deduplicate deployment IDs', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep({ subscriptionId: 'sub-1' });

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                // Write the same ID twice
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId, deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
        });

        it('should skip malformed JSONL lines gracefully', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep({ subscriptionId: 'sub-1' });

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                const content = 'not valid json\n' + JSON.stringify({ deploymentId }) + '\n';
                fs.addFile(MockUri.file(filePath), content);
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[0]).to.equal(deploymentId);
        });

        it('should still propagate provision errors', async () => {
            const { azd, step } = createStep();

            azd.provision.mock.mockImplementation(() => Promise.reject(new Error('provision failed')));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            try {
                await step.execute(context);
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.equal('provision failed');
            }
        });
    });
});
