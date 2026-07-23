/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { GitHubActionLogContentProvider } from './GitHubActionLogContentProvider';

/** Supplies the folds precomputed while a GitHub Action log was parsed. */
export class GitHubActionLogFoldingProvider implements vscode.FoldingRangeProvider {
    public constructor(
        private readonly contentProvider: GitHubActionLogContentProvider,
    ) { }

    /** @inheritdoc */
    public provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken,
    ): vscode.FoldingRange[] {
        return [...this.contentProvider.getFoldingRanges(document.uri)];
    }
}
