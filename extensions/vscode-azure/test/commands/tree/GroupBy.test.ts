/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { GroupBy } from '../../../src/commands/tree/GroupBy';

describe('GroupBy (unit)', () => {
    it('should update groupBy setting to resourceType', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'Resource Type' },
        ]);

        const cmd = new GroupBy(ctx);
        await cmd.execute();

        expect(mock.settings.get('vscode-azure.groupBy')).to.equal('resourceType');
    });

    it('should update groupBy setting to location', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'Location' },
        ]);

        const cmd = new GroupBy(ctx);
        await cmd.execute();

        expect(mock.settings.get('vscode-azure.groupBy')).to.equal('location');
    });

    it('should prompt for tag name when armTag is selected', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'ARM Tag' },
            { input: 'environment' },
        ]);

        const cmd = new GroupBy(ctx);
        await cmd.execute();

        expect(mock.settings.get('vscode-azure.groupBy')).to.equal('armTag');
        expect(mock.settings.get('vscode-azure.groupByTag')).to.equal('environment');
    });

    it('should trim whitespace from tag name', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'ARM Tag' },
            { input: '  env  ' },
        ]);

        const cmd = new GroupBy(ctx);
        await cmd.execute();

        expect(mock.settings.get('vscode-azure.groupByTag')).to.equal('env');
    });

    it('should keep resourceGroup as default when selected', async () => {
        const { ctx, mock } = createMockCodeContext();
        respondToPrompts(mock, [
            { pick: 'Resource Group' },
        ]);

        const cmd = new GroupBy(ctx);
        await cmd.execute();

        expect(mock.settings.get('vscode-azure.groupBy')).to.equal('resourceGroup');
    });
});
