/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CancellationError,
    IActionExecutor,
    IVsCode,
    throwIfCancelled,
    type IActionExecutor as ActionExecutor,
    type IActionContext,
    type IVsCode as VsCode,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { staticWebAppsCliSetupUrl } from '../../commands/staticWebApps/staticWebAppLinks';
import { detectStaticWebAppProject } from '../../commands/staticWebApps/steps/frameworkDetection';
import {
    FunctionsEmulatorAddress,
    ISwaCliService,
    SwaEmulatorAddress,
    type ISwaCliService as SwaCli,
} from '../../staticWebApps/SwaCliService';
import {
    SwaCliConfigFileName,
    tryGetStaticWebAppsCliConfig,
    type StaticWebAppsCliConfigFile,
} from '../../staticWebApps/SwaCliConfig';

/** Debugger type used for the SWA dynamic/initial configuration picker. */
export const SwaDebugType = 'swa';
/** Browser debugger used to launch the local SWA emulator. */
export const PwaChromeDebugType = 'pwa-chrome';

const debugConfigurationPrefix = 'SWA: Run ';
/**
 * Command contributed by the standalone Azure Functions extension that adds an
 * attach configuration to a Functions project. An optional integration: this
 * extension works without it.
 */
const InitFunctionsProjectCommandId = 'azureFunctions.initProjectForVSCode';
const configPostfix = ` (${SwaCliConfigFileName})`;
type FunctionsProxyFixOutcome = 'notApplicable' | 'alreadyConfigured' | 'fixed' | 'learnMore' | 'dismissed';

/**
 * Supplies browser launch configurations for named SWA CLI configs and detected projects.
 *
 * Resolution ignores unrelated `pwa-chrome` configurations, validates the CLI,
 * repairs opted-in Functions proxy settings, and starts an existing/generated
 * Azure Functions attach configuration.
 */
