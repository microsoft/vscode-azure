/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IProcessExecutor, IVsCode, command, isProcessError, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { IToolService } from '../tools/ToolService';
import { getVersionFromOutput } from '../tools/toolInstallerHelpers';
import { SwaCliConfigFileName, tryGetStaticWebAppsCliConfig, type SWACLIOptions } from './SwaCliConfig';

export const ISwaCliService: ServiceIdentifier<ISwaCliService> = Symbol.for('ISwaCliService');

/** The Static Web Apps CLI executable name. */
export const SwaCommand = 'swa';

/**
 * Minimum `swa` version required by this extension.
 *
 * v2 is the current major, and is what every install method below reaches.
 */
export const MinSwaVersion = '2.0.0';

export interface ISwaCliService {
    /**
     * Runs `swa init --yes` in {@linkcode cwd}, letting the CLI detect the
     * project's framework and write the result to {@linkcode SwaCliConfigFileName}.
     *
     * @remarks
     * **This writes to the user's workspace.** The CLI overwrites the
     * configuration entry it targets without asking once `--yes` is passed;
     * other named configurations in the file are preserved. Callers that must
     * not clobber an existing entry should check for one first.
     *
     * @param cwd - Project folder to detect in. The CLI detects from its own
     *   working directory, so this also scopes the detection.
     * @param configName - Configuration entry to write. When omitted the CLI
     *   names the entry after the folder, and the first entry in the file is
     *   returned -- which is what `swa build` and `azd` resolve when no name is
     *   passed, but need not be the entry just written if the file already had
     *   several. Pass a name when the caller needs certainty.
     *
     * @returns The configuration the CLI wrote.
     *
     * @throws When the CLI is missing, too old, exits non-zero, or completes
     *   without producing a configuration.
     */
    init(cwd: vscode.Uri, configName?: string): Promise<SWACLIOptions>;

    /**
     * Returns whether the resolved `swa` satisfies {@linkcode minVersion},
     * or `undefined` when no version could be read at all -- which in practice
     * means the CLI is not installed.
     */
    checkVersion(minVersion?: string): Promise<boolean | undefined>;
}

/**
 * Wraps {@linkcode IProcessExecutor} to provide a typed interface for invoking
 * the Azure Static Web Apps CLI (`swa`). Handles the common `ENOENT` error with
 * an actionable install hint.
 */
@injectable()
export class SwaCliService implements ISwaCliService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processExecutor: IProcessExecutor,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IToolService) private readonly tools: IToolService,
    ) { }

    /** @inheritdoc */
    public async init(cwd: vscode.Uri, configName?: string): Promise<SWACLIOptions> {
        const configUri = this.code.Uri.joinPath(cwd, SwaCliConfigFileName);

        // `--config` is passed explicitly because the CLI otherwise resolves the
        // file relative to its own working directory, which it may change while
        // loading an existing configuration.
        let cli = command(this.getSwaCommand()).arg('init');
        if (configName) {
            cli = cli.arg(configName);
        }
        cli = cli.arg('--yes').namedArg('--config', configUri.fsPath);

        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: cli,
                cwd,
            });
        } catch (e) {
            throw await this.wrapSwaError(e);
        }

        // The CLI reports a detection or write failure only on its own output
        // and still exits zero, so a successful spawn does not establish that a
        // configuration exists. Read it back instead of trusting the exit code.
        const config = await tryGetStaticWebAppsCliConfig(this.code, cwd);
        const written = configName
            ? config?.configurations?.[configName]
            : Object.values(config?.configurations ?? {})[0];

        if (!written) {
            throw new Error(this.code.l10n.t(
                "The Static Web Apps CLI did not write a configuration to '{0}'.",
                SwaCliConfigFileName,
            ));
        }

        return written;
    }

    /** @inheritdoc */
    public async checkVersion(minVersion: string = MinSwaVersion): Promise<boolean | undefined> {
        const version = await getVersionFromOutput(this.processExecutor, this.getSwaCommand());
        return version ? semver.gte(version, minVersion) : undefined;
    }

    /**
     * Wraps errors from `swa` commands with actionable messages.
     * - CLI not installed (`ENOENT`, or a {@linkcode checkVersion} probe that
     *   cannot produce a version) -> "not found"
     * - Installed but below {@linkcode MinSwaVersion} -> "version required"
     *
     * Shows a toast with an "Install" button and suppresses the default error
     * dialog when the error is actionable.
     */
    private async wrapSwaError(e: unknown): Promise<unknown> {
        // A raw ENOENT is already conclusive, so skip the extra version probe.
        const meetsMin = isProcessError(e) && e.code === 'ENOENT'
            ? undefined
            : await this.checkVersion();

        if (meetsMin === undefined) {
            const message = this.code.l10n.t(
                'Azure Static Web Apps CLI (swa) was not found. Install it and ensure it is available on your PATH.',
            );
            this.showInstallToast(message);
            return new Error(message, { cause: e });
        }

        if (!meetsMin) {
            const message = this.code.l10n.t(
                'Azure Static Web Apps CLI (swa) version {0} or later is required.',
                MinSwaVersion,
            );
            this.showInstallToast(message);
            return new Error(message, { cause: e });
        }

        return e;
    }

    /**
     * Shows a warning toast with an "Install" button that runs the install
     * command. Suppresses the default error dialog on the current action
     * context, if available.
     */
    private showInstallToast(message: string): void {
        const context = this.executor.currentContext;
        if (context) {
            context.errorHandling.suppress = 'display';
        }

        const installLabel = this.code.l10n.t('Install');
        void showMessage(this.code, message, { severity: 'warning' }, installLabel).then(choice => {
            if (choice === installLabel) {
                void this.code.commands.executeCommand('vscode-azure/installSwa');
            }
        });
    }

    /**
     * The `swa` executable to invoke: the absolute path found when the tool was
     * last acquired, or the bare command name so a normal `PATH` install works
     * without acquiring anything first.
     */
    private getSwaCommand(): string {
        return this.tools.getResolvedPath('swa') ?? SwaCommand;
    }
}
