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
 * - `localFunction` -- a function belonging to a local Functions project
 * - `functionsHint` -- a host-start hint beneath a Functions project
 * - `invalidLocalFunction` -- unreadable function metadata or a failed local listing
 * - `emulatorsGroup` -- a virtual grouping node for local emulators
 * - `emulator` -- an installed Storage emulator or indexed Functions host
 */
export type WorkspaceNodeType =
    | 'azdProject'
    | 'azdService'
    | 'functionsProject'
    | 'localFunction'
    | 'functionsHint'
    | 'invalidLocalFunction'
    | 'emulatorsGroup'
    | 'emulator';

/**
 * Concrete domain nodes shown in the workspace tree.
 * Functions presentation is derived from project URIs and host metadata by its view provider.
 */
export type WorkspaceNode = AzdProjectNode | AzdServiceNode | FunctionsProjectNode
    | LocalFunctionsNode | EmulatorsGroupNode | EmulatorNode;

interface WorkspaceNodeBase {
    /** Stable identifier; must be unique across the workspace tree. */
    readonly id: string;
    /** Discriminator for the concrete variant. */
    readonly type: WorkspaceNodeType;
    /**
     * Optional file or folder URI on disk that this node represents.
     * Used by commands like "Reveal in Explorer".
     */
    readonly resourceUri?: vscode.Uri;
}

/** An azd project identified by its `azure.yaml` / `azure.yml` file. */
export interface AzdProjectNode extends WorkspaceNodeBase {
    readonly type: 'azdProject';
    readonly label: string;
    /** URI of the `azure.yaml` (or `azure.yml`) file itself. */
    readonly resourceUri: vscode.Uri;
}

/** A single service declared under `services:` in `azure.yaml`. */
export interface AzdServiceNode extends WorkspaceNodeBase {
    readonly type: 'azdService';
    readonly label: string;
    /** The service name as it appears under `services:` in `azure.yaml`. */
    readonly serviceName: string;
    /** URI of the parent project's `azure.yaml` file. */
    readonly resourceUri: vscode.Uri;
    /**
     * URI of the service's project folder on disk, if a `project:` value
     * was found in `azure.yaml` and the folder exists.
     */
    readonly projectFolderUri?: vscode.Uri;
}

/** An Azure Functions project identified by its `host.json` file. */
export interface FunctionsProjectNode extends WorkspaceNodeBase {
    readonly type: 'functionsProject';
    /** URI of the `host.json` file itself. */
    readonly resourceUri: vscode.Uri;
    /** Safe, user-actionable error from project validation. */
    readonly error?: string;
}

/** A local function listed from its project's ready host. */
export interface LocalFunctionNode extends WorkspaceNodeBase {
    readonly type: 'localFunction';
    readonly project: FunctionsProjectNode;
    readonly functionName: string;
    readonly triggerKind: string;
    readonly authLevel?: string;
    readonly isDisabled: boolean;
}

/** A host-start hint or malformed function under a local project. */
export interface FunctionsInfoNode extends WorkspaceNodeBase {
    readonly type: 'functionsHint' | 'invalidLocalFunction';
    readonly project: FunctionsProjectNode;
    readonly error?: string;
    /** Name reported by the host when a failure concerns an individual function. */
    readonly functionName?: string;
}

/** Descendants shown directly beneath a local Functions project. */
export type LocalFunctionsNode = LocalFunctionNode | FunctionsInfoNode;

/** Virtual grouping node for local emulators. */
export interface EmulatorsGroupNode extends WorkspaceNodeBase {
    readonly type: 'emulatorsGroup';
    readonly label: string;
}

/** A single local emulator entry under {@linkcode EmulatorsGroupNode}. */
export interface EmulatorNode extends WorkspaceNodeBase {
    readonly type: 'emulator';
    readonly label: string;
    readonly emulatorKind: 'azurite' | 'functions';
    readonly state: 'notInstalled' | 'stopped' | 'running' | 'partial';
    /** Short description (e.g. "Storage", "Azure Functions CLI"). */
    readonly description?: string;
}

// #region Workspace-node key prefixes
// These constants define the URI-scheme prefixes used as stable `id` values
// for workspace-tree nodes. Data providers build ids with these prefixes;
// view providers match on them for dispatch.

/** Key prefix for {@linkcode AzdProjectNode} ids. */
export const AzdProjectKeyPrefix = 'azwr://azdProject/';

/** Key prefix for {@linkcode AzdServiceNode} ids. */
export const AzdServiceKeyPrefix = 'azwr://azdService/';

/** Key prefix for {@linkcode FunctionsProjectNode} ids. */
export const FunctionsProjectKeyPrefix = 'azwr://functionsProject/';

/** Stable id of the singleton {@linkcode EmulatorsGroupNode}. */
export const EmulatorsGroupId = 'azwr://emulatorsGroup';

/** Key prefix for {@linkcode EmulatorNode} ids. */
export const EmulatorKeyPrefix = 'azwr://emulator/';

// #endregion

/** Type guard that narrows an unknown value to a {@linkcode WorkspaceNode}. */
export function isWorkspaceNode(maybeNode: unknown): maybeNode is WorkspaceNode {
    return !!maybeNode
        && typeof maybeNode === 'object'
        && 'id' in maybeNode
        && 'type' in maybeNode
        && typeof maybeNode.id === 'string'
        && typeof maybeNode.type === 'string'
        && (['functionsProject', 'localFunction', 'functionsHint', 'invalidLocalFunction'].includes(maybeNode.type)
            || ('label' in maybeNode && typeof maybeNode.label === 'string'));
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

/** Identifies local function command targets. */
export function isLocalFunctionNode(node: unknown): node is LocalFunctionNode {
    return isWorkspaceNode(node) && node.type === 'localFunction';
}

/** Identifies Functions-owned project descendants for provider dispatch and parent navigation. */
export function isLocalFunctionsNode(node: unknown): node is LocalFunctionsNode {
    return isWorkspaceNode(node)
        && (node.type === 'localFunction' || node.type === 'functionsHint' || node.type === 'invalidLocalFunction');
}

/** Type guard for {@linkcode EmulatorsGroupNode}. */
export function isEmulatorsGroupNode(node: unknown): node is EmulatorsGroupNode {
    return isWorkspaceNode(node) && node.type === 'emulatorsGroup';
}

/** Type guard for {@linkcode EmulatorNode}. */
export function isEmulatorNode(node: unknown): node is EmulatorNode {
    return isWorkspaceNode(node) && node.type === 'emulator';
}
