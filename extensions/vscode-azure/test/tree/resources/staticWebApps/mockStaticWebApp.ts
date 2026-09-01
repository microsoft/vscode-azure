/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StaticWebAppResourceType, type StaticSiteBuildARMResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import type { StaticWebApp, StaticWebAppEnvironment } from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppVirtualTypes } from '../../../../src/tree/resources/staticWebApps/StaticWebApp';

/** Creates a Static Web App ARM resource with stable test defaults. */
export function makeStaticWebApp(overrides?: Partial<StaticWebApp>): StaticWebApp {
    return makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/mySwa',
        name: 'mySwa',
        type: StaticWebAppResourceType,
        logicalType: StaticWebAppResourceType,
        branch: 'main',
        defaultHostname: 'my-swa.azurestaticapps.net',
        staticSite: {},
        ...overrides,
    });
}

/**
 * Creates a Static Web Apps environment virtual node.
 *
 * `buildId` drives the defaults for the ARM payload, so a test asking for a preview
 * environment gets one whose `data` agrees with it. Any `data` supplied in `overrides` is
 * merged over those defaults rather than replacing them.
 */
export function makeStaticWebAppEnvironment(overrides?: Partial<StaticWebAppEnvironment>): StaticWebAppEnvironment {
    const site = overrides?.azureResource ?? makeStaticWebApp();
    const buildId = overrides?.buildId ?? 'default';
    const data: StaticSiteBuildARMResource = {
        id: `${site.id}/builds/${buildId}`,
        name: buildId,
        buildId,
        sourceBranch: 'main',
        hostname: site.defaultHostname,
        status: 'Ready',
        ...overrides?.data,
    };
    return {
        virtualType: StaticWebAppVirtualTypes.Environment,
        virtualPath: `environments/${buildId}`,
        azureResource: site,
        buildId,
        branch: 'main',
        isProduction: buildId === 'default',
        hostname: data.hostname,
        status: data.status,
        ...overrides,
        data,
    };
}
