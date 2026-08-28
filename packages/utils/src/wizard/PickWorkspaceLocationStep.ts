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

/**
 * Configures the picker shown by {@linkcode pickWorkspaceLocation}.
 */
export interface PickWorkspaceLocationArgs {
    /** Whether the matched files themselves are offered, or their containing folders. */
    readonly kind: 'file' | 'folder';
    readonly strings: PickWorkspaceLocationStrings;
    /** Arguments forwarded to {@linkcode vscode.workspace.findFiles} to gather suggestions. */
    readonly findFiles: FindWorkspaceFilesOptions;
    /**
     * Base used for filtering suggestions and calculating returned paths.
     *
     * Defaults to each match's containing workspace folder.
     */
    readonly relativeTo?: vscode.Uri;
    /**
     * Additional relative paths to offer even when they do not exist yet. Ignored when
     * {@linkcode relativeTo} is unset.
     */
    readonly suggestedRelativePaths?: readonly string[];
    /** Initial filter and active selection. */
    readonly value?: string;
    /** Allows a relative path to be entered when no existing suggestion fits. */
    readonly allowCustom?: boolean;
    /** Optional choice that returns `undefined` instead of a location. */
    readonly noneLabel?: string;
    /** Restricts custom and suggested relative paths. */
    readonly isValidRelativePath?: (value: string) => boolean;
}

/**
 * Prompts for a file or folder in the workspace, using {@linkcode vscode.workspace.findFiles}
 * results as suggestions.
 *
 * Folder suggestions are the containing folders of the files returned by
 * {@linkcode vscode.workspace.findFiles}. Selected paths use `/` separators and are relative to
 * {@linkcode PickWorkspaceLocationArgs.relativeTo}, or to the containing workspace folder when
 * that is unset.
 *
 * Callers that need the search, suggestions, or initial value to depend on state gathered earlier
 * in a wizard compute them before calling and pass plain values.
 *
 * @returns the selected location, or `undefined` when {@linkcode PickWorkspaceLocationArgs.noneLabel}
 *   was offered and chosen.
 * @throws when no workspace folder is open.
 */
export async function pickWorkspaceLocation(
    ctx: ICodeContext,
    args: PickWorkspaceLocationArgs,
): Promise<WorkspaceLocation | undefined> {
    if (!ctx.code.workspace.workspaceFolders?.length) {
        throw new Error(ctx.code.l10n.t('Open a workspace folder before selecting a location.'));
    }

    const { relativeTo, value } = args;
    const normalizedValue = normalizeRelativePath(value);
    const pickerValue = normalizedValue === ''
        && (!args.noneLabel || value?.trim() !== '')
        ? '.'
        : normalizedValue;
    const matches = await ctx.code.workspace.findFiles(...args.findFiles);
    const locations = toLocations(ctx, matches, args.kind, relativeTo);
    for (const path of args.suggestedRelativePaths ?? []) {
        const location = relativeTo && toRelativeLocation(ctx, relativeTo, path);
        if (location && isValidRelativePath(args, location.relativePath)) {
            locations.set(location.uri.toString(), location);
        }
    }

    const picks: QuickPickItemWithData<WorkspaceLocation | undefined>[] = [...locations.values()]
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map(location => ({
            label: location.relativePath || '.',
            description: ctx.code.workspace.workspaceFolders?.length === 1 ? undefined : location.workspaceFolder.name,
            data: location,
        }));
    if (args.noneLabel) {
        picks.unshift({ label: args.noneLabel, data: undefined });
    }

    const choice = await showSmartQuickPick(ctx, picks, {
        title: args.strings.title,
        placeHolder: args.strings.placeHolder,
        showBack: true,
        matchOnDescription: true,
        value: pickerValue,
        isActiveItem: item => item.data
            ? normalizedValue === item.data.relativePath
            : value === '',
        createItemFromValue: args.allowCustom && relativeTo
            ? input => {
                const location = toRelativeLocation(ctx, relativeTo, input);
                return location && isValidRelativePath(args, location.relativePath)
                    ? { label: location.relativePath || '.', data: location }
                    : undefined;
            }
            : undefined,
    });

    return choice.data;
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
    readonly contextProperty: WorkspaceLocationProperty<TContext>;
}

/**
 * Wizard step that runs {@linkcode pickWorkspaceLocation} over the whole workspace and stores the
 * selection on the wizard context.
 *
 * Steps whose search, suggestions, or result shape depend on the wizard context call
 * {@linkcode pickWorkspaceLocation} from their own {@linkcode PromptStep.prompt} instead of
 * extending this step.
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
        const location = await pickWorkspaceLocation(this.ctx, {
            kind: this.options.kind,
            strings: this.options.strings,
            findFiles: this.findFilesOptions,
        });

        return { [this.options.contextProperty]: location } as Partial<TContext>;
    }
}

function toLocations(
    ctx: ICodeContext,
    matches: readonly vscode.Uri[],
    kind: PickWorkspaceLocationArgs['kind'],
    relativeTo: vscode.Uri | undefined,
): Map<string, WorkspaceLocation> {
    const locations = new Map<string, WorkspaceLocation>();

    for (const match of matches) {
        const uri = kind === 'folder' ? ctx.code.Uri.joinPath(match, '..') : match;
        const location = toLocation(ctx, uri, relativeTo);
        if (location) {
            locations.set(location.uri.toString(), location);
        }
    }

    return locations;
}

function toLocation(
    ctx: ICodeContext,
    uri: vscode.Uri,
    relativeTo: vscode.Uri | undefined,
): WorkspaceLocation | undefined {
    const workspaceFolder = ctx.code.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return undefined;
    }

    const base = relativeTo ?? workspaceFolder.uri;
    const path = relativePath(base, uri);
    return path === undefined ? undefined : { uri, relativePath: path, workspaceFolder };
}

function toRelativeLocation(
    ctx: ICodeContext,
    relativeTo: vscode.Uri,
    path: string,
): WorkspaceLocation | undefined {
    const normalized = normalizeRelativePath(path);
    if (normalized === undefined) {
        return undefined;
    }
    const uri = normalized ? ctx.code.Uri.joinPath(relativeTo, normalized) : relativeTo;
    const workspaceFolder = ctx.code.workspace.getWorkspaceFolder(uri);
    return workspaceFolder ? { uri, relativePath: normalized, workspaceFolder } : undefined;
}

function isValidRelativePath(args: PickWorkspaceLocationArgs, value: string): boolean {
    return args.isValidRelativePath?.(value) ?? true;
}

function normalizeRelativePath(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized === '.' ? '' : normalized;
}
