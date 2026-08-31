/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { PropertiesContentProvider, PropertiesScheme } from '../../src/properties/PropertiesContentProvider';

describe('PropertiesContentProvider (unit)', () => {
    it('keeps only recent snapshots available for reopening', async () => {
        const { ctx } = createMockCodeContext();
        const provider = new PropertiesContentProvider(ctx.code);
        ctx.code.workspace.registerTextDocumentContentProvider(PropertiesScheme, provider);

        const documents = [];
        for (let index = 0; index < 21; index++) {
            documents.push(await provider.openTextDocument(`snapshot ${index}`));
        }

        expect(provider.provideTextDocumentContent(documents[0].uri)).to.equal('');
        expect(provider.provideTextDocumentContent(documents.at(-1)!.uri)).to.equal('snapshot 20');
    });
});
