/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type IExtensionContext, type IVsCode,
    PromptStep, showSmartQuickPick, Wizard
} from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type * as vscode from 'vscode';

interface PickContext {
    choice?: string;
}

class SimplePickStep extends PromptStep<PickContext> {
    constructor(private readonly ctx: { readonly code: IVsCode; readonly extensionContext: IExtensionContext }) { super(); }

    public async prompt(): Promise<Partial<PickContext>> {
        const items: vscode.QuickPickItem[] = [
            { label: 'Alpha' },
            { label: 'Beta' },
        ];
        const picked = await showSmartQuickPick(this.ctx, items);
        return { choice: picked.label };
    }
}

describe('(unit) MockVsCode from testing entrypoint', () => {
    it('should create a mock code context and run a wizard', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { pick: 'Beta' },
        ]);

        const wizard = new Wizard<PickContext>(
            { picks: [] } as unknown as PickContext,
            [new SimplePickStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.choice).to.equal('Beta');
        tracker.assertAllConsumed();
    });
});
