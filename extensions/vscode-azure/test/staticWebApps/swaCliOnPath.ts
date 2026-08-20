/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SwaCliCommand } from '../../src/staticWebApps/SwaCliService';

/**
 * Runs {@linkcode callback} with an executable named after
 * {@linkcode SwaCliCommand} on `PATH`, and returns its absolute path.
 *
 * @remarks
 * Task generation pins a bare command name to the absolute path it resolves to
 * on `PATH`, so a test that asserts on the generated command line has to control
 * what that name resolves to. A shim keeps the assertions deterministic without
 * requiring the real CLI to be installed on the machine running the tests.
 *
 * The shim is never executed -- only resolved -- so its contents are irrelevant;
 * it just has to exist with an executable extension on Windows and the execute
 * bit elsewhere.
 */
export async function withSwaCliOnPath<T>(callback: (executablePath: string) => Promise<T>): Promise<T> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-cli-shim-'));
    const fileName = process.platform === 'win32' ? `${SwaCliCommand}.cmd` : SwaCliCommand;
    const executablePath = path.join(directory, fileName);
    fs.writeFileSync(executablePath, '', { mode: 0o755 });

    const originalPath = process.env.PATH;
    process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ''}`;
    try {
        return await callback(executablePath);
    } finally {
        process.env.PATH = originalPath;
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
