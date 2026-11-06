/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addMockExtension, createMockVsCode, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { createServer, type Server } from 'node:http';
import { mock } from 'node:test';
import { AzuriteEmulator, AzuriteExtensionId, probeAzurite } from '../../src/emulators/AzuriteEmulator';

describe('AzuriteEmulator (unit)', () => {
    const servers: Server[] = [];
    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
            server.close(error => { if (error) { reject(error); } else { resolve(); } });
        })));
        mock.restoreAll();
    });

    async function listen(serverName: string): Promise<number> {
        const server = createServer((_req, response) => {
            response.setHeader('Server', serverName);
            response.writeHead(400);
            response.end();
        });
        servers.push(server);
        await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const address = server.address();
        if (!address || typeof address === 'string') { throw new Error('Expected an allocated TCP port.'); }
        return address.port;
    }

    it('identifies Azurite services instead of assuming every listener is Storage', async () => {
        const blob = await listen('Azurite-Blob/3.35.0');
        const other = await listen('OtherServer');
        expect(await probeAzurite('127.0.0.1', blob, 'blob')).to.be.true;
        expect(await probeAzurite('0.0.0.0', blob, 'blob')).to.be.true;
        expect(await probeAzurite('127.0.0.1', blob, 'queue')).to.be.false;
        expect(await probeAzurite('127.0.0.1', other, 'blob')).to.be.false;
        expect(await probeAzurite('example.com', blob, 'blob')).to.be.false;
    });

    it('uses configured ports and distinguishes partial availability', async () => {
        const m = createMockVsCode();
        addMockExtension(m, AzuriteExtensionId, {});
        const blob = await listen('Azurite-Blob/3.35.0');
        const other = await listen('OtherServer');
        await withSettings(m, {
            ['azurite.blobPort']: blob, ['azurite.queuePort']: other, ['azurite.tablePort']: other,
        }, async () => {
            expect(await new AzuriteEmulator(m.vscode).status()).to.deep.equal({ installed: true, running: 1 });
        });
    });

    it('reports an actionable error when lifecycle controls lack their owning extension', async () => {
        const m = createMockVsCode();
        await expect(new AzuriteEmulator(m.vscode).control('start')).to.be.rejectedWith('Install the Azurite extension');
        expect(m.commands.executeCommand.mock.callCount()).to.equal(0);
    });
});
