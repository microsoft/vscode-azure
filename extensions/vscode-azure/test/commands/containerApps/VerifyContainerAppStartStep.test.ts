/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { ExecuteStep, Wizard } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, DebugOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { CreateContainerAppContext } from '../../../src/commands/containerApps/CreateContainerAppContext';
import { VerifyContainerAppStartStep } from '../../../src/commands/containerApps/steps/VerifyContainerAppStartStep';
import { VerifyContainerAppStart } from '../../../src/commands/containerApps/VerifyContainerAppStart';
import { createMockAzdService } from '../../azd/MockAzdService';

const baseContext: CreateContainerAppContext = {
    resourceDisplayName: 'Container App',
    provision: true,
    deploy: true,
    subscription: makeSubscription(),
    iacFolder: MockUri.file('/project'),
    environmentName: 'dev',
};

describe('VerifyContainerAppStartStep (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    function createStep() {
        const code = createMockVsCode();
        const azd = createMockAzdService();
        azd.envGetValues.mock.mockImplementation(() => Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_CONTAINER_APP_NAME: 'app',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_RESOURCE_GROUP: 'rg',
        }));
        const resolveSubscription = mock.fn(() => Promise.resolve(makeSubscription()));
        return { code, azd, resolveSubscription, step: new VerifyContainerAppStartStep(code.vscode, azd, resolveSubscription) };
    }

    it('runs after image deployment with or without provisioning', () => {
        const { step } = createStep();
        expect(step.shouldExecute(baseContext)).to.be.true;
        expect(step.shouldExecute({ ...baseContext, provision: false })).to.be.true;
        expect(step.shouldExecute({ ...baseContext, deploy: false })).to.be.false;
        expect(step.shouldExecute({ ...baseContext, deploy: undefined })).to.be.false;
        expect(step.shouldExecute({ ...baseContext, iacFolder: undefined })).to.be.false;
    });

    it('advances the wizard while the separately dispatched command is unresolved', async () => {
        const { step, code, resolveSubscription } = createStep();
        const pending = Promise.withResolvers<undefined>();
        const dispatch = mock.method(code.vscode.commands, 'executeCommand', () => pending.promise);
        const next = new class extends ExecuteStep<CreateContainerAppContext> {
            public readonly execute = mock.fn(() => Promise.resolve());
        }();
        const wizard = new Wizard(new DebugOutputChannel('test'), baseContext, [], [step, next]);

        await wizard.run();

        expect(next.execute.mock.callCount()).to.equal(1);
        expect(dispatch.mock.calls[0].arguments[0]).to.equal(VerifyContainerAppStart.CommandId);
        const request = dispatch.mock.calls[0].arguments[1];
        expect(request).to.deep.equal({
            subscription: baseContext.subscription,
            resourceGroupName: 'rg', appName: 'app',
        });
        expect(Object.isFrozen(request)).to.be.true;
        expect(resolveSubscription.mock.callCount()).to.equal(0);
        pending.resolve(undefined);
    });

    it('snapshots a hydrated subscription without retaining the wizard context', async () => {
        const { step, code, resolveSubscription } = createStep();
        const dispatch = mock.method(code.vscode.commands, 'executeCommand', () => Promise.resolve());
        await step.execute({ ...baseContext, subscription: undefined, hydratedSubscriptionId: 'hydrated' });
        expect(dispatch.mock.calls[0].arguments[1]).to.deep.equal({
            subscription: await resolveSubscription.mock.calls[0].result,
            resourceGroupName: 'rg', appName: 'app',
        });
        expect(resolveSubscription.mock.calls[0].arguments).to.deep.equal(['hydrated']);
    });

    for (const kind of ['outputs', 'subscription'] as const) {
        it(`reports unavailable ${kind} through wizard error handling`, async () => {
            const { step, code, azd, resolveSubscription } = createStep();
            const dispatch = mock.method(code.vscode.commands, 'executeCommand', () => Promise.resolve());
            if (kind === 'outputs') {
                azd.envGetValues.mock.mockImplementation(() => Promise.resolve({}));
            } else {
                resolveSubscription.mock.mockImplementation(() => Promise.reject(new Error('not signed in')));
            }
            await expect(step.execute({ ...baseContext, subscription: undefined, hydratedSubscriptionId: 'sub' })).to.be.rejected;
            expect(dispatch.mock.callCount()).to.equal(0);
        });
    }
});
