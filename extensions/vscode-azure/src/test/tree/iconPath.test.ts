/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType, SubscriptionArmType } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getResourceTypeIconUri } from '../../tree/iconPath';
import { AcrResourceType } from '../../tree/resources/acr/AcrRegistry';

describe('getResourceTypeIconUri (unit)', () => {
    it('should return a URI under dist/azureIcons with .svg extension', () => {
        const { ctx } = createMockCodeContext();
        const uri = getResourceTypeIconUri(ctx, FunctionAppLogicalType);

        expect(uri).to.be.instanceOf(MockUri);
        expect(uri.path).to.include('dist/azureIcons/microsoft.web/sites~functionapp.svg');
    });

    it('should be based on the extensionUri', () => {
        const { ctx } = createMockCodeContext();
        const uri = getResourceTypeIconUri(ctx, SubscriptionArmType);

        expect(uri.path).to.include(ctx.extensionContext.extensionUri.path);
    });

    it('should lowercase the resource type', () => {
        const { ctx } = createMockCodeContext();
        const uri = getResourceTypeIconUri(ctx, AcrResourceType.toUpperCase());

        expect(uri.path).to.include('microsoft.containerregistry/registries.svg');
    });
});
