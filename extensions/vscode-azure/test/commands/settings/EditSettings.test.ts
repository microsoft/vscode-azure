/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { EditSettings } from '../../../src/commands/settings/EditSettings';
import { SettingsScheme, SettingsUri } from '../../../src/settings/SettingsUri';
import { makeSettingsNode } from '../../settings/mockSettings';

describe('EditSettings (unit)', () => {
    it('opens the selected settings node as a non-preview settings document', async () => {
        const node = makeSettingsNode();
        const { ctx, mock: mockResult } = createMockCodeContext();
        const command = new EditSettings(ctx, createMockDataItemTree([node]));

        await command.execute(AzureNodeId.from(node).toString());

        const document = mockResult.textDocuments[0];
        expect(document.isUntitled).to.be.false;
        expect(document.uri.scheme).to.equal(SettingsScheme);
        expect(document.uri.toString()).to.equal(SettingsUri.from(ctx.code, node).toString());
        expect(mockResult.shownDocuments[0]).to.equal(document);
        expect(mockResult.window.showTextDocument.mock.calls[0].arguments[1]).to.deep.equal({ preview: false });
    });
});
