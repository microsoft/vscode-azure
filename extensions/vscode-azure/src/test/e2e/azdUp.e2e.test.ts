/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessExecutor } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AzdDownCommandId, AzdUpCommandId, ExtensionId } from '../../constants';
import { describeE2e, getE2eConfig, type E2eConfig } from './e2eConfig';

// The real VS Code namespace satisfies IVsCode (the extension binds it the same
// way). Only background execution is used here, which never touches it.
const executor = new ProcessExecutor(vscode);

/**
 * Full end-to-end coverage of the `azd up` path.
 *
 * Activates the extension (with `RUN_E2E=1` rebinding the credential factory to
 * a real {@linkcode TokenCredential} via `applyOverrides`), copies the minimal
 * `azd-sample` fixture to a temp directory, creates an azd environment, then
 * exercises the extension exactly as a user would -- by running its real VS Code
 * commands:
 *
 * - {@linkcode AzdUpCommandId} (passing the `azure.yaml` URI so the wizard's
 *   folder-selection prompt is skipped) provisions and deploys, with
 *   authentication delegated to the in-process `AzdAuthServer`.
 * - {@linkcode AzdDownCommandId} tears the deployment back down in `after()`.
 *
 * Only the harness work that has no command equivalent -- detecting whether
 * `azd` is installed, creating the environment, and reading back the deployed
 * outputs -- shells out to `azd` directly via {@linkcode runAzd}. None of those
 * operations require Azure credentials.
 *
 * Skips automatically when the `azd` CLI is not installed.
 */
describeE2e('azd up', function () {
    let config: E2eConfig;
    let projectDir: vscode.Uri | undefined;
    let envName: string;
    let provisioned = false;

    before(async function () {
        config = await getE2eConfig();
        envName = `e2e-${randomBytes(3).toString('hex')}`;

        // The azd CLI is required; skip the suite gracefully when it is absent.
        if (!(await executor.isOnPath('azd'))) {
            this.skip();
        }

        // Activate the extension so the azd commands are registered and the
        // RUN_E2E override rebinds ICredentialFactory to a real credential.
        const ext = vscode.extensions.getExtension(ExtensionId);
        if (!ext) {
            expect.fail('Could not resolve the vscode-azure extension');
        }
        await ext.activate();

        projectDir = await copyFixtureToTempDir('azd-sample');

        // The azd up command provisions an existing environment; create one up
        // front. No Azure credentials are required for `azd env new`.
        await runAzd(
            ['env', 'new', envName, '--location', config.location, '--subscription', config.subscriptionId],
            projectDir,
        );
    });

    after(async function () {
        if (provisioned && projectDir) {
            try {
                // Tear down through the real command so the extension's auth
                // server authenticates `azd down` -- mirroring the user flow.
                const azureYaml = vscode.Uri.joinPath(projectDir, 'azure.yaml');
                await vscode.commands.executeCommand(AzdDownCommandId, azureYaml);
            } catch {
                // Best-effort teardown; surface nothing so a cleanup failure
                // does not mask the test result.
            }
        }

        if (projectDir) {
            await fs.rm(projectDir.fsPath, { recursive: true, force: true });
        }
    });

    it('provisions and deploys the sample project via the azd up command', async function () {
        if (!projectDir) {
            expect.fail('Expected the sample project to be set up in before()');
        }

        const azureYaml = vscode.Uri.joinPath(projectDir, 'azure.yaml');

        // Mark for teardown before running so a partial failure still triggers
        // `azd down` in the after() hook (resources may exist even if a later
        // wizard step fails).
        provisioned = true;

        // Run the literal extension command. Passing the azure.yaml URI seeds
        // the wizard's iacFolder and skips its only interactive prompt.
        await vscode.commands.executeCommand(AzdUpCommandId, azureYaml);

        const values = await runAzdJson<Record<string, string>>(
            ['env', 'get-values', '--environment', envName, '--output', 'json'],
            projectDir,
        );
        expect(
            values.STORAGE_ACCOUNT_NAME,
            `Expected STORAGE_ACCOUNT_NAME in azd env values, got ${JSON.stringify(values)}`,
        ).to.be.a('string').with.length.greaterThan(0);

        const show = await runAzdJson<{ name?: string }>(['show', '--output', 'json'], projectDir);
        expect(show.name).to.equal('vscode-azure-e2e-sample');
    });
});

/**
 * Runs `azd` with the given args, rejecting on a non-zero exit.
 *
 * @param args - Arguments passed to the `azd` CLI.
 * @param cwd - Working directory for the invocation.
 * @returns The captured stdout.
 */
async function runAzd(args: string[], cwd: vscode.Uri): Promise<string> {
    const { stdout } = await executor.spawn({ execution: 'background', command: 'azd', args, cwd });
    return stdout;
}

/**
 * Runs `azd` with the given args and parses its stdout as JSON.
 */
async function runAzdJson<T>(args: string[], cwd: vscode.Uri): Promise<T> {
    const { json } = await executor.spawn<T>({ execution: 'background', command: 'azd', args, cwd, parseJson: true });
    return json;
}

/**
 * Copy a fixture project from the extension source tree into a fresh temp
 * directory so azd can write its `.azure/` state without dirtying the repo.
 *
 * @param name - Folder name under `src/test/e2e/fixtures`.
 * @returns The temp directory containing the copied project.
 */
async function copyFixtureToTempDir(name: string): Promise<vscode.Uri> {
    const ext = vscode.extensions.getExtension(ExtensionId);
    if (!ext) {
        expect.fail('Could not resolve the vscode-azure extension to locate fixtures');
    }

    const source = vscode.Uri.joinPath(ext.extensionUri, 'src', 'test', 'e2e', 'fixtures', name);
    const destPath = path.join(os.tmpdir(), `vscode-azure-e2e-${randomBytes(4).toString('hex')}`);
    const dest = vscode.Uri.file(destPath);

    await vscode.workspace.fs.copy(source, dest, { overwrite: true });
    return dest;
}
