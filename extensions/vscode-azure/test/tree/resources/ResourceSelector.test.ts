/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isGenericResource, isSubscription, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockViewItemTree, makeGenericResource, makeSubscription, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { IAzureViewDataTree, IAzureViewViewItemTree } from '../../../src/services';
import { createTestResourceSelector } from './testResourceSelector';

const subscription = makeSubscription();
const subId = AzureNodeId.from(subscription).toString();

const site1 = makeGenericResource({ name: 'site1', subscription });
const site1Id = AzureNodeId.from(site1).toString();

const settings = makeVirtualResource({ virtualType: 'settings', virtualPath: 'settings', azureResource: site1 });
const settingsId = AzureNodeId.from(settings).toString();

describe('ResourceSelector (unit)', () => {
    describe('selectResource', () => {
        it('should resolve a resource from the cache when a key is provided', async () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            const result = await selector.selectResource<GenericResource>('Microsoft.Web/sites', site1Id);

            expect(result.name).to.equal('site1');
            expect(result.logicalType).to.equal('Microsoft.Web/sites');
        });

        it('should not prompt the user when a key is provided', async () => {
            const { selector, codeContext } = createTestResourceSelector({ nodes: [site1] });

            await selector.selectResource<GenericResource>('Microsoft.Web/sites', site1Id);

            expect(codeContext.mock.quickPicks).to.have.length(0);
        });

        it('should throw when a key is provided but the resource is not in the cache', async () => {
            const { selector } = createTestResourceSelector();

            await expect(selector.selectResource<GenericResource>('Microsoft.Web/sites', 'missing-key'))
                .to.be.rejectedWith(/Resource not found/);
        });

        it('should throw when the key identifies something that is not a resource', async () => {
            // Without the type check the subscription comes back typed as a
            // resource, and the caller fails somewhere further away instead.
            const { selector } = createTestResourceSelector({ nodes: [subscription] });

            await expect(selector.selectResource<GenericResource>('Microsoft.Web/sites', subId))
                .to.be.rejectedWith(/Resource not found/);
        });

        it('should throw when the key identifies a resource of a different logical type', async () => {
            // The logical type is part of the contract on both paths, so a key
            // naming a web app cannot satisfy a request for a registry.
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            await expect(selector.selectResource<GenericResource>('Microsoft.ContainerRegistry/registries', site1Id))
                .to.be.rejectedWith(/Resource not found/);
        });

        it('should match the logical type case-insensitively', async () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            const result = await selector.selectResource<GenericResource>('microsoft.web/SITES', site1Id);

            expect(result.name).to.equal('site1');
        });

        it('should prompt the user with a resource picker when no key is provided', async () => {
            const viewTree = createMockViewItemTree({
                '': [subId],
                [subId]: [site1Id],
            }) as unknown as IAzureViewViewItemTree;
            const { selector, codeContext } = createTestResourceSelector({ nodes: [subscription, site1], viewTree });

            respondToPrompts(codeContext.mock, [
                { pick: 'test-sub $(chevron-right)' },
                { pick: 'site1' },
            ]);

            const result = await selector.selectResource<GenericResource>('Microsoft.Web/sites');

            expect(result.name).to.equal('site1');
            expect(result.logicalType).to.equal('Microsoft.Web/sites');
        });
    });

    describe('resolve', () => {
        it('should return the node the key identifies', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            expect(selector.resolve({ key: site1Id })).to.equal(site1);
        });

        it('should narrow the node to the type the guard accepts', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            const resource = selector.resolve({ key: site1Id, canHandle: isGenericResource });

            // The guard is what types this as a GenericResource, so reading a
            // resource-only property here compiles.
            expect(resource.logicalType).to.equal('Microsoft.Web/sites');
        });

        it('should throw its own message for each way resolution can fail', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1, subscription] });
            const messages = {
                missingKey: 'no key',
                missingNode: 'no node',
                invalidNode: 'wrong node',
            };

            expect(() => selector.resolve({ key: undefined, canHandle: isSubscription, messages })).to.throw('no key');
            expect(() => selector.resolve({ key: 'missing-key', canHandle: isSubscription, messages })).to.throw('no node');
            expect(() => selector.resolve({ key: site1Id, canHandle: isSubscription, messages })).to.throw('wrong node');
        });

        it('should fall back to a generic message where the caller supplied none', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            expect(() => selector.resolve({ key: undefined })).to.throw(/Select an Azure resource/);
            expect(() => selector.resolve({ key: 'missing-key' })).to.throw(/no longer available/);
            expect(() => selector.resolve({ key: site1Id, canHandle: isSubscription })).to.throw(/does not support this command/);
        });

        it('should accept any cached node when no guard is supplied', () => {
            const { selector } = createTestResourceSelector({ nodes: [settings] });

            expect(selector.resolve({ key: settingsId })).to.equal(settings);
        });
    });

    describe('selectVirtual', () => {
        it('should prompt for a matching virtual resource when no key is provided', async () => {
            const siteWithoutSettings = makeGenericResource({
                name: 'site-without-settings',
                id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site-without-settings',
                subscription,
            });
            const siteWithoutSettingsId = AzureNodeId.from(siteWithoutSettings).toString();
            const viewTree = createMockViewItemTree({
                '': [site1Id, siteWithoutSettingsId],
                [site1Id]: [settingsId],
            }) as unknown as IAzureViewViewItemTree;
            const { selector, cache, codeContext } = createTestResourceSelector({ nodes: [site1, siteWithoutSettings, settings], viewTree });

            respondToPrompts(codeContext.mock, [
                { pick: 'site1 $(chevron-right)' },
                { pick: 'settings' },
            ]);

            const result = await selector.selectVirtual({
                key: undefined,
                canHandle: (node): node is typeof settings => node === settings,
            });

            expect(result).to.equal(settings);
            expect(codeContext.mock.quickPicks[0].items.map(item => item.label))
                .to.deep.equal(['site1 $(chevron-right)']);
            expect((cache.loadAll as unknown as ReturnType<typeof mock.fn>).mock.calls[0].arguments[0])
                .to.equal(site1);
        });

        it('should resolve a virtual resource from the cache without prompting', async () => {
            const { selector, codeContext } = createTestResourceSelector({ nodes: [settings] });

            const result = await selector.selectVirtual({
                key: settingsId,
                canHandle: (node): node is typeof settings => node === settings,
            });

            expect(result).to.equal(settings);
            expect(codeContext.mock.quickPicks).to.be.empty;
        });

        it('should reject a non-virtual node even when the caller guard accepts it', async () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            await expect(selector.selectVirtual({
                key: site1Id,
                canHandle: (_node): _node is typeof settings => true,
            })).to.be.rejectedWith(/does not support this command/);
        });
    });

    describe('tryResolve', () => {
        it('should return the node the key identifies', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            expect(selector.tryResolve({ key: site1Id, canHandle: isGenericResource })).to.equal(site1);
        });

        it('should return undefined instead of throwing for every failure', () => {
            const { selector } = createTestResourceSelector({ nodes: [site1] });

            expect(selector.tryResolve({ key: undefined, canHandle: isGenericResource })).to.be.undefined;
            expect(selector.tryResolve({ key: 'missing-key', canHandle: isGenericResource })).to.be.undefined;
            expect(selector.tryResolve({ key: site1Id, canHandle: isSubscription })).to.be.undefined;
        });
    });

    describe('telemetry', () => {
        it('should attribute the running action to the resolved node type', async () => {
            const { selector, executor } = createTestResourceSelector({ nodes: [site1, subscription] });

            const properties = await executor.callWithTelemetryAndErrorHandling('test', context => {
                selector.resolve({ key: site1Id });
                return context.telemetry.properties;
            });

            expect(properties?.nodeType).to.equal('Microsoft.Web/sites');
        });

        it('should attribute each action to its own resolution', async () => {
            const { selector, executor } = createTestResourceSelector({ nodes: [site1, subscription] });

            // One selector instance serves every command execution, so it has to
            // read the context of the action in flight rather than one captured
            // when it was constructed.
            const [first, second] = await Promise.all([
                executor.callWithTelemetryAndErrorHandling('first', async context => {
                    selector.resolve({ key: subId });
                    await Promise.resolve();
                    return context.telemetry.properties;
                }),
                executor.callWithTelemetryAndErrorHandling('second', async context => {
                    selector.resolve({ key: site1Id });
                    await Promise.resolve();
                    return context.telemetry.properties;
                }),
            ]);

            expect(first?.nodeType).to.equal('Microsoft.Resources/subscriptions');
            expect(second?.nodeType).to.equal('Microsoft.Web/sites');
        });

        it('should record nothing when the key does not resolve', async () => {
            const { selector, executor } = createTestResourceSelector({ nodes: [site1] });

            const properties = await executor.callWithTelemetryAndErrorHandling('test', context => {
                selector.tryResolve({ key: site1Id, canHandle: isSubscription });
                return context.telemetry.properties;
            });

            expect(properties?.nodeType).to.be.undefined;
        });
    });

    it('should delegate whenEnriched to the data cache', async () => {
        const enriched = makeGenericResource({ name: 'enriched' });
        const whenEnriched = mock.fn((resource: ConcreteAzureNode) => Promise.resolve(resource));
        const { selector } = createTestResourceSelector({ cache: { whenEnriched } as unknown as IAzureViewDataTree });

        const result = await selector.whenEnriched<GenericResource>(enriched);

        expect(result).to.equal(enriched);
        expect(whenEnriched.mock.callCount()).to.equal(1);
        expect(whenEnriched.mock.calls[0].arguments[0]).to.equal(enriched);
    });
});
