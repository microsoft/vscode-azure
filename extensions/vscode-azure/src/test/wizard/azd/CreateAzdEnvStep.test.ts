/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';
import { CreateAzdEnvStep } from '../../../wizard/azd/CreateAzdEnvStep';

describe('CreateAzdEnvStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when all required fields are present', () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when iacFolder is missing', () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when environmentName is missing', () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when location is missing', () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when subscription is missing', () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
            };

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when all fields are missing', () => {
            const step = new CreateAzdEnvStep();
            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should throw a helpful error when azd is not installed', async () => {
            const step = new CreateAzdEnvStep();
            const context: Partial<AzdWizardContext> = {
                iacFolder: MockUri.file('/project') as never,
                environmentName: 'dev',
                location: { name: 'eastus' },
                subscription: { subscriptionId: 'sub-1' } as never,
            };

            try {
                await step.execute(context);
                expect.fail('Expected an error');
            } catch (e) {
                expect((e as Error).message).to.include('Azure Developer CLI (azd) was not found');
            }
        });
    });
});
