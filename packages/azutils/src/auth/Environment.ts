/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { stripTrailingSlash } from '@microsoft/vscode-azure-utils';

/**
 * Configuration section read by VS Code's built-in Microsoft authentication
 * provider to determine which sovereign cloud to use.
 */
export const SovereignCloudConfigurationSection = 'microsoft-sovereign-cloud';

/**
 * A minimal, non-deprecated replacement for the `Environment` type from the
 * (deprecated) `@azure/ms-rest-azure-env` package.
 *
 * Only the endpoints the extension actually uses are modeled directly. Per-cloud
 * service hosts (storage, container registry, app service) that require an input
 * are exposed as string-in/string-out builder functions instead of raw suffixes.
 */
export interface EnvironmentLike {
    /** The cloud name (e.g. `'AzureCloud'`, `'AzureUSGovernment'`, `'AzureChinaCloud'`). */
    readonly name: string;

    /** Whether this environment was supplied as a user-configured custom cloud. */
    readonly isCustomCloud: boolean;

    /**
     * The ARM (Azure Resource Manager) endpoint, e.g. `https://management.azure.com`.
     * Stored without a trailing slash (see {@linkcode createEnvironment}).
     */
    readonly resourceManagerEndpointUrl: string;

    /**
     * The pre-built default `.default` token scope for ARM, e.g.
     * `https://management.azure.com/.default`.
     *
     * Derived from the trailing-slash-stripped
     * {@linkcode EnvironmentLike.resourceManagerEndpointUrl resourceManagerEndpointUrl}
     * (see {@linkcode createEnvironment}), so it always has exactly one slash before
     * `.default`. Prefer this over hand-building `${resourceManagerEndpointUrl}/.default`
     * at call sites, which relies on the no-trailing-slash invariant being preserved.
     */
    readonly resourceManagerDefaultScope: string;

    /** The Azure portal URL, e.g. `https://portal.azure.com`. */
    readonly portalUrl: string;

    /**
     * The Log Analytics query endpoint, e.g. `https://api.loganalytics.io`.
     *
     * Doubles as the authentication audience for log queries.
     */
    readonly logAnalyticsEndpoint: string;

    /**
     * Build the public host/URL for a storage account's blob service, e.g.
     * `https://<accountName>.blob.core.windows.net` in public Azure.
     */
    storageEndpoint(accountName: string): string;

    /**
     * Build the login server URL for a container registry, e.g.
     * `https://<registryName>.azurecr.io` in public Azure.
     */
    containerRegistryEndpoint(registryName: string): string;

    /**
     * Build the default hostname URL for an App Service / Function App site, e.g.
     * `https://<siteName>.azurewebsites.net` in public Azure.
     */
    azureWebSitesEndpoint(siteName: string): string;
}

/**
 * The set of values needed to construct an {@linkcode EnvironmentLike}. The
 * suffix fields drive the {@linkcode EnvironmentLike} endpoint-builder functions.
 */
export interface EnvironmentParametersLike {
    readonly name: string;
    readonly resourceManagerEndpointUrl: string;
    readonly portalUrl: string;
    /** Log Analytics query endpoint, e.g. `https://api.loganalytics.io`. */
    readonly logAnalyticsEndpoint: string;
    /** Storage DNS suffix, e.g. `core.windows.net`. */
    readonly storageEndpointSuffix: string;
    /** Container registry DNS suffix, e.g. `azurecr.io`. */
    readonly containerRegistryDnsSuffix: string;
    /** App Service / Function App hostname suffix, e.g. `azurewebsites.net`. */
    readonly azureWebSitesEndpointSuffix: string;
}

/**
 * Build an {@linkcode EnvironmentLike} from a set of parameters, wiring up the
 * endpoint-builder functions from the supplied DNS suffixes.
 *
 * Trailing slashes are stripped from the URL endpoints
 * ({@linkcode EnvironmentLike.resourceManagerEndpointUrl resourceManagerEndpointUrl},
 * {@linkcode EnvironmentLike.portalUrl portalUrl}) so they match the Azure SDK
 * convention regardless of whether the caller supplied them. This also sanitizes
 * user-configured custom clouds, whose values may or may not include a trailing
 * slash.
 *
 * @param parameters - The cloud endpoints and DNS suffixes.
 * @param isCustomCloud - Whether the environment came from user configuration.
 */
export function createEnvironment(parameters: EnvironmentParametersLike, isCustomCloud = false): EnvironmentLike {
    const { storageEndpointSuffix, containerRegistryDnsSuffix, azureWebSitesEndpointSuffix } = parameters;
    const resourceManagerEndpointUrl = stripTrailingSlash(parameters.resourceManagerEndpointUrl);
    return {
        name: parameters.name,
        isCustomCloud,
        resourceManagerEndpointUrl,
        resourceManagerDefaultScope: `${resourceManagerEndpointUrl}/.default`,
        portalUrl: stripTrailingSlash(parameters.portalUrl),
        logAnalyticsEndpoint: stripTrailingSlash(parameters.logAnalyticsEndpoint),
        storageEndpoint: (accountName: string) => `https://${accountName}.blob.${storageEndpointSuffix}`,
        containerRegistryEndpoint: (registryName: string) => `https://${registryName}.${containerRegistryDnsSuffix}`,
        azureWebSitesEndpoint: (siteName: string) => `https://${siteName}.${azureWebSitesEndpointSuffix}`,
    };
}

