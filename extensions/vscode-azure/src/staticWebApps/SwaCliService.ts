/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IOutputChannel,
    IProcessExecutor,
    IVsCode,
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
        if (!await this.verifyNpm(this.code.l10n.t(
            'Node.js and npm are required to install the Azure Static Web Apps CLI.',
        ))) {
            return;
        }

        this.output.show();
        await this.processExecutor.spawn({
            execution: 'foreground',
            command: ['npm', 'install', '--global', `${SwaCliPackageName}@latest`],
            name: this.code.l10n.t('Install Azure Static Web Apps CLI'),
            source: SwaCliCommand,
            focus: true,
        });
    }

    /** Uninstalls the globally installed CLI after verifying npm and installation state. */
    public async uninstall(): Promise<void> {
        if (!await this.verifyNpm(this.code.l10n.t(
            'Node.js and npm are required to uninstall the Azure Static Web Apps CLI.',
        ))) {
            return;
        }
        if (!await this.getInstalledVersion()) {
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
        if (installedVersion && semver.gte(installedVersion, minimumVersion)) {
            return true;
        }

        const npmAvailable = await this.hasNpm();
        const installLabel = installedVersion
            ? this.code.l10n.t('Update')
            : this.code.l10n.t('Install');
        const learnMoreLabel = this.code.l10n.t('Learn More');
        const choices = npmAvailable ? [installLabel, learnMoreLabel] : [learnMoreLabel];
        const result = await this.code.window.showWarningMessage(message, { modal: true }, ...choices);

        if (result === learnMoreLabel) {
            await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
            return false;
        }
        if (result !== installLabel) {
            return false;
        }

        await this.installOrUpdate();
        const updatedVersion = await this.getInstalledVersion();
        const valid = !!updatedVersion && semver.gte(updatedVersion, minimumVersion);
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
     * Shows the activation-time update warning when a newer CLI is available.
     *
     * Callers own error handling because this check is intentionally fire-and-forget.
     */
    public async warnIfOutdated(): Promise<void> {
        const configuration = this.code.workspace.getConfiguration(ConfigurationSection);
        if (!configuration.get<boolean>(ShowSwaCliWarningSetting, true)
            || !await this.hasNpm()) {
            return;
        }

        const installedVersion = await this.getInstalledVersion();
        if (!installedVersion) {
            return;
        }
        const newestVersion = await this.getNewestVersion();
        if (!semver.gt(newestVersion, installedVersion)) {
            return;
        }

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
                await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
            } else if (result === updateLabel) {
                await this.installOrUpdate();
            } else if (result === dontWarnLabel) {
                await configuration.update(
                    ShowSwaCliWarningSetting,
                    false,
                    this.code.ConfigurationTarget.Global,
                );
            }
        } while (result === learnMoreLabel);
    }

    private async verifyNpm(message: string): Promise<boolean> {
        if (await this.hasNpm()) {
            return true;
        }

        const learnMoreLabel = this.code.l10n.t('Learn More');
        const result = await this.code.window.showWarningMessage(
            message,
            { modal: true },
            learnMoreLabel,
        );
        if (result === learnMoreLabel) {
            await this.code.env.openExternal(this.code.Uri.parse(InstallSwaCliUrl));
        }
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
