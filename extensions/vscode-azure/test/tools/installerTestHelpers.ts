/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { argsToStrings, type IOutputChannel, type IProcessExecutor, type IVsCode } from '@microsoft/vscode-azure-utils';
import { MockOutputChannel, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { ToolInstallOptions, ToolInstaller } from '../../src/tools/ToolInstaller';

/** A permissive view of a captured `spawn` call. */
export interface SpawnOpts {
    readonly command: unknown[];
    readonly execution?: string;
    readonly focus?: boolean;
    readonly source?: string;
}

/** Any installer built from the three services they all take. */
export type InstallerConstructor<T extends ToolInstaller> =
    new (code: IVsCode, processExecutor: IProcessExecutor, output: IOutputChannel) => T;

export interface InstallerHarness<T extends ToolInstaller> {
    readonly installer: T;
    readonly spawn: ReturnType<typeof mock.fn>;
    readonly output: MockOutputChannel;
}

/**
 * Builds an installer over a mock process executor.
 *
 * @param onPath - Commands {@linkcode IProcessExecutor.isOnPath} should report
 *   as present, which is what selects between install methods.
 * @param spawnResult - What `spawn` resolves to, for version probes.
 */
export function createInstallerHarness<T extends ToolInstaller>(
    installerClass: InstallerConstructor<T>,
    onPath: readonly string[] = [],
    spawnResult: unknown = { stdout: '', stderr: '' },
): InstallerHarness<T> {
    const spawn = mock.fn(() => Promise.resolve(spawnResult));
    const processExecutor = {
        spawn,
        isOnPath: mock.fn((candidate: string) => onPath.includes(candidate)),
    } as unknown as IProcessExecutor;
    const output = new MockOutputChannel('test');

    return {
        installer: new installerClass(createMockVsCode().vscode, processExecutor, output),
        spawn,
        output,
    };
}

/** Install options with the flags a test does not care about defaulted off. */
export function installOptions(overrides: Partial<ToolInstallOptions> = {}): ToolInstallOptions {
    return { requireSignature: false, reveal: false, ...overrides };
}

/** The command line of the foreground install task, asserting it was one. */
export function installedWith(spawn: ReturnType<typeof mock.fn>): string[] {
    const opts = spawn.mock.calls[0].arguments[0] as SpawnOpts;
    expect(opts.execution).to.equal('foreground');
    return argsToStrings(opts.command as never);
}

/**
 * Pins `process.platform` for the enclosing suite, restoring it afterward.
 *
 * Install methods are chosen by platform, so every installer suite has to
 * exercise all three.
 */
export function usePlatform(): (value: NodeJS.Platform) => void {
    const original = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
    });

    return (value: NodeJS.Platform) => {
        Object.defineProperty(process, 'platform', { value, configurable: true });
    };
}
