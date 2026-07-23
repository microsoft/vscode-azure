/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, type Disposable, type IVsCode as VsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { GitHubLogFoldingRange } from './GitHubActionLogParser';

/** URI scheme used for read-only GitHub Action logs. */
export const GitHubActionLogScheme = 'github-action-log';

interface GitHubActionLogContent {
    readonly content: string;
    readonly foldingRanges: readonly vscode.FoldingRange[];
}

/** Stable identity used to build a collision-free virtual log document URI. */
export interface GitHubActionLogIdentity {
    readonly jobId: number;
    readonly stepNumber?: number;
    readonly label: string;
}

/**
 * Serves cached GitHub Action logs as virtual text documents.
 *
 * Entries are replaced for stable job/step URIs, removed when documents close,
 * and capped at 32 closed entries while preserving every currently open log.
 */
@injectable()
export class GitHubActionLogContentProvider implements vscode.TextDocumentContentProvider, Disposable {
    private static readonly maximumCachedDocuments = 32;
    private readonly content = new Map<string, GitHubActionLogContent>();
    private readonly closeDisposable: vscode.Disposable;

    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
    ) {
        this.closeDisposable = this.code.workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === GitHubActionLogScheme) {
                this.content.delete(document.uri.toString());
            }
        });
    }

    /** @inheritdoc */
    public dispose(): void {
        this.closeDisposable.dispose();
        this.content.clear();
    }

    /** @inheritdoc */
    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.content.get(uri.toString())?.content ?? '';
    }

    /** Returns precomputed folds for a virtual log document. */
    public getFoldingRanges(uri: vscode.Uri): readonly vscode.FoldingRange[] {
        return this.content.get(uri.toString())?.foldingRanges ?? [];
    }

    /**
     * Opens a virtual log document and folds all regions after the editor is ready.
     *
     * The same job/step always reuses its stable URI and replaces stale content.
     */
    public async open(
        identity: GitHubActionLogIdentity,
        content: string,
        foldingRanges: readonly GitHubLogFoldingRange[],
    ): Promise<vscode.Uri> {
        const id = identity.stepNumber === undefined
            ? `job-${identity.jobId}`
            : `job-${identity.jobId}-step-${identity.stepNumber}`;
        const fileName = sanitize(identity.label) || 'log';
        const uri = this.code.Uri.from({
            scheme: GitHubActionLogScheme,
            path: `/${sanitize(id)}/${fileName}.log`,
        });

        const key = uri.toString();
        this.content.delete(key);
        this.content.set(key, {
            content,
            foldingRanges: foldingRanges.map(range =>
                new this.code.FoldingRange(
                    range.start,
                    range.end,
                    this.code.FoldingRangeKind.Region,
                )),
        });

        await this.code.window.showTextDocument(uri);
        await this.code.commands.executeCommand('editor.foldAll');
        this.pruneClosedEntries(key);
        return uri;
    }

    private pruneClosedEntries(protectedKey: string): void {
        if (this.content.size <= GitHubActionLogContentProvider.maximumCachedDocuments) {
            return;
        }

        const openDocuments = new Set(
            this.code.workspace.textDocuments
                .filter(document => document.uri.scheme === GitHubActionLogScheme)
                .map(document => document.uri.toString()),
        );
        for (const key of this.content.keys()) {
            if (this.content.size <= GitHubActionLogContentProvider.maximumCachedDocuments) {
                break;
            }
            if (key !== protectedKey && !openDocuments.has(key)) {
                this.content.delete(key);
            }
        }
    }
}

function sanitize(value: string): string {
    return value.replace(/[^a-z0-9\-_.!~*'()]/gi, '_');
}
