/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataItemTree, Page } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { AzureAccount, AzureTenant } from '../../src/auth/AzureSubscription';
import type { ConcreteAzureNode } from '../../src/models/AzureNode';
import { AzureNodeId } from '../../src/models/AzureNodeId';

/**
 * Creates a mock view-item tree backed by a static lookup table.
 * Keys are `AzureNodeId` strings; values are arrays of child keys.
 */
export function createMockViewItemTree(tree: Record<string, string[]>) {
    return {
        getChildren(key?: string): Promise<string[]> {
            return Promise.resolve(tree[key ?? ''] ?? []);
        },
        getTreeItem(key: string) {
            const label = key.split('/').pop()?.split('#')[0] ?? key;
            return { label, id: key };
        },
    };
}

/**
 * Creates a mock {@linkcode DataItemTree} backed by a flat list of
 * nodes. Supports `get()` and `whenEnriched()` only (no `getChildren()`).
 */
export function createMockDataItemTree(nodes: ConcreteAzureNode[]): DataItemTree<ConcreteAzureNode> {
    const keyMap = new Map<string, ConcreteAzureNode>();
    for (const node of nodes) {
        keyMap.set(AzureNodeId.from(node).toString(), node);
    }
    return {
        get(key: string): ConcreteAzureNode | undefined {
            return keyMap.get(key);
        },
        whenEnriched(node: ConcreteAzureNode): Promise<ConcreteAzureNode> {
            return Promise.resolve(node);
        },
        invalidate: mock.fn(),
        remove: mock.fn(),
    } as unknown as DataItemTree<ConcreteAzureNode>;
}

/**
 * Creates a mock {@linkcode DataItemTree} backed by a hierarchy of
 * nodes. Supports both `get()` and `getChildren()`.
 *
 * Also exposes `invalidate` and `remove` spies (`mock.fn()`s, consistent with
 * {@linkcode createMockDataItemTree}) so callers can assert how the code under
 * test invalidated or evicted from the tree. Access them via a cast, e.g.
 * `(tree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate`.
 */
export function createMockHierarchicalDataItemTree(
    rootChildren: ConcreteAzureNode[],
    childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>(),
): DataItemTree<ConcreteAzureNode> {
    const keyMap = new Map<string, ConcreteAzureNode>();

    function registerNode(node: ConcreteAzureNode) {
        keyMap.set(AzureNodeId.from(node).toString(), node);
    }

    rootChildren.forEach(registerNode);
    for (const children of childrenMap.values()) {
        children.forEach(registerNode);
    }

    return {
        getChildren(node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
            if (!node) {
                return Promise.resolve(rootChildren);
            }
            return Promise.resolve(childrenMap.get(node) ?? []);
        },
        get(key: string): ConcreteAzureNode | undefined {
            return keyMap.get(key);
        },
        whenEnriched(node: ConcreteAzureNode): Promise<ConcreteAzureNode> {
            return Promise.resolve(node);
        },
        // Non-paged mock: every resource's children fit in a single page.
        hasMore(): boolean {
            return false;
        },
        loadMore(): Promise<void> {
            return Promise.resolve();
        },
        invalidate: mock.fn(),
        remove: mock.fn(),
    } as unknown as DataItemTree<ConcreteAzureNode>;
}

/** A paged mock {@linkcode DataItemTree} plus the underlying spies. */
export interface MockPagedDataItemTree {
    /** The mock tree, ready to pass where a {@linkcode DataItemTree} is expected. */
    readonly tree: DataItemTree<ConcreteAzureNode>;
    /** Spy for `getChildren` (root call passes `undefined`). */
    readonly getChildren: ReturnType<typeof mock.fn>;
    /** Spy for `hasMore`. */
    readonly hasMore: ReturnType<typeof mock.fn>;
    /** Spy for `loadMore`; assert its call count to verify paging advanced. */
    readonly loadMore: ReturnType<typeof mock.fn>;
}

/**
 * Creates a paged mock {@linkcode DataItemTree} that mirrors the paging
 * contract: `getChildren` returns only the pages loaded so far, `hasMore`
 * reports whether unloaded pages remain, and `loadMore` advances to the next
 * page. Root children are never paged.
 *
 * The mock also mirrors the real tree's initialization ordering: a node's page
 * cursor is only installed once `getChildren(node)` has been called, so before
 * that `hasMore(node)` is `false` and `loadMore(node)` rejects (just as the real
 * {@linkcode DataItemTree} throws `Cannot loadMore before getChildren has been
 * called`). This prevents tests from passing against an impossible call order.
 *
 * Any node in `failNodes` rejects on `getChildren`, simulating a branch whose
 * children cannot be enumerated (e.g. a tenant that can't mint a token); such a
 * node is never initialized, so `hasMore`/`loadMore` behave as if `getChildren`
 * was never called. The returned spies let tests assert how far paging advanced.
 *
 * @param rootChildren - The (unpaged) root nodes.
 * @param pagesMap - Maps a node to its children split into pages.
 * @param options - Optional `failNodes`: nodes whose `getChildren` rejects.
 */
