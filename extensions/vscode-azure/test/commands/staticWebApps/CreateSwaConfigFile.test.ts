/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { CreateSwaConfigFile } from '../../../src/commands/staticWebApps/CreateSwaConfigFile';

describe('CreateSwaConfigFile (unit)', () => {
    it('should honor config overwrite cancellation and write the example when confirmed', async () => {
        const { mock } = createMockCodeContext();
        const folderUri = mock.vscode.Uri.file('/workspace');
        mock.workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 });
        const configUri = mock.vscode.Uri.joinPath(folderUri, 'staticwebapp.config.json');
        mock.fs.addFile(configUri, 'existing');
        const command = new CreateSwaConfigFile(mock.vscode);

        let error: unknown;
        try {
            await command.execute();
        } catch (caught) {
            error = caught;
        }
        expect(CancellationError.test(error)).to.equal(true);
        expect(new TextDecoder().decode(mock.fs.files.get(configUri.path))).to.equal('existing');

        respondToPrompts(mock, [{ button: 'Overwrite' }]);
        await command.execute();

        const written = new TextDecoder().decode(mock.fs.files.get(configUri.path));
        const parsed = JSON.parse(written);
        expect(parsed.$schema).to.equal('https://json.schemastore.org/staticwebapp.config.json');
        expect(parsed.routes).to.have.lengthOf(1);
        expect(parsed.navigationFallback.rewrite).to.equal('/index.html');
        expect(written).to.match(/\n {4}"routes"/, 'should be indented for a human to edit');
    });
});
