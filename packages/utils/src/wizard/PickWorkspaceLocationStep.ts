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
 * A configured value, or a function deriving it from the wizard context when the
 * step runs. Every resolver of one invocation receives the same context object,
 * so a caller may cache work shared between them.
 */
export type PickWorkspaceLocationOption<TContext, TValue> =
    | TValue
    | ((context: Readonly<TContext>) => TValue | Promise<TValue>);

/**
 * Signals that the workspace cannot offer a location to pick from, before any UI
 * is shown. Steps that can still obtain one another way -- typically a free-text
 * prompt -- catch this and fall back; anything else lets it propagate.
 */
export class NoWorkspaceLocationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'NoWorkspaceLocationError';
    }
}

interface PickWorkspaceLocationOptionsBase<TContext> {
    readonly kind: 'file' | 'folder';
    readonly strings: PickWorkspaceLocationStrings;
    /** Arguments forwarded to {@linkcode vscode.workspace.findFiles} to gather suggestions. */
    readonly findFiles: PickWorkspaceLocationOption<TContext, FindWorkspaceFilesOptions>;
    /**
     * Base used for filtering suggestions and calculating returned paths.
     *
     * Defaults to each match's containing workspace folder.
     */
    readonly relativeTo?: PickWorkspaceLocationOption<TContext, vscode.Uri | undefined>;
    /** Additional relative paths to offer even when they do not exist yet. */
    readonly suggestedRelativePaths?: PickWorkspaceLocationOption<TContext, readonly string[]>;
    /** Initial filter and active selection. */
    readonly value?: PickWorkspaceLocationOption<TContext, string | undefined>;
    /** Allows a relative path to be entered when no existing suggestion fits. */
    readonly allowCustom?: boolean;
    /** Optional choice that returns `undefined` instead of a location. */
    readonly noneLabel?: string;
    /** Restricts custom and suggested relative paths. */
    readonly isValidRelativePath?: (value: string) => boolean;
}

/**
 * Configures the selection experience and result produced by
 * {@linkcode PickWorkspaceLocationStep}.
 *
 * The selection is recorded either by naming a context property that holds a
 * {@linkcode WorkspaceLocation}, or by projecting it with {@linkcode toContext}
 * when the context stores something else -- a relative path, a derived flag, or
 * several properties at once. Exactly one of the two is supplied.
 */
export type PickWorkspaceLocationOptions<TContext> =
    & PickWorkspaceLocationOptionsBase<TContext>
    & (
        | {
            readonly contextProperty: WorkspaceLocationProperty<TContext>;
            readonly toContext?: never;
        }
        | {
            readonly contextProperty?: never;
            /**
             * Converts the selection into this step's contribution. Receives
             * `undefined` when the user chose {@linkcode noneLabel}.
             */
            readonly toContext: (
                location: WorkspaceLocation | undefined,
                context: Readonly<TContext>,
            ) => Partial<TContext> | Promise<Partial<TContext>>;
        }
    );

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
        private readonly options: PickWorkspaceLocationOptions<TContext>,
    ) {
        super();
    }

    /**
     * @inheritdoc
     * @throws {@linkcode NoWorkspaceLocationError} when the workspace cannot
     *   offer anything to pick from.
     */
    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const location = await this.pickLocation(context);
        const options = this.options;
        if (options.toContext) {
            return await options.toContext(location, context);
        }
        return { [options.contextProperty]: location } as Partial<TContext>;
    }

    private async pickLocation(context: Readonly<TContext>): Promise<WorkspaceLocation | undefined> {
        if (!this.ctx.code.workspace.workspaceFolders?.length) {
            throw new NoWorkspaceLocationError(this.ctx.code.l10n.t('Open a workspace folder before selecting a location.'));
        }

        const relativeTo = await resolveOption(this.options.relativeTo, context);
        const value = await resolveOption(this.options.value, context);
        const normalizedValue = normalizeRelativePath(value);
        const pickerValue = normalizedValue === ''
            && (!this.options.noneLabel || value?.trim() !== '')
            ? '.'
            : normalizedValue;
        const matches = await this.ctx.code.workspace.findFiles(...await resolveOption(this.options.findFiles, context));
        const locations = this.toLocations(matches, relativeTo);
        const suggestedRelativePaths = await resolveOption(this.options.suggestedRelativePaths, context) ?? [];
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
    option: PickWorkspaceLocationOption<TContext, TValue>,
    context: Readonly<TContext>,
): Promise<TValue>;
function resolveOption<TContext, TValue>(
    option: PickWorkspaceLocationOption<TContext, TValue> | undefined,
    context: Readonly<TContext>,
): Promise<TValue | undefined>;
async function resolveOption<TContext, TValue>(
    option: PickWorkspaceLocationOption<TContext, TValue> | undefined,
    context: Readonly<TContext>,
): Promise<TValue | undefined> {
    return typeof option === 'function'
        ? await (option as (context: Readonly<TContext>) => TValue | Promise<TValue>)(context)
        : option;
}

function normalizeRelativePath(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized === '.' ? '' : normalized;
}
