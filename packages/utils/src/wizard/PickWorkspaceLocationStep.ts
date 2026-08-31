/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type QuickPickItemWithData, showSmartQuickPick } from '../ui/uiHelpers';
import type { ICodeContext, IVsCode } from '../vscode/IVsCode';
import { PromptStep } from './PromptStep';

/**
 * A file or folder selected relative to its containing workspace folder.
 */
export interface WorkspaceLocation {
    readonly uri: vscode.Uri;
    readonly relativePath: string;
    readonly workspaceFolder: vscode.WorkspaceFolder;
}

/**
 * User-facing text that describes the location being selected.
 */
export interface PickWorkspaceLocationStrings {
    readonly title?: string;
    readonly placeHolder: string;
}

/** Arguments forwarded to {@linkcode vscode.workspace.findFiles}. */
export type FindWorkspaceFilesOptions = Parameters<IVsCode['workspace']['findFiles']>;

type WorkspaceLocationProperty<TContext> = {
    [TKey in keyof TContext]: WorkspaceLocation | undefined extends TContext[TKey] ? TKey : never;
}[keyof TContext];

/**
 * Configures the selection experience and result produced by
 * {@linkcode PickWorkspaceLocationStep}.
 */
export interface PickWorkspaceLocationOptions<TContext> {
    readonly kind: 'file' | 'folder';
    readonly strings: PickWorkspaceLocationStrings;
    readonly contextProperty: WorkspaceLocationProperty<TContext>;
}

/**
 * Prompts for a file or folder in the workspace, using {@linkcode vscode.workspace.findFiles}
 * results as suggestions.
 *
 * Folder suggestions are the containing folders of the files returned by
 * {@linkcode vscode.workspace.findFiles}. Selected paths use `/` separators and are relative
 * to the containing workspace folder.
 */
export class PickWorkspaceLocationStep<TContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly findFilesOptions: FindWorkspaceFilesOptions,
        private readonly options: PickWorkspaceLocationOptions<TContext>,
    ) {
        super();
    }

    /** @inheritdoc */
    public async prompt(_context: Readonly<TContext>): Promise<Partial<TContext>> {
        if (!this.ctx.code.workspace.workspaceFolders?.length) {
            throw new Error(this.ctx.code.l10n.t('Open a workspace folder before selecting a location.'));
        }

        const matches = await this.ctx.code.workspace.findFiles(...this.findFilesOptions);
        const locations = this.toLocations(matches);

        const picks: QuickPickItemWithData<WorkspaceLocation>[] = locations.map(location => ({
            label: location.relativePath || '.',
            description: this.ctx.code.workspace.workspaceFolders?.length === 1 ? undefined : location.workspaceFolder.name,
            data: location,
        }));

        const choice = await showSmartQuickPick(this.ctx, picks, {
            title: this.options.strings.title,
            placeHolder: this.options.strings.placeHolder,
            showBack: true,
            matchOnDescription: true,
        });

        return { [this.options.contextProperty]: choice.data } as Partial<TContext>;
    }

    private toLocations(matches: readonly vscode.Uri[]): WorkspaceLocation[] {
        const locations = new Map<string, WorkspaceLocation>();

        for (const match of matches) {
            const uri = this.options.kind === 'folder' ? this.ctx.code.Uri.joinPath(match, '..') : match;
            const location = this.toLocation(uri);
            if (location) {
                locations.set(location.uri.toString(), location);
            }
        }

        return [...locations.values()]
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    private toLocation(uri: vscode.Uri): WorkspaceLocation | undefined {
        const workspaceFolder = this.ctx.code.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return undefined;
        }

        const rootPath = workspaceFolder.uri.path.replace(/\/$/, '');
        const relativePath = uri.path.slice(rootPath.length).replace(/^\/+/, '');
        return { uri, relativePath, workspaceFolder };
    }
}
