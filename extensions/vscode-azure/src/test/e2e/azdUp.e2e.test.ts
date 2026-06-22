/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { IAzdService } from '../../azd/AzdService';
import { AzdDownCommandId, AzdUpCommandId, ExtensionId } from '../../constants';
import type { E2eExtensionApi } from '../../extension';
import { describeE2e, getE2eConfig, type E2eConfig } from './e2eConfig';

/**
 * Full end-to-end coverage of the `azd up` path.
 *
 * Activates the extension (with `RUN_E2E=1` rebinding the credential factory to
 * a real {@linkcode TokenCredential} via `applyOverrides`, and exposing the DI
 * container via {@linkcode E2eExtensionApi}), copies the minimal `azd-sample`
 * fixture to a temp directory, creates an azd environment, then exercises the
 * extension exactly as a user would -- by running its real VS Code commands:
 *
 * - {@linkcode AzdUpCommandId} (passing the `azure.yaml` URI so the wizard's
 *   folder-selection prompt is skipped) provisions and deploys, with
 *   authentication delegated to the in-process `AzdAuthServer`.
 * - {@linkcode AzdDownCommandId} tears the deployment back down in `after()`.
 *
 * The operations *under test* always go through those commands. The surrounding
 * harness work -- checking the `azd` version, creating the environment, and
 * reading back the deployed outputs -- is delegated to the extension's own
 * {@linkcode IAzdService}, resolved from the exposed container. None of those
 * operations require Azure credentials.
 *
 * Fails (rather than skips) when the `azd` CLI is not installed or is below the
 * minimum supported version, so a missing dependency is visible until CI
 * installs it.
 */
describeE2e('azd up', function () {
    let config: E2eConfig;
    let azdService: IAzdService;
    let projectDir: vscode.Uri | undefined;
    let envName: string;
    let provisioned = false;

    before(async function () {
        config = await getE2eConfig();
        envName = `e2e-${randomBytes(3).toString('hex')}`;

        // Activate the extension so the azd commands are registered and the
        // RUN_E2E override rebinds ICredentialFactory to a real credential.
        // Activation also returns the DI container so we can resolve services.
        const ext = vscode.extensions.getExtension<E2eExtensionApi | undefined>(ExtensionId);
        if (!ext) {
            expect.fail('Could not resolve the vscode-azure extension');
        }
        const api = await ext.activate();
        if (!api) {
            expect.fail('Extension did not expose its container; ensure RUN_E2E=1 is set');
        }
        azdService = api.container.get(IAzdService);

        // A sufficiently recent azd CLI is required. Fail loudly rather than
        // skipping so a missing/old azd is visible until CI installs it.
        expect(
            await azdService.checkVersion(),
            'The azd CLI (at the minimum supported version) must be installed to run the E2E tests',
        ).to.equal(true);

        projectDir = await copyFixtureToTempDir('azd-sample');

        // The azd up command provisions an existing environment; create one up
        // front. No Azure credentials are required for `azd env new`.
        await azdService.envNew(envName, config.location, config.subscriptionId, projectDir);
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

        const values = await azdService.envGetValues(envName, projectDir);
        expect(
            values.STORAGE_ACCOUNT_NAME,
            `Expected STORAGE_ACCOUNT_NAME in azd env values, got ${JSON.stringify(values)}`,
        ).to.be.a('string').with.length.greaterThan(0);

        const show = await azdService.show(projectDir);
        expect(show?.name).to.equal('vscode-azure-e2e-sample');
    });
});

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
