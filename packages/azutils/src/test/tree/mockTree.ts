/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataItemTree } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { ConcreteAzureNode } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';

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
 * nodes. Supports `get()` only (no `getChildren()`).
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
        invalidateAll: mock.fn(),
    } as unknown as DataItemTree<ConcreteAzureNode>;
}

/**
 * Creates a mock {@linkcode DataItemTree} backed by a hierarchy of
 * nodes. Supports both `get()` and `getChildren()`.
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
    } as DataItemTree<ConcreteAzureNode>;
}
