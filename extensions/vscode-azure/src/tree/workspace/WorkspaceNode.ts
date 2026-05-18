/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Discriminator for the concrete {@linkcode WorkspaceNode} variants
 * shown in the workspace (local) tree.
 *
 * Each variant is produced by exactly one domain-specific data
 * provider (azd, functions, emulators, ...) which also handles
 * rendering via the matching view provider.
 *
 * - `azdProject` -- a folder that contains an `azure.yaml`/`azure.yml` file
 * - `azdService` -- a single service declared under `services:` in `azure.yaml`
 * - `functionsProject` -- a folder that contains a Functions `host.json`
 * - `emulatorsGroup` -- a virtual grouping node for local emulators
 * - `emulator` -- a single (currently stubbed) local emulator entry
 */
export type WorkspaceNodeType =
    | 'azdProject'
    | 'azdService'
    | 'functionsProject'
    | 'emulatorsGroup'
    | 'emulator';

/**
 * Common shape of all items displayed in the workspace tree.
 *
 * Concrete variants extend this interface with a discriminating
 * {@linkcode type} and additional fields. Every node has a stable
 * {@linkcode id} (used as both the cache key and the VS Code
 * `TreeItem.id`), a {@linkcode label} for display, and an optional
 * {@linkcode resourceUri} pointing at the file/folder the node
 * represents on disk (used by the "Reveal in Explorer" command).
 */
export interface WorkspaceNode {
    /** Stable identifier; must be unique across the workspace tree. */
    readonly id: string;
    /** Discriminator for the concrete variant. */
    readonly type: WorkspaceNodeType;
    /** Display label rendered as the tree item's primary text. */
    readonly label: string;
    /**
     * Optional file or folder URI on disk that this node represents.
     * Used by commands like "Reveal in Explorer".
     */
    readonly resourceUri?: vscode.Uri;
}

/** A folder containing an `azure.yaml` / `azure.yml` (an azd project). */
export interface AzdProjectNode extends WorkspaceNode {
    readonly type: 'azdProject';
    /** Folder containing the `azure.yaml` file. */
    readonly resourceUri: vscode.Uri;
    /** URI of the `azure.yaml` (or `azure.yml`) file itself. */
    readonly azureYamlUri: vscode.Uri;
}

/** A single service declared under `services:` in `azure.yaml`. */
export interface AzdServiceNode extends WorkspaceNode {
    readonly type: 'azdService';
    /** The service name as it appears under `services:` in `azure.yaml`. */
    readonly serviceName: string;
    /** Folder of the parent azd project. */
    readonly projectFolderUri: vscode.Uri;
    /**
     * URI of the service folder on disk, if a `project:` value was found
     * in `azure.yaml` and the folder exists.
     */
    readonly resourceUri?: vscode.Uri;
}

/** A folder containing an Azure Functions `host.json`. */
export interface FunctionsProjectNode extends WorkspaceNode {
    readonly type: 'functionsProject';
    /** Folder containing the `host.json` file. */
    readonly resourceUri: vscode.Uri;
}

/** Virtual grouping node for local emulators. */
export interface EmulatorsGroupNode extends WorkspaceNode {
    readonly type: 'emulatorsGroup';
}

/** A single local emulator entry under {@linkcode EmulatorsGroupNode}. */
export interface EmulatorNode extends WorkspaceNode {
    readonly type: 'emulator';
    /** Short description (e.g. "Storage", "Functions Core Tools"). */
    readonly description?: string;
}

/** Type guard that narrows an unknown value to a {@linkcode WorkspaceNode}. */
export function isWorkspaceNode(maybeNode: unknown): maybeNode is WorkspaceNode {
    return !!maybeNode
        && typeof maybeNode === 'object'
        && 'id' in maybeNode
        && 'type' in maybeNode
        && 'label' in maybeNode
        && typeof (maybeNode as WorkspaceNode).id === 'string'
        && typeof (maybeNode as WorkspaceNode).label === 'string';
}

/** Type guard for {@linkcode AzdProjectNode}. */
export function isAzdProjectNode(node: unknown): node is AzdProjectNode {
    return isWorkspaceNode(node) && node.type === 'azdProject';
}

/** Type guard for {@linkcode AzdServiceNode}. */
export function isAzdServiceNode(node: unknown): node is AzdServiceNode {
    return isWorkspaceNode(node) && node.type === 'azdService';
}

/** Type guard for {@linkcode FunctionsProjectNode}. */
export function isFunctionsProjectNode(node: unknown): node is FunctionsProjectNode {
    return isWorkspaceNode(node) && node.type === 'functionsProject';
}

/** Type guard for {@linkcode EmulatorsGroupNode}. */
export function isEmulatorsGroupNode(node: unknown): node is EmulatorsGroupNode {
    return isWorkspaceNode(node) && node.type === 'emulatorsGroup';
}

/** Type guard for {@linkcode EmulatorNode}. */
export function isEmulatorNode(node: unknown): node is EmulatorNode {
    return isWorkspaceNode(node) && node.type === 'emulator';
}
