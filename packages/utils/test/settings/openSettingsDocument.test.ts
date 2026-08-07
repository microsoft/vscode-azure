/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { openSettingsDocument } from '../../src/settings/openSettingsDocument';
import { createMockVsCode } from '../vscode/MockVsCode';

describe('openSettingsDocument (unit)', () => {
    it('opens the URI and shows its document', async () => {
        const mock = createMockVsCode();
        const uri = mock.vscode.Uri.from({ scheme: 'azure-settings', path: '/app.settings.jsonc' });

        const editor = await openSettingsDocument(mock.vscode, uri);

        expect(mock.textDocuments.map(document => document.uri)).to.deep.equal([uri]);
        expect(mock.shownDocuments).to.deep.equal(mock.textDocuments);
        expect(editor.document).to.equal(mock.textDocuments[0]);
    });
});
