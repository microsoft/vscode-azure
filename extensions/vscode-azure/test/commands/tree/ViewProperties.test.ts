/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource, makeSubscription, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext, IActionContext, ICodeContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock, type Mock } from 'node:test';
import { ViewProperties } from '../../../src/commands/tree/ViewProperties';
import { IPropertiesContentProvider, PropertiesContentProvider, PropertiesScheme } from '../../../src/properties/PropertiesContentProvider';
import { IPropertiesAdapter, type PropertiesAdapter } from '../../../src/properties/PropertiesAdapter';
import { RedactedMarker } from '../../../src/properties/redactSecrets';
import type { IAzureViewViewItemTree } from '../../../src/services';
import { IResourceSelector, ResourceSelector } from '../../../src/tree/resources/ResourceSelector';

describe('ViewProperties (unit)', () => {
    it('opens the payload from the matching adapter as a JSON preview', async () => {
        const resource = makeGenericResource();
        const payload = { name: resource.name, properties: { provisioningState: 'Succeeded' } };
        const setup = createCommand([resource], [stubAdapter({ read: () => Promise.resolve(payload) })]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        const document = setup.mockResult.textDocuments[0];
        expect(document.isUntitled).to.be.false;
        expect(document.uri.scheme).to.equal(PropertiesScheme);
        expect(document.languageId).to.equal('json');
        expect(JSON.parse(document.getText())).to.deep.equal(payload);
        expect(setup.mockResult.shownDocuments[0]).to.equal(document);
        expect(setup.mockResult.window.showTextDocument.mock.calls[0].arguments[1]).to.deep.equal({ preview: true });
    });

    it('records the node type for telemetry', async () => {
        const resource = makeGenericResource();
        const setup = createCommand([resource], [stubAdapter()]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(setup.context.telemetry.properties.nodeType).to.equal(resource.logicalType);
    });

    it('dispatches to the first adapter that claims the node', async () => {
        const resource = makeGenericResource();
        const declining = stubAdapter({ canHandle: () => false, read: () => Promise.resolve({ from: 'declining' }) });
        const first = stubAdapter({ read: () => Promise.resolve({ from: 'first' }) });
        const second = stubAdapter({ read: () => Promise.resolve({ from: 'second' }) });
        const setup = createCommand([resource], [declining, first, second]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(JSON.parse(setup.mockResult.textDocuments[0].getText())).to.deep.equal({ from: 'first' });
        expect(second.read.mock.callCount()).to.equal(0);
    });

    it('withholds secrets when the matching adapter declares redaction', async () => {
        const resource = makeGenericResource();
        const setup = createCommand([resource], [stubAdapter({
            redact: { alsoRedact: ['appId'] },
            read: () => Promise.resolve({ name: 'app1', appId: 'an-id', apiKey: 'shhh' }),
        })]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(JSON.parse(setup.mockResult.textDocuments[0].getText()))
            .to.deep.equal({ name: 'app1', appId: RedactedMarker, apiKey: RedactedMarker });
    });

    it('opens the payload unchanged when the matching adapter declares no redaction', async () => {
        const resource = makeGenericResource();
        const setup = createCommand([resource], [stubAdapter({
            read: () => Promise.resolve({ name: 'app1', apiKey: 'shhh' }),
        })]);

        await setup.command.execute(AzureNodeId.from(resource).toString());

        expect(JSON.parse(setup.mockResult.textDocuments[0].getText()))
            .to.deep.equal({ name: 'app1', apiKey: 'shhh' });
    });

    it('throws for a missing key and for a node that is no longer cached', async () => {
        const setup = createCommand([makeGenericResource()], [stubAdapter()]);

        await expect(setup.command.execute()).to.be.rejectedWith(/Select an Azure resource/);
        await expect(setup.command.execute('azr://missing@portal.azure.com/tenants/t1/subscriptions/sub1'))
            .to.be.rejectedWith(/Resource not found/);
        expect(setup.mockResult.textDocuments).to.be.empty;
    });

    it('throws when no adapter serves the node', async () => {
        const node = makeVirtualResource();
        const setup = createCommand([makeSubscription(), node], [stubAdapter({ canHandle: () => false })]);

        await expect(setup.command.execute(AzureNodeId.from(node).toString()))
            .to.be.rejectedWith(/does not have properties to view/);
        expect(setup.mockResult.textDocuments).to.be.empty;
    });
});

type StubAdapter = PropertiesAdapter & {
    readonly canHandle: Mock<(node: ConcreteAzureNode) => boolean>;
    readonly read: Mock<(node: ConcreteAzureNode) => Promise<unknown>>;
};

interface StubOptions {
    readonly canHandle?: (node: ConcreteAzureNode) => boolean;
    readonly read?: (node: ConcreteAzureNode) => Promise<unknown>;
    readonly redact?: PropertiesAdapter['redact'];
}

function stubAdapter(options: StubOptions = {}): StubAdapter {
    return {
        canHandle: mock.fn(options.canHandle ?? (() => true)),
        read: mock.fn(options.read ?? (() => Promise.resolve({}))),
        redact: options.redact,
    } as unknown as StubAdapter;
}

interface CommandSetup {
    readonly command: ViewProperties;
    readonly mockResult: MockVsCodeResult;
    readonly context: IActionContext;
}

function createCommand(nodes: readonly ConcreteAzureNode[], adapters: readonly PropertiesAdapter[]): CommandSetup {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const context = createActionContext('viewProperties');
    const dataTree = createMockDataItemTree([...nodes]);

    // The editor registration lives in product wiring rather than the provider's constructor, so
    // the test has to do it too for the document content to resolve.
    const contentProvider = new PropertiesContentProvider(ctx.code);
    ctx.code.workspace.registerTextDocumentContentProvider(PropertiesScheme, contentProvider);

    const container = new Container();
    container.bind(IVsCode).toConstantValue(ctx.code);
    container.bind(ICodeContext).toConstantValue(ctx);
    container.bind(IActionContext).toConstantValue(context);
    container.bind(IResourceSelector).toConstantValue(new ResourceSelector(
        ctx,
        new MockOutputChannel('test'),
        dataTree,
        undefined as unknown as IAzureViewViewItemTree,
    ));
    container.bind(IPropertiesContentProvider).toConstantValue(contentProvider);
    for (const adapter of adapters) {
        container.bind(IPropertiesAdapter).toConstantValue(adapter);
    }
    container.bind(ViewProperties).toSelf();

    return { command: container.get(ViewProperties), mockResult, context };
}
