/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { ProjectDetectionRule } from './ProjectDetectionRule';
import type { WorkspaceScanResult } from './WorkspaceProject';

/** Resource limits applied independently to each workspace folder scan. */
export interface WorkspaceScanBudgets {
    readonly maxDepth: number;
    readonly maxEntries: number;
    readonly maxProjects: number;
    readonly maxEvidenceFileBytes: number;
}

/** Options controlling workspace project discovery and result caching. */
export interface WorkspaceScanOptions {
    readonly workspaceFolders?: readonly vscode.WorkspaceFolder[];
    readonly additionalRules?: readonly ProjectDetectionRule[];
    readonly budgets?: Partial<WorkspaceScanBudgets>;
    readonly cacheTtlMs?: number;
    readonly forceRefresh?: boolean;
}

/** Conservative defaults suitable for an interactive wizard step. */
export const defaultWorkspaceScanBudgets: WorkspaceScanBudgets = {
    maxDepth: 8,
    maxEntries: 5000,
    maxProjects: 100,
    maxEvidenceFileBytes: 1024 * 1024,
};

/** Default lifetime of a completed project scan result. */
export const defaultWorkspaceScanCacheTtlMs = 30_000;

export const IWorkspaceProjectService: ServiceIdentifier<IWorkspaceProjectService> = Symbol.for('IWorkspaceProjectService');

/** Discovers and classifies candidate projects in open workspace folders. */
export interface IWorkspaceProjectService {
    /**
     * Scans requested workspace folders or all currently open folders.
     *
     * @throws {@linkcode CancellationError} when {@linkcode token} is canceled.
     */
    scan(token?: vscode.CancellationToken, options?: WorkspaceScanOptions): Promise<WorkspaceScanResult>;

    /** Invalidates all cached scans, or only scans containing {@linkcode root}. */
    invalidate(root?: vscode.Uri): void;
}
