/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureNodeId, FunctionAppLogicalType, LogicAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { mock } from 'node:test';
import { WebAppLifecycle } from '../../../src/commands/webApp/WebAppLifecycle';
import { makeSettingsResource } from '../../settings/mockSettings';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

describe('WebAppLifecycle (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    for (const logicalType of [FunctionAppLogicalType, AppServiceLogicalType, LogicAppLogicalType]) {
        for (const action of ['start', 'stop', 'restart'] as const) {
            it(`${action}s a ${logicalType} through the shared Web Apps command`, async () => {
                const app = makeSettingsResource({ logicalType });
                const s = createTestResourceSelector({ nodes: [app] });
                const client = createMockWebAppClient();
                const invalidate = mock.method(s.cache, 'invalidate');
                await new WebAppLifecycle(s.ctx.code, s.selector, () => client, s.cache).execute(action, AzureNodeId.from(app).toString());
                expect(client.webApps[action].mock.calls[0].arguments).to.deep.equal(['MyRG', app.name]);
                expect(invalidate.mock.calls[0].arguments[0]).to.equal(app);
            });
        }
    }

    it('keeps lifecycle failures visible and leaves the tree unchanged', async () => {
        const app = makeSettingsResource();
        const s = createTestResourceSelector({ nodes: [app] });
        const client = createMockWebAppClient();
        const invalidate = mock.method(s.cache, 'invalidate');
        client.webApps.stop.mock.mockImplementation(() => Promise.reject(new Error('stop rejected')));
        await expect(new WebAppLifecycle(s.ctx.code, s.selector, () => client, s.cache)
            .execute('stop', AzureNodeId.from(app).toString())).to.be.rejectedWith('stop rejected');
        expect(invalidate.mock.callCount()).to.equal(0);
        expect(s.codeContext.mock.window.showInformationMessage.mock.callCount()).to.equal(0);
    });
});
