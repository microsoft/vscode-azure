/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type QuickPickItemWithData, showSmartQuickPick } from '../ui/uiHelpers';
import { CancellationError } from '../vscode/CancellationError';
import type { ICodeContext, IVsCode } from '../vscode/IVsCode';
import { PromptStep } from './PromptStep';

const browse = Symbol('browse');
const skip = Symbol('skip');

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
    readonly browseLabel: string;
    readonly openLabel: string;
    readonly skipLabel?: string;
    readonly outsideWorkspaceMessage?: string;
}

/**
 * Configures the workspace scan performed by {@linkcode PickWorkspaceLocationStep}.
 */
export interface FindWorkspaceFilesOptions {
    readonly include: Parameters<IVsCode['workspace']['findFiles']>[0];
    readonly exclude?: Parameters<IVsCode['workspace']['findFiles']>[1];
    readonly maxResults?: Parameters<IVsCode['workspace']['findFiles']>[2];
    readonly token?: Parameters<IVsCode['workspace']['findFiles']>[3];
}

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
    readonly allowSkip?: boolean;
    readonly contextProperty: WorkspaceLocationProperty<TContext>;
}

type LocationPickData = WorkspaceLocation | typeof browse | typeof skip;

/**
 * Prompts for a file or folder in the workspace, using {@linkcode vscode.workspace.findFiles}
 * results as suggestions and an open dialog as an escape hatch.
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

        const matches = await this.ctx.code.workspace.findFiles(
            this.findFilesOptions.include,
            this.findFilesOptions.exclude,
            this.findFilesOptions.maxResults,
            this.findFilesOptions.token,
        );
        const locations = this.toLocations(matches);

        const picks: QuickPickItemWithData<LocationPickData>[] = locations.map(location => ({
            label: location.relativePath || '.',
            description: this.ctx.code.workspace.workspaceFolders?.length === 1 ? undefined : location.workspaceFolder.name,
            data: location,
        }));
        picks.push({ label: this.options.strings.browseLabel, data: browse });

        if (this.options.allowSkip) {
            if (!this.options.strings.skipLabel) {
                throw new Error('skipLabel is required when allowSkip is true');
            }

            picks.push({ label: this.options.strings.skipLabel, data: skip });
        }

        for (;;) {
            const choice = await showSmartQuickPick(this.ctx, picks, {
                title: this.options.strings.title,
                placeHolder: this.options.strings.placeHolder,
                showBack: true,
                matchOnDescription: true,
            });

            if (choice.data === skip) {
                return this.createResult(undefined);
            }

            if (choice.data !== browse) {
                return this.createResult(choice.data);
            }

            const selected = await this.ctx.code.window.showOpenDialog({
                canSelectFiles: this.options.kind === 'file',
                canSelectFolders: this.options.kind === 'folder',
                canSelectMany: false,
                defaultUri: this.ctx.code.workspace.workspaceFolders[0].uri,
                openLabel: this.options.strings.openLabel,
                title: this.options.strings.title,
            });

            if (!selected?.[0]) {
                throw new CancellationError();
            }

            const location = this.toLocation(selected[0]);
            if (location) {
                return this.createResult(location);
            }

            await this.ctx.code.window.showErrorMessage(
                this.options.strings.outsideWorkspaceMessage ??
                this.ctx.code.l10n.t('Select a location inside an open workspace folder.'),
            );
        }
    }

    private createResult(location: WorkspaceLocation | undefined): Partial<TContext> {
        return { [this.options.contextProperty]: location } as Partial<TContext>;
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
