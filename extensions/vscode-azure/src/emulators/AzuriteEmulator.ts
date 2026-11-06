/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { request } from 'node:http';
import { request as requestHttps } from 'node:https';

/** Extension that owns Azurite's processes, configuration and storage files. */
export const AzuriteExtensionId = 'Azurite.azurite';

/** Observed availability of the three configured Azurite service endpoints. */
export interface AzuriteStatus {
    readonly installed: boolean;
    readonly running: number;
}

/** Discovers Azurite via its configured endpoints; lifecycle commands stay with its owning extension. */
@injectable()
export class AzuriteEmulator {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    public async status(): Promise<AzuriteStatus> {
        const installed = !!this.code.extensions.getExtension(AzuriteExtensionId);
        const config = this.code.workspace.getConfiguration('azurite');
        const running = await Promise.all(['blob', 'queue', 'table'].map((service, index) =>
            probeAzurite(config.get<string>(`${service}Host`, '127.0.0.1'),
                config.get<number>(`${service}Port`, 10000 + index), service, !!config.get<string>('cert'))));
        return { installed, running: running.filter(Boolean).length };
    }

    /** Invokes only the owning extension's supported commands; never kills an arbitrary listener. */
    public async control(action: 'start' | 'stop'): Promise<void> {
        const extension = this.code.extensions.getExtension(AzuriteExtensionId);
        if (!extension) {
            throw new ExternalError(this.code.l10n.t('Install the Azurite extension to run local Storage services.'));
        }
        await extension.activate();
        await this.code.commands.executeCommand(action === 'start' ? 'azurite.start' : 'azurite.close');
        const status = await this.status();
        if (action === 'start' ? status.running !== 3 : status.running !== 0) {
            throw new ExternalError(this.code.l10n.t('Azurite did not reach the requested state. Check the Azurite output channels. Only services owned by the Azurite extension can be stopped here.'));
        }
    }
}

/**
 * Identifies an Azurite HTTP server rather than treating an occupied port as a running emulator.
 * Wildcard listeners are reached through loopback; non-loopback hosts are not probed.
 */
export function probeAzurite(host: string, port: number, service: string, secure = false): Promise<boolean> {
    if (host === '0.0.0.0') { host = '127.0.0.1'; }
    if (host === '::') { host = '::1'; }
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        const req = (secure ? requestHttps : request)({ hostname: host, port, method: 'HEAD', path: '/' }, response => {
            response.resume();
            const server = response.headers.server;
            resolve(typeof server === 'string' && server.toLowerCase().startsWith(`azurite-${service.toLowerCase()}/`));
        });
        req.setTimeout(750, () => { req.destroy(); resolve(false); });
        req.on('error', (error: NodeJS.ErrnoException) => {
            if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].includes(error.code ?? '')) {
                resolve(false);
            } else {
                reject(error);
            }
        });
        req.end();
    });
}
