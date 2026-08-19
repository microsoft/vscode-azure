/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StaticWebAppResourceType, type StaticSiteBuildARMResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import type { Page } from '@microsoft/vscode-azure-utils';
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

/** Creates a Static Web Apps environment virtual node. */
export function makeStaticWebAppEnvironment(overrides?: Partial<StaticWebAppEnvironment>): StaticWebAppEnvironment {
    const site = makeStaticWebApp();
    const data: StaticSiteBuildARMResource = {
        id: `${site.id}/builds/default`,
        name: 'default',
        buildId: 'default',
        sourceBranch: 'main',
        hostname: site.defaultHostname,
        status: 'Ready',
    };
    return {
        virtualType: StaticWebAppVirtualTypes.Environment,
        virtualPath: 'environments/default',
        azureResource: site,
        data,
        buildId: 'default',
        branch: 'main',
        isProduction: true,
        hostname: site.defaultHostname,
        status: 'Ready',
        displayLabel: 'Production',
        ...overrides,
    };
}

/** Wraps items in the single-page shape returned by Azure client wrappers. */
export function singlePage<T>(items: T[]): AsyncIterable<Page<T>> {
    return {
        [Symbol.asyncIterator]: () => {
            let done = false;
            return {
                next: () => {
                    if (done) {
                        return Promise.resolve({ done: true, value: undefined });
                    }
                    done = true;
                    return Promise.resolve({ done: false, value: { items, hasMore: false } });
                },
            };
        },
    };
}
