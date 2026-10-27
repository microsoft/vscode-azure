/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureNodeId, FunctionAppLogicalType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockHierarchicalDataItemTree, createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { ConfigurationSection } from '../../../../src/constants';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { getSettingsNodes } from '../../../../src/tree/resources/settings/SettingsNode';
import { FunctionAppVirtualTypes, isFunctionAppFunction, type FunctionApp, type FunctionAppInvalidNode } from '../../../../src/tree/resources/webApp/FunctionApp';
import { FunctionAppViewProvider } from '../../../../src/tree/resources/webApp/FunctionAppViewProvider';
import { setWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { makeSettingsResource } from '../../../settings/mockSettings';
import { createTestResourceSelector } from '../testResourceSelector';
import { makeFunctionAppFunction, makeFunctionAppFunctions } from './mockFunctionApp';
import { treeMenuMatches } from '../../treeMenuMatches';

describe('FunctionAppViewProvider (unit)', () => {
    function setup(app: FunctionApp = { ...makeSettingsResource(), isReadOnly: false }, invalidKind: FunctionAppInvalidNode['kind'] = 'function') {
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
            kind: invalidKind,
            error: 'The trigger binding is not available.',
            sourceLabel: 'Broken',
        };
        const tree = createMockHierarchicalDataItemTree([app], new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [app, [...settings, group]],
            [group, [fn, invalid]],
        ]));
        const provider = new FunctionAppViewProvider(codeContext.ctx, executor, tree);
        const key = (node: ConcreteAzureNode) => AzureNodeId.from(node).toString();
        return { app, group, fn, invalid, tree, provider, settings, key, codeContext };
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
        expect(provider.getTreeItem(key(group)).collapsibleState).to.equal(1);
        expect(provider.getTreeItem(key(fn))).to.include({ collapsibleState: 0 });
        expect(await provider.getChildren(key(fn))).to.deep.equal([]);
    });

    it('presents reported state and Flex metadata as the app changes', () => {
        const { provider, app, key } = setup();
        app.site = { location: 'eastus', state: 'Stopped', functionAppConfig: {} };
        const stopped = provider.getTreeItem(key(app));
        expect(stopped.description).to.equal('Stopped, Flex Consumption');

        app.site = { ...app.site, state: 'RUNNING' };
        setWebsiteUrl(app, 'myfuncapp.azurewebsites.net');
        const running = provider.getTreeItem(key(app));
        expect(running.description).to.equal('Flex Consumption');
        expect(treeMenuMatches('vscode-azure/resources/browseWebsite', 'vscode-azure/resources', running)).to.be.true;
        expect(treeMenuMatches('vscode-azure/resources/viewProperties', 'vscode-azure/resources', running)).to.be.true;

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
        expect(treeMenuMatches('vscode-azure/resources/viewProperties', 'vscode-azure/resources', item)).to.be.false;
    });

    it('displays retained error details and restricts invalid nodes to refresh', () => {
        const { provider, app, invalid, key } = setup();
        app.siteError = 'Site access denied.';
        const appItem = provider.getTreeItem(key(app));
        expect(appItem).to.include({ description: 'Invalid', tooltip: 'Site access denied.' });
        const errorItem = provider.getTreeItem(key(invalid));
        expect(errorItem).to.include({ tooltip: invalid.error, collapsibleState: 0 });
        for (const item of [appItem, errorItem]) {
            expect(treeMenuMatches('vscode-azure/resources/refresh', 'vscode-azure/resources', item)).to.be.true;
            expect(treeMenuMatches('vscode-azure/resources/delete', 'vscode-azure/resources', item)).to.be.false;
            expect(treeMenuMatches('vscode-azure/functions/delete', 'vscode-azure/resources', item)).to.be.false;
        }
    });

    it('offers lifecycle and identity actions according to readable site metadata', () => {
        const { app, key, provider } = setup();
        const matches = (action: string) => treeMenuMatches(action, 'vscode-azure/resources', provider.getTreeItem(key(app)));
        expect(matches('vscode-azure/functions/streamLogs')).to.be.false;
        app.site = {
            location: 'eastus', state: 'Running',
            identity: { type: 'UserAssigned', userAssignedIdentities: { '/identity': {} } },
        };
        expect(matches('vscode-azure/webApp/stop')).to.be.true;
        expect(matches('vscode-azure/webApp/restart')).to.be.true;
        expect(matches('vscode-azure/functions/streamLogs')).to.be.true;
        expect(matches('vscode-azure/functions/revealIdentity')).to.be.true;
        expect(matches('vscode-azure/webApp/start')).to.be.false;
        app.site = { location: 'eastus', state: 'STOPPED' };
        expect(matches('vscode-azure/webApp/start')).to.be.true;
        expect(matches('vscode-azure/webApp/stop')).to.be.false;
        expect(matches('vscode-azure/functions/revealIdentity')).to.be.false;
        app.site = { location: 'eastus', state: 'Starting' };
        expect(matches('vscode-azure/webApp/start')).to.be.false;
        expect(matches('vscode-azure/webApp/restart')).to.be.false;
    });

    it('offers function actions according to trigger and reported disabled state', () => {
        const { fn, key, provider, app } = setup();
        const matches = (action: string) => treeMenuMatches(`vscode-azure/functions/${action}`, 'vscode-azure/resources', provider.getTreeItem(key(fn)));
        expect(matches('copyUrl')).to.be.true;
        expect(matches('execute')).to.be.true;
        expect(matches('delete')).to.be.true;
        expect(matches('disable')).to.be.true;
        Object.assign(fn, { triggerKind: 'timerTrigger', authLevel: undefined, isDisabled: true });
        expect(matches('execute')).to.be.true;
        expect(matches('enable')).to.be.true;
        expect(matches('copyUrl')).to.be.false;
        expect(matches('disable')).to.be.false;
        for (const isReadOnly of [true, undefined]) {
            app.isReadOnly = isReadOnly;
            expect(matches('delete')).to.be.false;
            expect(matches('execute')).to.be.true;
        }
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

    for (const [groupBy, groupingValue] of [
        ['resourceType', FunctionAppLogicalType],
        ['location', 'westus'],
        ['armTag', 'prod'],
    ] as const) {
        it(`parents the app under its virtual group when grouping by ${groupBy}`, async () => {
            const app = makeSettingsResource({ location: 'westus', tags: { env: 'prod' } });
            const { provider, key, codeContext } = setup(app);
            const group = { subscription: app.subscription, groupingStrategy: groupBy, groupingValue };
            const overrides = { [`${ConfigurationSection}.groupBy`]: groupBy, [`${ConfigurationSection}.groupByTag`]: 'env' };
            await withSettings(codeContext.mock, overrides, () => {
                expect(provider.getParent(key(app))).to.equal(AzureNodeId.from(group).toString());
            });
        });
    }

    for (const kind of ['app', 'functions'] as const) {
        it(`resolves invalid ${kind} parentage before the view has loaded its children`, () => {
            const { app, group, invalid, provider, key } = setup(makeSettingsResource(), kind);
            expect(provider.getParent(key(invalid))).to.equal(key(kind === 'app' ? app : group));
        });
    }
});