@injectable()
export class SwaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
        @inject(ISwaCliService) private readonly swaCli: SwaCli,
        @inject(IActionExecutor) private readonly executor: ActionExecutor,
    ) { }

    /** @inheritdoc */
    public async provideDebugConfigurations(
        folder: vscode.WorkspaceFolder,
    ): Promise<vscode.DebugConfiguration[]> {
        const result = await this.executor.callWithTelemetryAndErrorHandling(
            'staticWebApps.provideDebugConfigurations',
            async context => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.rethrow = true;
                const configurations: vscode.DebugConfiguration[] = [];
                const swaConfig = await tryGetStaticWebAppsCliConfig(this.code, folder.uri);
                const configEntries = Object.entries(swaConfig?.configurations ?? {});
                for (const [name, options] of configEntries) {
                    configurations.push(this.createDebugConfiguration(name, options.appLocation, true));
                }

                const detection = await detectStaticWebAppProject(this.code, folder.uri);
                const hasDetectedApp = !!detection.primaryPresetId && !!detection.appLocation;
                if (detection.primaryPresetId && detection.appLocation) {
                    const appName = getDetectedAppName(folder, detection.appLocation);
                    configurations.push(this.createDebugConfiguration(appName, detection.appLocation, false));
                }

                const deduplicated = deduplicateConfigurations(configurations);
                context.telemetry.measurements.configsCount = configEntries.length;
                context.telemetry.measurements.appCount = hasDetectedApp ? 1 : 0;
                context.telemetry.measurements.generatedCount = deduplicated.length;
                context.telemetry.properties.buildPresets = detection.primaryPresetId ?? '';
                return deduplicated;
            },
        );
        if (!result) {
            throw new Error('Static Web Apps debug configuration discovery completed without a result.');
        }
        return result;
    }

    /** @inheritdoc */
    public async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfiguration: vscode.DebugConfiguration,
        cancellationToken: vscode.CancellationToken,
    ): Promise<vscode.DebugConfiguration | undefined> {
        // VS Code calls this for every debug session of every type, so hand back
        // anything that is not ours before starting a telemetry action.
        if (!isSwaDebugConfiguration(debugConfiguration)) {
            return debugConfiguration;
        }

        return this.executor.callWithTelemetryAndErrorHandling(
            'staticWebApps.resolveDebugConfiguration',
            async context => {
                context.errorHandling.rethrow = true;
                return this.resolveSwaDebugConfiguration(folder, debugConfiguration, cancellationToken, context);
            },
        ).catch((error: unknown) => {
            // Returning undefined aborts the launch without further UI, which is what a
            // cancelled resolve should do. Anything else is a genuine failure and is
            // rethrown so VS Code reports it rather than launching a half-prepared session.
            if (CancellationError.test(error)) {
                return undefined;
            }
            throw error;
        });
    }

    private async resolveSwaDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfiguration: vscode.DebugConfiguration,
        cancellationToken: vscode.CancellationToken,
        context: IActionContext,
    ): Promise<vscode.DebugConfiguration | undefined> {
        context.telemetry.properties.hasWorkspaceFolder = String(!!folder);
        if (!folder) {
            context.telemetry.properties.resolveOutcome = 'missingWorkspaceFolder';
            return undefined;
        }

        const installed = await this.swaCli.validateInstalled(this.code.l10n.t(
            'Install the Azure Static Web Apps CLI to debug this static web app.',
        ));
        context.telemetry.properties.cliAvailable = String(installed);
        if (!installed) {
            context.telemetry.properties.resolveOutcome = 'cliUnavailable';
            return undefined;
        }

        const detection = await detectStaticWebAppProject(this.code, folder.uri);
        context.telemetry.properties.hasApi = String(detection.apiLocations.length > 0);
        if (detection.apiLocations.length > 0) {
            const swaConfig = await tryGetStaticWebAppsCliConfig(this.code, folder.uri);
            context.telemetry.properties.hasSwaCliConfigFile = String(!!swaConfig);
            context.telemetry.properties.functionsProxyFix = await this.offerFunctionsProxyFix(
                folder,
                debugConfiguration,
                swaConfig,
            );
            if (!cancellationToken.isCancellationRequested) {
                const started = await this.startFunctionsDebugging(folder);
                context.telemetry.properties.debugApi = String(started);
            }
        }

        throwIfCancelled(cancellationToken, 'resolveDebugConfiguration');
        context.telemetry.properties.resolveOutcome = 'resolved';
        return debugConfiguration;
    }

    private createDebugConfiguration(
        name: string,
        appLocation: string | undefined,
        fromConfigFile: boolean,
    ): vscode.DebugConfiguration {
        const normalizedLocation = normalizeAppLocation(appLocation);
        return {
            name: `${debugConfigurationPrefix}${name}${fromConfigFile ? configPostfix : ''}`,
            request: 'launch',
            type: PwaChromeDebugType,
            url: SwaEmulatorAddress,
            preLaunchTask: `swa: start ${name}`,
            webRoot: `\${workspaceFolder}/${normalizedLocation}`,
            timeout: 30000,
        };
    }

    private async offerFunctionsProxyFix(
        folder: vscode.WorkspaceFolder,
        debugConfiguration: vscode.DebugConfiguration,
        swaConfig: StaticWebAppsCliConfigFile | undefined,
    ): Promise<FunctionsProxyFixOutcome> {
        const configurationName = parseSwaConfigurationName(debugConfiguration.name);
        if (!configurationName) {
            return 'notApplicable';
        }
        const selected = swaConfig?.configurations?.[configurationName];
        if (!selected) {
            return 'notApplicable';
        } else if (selected.apiLocation === FunctionsEmulatorAddress) {
            return 'alreadyConfigured';
        }

        const fixLabel = this.code.l10n.t('Fix');
        const learnMoreLabel = this.code.l10n.t('Learn More');
        const result = await this.code.window.showWarningMessage(
            this.code.l10n.t(
                "The Functions API was not started through the SWA CLI because 'apiLocation' is missing or invalid.",
            ),
            fixLabel,
            learnMoreLabel,
        );
        if (result === learnMoreLabel) {
            await this.code.env.openExternal(this.code.Uri.parse(staticWebAppsCliSetupUrl));
            return 'learnMore';
        } else if (result === fixLabel) {
            const updated: StaticWebAppsCliConfigFile = {
                ...swaConfig,
                configurations: {
                    ...swaConfig.configurations,
                    [configurationName]: {
                        ...selected,
                        apiLocation: FunctionsEmulatorAddress,
                    },
                },
            };
            await this.code.workspace.fs.writeFile(
                this.code.Uri.joinPath(folder.uri, SwaCliConfigFileName),
                new TextEncoder().encode(`${JSON.stringify(updated, undefined, 2)}\n`),
            );
            return 'fixed';
        }
        return 'dismissed';
    }

    /**
     * Attaches the Azure Functions debugger to the workspace's API, if the
     * workspace has an attach configuration for it.
     *
     * @remarks
     * Generating that configuration is the standalone Azure Functions
     * extension's `azureFunctions.initProjectForVSCode`, which this extension
     * neither owns nor requires. Invoking a command that is not registered
     * rejects, so it is only used when actually present; otherwise the user is
     * told what is missing and the browser still launches without the API
     * attached.
     */
    private async startFunctionsDebugging(folder: vscode.WorkspaceFolder): Promise<boolean> {
        let configuration = getFunctionsDebugConfiguration(this.code, folder);
        if (!configuration) {
            if (!(await this.code.commands.getCommands(true)).includes(InitFunctionsProjectCommandId)) {
                void this.code.window.showWarningMessage(this.code.l10n.t(
                    'This static web app has an API, but the workspace has no Azure Functions attach configuration, so the API will not be debugged. Install the Azure Functions extension to generate one.',
                ));
                return false;
            }

            await this.code.commands.executeCommand(InitFunctionsProjectCommandId, folder.uri.fsPath);
            configuration = getFunctionsDebugConfiguration(this.code, folder);
        }
        if (configuration) {
            return this.code.debug.startDebugging(folder, configuration);
        }
        return false;
    }
}

