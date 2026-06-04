/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { CreateAzdEnvStep } from '../../../azd/wizard/CreateAzdEnvStep';
import { createMockAzdService } from '../MockAzdService';

describe('CreateAzdEnvStep (unit)', () => {
    const baseContext: Partial<AzdWizardContext> = {
        iacFolder: MockUri.file('/project'),
        environmentName: 'dev',
        location: { name: 'eastus' },
        subscription: makeSubscription({ subscriptionId: 'sub-1' }),
    };

    describe('shouldExecute', () => {
        it('returns true when all required fields are present', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute(baseContext)).to.be.true;
        });

        it('returns false when iacFolder is missing', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute({ ...baseContext, iacFolder: undefined })).to.be.false;
        });

        it('returns false when environmentName is missing', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute({ ...baseContext, environmentName: undefined })).to.be.false;
        });

        it('returns false when location is missing', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute({ ...baseContext, location: undefined })).to.be.false;
        });

        it('returns false when subscription is missing', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute({ ...baseContext, subscription: undefined })).to.be.false;
        });

        it('returns false when existingDefaultEnvName is set (Bootstrapped state)', () => {
            const step = new CreateAzdEnvStep(createMockAzdService());
            expect(step.shouldExecute({ ...baseContext, existingDefaultEnvName: 'dev' })).to.be.false;
        });
    });

    describe('execute', () => {
        it('calls azd envNew with correct args when env does not exist', async () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);

            await step.execute(baseContext);

            expect(azd.envNew.mock.callCount()).to.equal(1);
            const [name, location, subscriptionId, cwd] = azd.envNew.mock.calls[0].arguments;
            expect(name).to.equal('dev');
            expect(location).to.equal('eastus');
            expect(subscriptionId).to.equal('sub-1');
            expect((cwd as vscode.Uri).path).to.equal('/project');
        });

        it('skips envNew when an env with the same name already exists in iacFolder', async () => {
            const azd = createMockAzdService([{ Name: 'dev', IsDefault: false }]);
            const step = new CreateAzdEnvStep(azd);

            await step.execute(baseContext);

            expect(azd.envNew.mock.callCount()).to.equal(0);
        });
    });
});
