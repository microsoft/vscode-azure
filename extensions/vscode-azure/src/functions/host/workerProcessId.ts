/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Reads only the .NET worker's structured startup event, including a JSON-wrapped console message. */
export function workerProcessId(line: string): number | undefined {
    const prefix = 'azfuncjsonlog:';
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        const offset = line.indexOf(prefix);
        if (offset < 0) { return undefined; }
        try { value = JSON.parse(line.slice(offset + prefix.length)); } catch { return undefined; }
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    if ('name' in value && value.name === 'dotnet-worker-startup' && 'workerProcessId' in value
        && typeof value.workerProcessId === 'number' && Number.isSafeInteger(value.workerProcessId) && value.workerProcessId > 0) {
        return value.workerProcessId;
    }
    for (const key of ['message', 'Message']) {
        if (key in value) {
            const message: unknown = value[key as keyof typeof value];
            if (typeof message === 'string' && message.includes(prefix)) {
                return workerProcessId(message);
            }
        }
    }
    return undefined;
}
