/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureNodeId, FunctionAppLogicalType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockHierarchicalDataItemTree, createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { BrowseWebsite } from '../../../../src/commands/tree/BrowseWebsite';
import { CopyFunctionUrl } from '../../../../src/commands/functions/CopyFunctionUrl';
import { DeleteFunction } from '../../../../src/commands/functions/DeleteFunction';
import { ExecuteFunction } from '../../../../src/commands/functions/ExecuteFunction';
import { RevealFunctionAppIdentity } from '../../../../src/commands/functions/RevealFunctionAppIdentity';
import { SetFunctionState } from '../../../../src/commands/functions/SetFunctionState';
import { StreamFunctionLogs } from '../../../../src/commands/functions/StreamFunctionLogs';
import { WebAppLifecycle } from '../../../../src/commands/webApp/WebAppLifecycle';
import { RefreshResourcesView } from '../../../../src/commands/tree/RefreshResourcesView';
import { ViewProperties } from '../../../../src/commands/tree/ViewProperties';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../../../../src/tree/resources/settings/SettingsNode';
import { FunctionAppVirtualTypes, isFunctionAppFunction, type FunctionApp, type FunctionAppInvalidNode } from '../../../../src/tree/resources/webApp/FunctionApp';
import { FunctionAppViewProvider } from '../../../../src/tree/resources/webApp/FunctionAppViewProvider';
import { setWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { makeSettingsResource } from '../../../settings/mockSettings';
import { createTestResourceSelector } from '../testResourceSelector';
import { makeFunctionAppFunction, makeFunctionAppFunctions } from './mockFunctionApp';

describe('FunctionAppViewProvider (unit)', () => {
    function setup(app: FunctionApp = makeSettingsResource()) {
        const codeContext = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const adapter = new WebAppSettingsAdapter(codeContext.ctx.code, () => createMockWebAppClient());
        const settings = getSettingsNodes(app, adapter);
        const group = makeFunctionAppFunctions(app);
        const fn = makeFunctionAppFunction({ azureResource: app });
        const invalid: FunctionAppInvalidNode = {
            azureResource: app,
            virtualType: FunctionAppVirtualTypes.Invalid,
            virtualPath: 'functions/invalid/0',
            kind: 'function',
            error: 'The trigger binding is not available.',
            sourceLabel: 'Broken',
        };
        const tree = createMockHierarchicalDataItemTree([app], new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [app, [...settings, group]],
            [group, [fn, invalid]],
        ]));
        const provider = new FunctionAppViewProvider(codeContext.ctx, executor, tree);
        const key = (node: ConcreteAzureNode) => AzureNodeId.from(node).toString();
        return { app, group, fn, invalid, tree, provider, settings, key };
    }

    it('claims Function Apps and their virtual children but leaves application settings to the shared provider', () => {
        const { app, group, fn, invalid, provider, settings, key } = setup();
        for (const node of [app, group, fn, invalid]) {
            expect(provider.canHandle(key(node))).to.be.true;
        }
        expect(provider.canHandle(key(settings[0]))).to.be.false;
        expect(provider.canHandle('not-a-node')).to.be.false;
        const other = setup(makeSettingsResource({ logicalType: AppServiceLogicalType }));
        expect(other.provider.canHandle(other.key(other.app))).to.be.false;
    });

    it('renders settings before the expandable Functions group and functions as leaves', async () => {
        const { provider, app, group, fn, invalid, settings, key } = setup();
        expect(await provider.getChildren(key(app))).to.deep.equal([...settings.map(key), key(group)]);
        expect(await provider.getChildren(key(group))).to.deep.equal([key(fn), key(invalid)]);
        expect(provider.getTreeItem(key(group))).to.include({ label: 'Functions', collapsibleState: 1, contextValue: RefreshResourcesView.ContextValue });
        expect(provider.getTreeItem(key(fn))).to.include({ label: 'HttpTrigger', collapsibleState: 0 });
        expect(await provider.getChildren(key(fn))).to.deep.equal([]);
    });

    it('reflects state transitions and Flex metadata while retaining shared resource capabilities', () => {
        const { provider, app, key } = setup();
        expect(provider.getTreeItem(key(app)).contextValue).not.to.include(FunctionAppViewProvider.RunningContextValue);
        app.site = { location: 'eastus', state: 'Stopped', functionAppConfig: {} };
        const stopped = provider.getTreeItem(key(app));
        expect(stopped.description).to.equal('Stopped, Flex Consumption');
        expect(stopped.contextValue).to.include(FunctionAppViewProvider.StoppedContextValue);
        expect(stopped.contextValue).to.include(FunctionAppViewProvider.FlexContextValue);

        app.site = { ...app.site, state: 'RUNNING' };
        setWebsiteUrl(app, 'myfuncapp.azurewebsites.net');
        const running = provider.getTreeItem(key(app));
        expect(running.description).to.equal('Flex Consumption');
        expect(running.contextValue).to.include(FunctionAppViewProvider.RunningContextValue);
        expect(running.contextValue).not.to.include(FunctionAppViewProvider.StoppedContextValue);
        expect(running.contextValue).to.include(BrowseWebsite.ContextValue);
        expect(running.contextValue).to.include(ViewProperties.ContextValue);

        app.site.functionAppConfig = undefined;
        expect(provider.getTreeItem(key(app)).description).to.equal('');
    });

    it('shows trigger, access level and disabled state without using generic ARM actions for function leaves', () => {
        const { provider, fn, key } = setup();
        expect(provider.getTreeItem(key(fn)).description).to.equal('httpTrigger (function)');
        const disabled = setup();
        Object.assign(disabled.fn, { isDisabled: true });
        const item = disabled.provider.getTreeItem(disabled.key(disabled.fn));
        expect(item.description).to.equal('httpTrigger (function), Disabled');
        expect(item.tooltip).to.include('State: Disabled');
        expect(item.contextValue).to.include(FunctionAppViewProvider.DisabledFunctionContextValue);
        expect(item.contextValue).not.to.include(ViewProperties.ContextValue);
    });

    it('displays retained error details and restricts invalid nodes to refresh', () => {
        const { provider, app, invalid, key } = setup();
        app.siteError = 'Site access denied.';
        const appItem = provider.getTreeItem(key(app));
        expect(appItem).to.include({ description: 'Invalid', tooltip: 'Site access denied.', contextValue: RefreshResourcesView.ContextValue });
        const errorItem = provider.getTreeItem(key(invalid));
        expect(errorItem).to.include({ label: 'Broken', tooltip: invalid.error, collapsibleState: 0, contextValue: RefreshResourcesView.ContextValue });
    });

    it('offers lifecycle and identity actions according to readable site metadata', () => {
        const { app, key, provider } = setup();
        expect(provider.getTreeItem(key(app)).contextValue).not.to.include(StreamFunctionLogs.ContextValue);
        app.site = {
            location: 'eastus', state: 'Running',
            identity: { type: 'UserAssigned', userAssignedIdentities: { '/identity': {} } },
        };
        const running = provider.getTreeItem(key(app)).contextValue?.split(';');
        expect(running).to.include(WebAppLifecycle.StopContextValue).and.include(WebAppLifecycle.RestartContextValue);
        expect(running).to.include(StreamFunctionLogs.ContextValue).and.include(RevealFunctionAppIdentity.ContextValue);
        expect(running).not.to.include(WebAppLifecycle.StartContextValue);
        app.site = { location: 'eastus', state: 'STOPPED' };
        const stopped = provider.getTreeItem(key(app)).contextValue?.split(';');
        expect(stopped).to.include(WebAppLifecycle.StartContextValue);
        expect(stopped).not.to.include(WebAppLifecycle.StopContextValue);
        expect(stopped).not.to.include(RevealFunctionAppIdentity.ContextValue);
        app.site = { location: 'eastus', state: 'Starting' };
        const starting = provider.getTreeItem(key(app)).contextValue?.split(';');
        expect(starting).not.to.include(WebAppLifecycle.StartContextValue);
        expect(starting).not.to.include(WebAppLifecycle.RestartContextValue);
    });

    it('offers function actions according to trigger and reported disabled state', () => {
        const { fn, key, provider } = setup();
        const http = provider.getTreeItem(key(fn)).contextValue?.split(';');
        expect(http).to.include(CopyFunctionUrl.ContextValue).and.include(ExecuteFunction.ContextValue);
        expect(http).to.include(DeleteFunction.ContextValue).and.include(SetFunctionState.DisableContextValue);
        Object.assign(fn, { triggerKind: 'timerTrigger', authLevel: undefined, isDisabled: true });
        const timer = provider.getTreeItem(key(fn)).contextValue?.split(';');
        expect(timer).to.include(ExecuteFunction.ContextValue).and.include(SetFunctionState.EnableContextValue);
        expect(timer).not.to.include(CopyFunctionUrl.ContextValue);
        expect(timer).not.to.include(SetFunctionState.DisableContextValue);
    });

    it('allows the shared selector to resolve app and remote function nodes by their normal tree keys', async () => {
        const { app, fn, tree, key } = setup();
        const { selector } = createTestResourceSelector({ cache: tree });
        expect(await selector.selectResource({ key: key(app), logicalTypes: [FunctionAppLogicalType] })).to.equal(app);
        expect(selector.resolve({ key: key(fn), canHandle: isFunctionAppFunction })).to.equal(fn);
    });

    it('resolves parentage through the Functions group before the view has loaded its children', () => {
        const { app, group, fn, invalid, provider, key } = setup();
        expect(provider.getParent(key(fn))).to.equal(key(group));
        expect(provider.getParent(key(invalid))).to.equal(key(group));
        expect(provider.getParent(key(group))).to.equal(key(app));
        expect(provider.getParent(key(app))).to.equal(AzureNodeId.from(app).parentNodeId()?.toString());
    });
});
