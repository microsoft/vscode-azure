/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { delay } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { ShowEndpointUrlStep } from '../../../src/azd/wizard/ShowEndpointUrlStep';
import { OpenUrl } from '../../../src/commands/OpenUrl';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const step = new ShowEndpointUrlStep(ctx, azd, output, new OpenUrl(ctx.code));
    return { step, azd, mockResult, ctx, output };
}

describe('ShowEndpointUrlStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when deploy is true and iacFolder is set', () => {
            const { step } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when iacFolder is undefined', () => {
            const { step } = createStep();

            expect(step.shouldExecute({ deploy: true })).to.be.false;
        });

        it('should return false when deploy is false (provision-only, CI-routed, or blocked flows)', () => {
            const { step } = createStep();

            const context = {
                deploy: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when deploy is undefined', () => {
            const { step } = createStep();

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd show and display a toast with the ingress URL', async () => {
            const { step, azd, mockResult } = createStep();

            azd.show.mock.mockImplementation(() => Promise.resolve({
                name: 'my-app',
                services: {
                    myfunc: { ingressUrl: 'https://myapp.azurewebsites.net' },
                },
            }));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            const msg = mockResult.window.showInformationMessage.mock.calls[0].arguments[0];
            expect(msg).to.include('https://myapp.azurewebsites.net');
        });

        it('should use the first ingress URL when multiple services have URLs', async () => {
            const { step, azd, mockResult } = createStep();

            azd.show.mock.mockImplementation(() => Promise.resolve({
                name: 'my-app',
                services: {
                    svc1: { ingressUrl: 'https://first.azurewebsites.net' },
                    svc2: { ingressUrl: 'https://second.azurewebsites.net' },
                },
            }));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
            const msg = mockResult.window.showInformationMessage.mock.calls[0].arguments[0];
            expect(msg).to.include('https://first.azurewebsites.net');
        });

        it('should not show a toast when azd show returns no services', async () => {
            const { step, azd, mockResult } = createStep();

            azd.show.mock.mockImplementation(() => Promise.resolve({
                name: 'my-app',
            }));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(0);
        });

        it('should not show a toast when services have no ingress URLs', async () => {
            const { step, azd, mockResult } = createStep();

            azd.show.mock.mockImplementation(() => Promise.resolve({
                name: 'my-app',
                services: {
                    myfunc: { project: { path: '/p', language: 'node' } },
                },
            }));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(0);
        });

        it('should not show a toast when azd show fails', async () => {
            const { step, mockResult } = createStep();
            // Default mock returns undefined for show()

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(0);
        });

        it('should open the URL in a browser when user clicks Open in Browser', async () => {
            const { step, azd, mockResult } = createStep();

            azd.show.mock.mockImplementation(() => Promise.resolve({
                name: 'my-app',
                services: { myfunc: { ingressUrl: 'https://myapp.azurewebsites.net' } },
            }));

            respondToPrompts(mockResult, [{ button: 'Open in Browser' }]);

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            // Let the promise chain settle
            await delay(0);

            expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
        });
    });
});
