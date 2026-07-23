/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../src/commands/tree/OpenInPortal';

describe('OpenInPortal (unit)', () => {
    it('should open the portal URL for a subscription node', () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });

        const cmd = new OpenInPortal(mockResult.vscode);
        cmd.execute('azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1');

        expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
    });

    it('should open the portal URL for a resource node', () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });

        const cmd = new OpenInPortal(mockResult.vscode);
        cmd.execute('azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1');

        expect(mockResult.env.openExternal.mock.callCount()).to.equal(1);
    });

    it('should honor a virtual node portal subresource path', () => {
        const mockResult = createMockVsCode({ Uri: vscode.Uri });
        const resource = makeVirtualResource({
            virtualType: 'staticWebApp.functions',
            virtualPath: 'environments/default/functions',
        }) as ReturnType<typeof makeVirtualResource> & { portalResourceId: string };
        resource.portalResourceId = `${resource.azureResource.id}/builds/default/functions`;
        const key = AzureNodeId.from(resource).toString();
        const cache = { get: (candidate: string) => candidate === key ? resource : undefined };

        new OpenInPortal(mockResult.vscode, cache as never).execute(key);

        expect(decodeURIComponent(mockResult.env.openExternal.mock.calls[0].arguments[0].toString())).to.include(
            `${resource.azureResource.id}/builds/default/functions`,
        );
    });
});
