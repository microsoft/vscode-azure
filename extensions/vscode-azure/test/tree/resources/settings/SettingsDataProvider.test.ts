/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { createSettingsDataProvider, createStubAdapter, entry } from '../../../settings/mockSettings';
import {
    collectionIdOf, createCollectionNode, createEntryNode, settingKeyOf,
} from '../../../../src/tree/resources/settings/SettingsNode';

const resource = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
    name: 'app',
    logicalType: FunctionAppLogicalType,
});

const unsupported = makeGenericResource({
    id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/stg',
    name: 'stg',
    logicalType: 'Microsoft.Storage/storageAccounts',
});

describe('SettingsDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('claims settings nodes only, never the owning resource', () => {
            const provider = createSettingsDataProvider();

            expect(provider.canHandle(createCollectionNode(resource, 'appSettings'))).to.be.true;
            expect(provider.canHandle(createEntryNode(resource, 'appSettings', entry('A', '1')))).to.be.true;
            // Critical: the resource must stay with whichever provider owns it, since
            // ProviderRegistry dispatches to the first match only.
            expect(provider.canHandle(resource)).to.be.false;
        });
    });

    describe('getCollectionNodes', () => {
        it('returns one node per collection the adapter exposes', () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                collections: [
                    { id: 'appSettings', label: 'Application Settings', structured: false },
                    { id: 'connectionStrings', label: 'Connection Strings', structured: true },
                ],
            }));

            const nodes = provider.getCollectionNodes(resource);

            expect(nodes.map(collectionIdOf)).to.deep.equal(['appSettings', 'connectionStrings']);
        });

        it('returns nothing for a resource with no adapter', () => {
            const provider = createSettingsDataProvider(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(provider.getCollectionNodes(unsupported)).to.be.empty;
        });

        it('returns nothing when no adapters are registered at all', () => {
            expect(createSettingsDataProvider().getCollectionNodes(resource)).to.be.empty;
        });
    });

    describe('getChildren', () => {
        it('expands a collection into one node per setting', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                entries: { appSettings: [entry('A', '1'), entry('B', '2')] },
            }));

            const children = await provider.getChildren(createCollectionNode(resource, 'appSettings'));

            expect(children.map(child => settingKeyOf(child as never))).to.deep.equal(['A', 'B']);
        });

        it('carries each value onto its node', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                entries: { appSettings: [entry('A', 'the-value')] },
            }));

            const [child] = await provider.getChildren(createCollectionNode(resource, 'appSettings'));

            expect((child as unknown as { value: string }).value).to.equal('the-value');
        });

        it('carries structured metadata onto its node', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                collections: [{ id: 'connectionStrings', label: 'Connection Strings', structured: true }],
                entries: { connectionStrings: [entry('DB', 'conn', { type: 'SQLAzure' })] },
            }));

            const [child] = await provider.getChildren(createCollectionNode(resource, 'connectionStrings'));

            expect((child as unknown as { metadata?: Record<string, string> }).metadata).to.deep.equal({ type: 'SQLAzure' });
        });

        it('treats an individual setting as a leaf', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({
                logicalTypes: [FunctionAppLogicalType],
                entries: { appSettings: [entry('A', '1')] },
            }));

            const children = await provider.getChildren(createEntryNode(resource, 'appSettings', entry('A', '1')));

            expect(children).to.be.empty;
        });

        it('returns nothing when called with no resource, since it is not a root provider', async () => {
            expect(await createSettingsDataProvider().getChildren()).to.be.empty;
        });

        it('returns an empty collection without error', async () => {
            const provider = createSettingsDataProvider(createStubAdapter({ logicalTypes: [FunctionAppLogicalType] }));

            expect(await provider.getChildren(createCollectionNode(resource, 'appSettings'))).to.be.empty;
        });
    });
});