/** The endpoint/suffix parameters for the public Azure cloud, also used as the base for custom clouds. */
const publicCloudParameters: EnvironmentParametersLike = {
    name: 'AzureCloud',
    resourceManagerEndpointUrl: 'https://management.azure.com',
    portalUrl: 'https://portal.azure.com',
    logAnalyticsEndpoint: 'https://api.loganalytics.io',
    storageEndpointSuffix: 'core.windows.net',
    containerRegistryDnsSuffix: 'azurecr.io',
    azureWebSitesEndpointSuffix: 'azurewebsites.net',
};

/** The public Azure cloud environment. */
export const AzurePublicCloud: EnvironmentLike = createEnvironment(publicCloudParameters);

/** The Azure US Government cloud environment. */
export const AzureUSGovernment: EnvironmentLike = createEnvironment({
    name: 'AzureUSGovernment',
    resourceManagerEndpointUrl: 'https://management.usgovcloudapi.net',
    portalUrl: 'https://portal.azure.us',
    logAnalyticsEndpoint: 'https://api.loganalytics.us',
    storageEndpointSuffix: 'core.usgovcloudapi.net',
    containerRegistryDnsSuffix: 'azurecr.us',
    azureWebSitesEndpointSuffix: 'azurewebsites.us',
});

/** The Azure China cloud environment. */
export const AzureChinaCloud: EnvironmentLike = createEnvironment({
    name: 'AzureChinaCloud',
    resourceManagerEndpointUrl: 'https://management.chinacloudapi.cn',
    portalUrl: 'https://portal.azure.cn',
    logAnalyticsEndpoint: 'https://api.loganalytics.azure.cn',
    storageEndpointSuffix: 'core.chinacloudapi.cn',
    containerRegistryDnsSuffix: 'azurecr.cn',
    azureWebSitesEndpointSuffix: 'chinacloudsites.cn',
});

const CloudEnvironmentSettingName = 'environment';
const CustomEnvironmentSettingName = 'customEnvironment';

/**
 * The auth provider id used by VS Code for the public Azure cloud.
 */
export const PublicAuthProviderId = 'microsoft';

/**
 * The auth provider id used by VS Code for sovereign / custom clouds.
 */
export const SovereignAuthProviderId = 'microsoft-sovereign-cloud';

/**
 * Determine the VS Code authentication provider id for the given environment.
 * Returns {@linkcode PublicAuthProviderId} for public Azure and
 * {@linkcode SovereignAuthProviderId} for every sovereign / custom cloud.
 */
export function getAuthProviderId(environment: EnvironmentLike): string {
    return environment.name === AzurePublicCloud.name ? PublicAuthProviderId : SovereignAuthProviderId;
}

/**
 * Read the configured Azure environment from the `microsoft-sovereign-cloud`
 * setting owned by VS Code's built-in Microsoft authentication provider.
 *
 * Mirrors the behavior of the (removed) `getConfiguredAzureEnv` helper from
 * `@microsoft/vscode-azext-azureauth`: `ChinaCloud` / `USGovernment` map to the
 * corresponding presets, `custom` reads the `customEnvironment` object, and any
 * other value (including unset) falls back to the public cloud.
 *
 * @throws if the setting is `custom` but `customEnvironment` is not configured.
 */
export function getConfiguredAzureEnv(code: IVsCode): EnvironmentLike {
    const config = code.workspace.getConfiguration(SovereignCloudConfigurationSection);
    const setting = config.get<string>(CloudEnvironmentSettingName);

    if (setting === 'ChinaCloud') {
        return AzureChinaCloud;
    } else if (setting === 'USGovernment') {
        return AzureUSGovernment;
    } else if (setting === 'custom') {
        const custom = config.get<Partial<EnvironmentParametersLike>>(CustomEnvironmentSettingName);
        if (!custom) {
            throw new Error(code.l10n.t('The custom cloud choice is not configured. Please configure the setting `{0}.{1}`.', SovereignCloudConfigurationSection, CustomEnvironmentSettingName));
        }
        // Layer the user-provided values on top of the public-cloud defaults.
        // `name` defaults to 'Custom' (rather than the public cloud's name) so a
        // bare custom cloud is not misclassified as the public auth provider.
        return createEnvironment({ ...publicCloudParameters, name: 'Custom', ...custom }, true);
    }

    return AzurePublicCloud;
}
