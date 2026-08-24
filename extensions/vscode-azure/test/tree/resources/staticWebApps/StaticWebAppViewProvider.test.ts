/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as vscode from 'vscode';
import { DeleteAzureResource } from '../../../../src/commands/tree/DeleteAzureResource';
import { OpenInPortal } from '../../../../src/commands/tree/OpenInPortal';
import {
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebAppNoFunctions,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppViewProvider } from '../../../../src/tree/resources/staticWebApps/StaticWebAppViewProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from './mockStaticWebApp';

describe('StaticWebAppViewProvider (unit)', () => {
    function render(resource: ConcreteAzureNode) {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const key = AzureNodeId.from(resource).toString();
        const cache = {
            get: (candidate: string) => candidate === key ? resource : undefined,
            getChildren: () => Promise.resolve([]),
        };
        const provider = new StaticWebAppViewProvider(ctx, executor, cache as never);
        return { item: provider.getTreeItem(key), key, ctx };
    }

    it('should render the site root with stable compatibility and portal contexts', () => {
        const { item } = render(makeStaticWebApp());
        expect(item.label).to.equal('mySwa');
        expect(item.description).to.be.undefined;
        expect(item.contextValue).to.include(StaticWebAppViewProvider.ContextValue);
        expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('should offer the generic delete on the site rather than a product-specific one', () => {
        const { item } = render(makeStaticWebApp());
        expect(item.contextValue).to.include(DeleteAzureResource.ResourceContextValue);
    });

    it('should prioritize environment status and show branches when ready', () => {
        const failed = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Deploying',
        })).item;
        expect(failed.description).to.equal('feature (Deploying)');

        const ready = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Ready',
        })).item;
        expect(ready.description).to.equal('feature');
        expect(ready.contextValue).to.include('azureStaticEnvironment');
    });

    it('should render distinct no-functions help and empty-list semantics', () => {
        const site = makeStaticWebApp();
        const help: StaticWebAppNoFunctions = {
            virtualType: StaticWebAppVirtualTypes.NoFunctions,
            virtualPath: 'environments/default/noFunctions/help',
            azureResource: site,
            kind: 'help',
        };
        const empty: StaticWebAppNoFunctions = {
            ...help,
            virtualPath: 'environments/default/functions/noFunctions/empty',
            kind: 'empty',
        };

        expect(render(help).item.command?.command).to.equal('vscode-azure/staticWebApps/showFunctionsDocumentation');
        expect(render(empty).item.command).to.be.undefined;
        expect(render(empty).item.label).to.equal('No Functions have been pushed to this Static Web App.');
    });

    it('should render exact invalid context variants', () => {
        const invalid: InvalidStaticWebAppNode = {
            virtualType: StaticWebAppVirtualTypes.Invalid,
            virtualPath: 'environments/invalid/broken',
            azureResource: makeStaticWebApp(),
            invalidContextValue: 'invalidStaticEnvironment',
            sourceLabel: 'broken',
        };
        expect(render(invalid).item.contextValue).to.equal('invalidStaticEnvironment');
    });
});
