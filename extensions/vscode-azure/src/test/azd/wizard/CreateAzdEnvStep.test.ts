/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { CreateAzdEnvStep } from '../../../azd/wizard/CreateAzdEnvStep';
import { createMockAzdService } from '../MockAzdService';

describe('CreateAzdEnvStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when all required fields are present', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when iacFolder is missing', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when environmentName is missing', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when location is missing', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when subscription is missing', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when all fields are missing', () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd envNew with correct args', async () => {
            const azd = createMockAzdService();
            const step = new CreateAzdEnvStep(azd);
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            await step.execute(context);

            expect(azd.envNew.mock.callCount()).to.equal(1);
            const [name, location, subscriptionId, cwd] = azd.envNew.mock.calls[0].arguments;
            expect(name).to.equal('dev');
            expect(location).to.equal('eastus');
            expect(subscriptionId).to.equal('sub-1');
            expect((cwd as MockUri).path).to.equal('/project');
        });
    });
});
