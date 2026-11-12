/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { LocalFunctionSettings } from '../../src/functions/LocalFunctionSettings';

describe('LocalFunctionSettings (unit)', () => {
    it('serializes concurrent edits to the same file so neither is lost', async () => {
        const m = createMockVsCode();
        const code = m.vscode;
        const project = code.Uri.file('/repo');
        m.fs.addFile(code.Uri.joinPath(project, 'local.settings.json'), '{"Values":{}}');
        const settings = new LocalFunctionSettings(code);

        await Promise.all([
            settings.setDisabled(project, 'Hello', true),
            settings.setWorkerRuntime(project, 'node'),
            settings.setDisabled(project, 'World', false),
        ]);

        const values = (await settings.read(project)).values;
        expect(values.get('AzureWebJobs.Hello.Disabled')).to.equal('true');
        expect(values.get('AzureWebJobs.World.Disabled')).to.equal('false');
        expect(values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('node');
    });

    it('does not leave an unhandled rejection when a lone write fails', async () => {
        const m = createMockVsCode();
        const code = m.vscode;
        const project = code.Uri.file('/repo');
        m.fs.addFile(code.Uri.joinPath(project, 'local.settings.json'), '{"Values":{}}');
        mock.method(code.workspace.fs, 'writeFile', () => Promise.reject(new Error('disk full')));
        const unhandled = mock.fn();
        process.on('unhandledRejection', unhandled);
        try {
            await expect(new LocalFunctionSettings(code).setDisabled(project, 'Hello', true)).to.be.rejectedWith('disk full');
            await new Promise(resolve => setImmediate(resolve));
        } finally {
            process.off('unhandledRejection', unhandled);
        }
        expect(unhandled.mock.callCount()).to.equal(0);
    });

    it('continues queued edits after one fails', async () => {
        const m = createMockVsCode();
        const code = m.vscode;
        const project = code.Uri.file('/repo');
        m.fs.addFile(code.Uri.joinPath(project, 'local.settings.json'), '{"Values":{}}');
        const write = mock.method(code.workspace.fs, 'writeFile', () => Promise.reject(new Error('disk full')), { times: 1 });
        const settings = new LocalFunctionSettings(code);

        const failed = expect(settings.setDisabled(project, 'Hello', true)).to.be.rejectedWith('disk full');
        const succeeded = settings.setDisabled(project, 'Hello', false);

        await failed;
        await succeeded;
        write.mock.restore();
        expect((await settings.read(project)).values.get('AzureWebJobs.Hello.Disabled')).to.equal('false');
    });
});
