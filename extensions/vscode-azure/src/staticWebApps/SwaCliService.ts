/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CancellationError,
    IActionExecutor,
    IOutputChannel,
    IProcessExecutor,
    IVsCode,
    type IActionExecutor as ActionExecutor,
    type IOutputChannel as OutputChannel,
    type IProcessExecutor as ProcessExecutor,
    type IVsCode as VsCode,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as semver from 'semver';
import { ConfigurationSection } from '../constants';

/** npm package that supplies the Azure Static Web Apps CLI. */
export const SwaCliPackageName = '@azure/static-web-apps-cli';
/** Executable installed by {@linkcode SwaCliPackageName}. */
export const SwaCliCommand = 'swa';
/** Oldest CLI version supported by local tooling. */
export const MinimumSwaCliVersion = '0.8.0';
/** Official CLI installation documentation. */
export const InstallSwaCliUrl = 'https://aka.ms/installSwaCli';
/** Local Static Web Apps emulator address. */
export const SwaEmulatorAddress = 'http://localhost:4280';
/** Local Azure Functions host address expected by the SWA CLI. */
export const FunctionsEmulatorAddress = 'http://localhost:7071';
/** Configuration key within {@linkcode ConfigurationSection} controlling update warnings. */
export const ShowSwaCliWarningSetting = 'staticWebApps.showStaticWebAppsCliWarning';

const registryUrl = `https://registry.npmjs.org/${SwaCliPackageName}`;
const requestTimeoutMs = 15_000;

interface FetchResponse {
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
}

/** Minimal fetch contract used to keep CLI version checks deterministic in tests. */
export type SwaCliFetch = (
    url: string,
    init: { readonly signal: AbortSignal },
) => Promise<FetchResponse>;

/** DI identifier for {@linkcode SwaCliService}. */
export const ISwaCliService: ServiceIdentifier<ISwaCliService> = Symbol.for('ISwaCliService');
export type ISwaCliService = SwaCliService;

/**
 * Owns installation, version checks, and update UX for the Static Web Apps CLI.
 *
 * Process output from install/uninstall remains visible in the task terminal;
 * captured version output and registry response bodies are never logged.
 */
