/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { PickBuildPresetStep } from '../../../src/commands/staticWebApps/steps/PickBuildPresetStep';

describe('PickBuildPresetStep (unit)', () => {
    it('should group presets and offer Custom', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.directories.add('/workspace');
        const actionContext = createActionContext('test');
        const step = new PickBuildPresetStep(
            actionContext,
            ctx,
        );
        respondToPrompts(mock, [{ pick: '$(keyboard) Custom' }]);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
        });

        expect(result.buildPresetSelection).to.equal('custom');
        expect(actionContext.telemetry.properties.buildPreset).to.equal('Custom');
        const quickPick = mock.quickPicks[0];
        expect(quickPick.items.filter(item => item.kind === ctx.code.QuickPickItemKind.Separator).map(item => item.label))
            .to.deep.equal(['Framework', 'Static site generator', 'Other']);
    });

    it('should preselect a detected framework', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({
            dependencies: { react: '19.0.0' },
        }));
        const actionContext = createActionContext('test');
        const step = new PickBuildPresetStep(
            actionContext,
            ctx,
        );
        respondToPrompts(mock, ['acceptDefault']);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
        });

        expect(result.buildPresetSelection).to.equal('react');
        expect(result.detectedFrameworks).to.deep.equal(['react']);
    });
});
