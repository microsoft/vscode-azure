/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as z from 'zod/mini';

const AzFuncLogPrefix = 'azfuncjsonlog:';
const PidSchema = z.int().check(z.positive());
const ToolingPidMessage = /^Azure Functions \.NET Worker \(PID:\s*(\d+)\) initialized in debug mode\.?$/;

const StartupEventSchema = z.object({
    name: z.literal('dotnet-worker-startup'),
    workerProcessId: PidSchema,
});

const LogEntrySchema = z.object({
    message: z.optional(z.string()),
    Message: z.optional(z.string()),
    category: z.optional(z.string()),
});

/** Reads the .NET worker startup event or tooling-category PID message from Core Tools output. */
export function workerProcessId(line: string): number | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        const offset = line.indexOf(AzFuncLogPrefix);
        if (offset < 0) { return undefined; }
        try { value = JSON.parse(line.slice(offset + AzFuncLogPrefix.length)); } catch { return undefined; }
    }
    const startup = StartupEventSchema.safeParse(value);
    if (startup.success) {
        return startup.data.workerProcessId;
    }
    const entry = LogEntrySchema.safeParse(value);
    if (!entry.success) {
        return undefined;
    }
    for (const message of [entry.data.message, entry.data.Message]) {
        if (message?.includes(AzFuncLogPrefix)) {
            return workerProcessId(message);
        }
        if (message !== undefined && entry.data.category?.toLowerCase() === 'host.function.toolingconsolelog') {
            const pid = PidSchema.safeParse(Number(ToolingPidMessage.exec(message)?.[1]));
            if (pid.success) {
                return pid.data;
            }
        }
    }
    return undefined;
}
