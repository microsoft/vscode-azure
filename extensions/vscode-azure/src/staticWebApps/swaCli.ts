/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * npm package that supplies the Azure Static Web Apps CLI, pinned to the same
 * specifier `azd` uses so a workspace does not end up running two versions.
 */
export const SwaCliPackageName = '@azure/static-web-apps-cli@latest';

/** Local Static Web Apps emulator address. */
export const SwaEmulatorAddress = 'http://localhost:4280';

/** Local Azure Functions host address expected by the SWA CLI. */
export const FunctionsEmulatorAddress = 'http://localhost:7071';

/**
 * Builds the command line that runs the SWA CLI with `args`.
 *
 * The CLI is fetched on demand through `npx` rather than installed, which is
 * how `azd` invokes it for build and deploy. Running it the same way keeps a
 * workspace on one version and leaves installation to `npx`, so nothing here
 * has to detect, install, or update it.
 */
export function swaCliCommandLine(...args: readonly string[]): string[] {
    // `-y` suppresses the install prompt, which would otherwise block on first
    // use inside a task terminal.
    return ['npx', '-y', SwaCliPackageName, ...args];
}
