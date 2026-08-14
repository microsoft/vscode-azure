/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { SettingsScheme, SettingsUri } from '../../src/settings/SettingsUri';
import { createSettingsNode } from '../../src/tree/resources/settings/SettingsNode';

function makeApp(overrides?: Parameters<typeof makeGenericResource>[0]) {
    return makeGenericResource({
        id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.Web/sites/MyFuncApp',
        name: 'MyFuncApp',
        type: 'Microsoft.Web/sites',
        logicalType: FunctionAppLogicalType,
        ...overrides,
    });
}

describe('SettingsUri (unit)', () => {
    const code = createMockVsCode().vscode;

    describe('from / parseNodeKey', () => {
        it('round-trips the node key the tree uses', () => {
            const node = createSettingsNode(makeApp());
            const uri = SettingsUri.from(code, node);

            expect(SettingsUri.parseNodeKey(uri)).to.equal(AzureNodeId.from(node).toString());
        });

        it('uses the azure-settings scheme', () => {
            const uri = SettingsUri.from(code, createSettingsNode(makeApp()));
            expect(uri.scheme).to.equal(SettingsScheme);
        });

        it('names the file after the resource, so tabs are readable', () => {
            const uri = SettingsUri.from(code, createSettingsNode(makeApp()));
            expect(uri.path.endsWith('/MyFuncApp.settings.jsonc')).to.equal(true, uri.path);
        });

        it('uses a .jsonc extension so the editor picks the jsonc language mode', () => {
            const uri = SettingsUri.from(code, createSettingsNode(makeApp()));
            expect(uri.path.endsWith('.jsonc')).to.be.true;
        });

        it('distinguishes settings on two different resources', () => {
            const first = SettingsUri.from(code, createSettingsNode(makeApp({ name: 'first' })));
            const second = SettingsUri.from(code, createSettingsNode(makeApp({ name: 'second' })));

            expect(first.toString()).to.not.equal(second.toString());
        });

        it('survives a full serialize / re-parse cycle, as it must after a window reload', () => {
            const node = createSettingsNode(makeApp({
                subscription: makeSubscription({
                    accountId: 'User@Contoso.com',
                    tenantId: '72F988BF-86F1-41AF-91AB-2D7CD011DB47',
                }),
            }));

            const original = SettingsUri.from(code, node);
            // Exactly what the editor does when it restores a tab.
            const restored = code.Uri.parse(original.toString());

            expect(SettingsUri.parseNodeKey(restored)).to.equal(SettingsUri.parseNodeKey(original));
        });

        it('preserves a case-sensitive account id through serialize / re-parse', () => {
            const accountId = 'MixedCase@Contoso.com';
            const node = createSettingsNode(makeApp({ subscription: makeSubscription({ accountId }) }));

            const uri = code.Uri.parse(SettingsUri.from(code, node).toString());

            expect(SettingsUri.parseNodeKey(uri)).to.equal(AzureNodeId.from(node).toString());
        });

        it('handles a resource name containing dots', () => {
            const node = createSettingsNode(makeApp({
                id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/my.dotted.app',
                name: 'my.dotted.app',
            }));

            const uri = SettingsUri.from(code, node);

            expect(SettingsUri.parseNodeKey(uri)).to.equal(AzureNodeId.from(node).toString());
        });
    });

    describe('parseNodeKey rejection', () => {
        it('rejects a foreign scheme', () => {
            expect(() => SettingsUri.parseNodeKey(code.Uri.file('/tmp/x.jsonc'))).to.throw(/scheme/);
        });

        it('rejects a path with the wrong number of segments', () => {
            const uri = code.Uri.from({ scheme: SettingsScheme, path: '/only-one-segment' });
            expect(() => SettingsUri.parseNodeKey(uri)).to.throw();
        });

        it('rejects non-hex and odd-length node keys before decoding', () => {
            const nonHex = code.Uri.from({ scheme: SettingsScheme, path: '/zz/app.appSettings.jsonc' });
            const oddLength = code.Uri.from({ scheme: SettingsScheme, path: '/abc/app.appSettings.jsonc' });

            expect(() => SettingsUri.parseNodeKey(nonHex)).to.throw(/hexadecimal/);
            expect(() => SettingsUri.parseNodeKey(oddLength)).to.throw(/hexadecimal/);
        });

        it('rejects a non-jsonc file name', () => {
            const valid = SettingsUri.from(code, createSettingsNode(makeApp()));
            const uri = code.Uri.from({ scheme: SettingsScheme, path: valid.path.replace(/\.jsonc$/, '.txt') });

            expect(() => SettingsUri.parseNodeKey(uri)).to.throw(/jsonc/);
        });
    });
});
