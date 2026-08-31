/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { createMockViewItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { EditSettings } from '../../../src/commands/settings/EditSettings';
import type { IAzureViewViewItemTree } from '../../../src/services';
import { SettingsScheme } from '../../../src/settings/SettingsUri';
import { getSettingsNodes } from '../../../src/tree/resources/settings/SettingsNode';
import { StubAdapter } from '../../settings/mockSettings';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

const resource = makeGenericResource({ name: 'function-app', logicalType: FunctionAppLogicalType });
const settingsNode = getSettingsNodes(resource, new StubAdapter({ logicalTypes: [FunctionAppLogicalType] }))[0];
const resourceId = AzureNodeId.from(resource).toString();
const settingsId = AzureNodeId.from(settingsNode).toString();

function createCommand() {
    const viewTree = createMockViewItemTree({
        '': [resourceId],
        [resourceId]: [settingsId],
    }) as unknown as IAzureViewViewItemTree;
    const { selector, codeContext } = createTestResourceSelector({ nodes: [settingsNode, resource], viewTree });
    return { command: new EditSettings(codeContext.ctx, selector), mockResult: codeContext.mock };
}

describe('EditSettings (unit)', () => {
    it('opens the settings document for the selected node in its own tab', async () => {
        const { command, mockResult } = createCommand();

        await command.execute(settingsId);

        expect(mockResult.shownDocuments).to.have.length(1);
        expect(mockResult.textDocuments[0].uri.scheme).to.equal(SettingsScheme);
        // Two views of one resource's settings could disagree after a save, so
        // the tab must not be reused as a preview.
        expect(mockResult.window.showTextDocument.mock.calls[0].arguments[1]).to.deep.equal({ preview: false });
    });

    it('prompts for settings when invoked from the command palette', async () => {
        const { command, mockResult } = createCommand();

        respondToPrompts(mockResult, [
            { pick: 'site1 $(chevron-right)' },
            { pick: 'settings' },
        ]);

        await command.execute();

        expect(mockResult.shownDocuments).to.have.length(1);
        expect(mockResult.textDocuments[0].uri.scheme).to.equal(SettingsScheme);
    });

    it('rejects a stale or invalid selection', async () => {
        const { command } = createCommand();

        await expect(command.execute('azr://missing@portal.azure.com/tenants/t1/subscriptions/sub1'))
            .to.be.rejectedWith(/no longer available/);
        await expect(command.execute(resourceId))
            .to.be.rejectedWith(/does not support this command/);
    });
});
