/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, type QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';
import { runtimeVersions } from './runtimesAndVersions';

/**
 * Resolves the version for the runtime stack chosen in {@linkcode PickRuntimeStep}.
 *
 * Skipped entirely when the version is already known or when infrastructure already exists.
 * Otherwise this step runs, but only actually prompts when the selected runtime supports more than
 * one (non-EOL) version; when there is a single supported version it is assigned without prompting.
 */
export class PickRuntimeVersionStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.runtimeVersion === undefined && !context.hasInfra && !!context.functionWorkerRuntime;
    }

    public async prompt(context: Readonly<CreateFunctionAppContext>): Promise<Partial<CreateFunctionAppContext>> {
        // shouldPrompt guarantees a runtime is selected before this step runs.
        const runtime = context.functionWorkerRuntime;
        const versions = runtime ? runtimeVersions[runtime] : [];

        // Assign the version without prompting when there is only one supported choice.
        if (versions.length === 1) {
            return { runtimeVersion: versions[0] };
        }

        const items: QuickPickItemWithData<string>[] = versions.map((version, index) => ({
            label: version,
            description: index === 0 ? this.ctx.code.l10n.t('Recommended') : undefined,
            data: version,
        }));

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('Select a version'),
            showBack: true,
        });

        return { runtimeVersion: picked.data };
    }
}
