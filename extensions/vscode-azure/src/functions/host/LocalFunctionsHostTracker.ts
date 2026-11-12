/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { injectable } from 'inversify';
import type * as vscode from 'vscode';

/** A ready local host associated with one project folder. */
export interface LocalFunctionsHost {
    readonly port: number;
}

/**
 * Tracks ready hosts without probing guessed ports or adopting unrelated processes.
 * The process owner registers after readiness and disposes the registration when the host stops.
 */
@injectable()
export class LocalFunctionsHostTracker implements Disposable {
    private readonly hosts = new Map<string, LocalFunctionsHost>();
    private readonly changeEmitter = new EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.changeEmitter.event;

    /** Returns the host registered for this exact project URI. */
    public get(project: vscode.Uri): LocalFunctionsHost | undefined {
        return this.hosts.get(project.toString());
    }

    /** Replaces a registration; disposing an older registration cannot remove its replacement. */
    public register(project: vscode.Uri, port: number): Disposable {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new TypeError('The local Functions host port must be an integer from 1 to 65535.');
        }
        const host = { port };
        const key = project.toString();
        this.hosts.set(key, host);
        this.changeEmitter.fire(project);
        return {
            dispose: () => {
                if (this.hosts.get(key) === host) {
                    this.hosts.delete(key);
                    this.changeEmitter.fire(project);
                }
            },
        };
    }

    /** Releases tracking state; process shutdown remains the process owner's responsibility. */
    public dispose(): void {
        this.hosts.clear();
        this.changeEmitter.dispose();
    }
}
