/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { createServer, type Socket } from 'node:net';

/** A loopback port held exclusively until its process owner is ready to launch. */
export interface FunctionsPortReservation {
    readonly port: number;
    release(): Promise<void>;
}

/** Loopback-only port allocation and non-connecting listener checks for local Functions development. */
@injectable()
export class LocalFunctionsNetwork {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    public async reserve(port = 0): Promise<FunctionsPortReservation> {
        const sockets = new Set<Socket>();
        const server = createServer(socket => {
            sockets.add(socket);
            socket.once('close', () => { sockets.delete(socket); });
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                server.removeListener('error', reject);
                resolve();
            });
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            server.close();
            throw new Error(this.code.l10n.t('Could not reserve a loopback port.'));
        }
        let released: Promise<void> | undefined;
        return {
            port: address.port,
            release: () => released ??= new Promise<void>((resolve, reject) => {
                server.close(error => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
                sockets.forEach(socket => { socket.destroy(); });
            }),
        };
    }

    /**
     * Reports whether a process is already listening on the loopback port, by trying to bind it instead of
     * connecting. A connection would be accepted by single-client debug servers such as debugpy, which then treat the
     * probe as their debugger.
     */
    public listening(port: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const server = createServer();
            server.once('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') {
                    resolve(true);
                } else {
                    reject(error);
                }
            });
            server.listen(port, '127.0.0.1', () => { server.close(() => { resolve(false); }); });
        });
    }
}
