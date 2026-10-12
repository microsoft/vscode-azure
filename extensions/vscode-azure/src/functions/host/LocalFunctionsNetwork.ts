/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { injectable } from 'inversify';
import { createConnection, createServer } from 'node:net';

/** A loopback port held exclusively until its process owner is ready to launch. */
export interface FunctionsPortReservation {
    readonly port: number;
    release(): Promise<void>;
}

/** Loopback-only port allocation and bounded connection probes for local Functions development. */
@injectable()
export class LocalFunctionsNetwork {
    public async reserve(port = 0): Promise<FunctionsPortReservation> {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            server.close();
            throw new Error('Could not reserve a loopback port.');
        }
        let released: Promise<void> | undefined;
        return {
            port: address.port,
            release: () => released ??= new Promise<void>((resolve, reject) => {
                server.close(error => { if (error) { reject(error); } else { resolve(); } });
            }),
        };
    }

    /** Refused or timed-out connections mean not ready; other socket errors propagate. */
    public listening(port: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const socket = createConnection({ port, host: '127.0.0.1' });
            const finish = (ready: boolean) => { socket.destroy(); resolve(ready); };
            socket.once('connect', () => { finish(true); });
            socket.setTimeout(300, () => { finish(false); });
            socket.once('error', (error: NodeJS.ErrnoException) => {
                socket.destroy();
                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
                    resolve(false);
                } else {
                    reject(error);
                }
            });
        });
    }
}
