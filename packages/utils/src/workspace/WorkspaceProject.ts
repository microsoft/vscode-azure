/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/** How strongly a rule's evidence identifies the emitted project characteristic. */
export type ProjectDetectionConfidence = 'high' | 'medium' | 'low';

/** The kind of project characteristic emitted by a detection rule. */
export type ProjectDetectionKind = 'project' | 'framework' | 'buildTool' | 'language';

/** A path or manifest value that caused a project rule to match. */
export interface ProjectDetectionEvidence {
    readonly uri: vscode.Uri;
    readonly description: string;
}

/** One explainable result produced by a {@linkcode ProjectDetectionRule}. */
export interface ProjectDetection {
    readonly ruleId: string;
    readonly kind: ProjectDetectionKind;
    readonly id: string;
    readonly confidence: ProjectDetectionConfidence;
    readonly evidence: readonly ProjectDetectionEvidence[];
}

/** A likely build output directory, relative to {@linkcode WorkspaceProject.rootUri}. */
export interface ProjectOutputDirectory {
    readonly path: string;
    readonly confidence: ProjectDetectionConfidence;
    readonly ruleId: string;
}

/** One candidate project discovered in an open workspace folder. */
export interface WorkspaceProject {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly rootUri: vscode.Uri;
    /** POSIX-style path relative to the workspace folder, or `.` for its root. */
    readonly relativePath: string;
    readonly frameworks: readonly string[];
    readonly buildTools: readonly string[];
    readonly languages: readonly string[];
    readonly outputDirectories: readonly ProjectOutputDirectory[];
    readonly detections: readonly ProjectDetection[];
}

/** A non-fatal problem encountered while reading project evidence. */
export interface WorkspaceScanDiagnostic {
    readonly uri: vscode.Uri;
    readonly code: 'invalidJson';
    readonly message: string;
}

/** The budget that stopped a scan before it could inspect the whole workspace. */
export type WorkspaceScanLimit = 'depth' | 'entries' | 'projects' | 'evidenceFileSize';

/** Results of a bounded workspace project scan. */
export interface WorkspaceScanResult {
    readonly projects: readonly WorkspaceProject[];
    readonly diagnostics: readonly WorkspaceScanDiagnostic[];
    readonly truncated: boolean;
    readonly reachedLimits: readonly WorkspaceScanLimit[];
}