export function createMockPagedDataItemTree(
    rootChildren: ConcreteAzureNode[],
    pagesMap: Map<ConcreteAzureNode, ConcreteAzureNode[][]>,
    options: { readonly failNodes?: Set<ConcreteAzureNode> } = {},
): MockPagedDataItemTree {
    const failNodes = options.failNodes ?? new Set<ConcreteAzureNode>();
    // Number of pages materialized for a node. A node is absent until its first
    // successful `getChildren` installs the cursor (page count 1), mirroring the
    // real tree only exposing `hasMore`/`loadMore` after `getChildren`.
    const loaded = new Map<ConcreteAzureNode, number>();

    const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
        if (!node) {
            return Promise.resolve(rootChildren);
        }
        if (failNodes.has(node)) {
            return Promise.reject(new Error('token acquisition failed'));
        }
        const count = loaded.get(node) ?? 1;
        loaded.set(node, count);
        const pages = pagesMap.get(node) ?? [];
        return Promise.resolve(pages.slice(0, count).flat());
    });

    const hasMore = mock.fn((node?: ConcreteAzureNode): boolean => {
        if (!node) {
            return false;
        }
        const count = loaded.get(node);
        // No cursor installed yet -> getChildren has not run, so there is no "more".
        if (count === undefined) {
            return false;
        }
        return count < (pagesMap.get(node)?.length ?? 0);
    });

    const loadMore = mock.fn((node: ConcreteAzureNode): Promise<void> => {
        const count = loaded.get(node);
        if (count === undefined) {
            return Promise.reject(new Error('Cannot loadMore before getChildren has been called'));
        }
        loaded.set(node, count + 1);
        return Promise.resolve();
    });

    const tree = { getChildren, hasMore, loadMore } as unknown as DataItemTree<ConcreteAzureNode>;
    return { tree, getChildren, hasMore, loadMore };
}

/**
 * Builds the `node -> pages-of-children` {@linkcode Map} consumed by
 * {@linkcode createMockPagedDataItemTree}.
 *
 * A thin convenience over `new Map(...)` that pins the key/value types so call
 * sites don't need to repeat the `new Map<ConcreteAzureNode, ConcreteAzureNode[][]>`
 * annotation. Each entry is `[parentNode, pages]`, where `pages` is the parent's
 * children split into successive pages.
 */
export function pagedChildren(
    entries: readonly [ConcreteAzureNode, ConcreteAzureNode[][]][],
): Map<ConcreteAzureNode, ConcreteAzureNode[][]> {
    return new Map<ConcreteAzureNode, ConcreteAzureNode[][]>(entries);
}

/** The unfiltered account/tenant/subscription listing surface, plus its spies. */
export interface MockAzureListing {
    readonly listing: {
        listAccounts(): Promise<AzureAccount[]>;
        listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>>;
        listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>>;
    };
    readonly listAccounts: ReturnType<typeof mock.fn>;
    readonly listTenantsForAccount: ReturnType<typeof mock.fn>;
    readonly listSubscriptionsForTenant: ReturnType<typeof mock.fn>;
}

/**
 * Creates a mock of the unfiltered account/tenant/subscription listing that the
 * discovery flows (Select Subscriptions, Sign In) read instead of the tree.
 *
 * Unlike {@linkcode createMockPagedDataItemTree}, pages are streamed directly:
 * the listing surface yields every page of a node in sequence, so there is no
 * `hasMore`/`loadMore` cursor to advance.
 *
 * Any node in `failNodes` throws when its children are listed, simulating a
 * branch whose children cannot be enumerated (e.g. a tenant that can't mint a
 * token). The returned spies let tests assert which nodes were listed at all --
 * the key property when verifying that a filtered-out tenant is never touched.
 *
 * @param accounts - The accounts returned by `listAccounts`.
 * @param pagesMap - Maps a node to its children split into pages.
 * @param options - Optional `failNodes`: nodes whose listing throws.
 */
export function createMockAzureListing(
    accounts: AzureAccount[],
    pagesMap: Map<ConcreteAzureNode, ConcreteAzureNode[][]>,
    options: { readonly failNodes?: Set<ConcreteAzureNode> } = {},
): MockAzureListing {
    const failNodes = options.failNodes ?? new Set<ConcreteAzureNode>();

    function pagesFor(node: ConcreteAzureNode): AsyncIterable<Page<ConcreteAzureNode>> {
        // eslint-disable-next-line @typescript-eslint/require-await
        return (async function* () {
            if (failNodes.has(node)) {
                throw new Error('token acquisition failed');
            }
            const pages = pagesMap.get(node) ?? [];
            for (let i = 0; i < pages.length; i++) {
                yield { items: pages[i], hasMore: i < pages.length - 1 };
            }
        })();
    }

    const listAccounts = mock.fn(() => Promise.resolve(accounts));
    const listTenantsForAccount = mock.fn((account: AzureAccount) => pagesFor(account as ConcreteAzureNode));
    const listSubscriptionsForTenant = mock.fn((tenant: AzureTenant) => pagesFor(tenant as ConcreteAzureNode));

    return {
        listing: { listAccounts, listTenantsForAccount, listSubscriptionsForTenant },
        listAccounts,
        listTenantsForAccount,
        listSubscriptionsForTenant,
    };
}
