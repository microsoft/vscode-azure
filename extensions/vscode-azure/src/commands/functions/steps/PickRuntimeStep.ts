/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { FunctionAppRuntime } from '../../../bicep/BicepGenerator';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

interface RuntimeItem {
    readonly label: string;
    readonly description: string;
    readonly data: FunctionAppRuntime;
}

const runtimeItems: readonly RuntimeItem[] = [
    { label: 'Node.js', description: 'JavaScript / TypeScript', data: 'node' },
    { label: 'Python', description: 'Python 3.11', data: 'python' },
    { label: '.NET (isolated)', description: '.NET 8 isolated worker', data: 'dotnet-isolated' },
    { label: 'Java', description: 'Java 17', data: 'java' },
    { label: 'PowerShell', description: 'PowerShell 7.4', data: 'powershell' },
    { label: 'Custom', description: 'Custom handler', data: 'custom' },
];

/**
 * Prompts the user to pick a Function App runtime stack.
 */
export class PickRuntimeStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const picked = await showSmartQuickPick(this.ctx, [...runtimeItems], {
            placeHolder: this.ctx.code.l10n.t('Select a runtime stack'),
            showBack: true,
        });

        return { runtime: picked.data };
    }
}
