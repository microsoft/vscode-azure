/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { SettingsScheme, SettingsUri } from '../../src/settings/SettingsUri';
import { createCollectionNode } from '../../src/tree/resources/settings/SettingsNode';

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

    describe('from / parse', () => {
        it('round-trips every identity component', () => {
            const resource = makeApp();
            const uri = SettingsUri.from(code, createCollectionNode(resource, 'appSettings'));

            const parts = SettingsUri.parse(uri);
            expect(parts.accountId).to.equal(resource.subscription.accountId);
            expect(parts.tenantId).to.equal(resource.subscription.tenantId);
            expect(parts.armResourceId).to.equal(resource.id);
            expect(parts.collectionId).to.equal('appSettings');
        });

        it('uses the azure-settings scheme', () => {
            const uri = SettingsUri.from(code, createCollectionNode(makeApp(), 'appSettings'));
            expect(uri.scheme).to.equal(SettingsScheme);
        });

        it('names the file after the resource and collection, so tabs are readable', () => {
            const uri = SettingsUri.from(code, createCollectionNode(makeApp(), 'appSettings'));
            expect(uri.path.endsWith('/MyFuncApp.appSettings.jsonc')).to.equal(true, uri.path);
        });

        it('uses a .jsonc extension so the editor picks the jsonc language mode', () => {
            const uri = SettingsUri.from(code, createCollectionNode(makeApp(), 'connectionStrings'));
            expect(uri.path.endsWith('.jsonc')).to.be.true;
        });

        it('distinguishes two collections on the same resource', () => {
            const resource = makeApp();
            const appSettings = SettingsUri.from(code, createCollectionNode(resource, 'appSettings'));
            const connectionStrings = SettingsUri.from(code, createCollectionNode(resource, 'connectionStrings'));

            expect(appSettings.toString()).to.not.equal(connectionStrings.toString());
        });

        it('keeps the ARM id verbatim, including its casing', () => {
            const resource = makeApp();
            const uri = SettingsUri.from(code, createCollectionNode(resource, 'appSettings'));

            expect(SettingsUri.parse(uri).armResourceId).to.equal(resource.id);
            expect(uri.path).to.contain('/resourceGroups/MyRG/');
        });

        it('survives a full serialize / re-parse cycle, as it must after a window reload', () => {
            const resource = makeApp({
                subscription: makeSubscription({
                    accountId: 'User@Contoso.com',
                    tenantId: '72F988BF-86F1-41AF-91AB-2D7CD011DB47',
                }),
            });

            const original = SettingsUri.from(code, createCollectionNode(resource, 'appSettings'));
            // Exactly what the editor does when it restores a tab.
            const restored = code.Uri.parse(original.toString());

            expect(SettingsUri.parse(restored)).to.deep.equal(SettingsUri.parse(original));
        });

        it('preserves a case-sensitive account id through serialize / re-parse', () => {
            const accountId = 'MixedCase@Contoso.com';
            const resource = makeApp({ subscription: makeSubscription({ accountId }) });

            const uri = code.Uri.parse(SettingsUri.from(code, createCollectionNode(resource, 'appSettings')).toString());

            expect(SettingsUri.parse(uri).accountId).to.equal(accountId);
        });

        it('handles a resource name containing dots', () => {
            const resource = makeApp({
                id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/my.dotted.app',
                name: 'my.dotted.app',
            });

            const uri = SettingsUri.from(code, createCollectionNode(resource, 'appSettings'));

            expect(SettingsUri.parse(uri).collectionId).to.equal('appSettings');
            expect(SettingsUri.parse(uri).armResourceId).to.equal(resource.id);
        });
    });

    describe('parse rejection', () => {
        it('rejects a foreign scheme', () => {
            expect(() => SettingsUri.parse(code.Uri.file('/tmp/x.jsonc'))).to.throw(/scheme/);
        });

        it('rejects a path with too few segments', () => {
            const uri = code.Uri.from({ scheme: SettingsScheme, path: '/only/two' });
            expect(() => SettingsUri.parse(uri)).to.throw();
        });

        it('rejects a malformed identity segment', () => {
            const uri = code.Uri.from({ scheme: SettingsScheme, path: '/6162/subscriptions/s/app.appSettings.jsonc' });
            expect(() => SettingsUri.parse(uri)).to.throw(/identity/);
        });

        it('rejects a file name with no collection id', () => {
            // '617c627c63' is hex for 'a|b|c', a well-formed identity segment.
            const uri = code.Uri.from({ scheme: SettingsScheme, path: '/617c627c63/subscriptions/s/rg/appSettings.jsonc' });
            expect(() => SettingsUri.parse(uri)).to.throw(/collection/);
        });

        it('rejects a non-jsonc file name', () => {
            const uri = code.Uri.from({ scheme: SettingsScheme, path: '/617c627c63/subscriptions/s/rg/app.appSettings.txt' });
            expect(() => SettingsUri.parse(uri)).to.throw(/jsonc/);
        });
    });
});
