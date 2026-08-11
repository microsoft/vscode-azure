/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QuickPickItemWithData, showSmartQuickPick } from '../ui/uiHelpers';
import type { ICodeContext } from '../vscode/IVsCode';
import { PromptStep } from './PromptStep';
import type { WorkspaceLocation, WorkspaceLocationSource } from './workspaceLocations';

/** User-facing text that describes the location being selected. */
export interface PickWorkspaceLocationStrings {
    readonly title?: string;
    readonly placeHolder: string;
    /** Shown when the source finds nothing. Defaults to a generic message. */
    readonly noneFound?: string;
}

type WorkspaceLocationProperty<TContext> = {
    [TKey in keyof TContext]: WorkspaceLocation | undefined extends TContext[TKey] ? TKey : never;
}[keyof TContext];

/**
 * Configures the selection experience and result produced by
 * {@linkcode PickWorkspaceLocationStep}.
 */
export interface PickWorkspaceLocationOptions<TContext> {
    readonly strings: PickWorkspaceLocationStrings;
    readonly contextProperty: WorkspaceLocationProperty<TContext>;
}

/**
 * Prompts for a location in the workspace, choosing from the suggestions a
 * {@linkcode WorkspaceLocationSource} provides.
 *
 * Suggestions normally come from `projectLocations`, so the list is the set of
 * detected projects rather than raw glob matches -- generated, vendored, and
 * `.gitignore`d paths are already excluded, and each entry is labelled with the
 * frameworks that were detected.
 *
 * Selected paths use `/` separators and are relative to the containing
 * workspace folder.
 */
export class PickWorkspaceLocationStep<TContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly source: WorkspaceLocationSource,
        private readonly options: PickWorkspaceLocationOptions<TContext>,
    ) {
        super();
    }

    /** @inheritdoc */
    public async prompt(_context: Readonly<TContext>): Promise<Partial<TContext>> {
        if (!this.ctx.code.workspace.workspaceFolders?.length) {
            throw new Error(this.ctx.code.l10n.t('Open a workspace folder before selecting a location.'));
        }

        const locations = await this.source();
        if (locations.length === 0) {
            throw new Error(this.options.strings.noneFound
                ?? this.ctx.code.l10n.t('No matching locations were found in the workspace.'));
        }

        const multiRoot = this.ctx.code.workspace.workspaceFolders.length > 1;
        const picks: QuickPickItemWithData<WorkspaceLocation>[] = locations.map(location => ({
            label: location.relativePath || '.',
            description: describe(location, multiRoot),
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
}

/**
 * Builds the secondary text for a suggestion: what was detected there, plus the
 * owning workspace folder when there is more than one.
 */
function describe(location: WorkspaceLocation, multiRoot: boolean): string | undefined {
    const parts = [location.description];
    if (multiRoot) {
        parts.push(location.workspaceFolder.name);
    }
    return parts.filter(Boolean).join(' - ') || undefined;
}
