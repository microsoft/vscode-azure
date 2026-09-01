/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { delay } from '@microsoft/vscode-azure-utils';
import type { AzureSubscription } from '@microsoft/vscode-azure-azutils';
import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { AzdProvisionStep } from '../../../src/azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep(resolved?: AzureSubscription) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const armProvider = { trackDeployment: mock.fn() } as never;
    const tempDirManager = new TempDirManager(ctx);
    const resolveSubscription = mock.fn((_subscriptionId: string) => Promise.resolve(resolved));
    const step = new AzdProvisionStep(ctx, azd, output, armProvider, resolveSubscription, tempDirManager);
    return {
        azd,
        step,
        armProvider: armProvider as unknown as { trackDeployment: ReturnType<typeof mock.fn> },
        resolveSubscription,
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
            expect((azd.provision.mock.calls[0].arguments[0]).path).to.equal('/project');
            const env = azd.provision.mock.calls[0].arguments[1] as Record<string, string>;
            expect(env).to.have.property('AZD_DEPLOYMENT_ID_FILE');
            expect(env.AZD_DEPLOYMENT_ID_FILE).to.include('.jsonl');
        });

        it('should track a deployment from the JSONL file after provision completes', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep();

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

        it('should forward the hydrated tenantId hint to trackDeployment', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep();

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                hydratedTenantId: 'tenant-9',
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[0]).to.equal(deploymentId);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.equal('tenant-9');
        });

        it('should forward the selected subscription account id hint to trackDeployment', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep();

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                subscription: { accountId: 'acct-9' },
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[2]).to.equal('acct-9');
        });

        it('should look up the tenant from the deployment id when nothing names it', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, resolveSubscription, fs } = createStep(
                makeSubscription({ subscriptionId: 'sub-1', tenantId: 'tenant-owning', accountId: 'acct-owning' }),
            );

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            // `azd up` on an existing project runs no pick step and no hydration,
            // so the deployment id is the only thing naming the subscription.
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(resolveSubscription.mock.calls.map(call => call.arguments[0])).to.deep.equal(['sub-1']);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.equal('tenant-owning');
            expect(armProvider.trackDeployment.mock.calls[0].arguments[2]).to.equal('acct-owning');
        });

        it('should look up the tenant when a hydrated env names only the subscription', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, resolveSubscription, fs } = createStep(
                makeSubscription({ subscriptionId: 'sub-1', tenantId: 'tenant-owning', accountId: 'acct-owning' }),
            );

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                hydratedSubscriptionId: 'sub-1',
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            // AZURE_TENANT_ID is optional, and without the lookup the deployment
            // authenticates to the home tenant, which ARM rejects.
            expect(resolveSubscription.mock.calls.map(call => call.arguments[0])).to.deep.equal(['sub-1']);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.equal('tenant-owning');
            expect(armProvider.trackDeployment.mock.calls[0].arguments[2]).to.equal('acct-owning');
        });

        it('should look the tenant up once for deployments sharing a subscription', async () => {
            const id1 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const id2 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-2';
            const { azd, step, armProvider, resolveSubscription, fs } = createStep(
                makeSubscription({ subscriptionId: 'sub-1', tenantId: 'tenant-owning' }),
            );

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

            // A provision emits many deployments into one subscription, and a walk
            // per deployment would list every tenant again.
            expect(resolveSubscription.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.callCount()).to.equal(2);
            expect(armProvider.trackDeployment.mock.calls[1].arguments[1]).to.equal('tenant-owning');
        });

        it('should not look up a tenant the env already names', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, resolveSubscription, fs } = createStep();

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                hydratedSubscriptionId: 'sub-1',
                hydratedTenantId: 'tenant-9',
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(resolveSubscription.mock.callCount()).to.equal(0);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.equal('tenant-9');
        });

        it('should still track the deployment when the subscription cannot be resolved', async () => {
            const deploymentId = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const { azd, step, armProvider, fs } = createStep(undefined);

            azd.provision.mock.mockImplementation((_cwd: unknown, env: Record<string, string>) => {
                const filePath = env.AZD_DEPLOYMENT_ID_FILE;
                fs.addFile(MockUri.file(filePath), makeJsonl(deploymentId));
                return Promise.resolve();
            });

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
                hydratedSubscriptionId: 'sub-1',
            } as AzdWizardContext;

            await step.execute(context);
            await delay(0);

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[1]).to.be.undefined;
        });

        it('should track multiple deployments from JSONL', async () => {
            const id1 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1';
            const id2 = '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-2';
            const { azd, step, armProvider, fs } = createStep();

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
            const { step, armProvider } = createStep();

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
            const { azd, step, armProvider, fs } = createStep();

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
            const { azd, step, armProvider, fs } = createStep();

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

            await expect(step.execute(context)).to.be.rejectedWith('provision failed');
        });
    });
});
