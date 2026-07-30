/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { Page } from '@microsoft/vscode-azure-utils';
import { collectPages, createMockVsCode, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { ConfigurationSection } from '../../../src/constants';
import { AzureResourceDataProvider } from '../../../src/tree/resources/AzureResourceDataProvider';
import { multiPage, singlePage } from './mockResourceClient';

/**
 * A {@linkcode AsyncIterable} that rejects on the first pull, mirroring how an
 * ARM listing fails once iteration begins rather than at call time.
 */
function failingPage<T>(error: Error): AsyncIterable<Page<T>> {
    return {
        [Symbol.asyncIterator]: (): AsyncIterator<Page<T>> => ({
            next: (): Promise<IteratorResult<Page<T>>> => Promise.reject(error),
        }),
    };
}

/**
 * A listing that stays in flight until released, so tests can observe a bulk
 * load that has been started but has not settled.
 */
function gatedPage<T>(items: T[]): { pages: AsyncIterable<Page<T>>; release: () => void } {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    return {
        pages: {
            [Symbol.asyncIterator]: async function* () {
                await gate;
                yield { items, hasMore: false };
            },
        },
        release: () => { release(); },
    };
}

describe('AzureResourceDataProvider (unit)', () => {
    const code = createMockVsCode();

    function createProvider(clientFactory?: unknown) {
        const { executor } = createTestActionExecutor();
        const createClient = clientFactory ?? mock.fn(() => ({}));
        return new AzureResourceDataProvider(code.vscode, executor, createClient as never);
    }

    describe('canHandle', () => {
        it('should return false for account nodes', () => {
            expect(createProvider().canHandle(makeAccount())).to.be.false;
        });

        it('should return false for tenant nodes', () => {
            expect(createProvider().canHandle(makeTenant())).to.be.false;
        });

        it('should return true for subscription nodes', () => {
            expect(createProvider().canHandle(makeSubscription())).to.be.true;
        });

        it('should return true for resource group nodes', () => {
            expect(createProvider().canHandle(makeResourceGroup())).to.be.true;
        });

        it('should return false for generic resources', () => {
            expect(createProvider().canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for null/undefined', () => {
            const provider = createProvider();
            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle(undefined)).to.be.false;
        });

        it('should return false for non-objects', () => {
            expect(createProvider().canHandle('string')).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('should throw when called as a root provider', async () => {
            const provider = createProvider();
            let error: unknown;
            try {
                await provider.getChildren();
            } catch (e) {
                error = e;
            }
            expect((error as Error).message).to.include('not a root provider');
        });

        it('should return resource groups for a subscription', async () => {
            const sub = makeSubscription();
            const rgs = [{ id: 'rg1', name: 'rg1' }];
            const mockClient = { resourceGroups: { list: () => rgs } };
            const provider = createProvider(() => mockClient);

            const children = await provider.getChildren(sub);
            expect(children).to.deep.equal(rgs);
        });

        it('should return resources for a resource group', async () => {
            const rg = makeResourceGroup();
            const resources = [{ id: 'res1', name: 'res1' }];
            const mockClient = { resources: { listByResourceGroup: () => resources } };
            const provider = createProvider(() => mockClient);

            const children = await provider.getChildren(rg);
            expect(children).to.deep.equal(resources);
        });

        it('should reuse a cached client across calls for the same subscription', async () => {
            const sub = makeSubscription();
            const createClient = mock.fn(() => ({ resourceGroups: { list: () => [] } }));
            const provider = createProvider(createClient);

            await provider.getChildren(sub);
            await provider.getChildren(sub);

            expect(createClient.mock.callCount()).to.equal(1);
        });

        it('should pass configured page size to resource list calls', async () => {
            const sub = makeSubscription();
            let capturedOptions: Record<string, unknown> | undefined;
            const mockClient = {
                resourceGroups: {
                    list: (options?: Record<string, unknown>) => { capturedOptions = options; return []; },
                },
            };
            const provider = createProvider(() => mockClient);

            await withSettings(code, { [`${ConfigurationSection}.pageSize`]: 25 }, () => provider.getChildren(sub));
            expect(capturedOptions?.top).to.equal(25);
        });
    });

    describe('bulk resource loading', () => {
        afterEach(() => { mock.restoreAll(); });

        const subscription = makeSubscription();
        const rg1 = makeResourceGroup({ name: 'rg1', subscription });
        const rg2 = makeResourceGroup({ id: '/subscriptions/test-sub/resourceGroups/rg2', name: 'rg2', groupingValue: 'rg2', subscription });

        const site = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site1', name: 'site1', subscription });
        const storage = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg2/providers/Microsoft.Storage/storageAccounts/sa1', name: 'sa1', type: 'Microsoft.Storage/storageAccounts', subscription });

        /**
         * Builds a client that records how many times each listing operation ran,
         * so tests can assert the fan-out actually collapsed.
         */
        function createCountingClient(resources: unknown[] = [site, storage]) {
            const list = mock.fn(() => singlePage(resources));
            const listByResourceGroup = mock.fn((_rgName: string) => singlePage(resources));
            return {
                client: {
                    resourceGroups: { list: () => singlePage([rg1, rg2]) },
                    resources: { list, listByResourceGroup },
                },
                list,
                listByResourceGroup,
            };
        }

        async function childrenOf(provider: AzureResourceDataProvider, node: unknown): Promise<GenericResource[]> {
            const pages = await collectPages(await provider.getChildren(node as never));
            return pages.flatMap(page => page.items) as GenericResource[];
        }

        /**
         * Run `body` inside a bulk-load window, standing in for the view layer
         * declaring that it is about to walk every resource group.
         */
        async function withBulkLoad<T>(provider: AzureResourceDataProvider, body: () => Promise<T>): Promise<T> {
            const handle = provider.beginBulkLoad(subscription);
            try {
                return await body();
            } finally {
                handle.dispose();
            }
        }

        it('should serve every resource group from a single subscription-wide call', async () => {
            const { client, list, listByResourceGroup } = createCountingClient();
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                await Promise.all([childrenOf(provider, rg1), childrenOf(provider, rg2)]);
            });

            expect(list.mock.callCount()).to.equal(1);
            expect(listByResourceGroup.mock.callCount()).to.equal(0);
        });

        it('should bucket resources into the resource group named by their ARM id', async () => {
            const { client } = createCountingClient();
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                expect(await childrenOf(provider, rg1)).to.deep.equal([site]);
                expect(await childrenOf(provider, rg2)).to.deep.equal([storage]);
            });
        });

        it('should match resource group names case-insensitively', async () => {
            const mixedCase = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/RG1/providers/Microsoft.Web/sites/site1', name: 'site1', subscription });
            const { client } = createCountingClient([mixedCase]);
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                expect(await childrenOf(provider, rg1)).to.deep.equal([mixedCase]);
            });
        });

        it('should drop subscription-scoped resources that have no resource group', async () => {
            const subScoped = makeGenericResource({ id: '/subscriptions/test-sub/providers/Microsoft.Insights/actionGroups/ag1', name: 'ag1', subscription });
            const { client } = createCountingClient([subScoped, site]);
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                expect(await childrenOf(provider, rg1)).to.deep.equal([site]);
            });
        });

        it('should return nothing for a resource group the listing never mentions', async () => {
            // The subscription-wide listing omits empty resource groups, so a
            // missing bucket means "empty", never "not loaded yet".
            const { client, listByResourceGroup } = createCountingClient([site]);
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                expect(await childrenOf(provider, rg2)).to.deep.equal([]);
            });

            expect(listByResourceGroup.mock.callCount()).to.equal(0);
        });

        it('should list per resource group when no bulk load has been declared', async () => {
            const { client, list, listByResourceGroup } = createCountingClient();
            const provider = createProvider(() => client);

            await childrenOf(provider, rg1);

            expect(list.mock.callCount()).to.equal(0);
            expect(listByResourceGroup.mock.callCount()).to.equal(1);
        });

        it('should go back to per-resource-group listing once the window closes', async () => {
            const { client, list, listByResourceGroup } = createCountingClient();
            const provider = createProvider(() => client);

            await withBulkLoad(provider, () => childrenOf(provider, rg1));
            await childrenOf(provider, rg2);

            expect(list.mock.callCount()).to.equal(1);
            expect(listByResourceGroup.mock.callCount()).to.equal(1);
        });

        it('should start a fresh subscription-wide call for each new window', async () => {
            const { client, list } = createCountingClient();
            const provider = createProvider(() => client);

            await withBulkLoad(provider, () => childrenOf(provider, rg1));
            expect(list.mock.callCount()).to.equal(1);

            // A later render opens its own window and must not be served a
            // snapshot gathered for the previous one.
            await withBulkLoad(provider, () => childrenOf(provider, rg1));

            expect(list.mock.callCount()).to.equal(2);
        });

        it('should not load anything when a window opens but no resource group asks', async () => {
            const { client, list } = createCountingClient();
            const provider = createProvider(() => client);

            // Mirrors ChooseResourceGroupStep, which treats resource groups as
            // terminal picks and never asks for their children.
            await withBulkLoad(provider, async () => {
                await provider.getChildren(subscription);
            });

            expect(list.mock.callCount()).to.equal(0);
        });

        it('should exhaust every page of the subscription-wide listing', async () => {
            // 1001 resources would be two ARM pages in production; the shape is
            // what matters, so keep the fixture small and split it by hand.
            const site2 = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site2', name: 'site2', subscription });
            const list = mock.fn(() => multiPage([[site], [storage], [site2]]));
            const client = {
                resourceGroups: { list: () => singlePage([rg1, rg2]) },
                resources: { list, listByResourceGroup: () => singlePage([]) },
            };
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                // Resources from the first and third pages both land in rg1, so
                // this only passes if every page was drained before bucketing.
                expect(await childrenOf(provider, rg1)).to.deep.equal([site, site2]);
                expect(await childrenOf(provider, rg2)).to.deep.equal([storage]);
            });

            expect(list.mock.callCount()).to.equal(1);
        });

        it('should serve a resource group that asks after the shared load settled', async () => {
            const { client, list } = createCountingClient();
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                // The view limits itself to 5 concurrent resource groups, so
                // every group past the first wave asks only after an earlier
                // group's promise has already resolved. The shared load has to
                // outlive settlement to serve them.
                expect(await childrenOf(provider, rg1)).to.deep.equal([site]);
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(await childrenOf(provider, rg2)).to.deep.equal([storage]);
            });

            expect(list.mock.callCount()).to.equal(1);
        });

        it('should never duplicate a load that is still in flight', async () => {
            const realNow = Date.now();
            const gated = gatedPage([site, storage]);
            const list = mock.fn(() => gated.pages);
            const client = {
                resourceGroups: { list: () => singlePage([rg1, rg2]) },
                resources: { list, listByResourceGroup: () => singlePage([]) },
            };
            const provider = createProvider(() => client);

            const handle = provider.beginBulkLoad(subscription);
            try {
                // First wave starts the load. It is now in flight.
                const first = childrenOf(provider, rg1);
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(list.mock.callCount()).to.equal(1);

                // A very large subscription can take a long time to drain. No
                // amount of elapsed time may cause a load that is still running
                // to be abandoned and restarted -- a later wave joining it must
                // never trigger a second subscription-wide call.
                mock.method(Date, 'now', () => realNow + 60 * 60 * 1000);
                const second = childrenOf(provider, rg2);
                await new Promise(resolve => setTimeout(resolve, 0));

                gated.release();
                expect(await first).to.deep.equal([site]);
                expect(await second).to.deep.equal([storage]);
            } finally {
                handle.dispose();
            }

            expect(list.mock.callCount()).to.equal(1);
        });

        it('should keep the shared load alive until the last window closes', async () => {
            const { client, list } = createCountingClient();
            const provider = createProvider(() => client);

            // Two renders overlap on the same subscription. The inner one
            // finishing must not cut the outer one's load out from under it.
            const outer = provider.beginBulkLoad(subscription);
            const inner = provider.beginBulkLoad(subscription);
            await childrenOf(provider, rg1);
            inner.dispose();
            expect(await childrenOf(provider, rg2)).to.deep.equal([storage]);
            outer.dispose();

            expect(list.mock.callCount()).to.equal(1);
        });

        it('should latch a failure for the window and retry in the next one', async () => {
            let attempts = 0;
            const list = mock.fn(() => {
                attempts++;
                if (attempts === 1) {
                    return failingPage(new Error('ARM exploded'));
                }
                return singlePage([site]);
            });
            const client = {
                resourceGroups: { list: () => singlePage([rg1]) },
                resources: { list, listByResourceGroup: () => singlePage([]) },
            };
            const provider = createProvider(() => client);

            await withBulkLoad(provider, async () => {
                let error: unknown;
                try {
                    await childrenOf(provider, rg1);
                } catch (e) {
                    error = e;
                }
                expect((error as Error).message).to.equal('ARM exploded');

                // Every group in this walk shares the one failed listing rather
                // than each retrying it, which would be 26 doomed calls.
                let repeated: unknown;
                try {
                    await childrenOf(provider, rg1);
                } catch (e) {
                    repeated = e;
                }
                expect((repeated as Error).message).to.equal('ARM exploded');
                expect(list.mock.callCount()).to.equal(1);
            });

            // The next render opens a new window, which retries.
            await withBulkLoad(provider, async () => {
                expect(await childrenOf(provider, rg1)).to.deep.equal([site]);
            });

            expect(list.mock.callCount()).to.equal(2);
        });
    });

    describe('dispose', () => {
        it('should not throw when disposed', () => {
            const provider = createProvider();
            expect(() => { provider.dispose(); }).to.not.throw;
        });
    });

    describe('configuration change listener', () => {
        it('should fire onDidChange when pageSize setting changes', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            code.configChangeEmitter.fire({
                affectsConfiguration: (s: string) => s === `${ConfigurationSection}.pageSize`,
            });

            expect(listener.mock.callCount()).to.equal(1);
        });

        it('should not fire onDidChange for unrelated settings', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            code.configChangeEmitter.fire({
                affectsConfiguration: () => false,
            });

            expect(listener.mock.callCount()).to.equal(0);
        });
    });
});
