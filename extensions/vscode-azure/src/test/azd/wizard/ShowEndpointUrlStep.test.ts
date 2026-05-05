/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { ShowEndpointUrlStep } from '../../../azd/wizard/ShowEndpointUrlStep';

function createStep() {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const step = new ShowEndpointUrlStep(ctx);
    return { step, mockResult, ctx };
}

describe('ShowEndpointUrlStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when endpointUrls has entries', () => {
            const { step } = createStep();

            const context = {
                endpointUrls: ['https://myapp.azurewebsites.net'],
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when endpointUrls is empty', () => {
            const { step } = createStep();

            const context = {
                endpointUrls: [],
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when endpointUrls is undefined', () => {
            const { step } = createStep();

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should show an information message with the first URL', () => {
            const { step, mockResult } = createStep();

            const context = {
                endpointUrls: ['https://first.azurewebsites.net', 'https://second.azurewebsites.net'],
            } as AzdWizardContext;

            step.execute(context);

            const showInfo = mockResult.window.showInformationMessage as unknown as Mock<typeof mockResult.window.showInformationMessage>;
            expect(showInfo.mock.callCount()).to.equal(1);
            const msg = showInfo.mock.calls[0].arguments[0];
            expect(msg).to.include('https://first.azurewebsites.net');
        });
    });
});
