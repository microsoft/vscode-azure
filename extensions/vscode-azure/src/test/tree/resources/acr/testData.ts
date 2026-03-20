/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { GenericResource, IAcrClient, Registry } from '@microsoft/vscode-azure-azutils';
import { AcrResourceType } from '../../../../tree/resources/acr/AcrRegistry';

/**
 * A minimal fake {@link AzureSubscription} suitable for offline tests.
 * Only the fields actually accessed by tree providers are populated.
 */
export function createFakeSubscription(overrides?: Partial<AzureSubscription>): AzureSubscription {
    return {
        subscriptionId: 'aaaabbbb-1111-2222-3333-ccccddddeeee',
        tenantId: '11112222-3333-4444-5555-666677778888',
        name: 'Test Subscription',
        isCustomCloud: false,
        environment: {
            name: 'AzureCloud',
            portalUrl: 'https://portal.azure.com',
            resourceManagerEndpointUrl: 'https://management.azure.com/',
        } as AzureSubscription['environment'],
        credential: {} as AzureSubscription['credential'],
        authentication: {} as AzureSubscription['authentication'],
        account: {
            id: 'test-account-id',
            label: 'test@contoso.com',
            environment: {
                name: 'AzureCloud',
                portalUrl: 'https://portal.azure.com',
            },
        } as AzureSubscription['account'],
        ...overrides,
    };
}

/**
 * Creates a fake {@link GenericResource} representing an ACR registry.
 */
export function createFakeAcrResource(name: string, subscription?: AzureSubscription): GenericResource {
    const sub = subscription ?? createFakeSubscription();
    return {
        id: `/subscriptions/${sub.subscriptionId}/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/${name}`,
        name,
        type: AcrResourceType,
        location: 'eastus',
        logicalType: AcrResourceType,
        subscription: sub,
    };
}

/**
 * Creates a mock {@link IAcrClient} whose `registries.get()` returns
 * a pre-canned {@link Registry} for any request.
 */
export function createMockAcrClient(registryOverrides?: Partial<Registry>): IAcrClient {
    return {
        registries: {
            get: async (resourceGroupName: string, registryName: string) => ({
                id: `/subscriptions/aaaabbbb-1111-2222-3333-ccccddddeeee/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerRegistry/registries/${registryName}`,
                name: registryName,
                type: AcrResourceType,
                location: 'eastus',
                loginServer: `${registryName}.azurecr.io`,
                sku: { name: 'Standard', tier: 'Standard' },
                adminUserEnabled: false,
                ...registryOverrides,
            }),
        },
    };
}