function isSwaDebugConfiguration(
    debugConfiguration: vscode.DebugConfiguration,
): boolean {
    return typeof debugConfiguration.name === 'string'
        && debugConfiguration.name.startsWith(debugConfigurationPrefix);
}

function parseSwaConfigurationName(name: unknown): string | undefined {
    if (typeof name !== 'string' || !name.startsWith(debugConfigurationPrefix)) {
        return undefined;
    }
    const withoutPrefix = name.slice(debugConfigurationPrefix.length);
    return withoutPrefix.endsWith(configPostfix)
        ? withoutPrefix.slice(0, -configPostfix.length)
        : withoutPrefix;
}

function getFunctionsDebugConfiguration(
    code: VsCode,
    folder: vscode.WorkspaceFolder,
): vscode.DebugConfiguration | undefined {
    const configurations = code.workspace
        .getConfiguration('launch', folder.uri)
        .get<readonly vscode.DebugConfiguration[]>('configurations', []);
    return configurations.find(configuration =>
        typeof configuration.name === 'string'
        && /^Attach to (.+) Functions$/i.test(configuration.name));
}

function normalizeAppLocation(appLocation: string | undefined): string {
    return appLocation?.replace(/^[/\\]+|[/\\]+$/g, '') ?? '';
}

function getDetectedAppName(
    folder: vscode.WorkspaceFolder,
    appLocation: string,
): string {
    const segments = appLocation.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments.pop() ?? folder.name;
}

function deduplicateConfigurations(
    configurations: readonly vscode.DebugConfiguration[],
): vscode.DebugConfiguration[] {
    const result = new Map<string, vscode.DebugConfiguration>();
    for (const configuration of configurations) {
        const key = `${configuration.name}|${String(configuration.preLaunchTask)}`;
        if (!result.has(key)) {
            result.set(key, configuration);
        }
    }
    return [...result.values()];
}
