/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureNodeId, LogicAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../../../../src/tree/resources/settings/SettingsNode';
import { WebAppViewProvider } from '../../../../src/tree/resources/webApp/WebAppViewProvider';
import type { WebApp } from '../../../../src/tree/resources/webApp/WebApp';
import { WebAppLifecycle } from '../../../../src/commands/webApp/WebAppLifecycle';
import { makeSettingsResource } from '../../../settings/mockSettings';

describe('WebAppViewProvider (unit)', () => {
    const resource = makeSettingsResource();
    const key = AzureNodeId.from(resource).toString();
    const adapter = new WebAppSettingsAdapter(
        createMockVsCode().vscode,
        () => createMockWebAppClient(),
    );
    const settingsNodes = getSettingsNodes(resource, adapter);
    const tree = {
        get: (requested: string) => requested === key ? resource : undefined,
        getChildren: () => Promise.resolve(settingsNodes),
    };
    const { executor } = createTestActionExecutor();
    const provider = new WebAppViewProvider(
        createMockCodeContext().ctx,
        executor,
        tree as never,
    );

    it('claims resources supported by its settings adapter', () => {
        expect(provider.canHandle(key)).to.be.true;
        expect(provider.canHandle('not-a-node')).to.be.false;
    });

    it('renders the owning resource as expandable', () => {
        expect(provider.getTreeItem(key).collapsibleState).to.equal(1);
    });

    it('returns the contributed settings node', async () => {
        expect(await provider.getChildren(key)).to.deep.equal(
            settingsNodes.map(node => AzureNodeId.from(node).toString()),
        );
    });

    for (const logicalType of [AppServiceLogicalType, LogicAppLogicalType]) {
        it(`uses shared lifecycle capabilities for ${logicalType}`, () => {
            const app: WebApp = makeSettingsResource({ logicalType });
            const view = new WebAppViewProvider(createMockCodeContext().ctx, executor, createMockDataItemTree([app]));
            const appKey = AzureNodeId.from(app).toString();
            app.site = { location: 'eastus', state: 'Running' };
            expect(view.getTreeItem(appKey).contextValue).to.include(WebAppLifecycle.StopContextValue);
            app.site = { location: 'eastus', state: 'Stopped' };
            expect(view.getTreeItem(appKey).contextValue).to.include(WebAppLifecycle.StartContextValue);
            expect(view.getTreeItem(appKey).contextValue).not.to.include(WebAppLifecycle.StopContextValue);
        });
    }
});
