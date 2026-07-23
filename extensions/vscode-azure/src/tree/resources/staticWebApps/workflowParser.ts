/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { LineCounter, parseDocument, type Node } from 'yaml';
import type * as vscode from 'vscode';

/** Static Web Apps build keys surfaced as workflow tree children. */
export type WorkflowBuildConfig = 'app_location' | 'api_location' | 'output_location' | 'app_artifact_location';

/** Serializable source position retained for a future editor-selection command. */
export interface WorkflowSourcePosition {
    readonly line: number;
    readonly character: number;
}

/** Serializable source range retained without a runtime VS Code dependency. */
export interface WorkflowSourceRange {
    readonly start: WorkflowSourcePosition;
    readonly end: WorkflowSourcePosition;
}

/** One build configuration extracted from a deployment workflow. */
export interface WorkflowBuildSetting {
    readonly name: WorkflowBuildConfig;
    readonly value: string;
    readonly range: WorkflowSourceRange;
}

/** Parsed workflow group, including recoverable YAML error metadata. */
export interface ParsedWorkflow {
    readonly uri: vscode.Uri;
    readonly settings: readonly WorkflowBuildSetting[];
    readonly errorRange?: WorkflowSourceRange;
}

const buildConfigs: readonly WorkflowBuildConfig[] = [
    'app_location',
    'api_location',
    'output_location',
    'app_artifact_location',
];

/**
 * Parses one YAML file and returns its Static Web Apps deployment settings.
 *
 * Valid workflows without an `Azure/static-web-apps-deploy` step whose id is
 * `builddeploy` are ignored. Syntax errors are returned with source metadata so
 * the tree can expose an auditable parse-error node.
 */
export async function parseStaticWebAppWorkflow(code: IVsCode, uri: vscode.Uri): Promise<ParsedWorkflow | undefined> {
    const bytes = await code.workspace.fs.readFile(uri);
    const source = new TextDecoder().decode(bytes);
    const lineCounter = new LineCounter();
    const document = parseDocument(source, { lineCounter, prettyErrors: true });

    if (document.errors.length > 0) {
        const parseError = document.errors[0];
        return {
            uri,
            settings: [],
            errorRange: errorRange(parseError.linePos, parseError.pos, lineCounter),
        };
    }

    const root = document.toJS() as unknown;
    if (!isRecord(root) || !isRecord(root.jobs)) {
        return undefined;
    }

    for (const [jobName, candidateJob] of Object.entries(root.jobs)) {
        if (!isRecord(candidateJob) || !Array.isArray(candidateJob.steps)) {
            continue;
        }

        for (const [stepIndex, candidateStep] of candidateJob.steps.entries()) {
            if (!isRecord(candidateStep)
                || candidateStep.id !== 'builddeploy'
                || typeof candidateStep.uses !== 'string'
                || !/^Azure\/static-web-apps-deploy(?:@|$)/i.test(candidateStep.uses)) {
                continue;
            }

            const withConfig = candidateStep.with;
            if (!isRecord(withConfig) || !Object.hasOwn(withConfig, 'app_location')) {
                continue;
            }

            const settings = buildConfigs.flatMap(config => {
                if (!Object.hasOwn(withConfig, config)) {
                    return [];
                }

                const value = withConfig[config];
                if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                    return [];
                }

                const node = document.getIn(['jobs', jobName, 'steps', stepIndex, 'with', config], true);
                return [{
                    name: config,
                    value: typeof value === 'string' ? value : JSON.stringify(value),
                    range: nodeRange(node, lineCounter),
                } satisfies WorkflowBuildSetting];
            });

            return { uri, settings };
        }
    }

    return undefined;
}

/**
 * Scans `.github/workflows` beneath a local repository using
 * {@linkcode vscode.workspace.fs workspace.fs}.
 */
export async function scanStaticWebAppWorkflows(code: IVsCode, repositoryRoot: vscode.Uri): Promise<ParsedWorkflow[]> {
    const workflowsUri = code.Uri.joinPath(repositoryRoot, '.github', 'workflows');
    let entries: [string, vscode.FileType][];
    try {
        entries = await code.workspace.fs.readDirectory(workflowsUri);
    } catch (error) {
        if (isFileNotFound(error)) {
            return [];
        }
        throw error;
    }

    const workflowUris = entries
        .filter(([name, type]) => type === code.FileType.File && /\.ya?ml$/i.test(name))
        .map(([name]) => code.Uri.joinPath(workflowsUri, name))
        .sort((left, right) => left.path.localeCompare(right.path));

    const workflows = await Promise.all(workflowUris.map(uri => parseStaticWebAppWorkflow(code, uri)));
    return workflows.filter((workflow): workflow is ParsedWorkflow => !!workflow);
}

function nodeRange(node: unknown, lineCounter: LineCounter): WorkflowSourceRange {
    if (node && typeof node === 'object' && 'range' in node) {
        const range = (node as Node).range;
        if (range) {
            return sourceRange(range[0], range[1], lineCounter);
        }
    }
    return sourceRange(0, 0, lineCounter);
}

function errorRange(
    linePos: readonly { readonly line: number; readonly col: number }[] | undefined,
    offsets: readonly [number, number],
    lineCounter: LineCounter,
): WorkflowSourceRange {
    if (linePos?.length) {
        const start = linePos[0];
        const end = linePos[1] ?? start;
        return {
            start: { line: start.line - 1, character: start.col - 1 },
            end: { line: end.line - 1, character: end.col - 1 },
        };
    }
    return sourceRange(offsets[0], offsets[1], lineCounter);
}

function sourceRange(startOffset: number, endOffset: number, lineCounter: LineCounter): WorkflowSourceRange {
    const start = lineCounter.linePos(startOffset);
    const end = lineCounter.linePos(endOffset);
    return {
        start: { line: Math.max(0, start.line - 1), character: Math.max(0, start.col - 1) },
        end: { line: Math.max(0, end.line - 1), character: Math.max(0, end.col - 1) },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFileNotFound(error: unknown): error is { readonly code: 'FileNotFound' } {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound';
}
