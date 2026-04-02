/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext, FunctionAppRuntime } from '../CreateFunctionAppContext';
import { getRuntimeVersion } from '../CreateFunctionAppContext';

interface RuntimeItem {
    readonly label: string;
    readonly description: string;
    readonly data: FunctionAppRuntime;
}

function getRuntimeItems(ctx: ICodeContext): RuntimeItem[] {
    return [
        { label: 'Node.js', description: ctx.code.l10n.t('JavaScript / TypeScript'), data: 'node' },
        { label: 'Python', description: ctx.code.l10n.t('Python 3.11'), data: 'python' },
        { label: '.NET (isolated)', description: ctx.code.l10n.t('.NET 8 isolated worker'), data: 'dotnet-isolated' },
        { label: 'Java', description: ctx.code.l10n.t('Java 17'), data: 'java' },
        { label: 'PowerShell', description: ctx.code.l10n.t('PowerShell 7.4'), data: 'powershell' },
        { label: ctx.code.l10n.t('Custom'), description: ctx.code.l10n.t('Custom handler'), data: 'custom' },
    ];
}

/**
 * Prompts the user to pick a Function App runtime stack.
 */
export class PickRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return !context.runtime;
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const picked = await showSmartQuickPick(this.ctx, getRuntimeItems(this.ctx), {
            placeHolder: this.ctx.code.l10n.t('Select a runtime stack'),
            showBack: true,
        });

        return { runtime: picked.data, runtimeVersion: getRuntimeVersion(picked.data) };
    }
}
