/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getAzureIconUri } from '../../tree/iconPath';

describe('getAzureIconUri (unit)', () => {
    it('should return a URI under resources/icons with .svg extension', () => {
        const { ctx } = createMockCodeContext();
        const uri = getAzureIconUri(ctx.code, ctx.extensionContext, 'functionApp');

        expect(uri).to.be.instanceOf(MockUri);
        expect(uri.path).to.include('resources/icons/functionApp.svg');
    });

    it('should be based on the extensionUri', () => {
        const { ctx } = createMockCodeContext();
        const uri = getAzureIconUri(ctx.code, ctx.extensionContext, 'subscription');

        expect(uri.path).to.include(ctx.extensionContext.extensionUri.path);
    });

    it('should handle different icon names', () => {
        const { ctx } = createMockCodeContext();

        for (const name of ['resourceGroup', 'acr', 'appService']) {
            const uri = getAzureIconUri(ctx.code, ctx.extensionContext, name);
            expect(uri.path).to.include(`${name}.svg`);
        }
    });
});
