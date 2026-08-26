/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { EditSettings } from '../../../src/commands/settings/EditSettings';
import { SettingsScheme } from '../../../src/settings/SettingsUri';
import { getSettingsNodes } from '../../../src/tree/resources/settings/SettingsNode';
import { StubAdapter } from '../../settings/mockSettings';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

const resource = makeGenericResource({ logicalType: FunctionAppLogicalType });
const settingsNode = getSettingsNodes(resource, new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }))[0];

function createCommand() {
    const { selector, codeContext } = createTestResourceSelector({ nodes: [settingsNode, resource] });
    return { command: new EditSettings(codeContext.ctx, selector), mockResult: codeContext.mock };
}

describe('EditSettings (unit)', () => {
    it('opens the settings document for the selected node in its own tab', async () => {
        const { command, mockResult } = createCommand();

        await command.execute(AzureNodeId.from(settingsNode).toString());

        expect(mockResult.shownDocuments).to.have.length(1);
        expect(mockResult.textDocuments[0].uri.scheme).to.equal(SettingsScheme);
        // Two views of one resource's settings could disagree after a save, so
        // the tab must not be reused as a preview.
        expect(mockResult.window.showTextDocument.mock.calls[0].arguments[1]).to.deep.equal({ preview: false });
    });

    it('does nothing when the selection is not a settings node', async () => {
        const { command, mockResult } = createCommand();

        // The command palette supplies no key, a stale tree item supplies one
        // the tree no longer knows, and any other node is simply not settings.
        await command.execute();
        await command.execute('azr://missing@portal.azure.com/tenants/t1/subscriptions/sub1');
        await command.execute(AzureNodeId.from(resource).toString());

        expect(mockResult.shownDocuments).to.be.empty;
    });
});
