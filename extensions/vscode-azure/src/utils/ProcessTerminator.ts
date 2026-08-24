/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { terminateProcessTree } from '@microsoft/vscode-azure-utils';
import { injectable, type ServiceIdentifier } from 'inversify';

/** Injectable boundary around stopping a process the extension did not spawn. */
export const IProcessTerminator: ServiceIdentifier<IProcessTerminator> = Symbol.for('IProcessTerminator');

/**
 * Stops one process, and anything it spawned, given only its id.
 *
 * Exists so a caller holding a process id from elsewhere -- a task, a debug adapter -- can
 * stop it without resorting to matching on process names. A process the extension spawned
 * itself should be stopped through its own abort signal instead.
 */
export interface IProcessTerminator {
    /** Resolves once the process is gone, or immediately if it had already exited. */
    stop(processId: number): Promise<void>;
}

/** {@linkcode IProcessTerminator} backed by {@linkcode terminateProcessTree}. */
@injectable()
export class ProcessTerminator implements IProcessTerminator {
    /** @inheritdoc */
    public stop(processId: number): Promise<void> {
        return terminateProcessTree(processId);
    }
}
