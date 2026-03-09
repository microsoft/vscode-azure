/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { PromptStep, showSmartInputBox, Wizard } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { ICodeContext } from '@microsoft/vscode-azure-utils';

interface NameContext {
    name?: string;
}

class NameStep extends PromptStep<NameContext> {
    constructor(private readonly ctx: ICodeContext) { super(); }

    public async prompt(): Promise<Partial<NameContext>> {
        const name = await showSmartInputBox(this.ctx, { prompt: 'Enter a name' });
        return { name };
    }
}

describe('(unit) MockVsCode from testing entrypoint', () => {
    it('should run a wizard with an input box', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tracker = respondToPrompts(mock, [
            { input: 'my-resource' },
        ]);

        const wizard = new Wizard<NameContext>(
            {},
            [new NameStep(ctx)],
        );
        const result = await wizard.run();

        expect(result.name).to.equal('my-resource');
        tracker.assertAllConsumed();
    });
});
