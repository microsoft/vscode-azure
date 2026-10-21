/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readText } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { parse } from 'jsonc-parser';
import { LocalFunctionSettings } from '../../src/functions/LocalFunctionSettings';

describe('LocalFunctionSettings (unit)', () => {
    it('updates the worker runtime in place while retaining its casing, comments, and unrelated properties', async () => {
        const m = createMockVsCode();
        const code = m.vscode;
        const project = code.Uri.file('/repo');
        const uri = code.Uri.joinPath(project, 'local.settings.json');
        m.fs.addFile(uri, '{\r\n // runtime selection\r\n "Values": {"functions_worker_runtime": "python", "private": "preserved"},\r\n "Host": {"LocalHttpPort": 8090}\r\n}');
        const settings = new LocalFunctionSettings(code);

        await settings.setWorkerRuntime(project, 'node');

        const text = await readText(code, uri);
        expect(text).to.include('// runtime selection').and.include('\r\n');
        expect(parse(text ?? '')).to.deep.equal({
            Values: { ['functions_worker_runtime']: 'node', private: 'preserved' },
            Host: { LocalHttpPort: 8090 },
        });
        const snapshot = await settings.read(project);
        expect(snapshot.values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('node');
    });

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

    it('continues queued edits after one fails', async () => {
        const m = createMockVsCode();
        const code = m.vscode;
        const project = code.Uri.file('/repo');
        m.fs.addFile(code.Uri.joinPath(project, 'local.settings.json'), '{"Values":{}}');
        const write = mock.method(code.workspace.fs, 'writeFile', () => Promise.reject(new Error('disk full')), { times: 1 });
        const settings = new LocalFunctionSettings(code);

        const failed = expect(settings.setWorkerRuntime(project, 'node')).to.be.rejectedWith('disk full');
        const succeeded = settings.setWorkerRuntime(project, 'python');

        await failed;
        await succeeded;
        write.mock.restore();
        expect((await settings.read(project)).values.get('FUNCTIONS_WORKER_RUNTIME')).to.equal('python');
    });
});
