/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type QuickPickItemWithData, showSmartQuickPick } from '../ui/uiHelpers';
import { relativePath } from '../vscode/fsHelpers';
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
    /**
     * Base used for filtering suggestions and calculating returned paths.
     *
     * Defaults to each match's containing workspace folder.
     */
    readonly relativeTo?: vscode.Uri | ((context: Readonly<TContext>) => vscode.Uri | undefined);
    /** Additional relative paths to offer even when they do not exist yet. */
    readonly suggestedRelativePaths?: readonly string[] | ((context: Readonly<TContext>) => readonly string[]);
    /** Initial filter and active selection. */
    readonly value?: string | ((context: Readonly<TContext>) => string | undefined);
    /** Allows a relative path to be entered when no existing suggestion fits. */
    readonly allowCustom?: boolean;
    /** Optional choice that returns `undefined` instead of a location. */
    readonly noneLabel?: string;
    /** Restricts custom and suggested relative paths. */
    readonly isValidRelativePath?: (value: string) => boolean;
}

/**
 * Per-invocation values used by subclasses that derive picker state
 * asynchronously before prompting.
 */
export interface PickWorkspaceLocationPromptOverrides {
    readonly findFilesOptions?: FindWorkspaceFilesOptions;
    readonly relativeTo?: vscode.Uri;
    readonly suggestedRelativePaths?: readonly string[];
    readonly value?: string;
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
        protected readonly ctx: ICodeContext,
        private readonly findFilesOptions: FindWorkspaceFilesOptions,
        private readonly options: PickWorkspaceLocationOptions<TContext>,
    ) {
        super();
    }

    /** @inheritdoc */
    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const location = await this.pickLocation(context);
        return { [this.options.contextProperty]: location } as Partial<TContext>;
    }

    /**
     * Runs the configured picker and returns its selected location.
     *
     * Subclasses may provide values resolved asynchronously for the current
     * invocation while retaining the shared picker behavior.
     */
    protected async pickLocation(
        context: Readonly<TContext>,
        overrides: PickWorkspaceLocationPromptOverrides = {},
    ): Promise<WorkspaceLocation | undefined> {
        if (!this.ctx.code.workspace.workspaceFolders?.length) {
            throw new Error(this.ctx.code.l10n.t('Open a workspace folder before selecting a location.'));
        }

        const relativeTo = overrides.relativeTo ?? resolveOption(this.options.relativeTo, context);
        const value = overrides.value ?? resolveOption(this.options.value, context);
        const normalizedValue = normalizeRelativePath(value);
        const pickerValue = normalizedValue === ''
            && (!this.options.noneLabel || value?.trim() !== '')
            ? '.'
            : normalizedValue;
        const matches = await this.ctx.code.workspace.findFiles(...(overrides.findFilesOptions ?? this.findFilesOptions));
        const locations = this.toLocations(matches, relativeTo);
        const suggestedRelativePaths = overrides.suggestedRelativePaths
            ?? resolveOption(this.options.suggestedRelativePaths, context)
            ?? [];
        for (const path of suggestedRelativePaths) {
            const location = relativeTo && this.toRelativeLocation(relativeTo, path);
            if (location && this.isValidRelativePath(location.relativePath)) {
                locations.set(location.uri.toString(), location);
            }
        }

        const picks: QuickPickItemWithData<WorkspaceLocation | undefined>[] = [...locations.values()]
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
            .map(location => ({
                label: location.relativePath || '.',
                description: this.ctx.code.workspace.workspaceFolders?.length === 1 ? undefined : location.workspaceFolder.name,
                data: location,
            }));
        if (this.options.noneLabel) {
            picks.unshift({ label: this.options.noneLabel, data: undefined });
        }

        const choice = await showSmartQuickPick(this.ctx, picks, {
            title: this.options.strings.title,
            placeHolder: this.options.strings.placeHolder,
            showBack: true,
            matchOnDescription: true,
            value: pickerValue,
            isActiveItem: item => item.data
                ? normalizeRelativePath(value) === item.data.relativePath
                : value === '',
            createItemFromValue: this.options.allowCustom && relativeTo
                ? input => {
                    const location = this.toRelativeLocation(relativeTo, input);
                    return location && this.isValidRelativePath(location.relativePath)
                        ? { label: location.relativePath || '.', data: location }
                        : undefined;
                }
                : undefined,
        });

        return choice.data;
    }

    private toLocations(
        matches: readonly vscode.Uri[],
        relativeTo: vscode.Uri | undefined,
    ): Map<string, WorkspaceLocation> {
        const locations = new Map<string, WorkspaceLocation>();

        for (const match of matches) {
            const uri = this.options.kind === 'folder' ? this.ctx.code.Uri.joinPath(match, '..') : match;
            const location = this.toLocation(uri, relativeTo);
            if (location) {
                locations.set(location.uri.toString(), location);
            }
        }

        return locations;
    }

    private toLocation(uri: vscode.Uri, relativeTo: vscode.Uri | undefined): WorkspaceLocation | undefined {
        const workspaceFolder = this.ctx.code.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return undefined;
        }

        const base = relativeTo ?? workspaceFolder.uri;
        const path = relativePath(base, uri);
        return path === undefined ? undefined : { uri, relativePath: path, workspaceFolder };
    }

    private toRelativeLocation(relativeTo: vscode.Uri, path: string): WorkspaceLocation | undefined {
        const normalized = normalizeRelativePath(path);
        if (normalized === undefined) {
            return undefined;
        }
        const uri = normalized ? this.ctx.code.Uri.joinPath(relativeTo, normalized) : relativeTo;
        const workspaceFolder = this.ctx.code.workspace.getWorkspaceFolder(uri);
        return workspaceFolder ? { uri, relativePath: normalized, workspaceFolder } : undefined;
    }

    private isValidRelativePath(value: string): boolean {
        return this.options.isValidRelativePath?.(value) ?? true;
    }
}

function resolveOption<TContext, TValue>(
    option: TValue | ((context: Readonly<TContext>) => TValue) | undefined,
    context: Readonly<TContext>,
): TValue | undefined {
    return typeof option === 'function'
        ? (option as (context: Readonly<TContext>) => TValue)(context)
        : option;
}

function normalizeRelativePath(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized === '.' ? '' : normalized;
}
