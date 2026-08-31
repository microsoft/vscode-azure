/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { OpenUrl } from '../../../src/commands/OpenUrl';
import { OpenInPortal } from '../../../src/commands/tree/OpenInPortal';

describe('OpenInPortal (unit)', () => {
    it('should open the portal URL for a subscription node', async () => {
        const mockResult = createMockVsCode();
        const command = new OpenUrl(mockResult.vscode);

        await command.execute(
            OpenInPortal.getUrl,
            'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1',
        );

        expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
    });

    it('should open the portal URL for a resource node', async () => {
        const mockResult = createMockVsCode();
        const command = new OpenUrl(mockResult.vscode);

        await command.execute(
            OpenInPortal.getUrl,
            'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1',
        );

        expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
    });

    it('should normalize a portal blade path without a leading slash', () => {
        const resolveUrl = OpenInPortal.bladeUrl('console');

        expect(resolveUrl('azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1'))
            .to.equal('https://portal.azure.com/#@t1/resource/subscriptions/sub-1/console');
    });
});