@injectable()
export class SwaCliService {
    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
        @inject(IProcessExecutor) private readonly processExecutor: ProcessExecutor,
        @inject(IOutputChannel) private readonly output: OutputChannel,
        @inject(IActionExecutor) private readonly executor: ActionExecutor,
        private readonly fetcher: SwaCliFetch = (url, init) => globalThis.fetch(url, init),
    ) { }

    /** Checks npm by invoking `npm --version`. */
    public async hasNpm(): Promise<boolean> {
        try {
            await this.processExecutor.spawn({
                execution: 'background',
                command: ['npm', '--version'],
            });
            return true;
        } catch {
            return false;
        }
    }

    /** Returns the globally installed CLI version, or `undefined` when unavailable. */
    public async getInstalledVersion(): Promise<string | undefined> {
        try {
            const result = await this.processExecutor.spawn({
                execution: 'background',
                command: ['npx', '--global', '--no-install', SwaCliCommand, '--version'],
            });
            return semver.clean(result.stdout) ?? undefined;
        } catch {
            return undefined;
        }
    }

    /** Gets the npm registry's current `latest` version with a 15-second timeout. */
    public async getNewestVersion(): Promise<string> {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, requestTimeoutMs);
        try {
            const response = await this.fetcher(registryUrl, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const metadata = await response.json();
            if (!isRecord(metadata)
                || !isRecord(metadata['dist-tags'])
                || typeof metadata['dist-tags'].latest !== 'string') {
                throw new Error('The npm response did not include dist-tags.latest.');
            }
            return metadata['dist-tags'].latest;
        } catch (error) {
            throw new Error(this.code.l10n.t(
                'Failed to retrieve the latest version of the Azure Static Web Apps CLI.',
            ), { cause: error });
        } finally {
            clearTimeout(timeout);
        }
    }

    /** Installs or updates the CLI globally after verifying npm is available. */
    public async installOrUpdate(): Promise<void> {
        this.executor.setTelProp('swaCliOperation', 'installOrUpdate');
        if (!await this.verifyNpm(this.code.l10n.t(
            'Node.js and npm are required to install the Azure Static Web Apps CLI.',
        ))) {
            this.executor.setTelProp('swaCliOperationOutcome', 'npmUnavailable');
            throw new CancellationError(undefined, 'Verify npm availability');
        }

        this.output.show();
        await this.processExecutor.spawn({
            execution: 'foreground',
            command: ['npm', 'install', '--global', `${SwaCliPackageName}@latest`],
            name: this.code.l10n.t('Install Azure Static Web Apps CLI'),
            source: SwaCliCommand,
            focus: true,
        });
        this.executor.setTelProp('swaCliOperationOutcome', 'completed');
    }

    /** Uninstalls the globally installed CLI after verifying npm and installation state. */
    public async uninstall(): Promise<void> {
        this.executor.setTelProp('swaCliOperation', 'uninstall');
        if (!await this.verifyNpm(this.code.l10n.t(
            'Node.js and npm are required to uninstall the Azure Static Web Apps CLI.',
        ))) {
            this.executor.setTelProp('swaCliOperationOutcome', 'npmUnavailable');
            throw new CancellationError(undefined, 'Verify npm availability');
        }
        const installedVersion = await this.getInstalledVersion();
        this.executor.setTelProp('swaCliInstalled', String(!!installedVersion));
        if (!installedVersion) {
            this.executor.setTelProp('swaCliOperationOutcome', 'notInstalled');
            throw new Error(this.code.l10n.t(
                'Cannot uninstall the Azure Static Web Apps CLI because it is not installed with npm.',
            ));
        }

        this.output.show();
        await this.processExecutor.spawn({
            execution: 'foreground',
            command: ['npm', 'uninstall', '--global', SwaCliPackageName],
            name: this.code.l10n.t('Uninstall Azure Static Web Apps CLI'),
            source: SwaCliCommand,
            focus: true,
        });
        this.executor.setTelProp('swaCliOperationOutcome', 'completed');
    }

    /**
     * Ensures the CLI is installed and satisfies a minimum version.
     *
     * The user may install/update with npm or open the manual installation guide.
     */
    public async validateInstalled(
        message: string,
        minimumVersion: string = MinimumSwaCliVersion,
    ): Promise<boolean> {
        const installedVersion = await this.getInstalledVersion();
        this.executor.setTelProp('swaCliInstalled', String(!!installedVersion));
        if (installedVersion) {
            this.executor.setTelProp('swaCliInstalledVersion', installedVersion);
        }
        if (installedVersion && semver.gte(installedVersion, minimumVersion)) {
            this.executor.setTelProp('swaCliValidationAction', 'none');
            this.executor.setTelProp('swaCliValidationOutcome', 'valid');
            this.startUpdateCheck();
            return true;
        }

        const npmAvailable = await this.hasNpm();
        this.executor.setTelProp('swaCliNpmAvailable', String(npmAvailable));
        const installLabel = installedVersion
            ? this.code.l10n.t('Update')
            : this.code.l10n.t('Install');
        const learnMoreLabel = this.code.l10n.t('Learn More');
        const choices = npmAvailable ? [installLabel, learnMoreLabel] : [learnMoreLabel];
        const result = await this.code.window.showWarningMessage(message, { modal: true }, ...choices);

        if (result === learnMoreLabel) {
            this.executor.setTelProp('swaCliValidationAction', 'learnMore');
            this.executor.setTelProp('swaCliValidationOutcome', 'invalid');
            await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
            return false;
        }
        if (result !== installLabel) {
            this.executor.setTelProp('swaCliValidationAction', 'dismissed');
            this.executor.setTelProp('swaCliValidationOutcome', 'invalid');
            return false;
        }

        this.executor.setTelProp('swaCliValidationAction', installedVersion ? 'update' : 'install');
        await this.installOrUpdate();
        const updatedVersion = await this.getInstalledVersion();
        const valid = !!updatedVersion && semver.gte(updatedVersion, minimumVersion);
        this.executor.setTelProp('swaCliValidationOutcome', valid ? 'valid' : 'verificationFailed');
        if (!valid) {
            const learnMoreLabel = this.code.l10n.t('Learn More');
            const failedResult = await this.code.window.showWarningMessage(
                this.code.l10n.t(
                    'The Azure Static Web Apps CLI installation could not be verified. Install it manually and try again.',
                ),
                learnMoreLabel,
            );
            if (failedResult === learnMoreLabel) {
                await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
            }
        }
        return valid;
    }

    /**
     * Starts the "a newer CLI is available" check without waiting for it.
     *
     * Deliberately triggered from {@linkcode validateInstalled} rather than from
     * activation: it spawns npm and queries the registry, which is too much to
     * spend on someone who merely has a config file in their workspace. Reaching
     * here means the user has actually asked for something that needs the CLI.
     *
     * Runs in its own telemetry action because it outlives the caller, and stays
     * fire-and-forget so a slow or offline registry never delays a debug session.
     */
    private startUpdateCheck(): void {
        void this.executor.callWithTelemetryAndErrorHandling(
            'staticWebApps.validateStaticWebAppsCliIsLatest',
            async context => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.suppress = 'display';
                await this.warnIfOutdated();
            },
        );
    }

    /**
     * Warns when a newer CLI is available.
     *
     * Callers own error handling because this check is intentionally fire-and-forget.
     */
    public async warnIfOutdated(): Promise<void> {
        const configuration = this.code.workspace.getConfiguration(ConfigurationSection);
        if (!configuration.get<boolean>(ShowSwaCliWarningSetting, true)) {
            this.executor.setTelProp('swaCliUpdateCheckOutcome', 'disabled');
            return;
        }
        const npmAvailable = await this.hasNpm();
        this.executor.setTelProp('swaCliNpmAvailable', String(npmAvailable));
        if (!npmAvailable) {
            this.executor.setTelProp('swaCliUpdateCheckOutcome', 'npmUnavailable');
            return;
        }

        const installedVersion = await this.getInstalledVersion();
        if (!installedVersion) {
            this.executor.setTelProp('swaCliInstalled', 'false');
            this.executor.setTelProp('swaCliUpdateCheckOutcome', 'notInstalled');
            return;
        }
        this.executor.setTelProp('swaCliInstalled', 'true');
        this.executor.setTelProp('swaCliInstalledVersion', installedVersion);
        const newestVersion = await this.getNewestVersion();
        this.executor.setTelProp('swaCliNewestVersion', newestVersion);
        if (!semver.gt(newestVersion, installedVersion)) {
            this.executor.setTelProp('swaCliUpdateCheckOutcome', 'current');
            return;
        }
        this.executor.setTelProp('swaCliUpdateCheckOutcome', 'outdated');

        const message = this.code.l10n.t(
            'Update the Azure Static Web Apps CLI ({0}) to the latest ({1}) for the best experience.',
            installedVersion,
            newestVersion,
        );
        const updateLabel = this.code.l10n.t('Update');
        const learnMoreLabel = this.code.l10n.t('Learn More');
        const dontWarnLabel = this.code.l10n.t("Don't warn again");

        let result: string | undefined;
        do {
            result = await this.code.window.showWarningMessage(
                message,
                updateLabel,
                learnMoreLabel,
                dontWarnLabel,
            );
            if (result === learnMoreLabel) {
                this.executor.setTelProp('swaCliUpdateAction', 'learnMore');
                await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
            } else if (result === updateLabel) {
                this.executor.setTelProp('swaCliUpdateAction', 'update');
                await this.installOrUpdate();
            } else if (result === dontWarnLabel) {
                this.executor.setTelProp('swaCliUpdateAction', 'disableWarning');
                await configuration.update(
                    ShowSwaCliWarningSetting,
                    false,
                    this.code.ConfigurationTarget.Global,
                );
            } else {
                this.executor.setTelProp('swaCliUpdateAction', 'dismissed');
            }
        } while (result === learnMoreLabel);
    }

    private async verifyNpm(message: string): Promise<boolean> {
        const npmAvailable = await this.hasNpm();
        this.executor.setTelProp('swaCliNpmAvailable', String(npmAvailable));
        if (npmAvailable) {
            return true;
        }

        const learnMoreLabel = this.code.l10n.t('Learn More');
        const result = await this.code.window.showWarningMessage(
            message,
            { modal: true },
            learnMoreLabel,
        );
        if (result === learnMoreLabel) {
            this.executor.setTelProp('swaCliNpmPromptAction', 'learnMore');
            await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
        } else {
            this.executor.setTelProp('swaCliNpmPromptAction', 'dismissed');
        }
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
