/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IProcessExecutor, IVsCode, command, isProcessError, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as semver from 'semver';
import type * as vscode from 'vscode';
import { ITempDirManager } from '../azd/TempDirManager';
import { IToolService } from '../tools/ToolService';
import { getVersionFromOutput } from '../tools/toolInstallerHelpers';
import { SwaCliConfigFileName, tryGetStaticWebAppsCliConfig, type StaticWebAppsCliConfigFile, type SWACLIOptions } from './SwaCliConfig';

export const ISwaCliService: ServiceIdentifier<ISwaCliService> = Symbol.for('ISwaCliService');

/** The Static Web Apps CLI executable name. */
export const SwaCommand = 'swa';

/**
 * Configuration name written by a detection run.
 *
 * Naming the entry explicitly means the result is read back by key rather than
 * by position, which the CLI would otherwise derive from the folder name.
 */
const DetectionConfigName = 'detected';

/**
 * Minimum `swa` version required by this extension.
 *
 * v2 is the current major, and is what every install method below reaches.
 */
export const MinSwaVersion = '2.0.0';

/** Complete detection output needed to reproduce the CLI's selected build. */
export interface SwaCliDetectionResult {
    /** Full file emitted by `swa init`, including options this extension does not interpret. */
    readonly config: StaticWebAppsCliConfigFile;
    /** Named configuration selected for path and language decisions. */
    readonly options: SWACLIOptions;
}

export interface ISwaCliService {
    /**
     * Detects a project's Static Web Apps layout with `swa init --yes`, without
     * modifying the project.
     *
     * @remarks
     * The CLI scans its working directory but writes to the path given by
     * `--config`, and stores the detected values verbatim rather than rebasing
     * them onto the configuration's own location. Pointing `--config` at a
     * throwaway directory therefore turns `swa init` into the detection-only
     * mode it does not otherwise offer, leaving {@linkcode projectFolder}
     * untouched.
     *
     * @param projectFolder - Project to detect. Doubles as the CLI's working
     *   directory, so it also scopes the scan.
     *
     * @returns The full generated configuration and the named options selected
     *   from it. Paths are relative to {@linkcode projectFolder}, except
     *   `outputLocation`, which the CLI reports relative to the detected
     *   `appLocation`.
     *
     * @throws When the CLI is missing, too old, exits non-zero, or detects
     *   nothing.
     */
    detect(projectFolder: vscode.Uri): Promise<SwaCliDetectionResult>;

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
        @inject(ITempDirManager) private readonly tempDirs: ITempDirManager,
    ) { }

    /** @inheritdoc */
    public async detect(projectFolder: vscode.Uri): Promise<SwaCliDetectionResult> {
        const scratchDir = await this.tempDirs.createTempDir();
        const configUri = this.code.Uri.joinPath(scratchDir, SwaCliConfigFileName);

        // `--config` is the write target while the scan follows the working
        // directory, so aiming it outside the project keeps detection read-only.
        const cli = command(this.getSwaCommand())
            .arg('init')
            .arg(DetectionConfigName)
            .arg('--yes')
            .namedArg('--config', configUri.fsPath);

        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: cli,
                cwd: projectFolder,
            });
        } catch (e) {
            throw await this.wrapSwaError(e);
        }

        // The CLI reports a detection failure only on its own output and still
        // exits zero, so a successful spawn does not establish that a
        // configuration exists. Read it back instead of trusting the exit code.
        const config = await tryGetStaticWebAppsCliConfig(this.code, scratchDir);
        const detected = config?.configurations?.[DetectionConfigName];

        if (!config || !detected) {
            throw new Error(this.code.l10n.t(
                'The Static Web Apps CLI could not detect this project.',
            ));
        }

        return { config, options: detected };
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
