/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from './MockVsCode';

// `openTextDocument` is one of the few pieces of mock logic worth testing directly: it picks between
// two real overloads and, for a URI, serves content from the mock filesystem. A caller whose
// assertion silently passed against the wrong branch would prove nothing.
describe('MockVsCode.openTextDocument (unit)', () => {
    it('serves a URI from the mock filesystem so a caller can read back what it wrote', async () => {
        const { vscode: code, fs } = createMockVsCode();
        const uri = code.Uri.file('/settings.json');
        fs.addFile(uri, '{\n    "setting": true\n}');

        const document = await code.workspace.openTextDocument(uri);

        expect(document.uri).to.equal(uri);
        expect(document.getText()).to.equal('{\n    "setting": true\n}');
        expect(document.lineAt(1).text).to.equal('    "setting": true');
    });

    it('reads an absent URI as empty rather than throwing', async () => {
        const { vscode: code } = createMockVsCode();

        const document = await code.workspace.openTextDocument(code.Uri.file('/missing.json'));

        expect(document.getText()).to.equal('');
    });

    it('creates an untitled document from an options bag', async () => {
        const { vscode: code } = createMockVsCode();

        const document = await code.workspace.openTextDocument({ content: '{}', language: 'json' });

        expect(document.isUntitled).to.be.true;
        expect(document.languageId).to.equal('json');
        expect(document.getText()).to.equal('{}');
    });

    it('treats an empty options bag as an untitled document, not as a URI', async () => {
        const { vscode: code } = createMockVsCode();

        const document = await code.workspace.openTextDocument({});

        expect(document.isUntitled).to.be.true;
        expect(document.getText()).to.equal('');
    });
});
