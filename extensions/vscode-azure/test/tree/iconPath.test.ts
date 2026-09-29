/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FoundryProjectResourceType, FunctionAppLogicalType, SubscriptionArmType } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { getAzureIconUri, getResourceTypeIconUri } from '../../src/tree/iconPath';
import { AcrResourceType } from '../../src/tree/resources/acr/AcrRegistry';

describe('getResourceTypeIconUri (unit)', () => {
    it('should return a URI under dist/azureIcons with .svg extension', () => {
        const { ctx } = createMockCodeContext();
        const uri = getResourceTypeIconUri(ctx, FunctionAppLogicalType);

        expect(uri.scheme).to.equal('file');
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

    it('should resolve a shared project icon for Cognitive Services projects', () => {
        const { ctx } = createMockCodeContext();
        const uri = getResourceTypeIconUri(ctx, FoundryProjectResourceType);

        expect(uri.path).to.include('microsoft.machinelearningservices/workspaces~project.svg');
    });
});

describe('getAzureIconUri (unit)', () => {
    it('should return a URI under dist/azureIcons with .svg extension', () => {
        const { ctx } = createMockCodeContext();
        const uri = getAzureIconUri(ctx, 'azd');

        expect(uri.scheme).to.equal('file');
        expect(uri.path).to.include('dist/azureIcons/azd.svg');
    });

    it('should lowercase the icon name', () => {
        const { ctx } = createMockCodeContext();
        const uri = getAzureIconUri(ctx, 'AZD');

        expect(uri.path).to.include('dist/azureIcons/azd.svg');
    });

    it('should be based on the extensionUri', () => {
        const { ctx } = createMockCodeContext();
        const uri = getAzureIconUri(ctx, 'azd');

        expect(uri.path).to.include(ctx.extensionContext.extensionUri.path);
    });
});
