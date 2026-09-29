/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, type IVsCode } from '@microsoft/vscode-azure-utils';
import { AcrResourceType, AIFoundryProjectLogicalType, AIServicesLogicalType, AppServiceLogicalType, ContainerAppResourceType, CosmosDBLogicalType, CosmosDBMongoLogicalType, DocumentDbResourceType, DurableTaskHubLogicalType, FoundryProjectResourceType, FunctionAppLogicalType, LogicAppLogicalType, ManagedEnvironmentResourceType, StaticWebAppResourceType } from '../rest/clients/ResourceClient';

/** Localized presentation for a supported logical resource type. */
export interface ResourceTypePresentation {
    /** Product name used for resource-type groups. */
    readonly name: string;
    /** Icon key under `azureIcons/`, without the `.svg` extension. */
    readonly iconName: string;
}

const presentationEntries: [string, (code: IVsCode) => string, string?][] = [
    ['Microsoft.ApiManagement/service', code => code.l10n.t('API Management')],
    [ContainerAppResourceType, code => code.l10n.t('Container Apps')],
    [ManagedEnvironmentResourceType, code => code.l10n.t('Container App Environments')],
    ['Microsoft.AppPlatform/Spring', code => code.l10n.t('Spring Apps')],
    ['Microsoft.Batch/batchAccounts', code => code.l10n.t('Batch Accounts')],
    ['Microsoft.Cache/Redis', code => code.l10n.t('Cache for Redis')],
    ['Microsoft.Cdn/profiles', code => code.l10n.t('Front Door and CDN Profiles')],
    [AIServicesLogicalType, code => code.l10n.t('AI Services')],
    [FoundryProjectResourceType, code => code.l10n.t('Microsoft Foundry Projects'), AIFoundryProjectLogicalType],
    ['Microsoft.Compute/availabilitySets', code => code.l10n.t('Availability Sets')],
    ['Microsoft.Compute/disks', code => code.l10n.t('Managed Disks')],
    ['Microsoft.Compute/images', code => code.l10n.t('Images')],
    ['Microsoft.Compute/virtualMachines', code => code.l10n.t('Virtual Machines')],
    ['Microsoft.Compute/virtualMachineScaleSets', code => code.l10n.t('Virtual Machine Scale Sets')],
    [AcrResourceType, code => code.l10n.t('Container Registries')],
    ['Microsoft.ContainerService/managedClusters', code => code.l10n.t('Kubernetes Clusters')],
    ['Microsoft.DBforMySQL/servers', code => code.l10n.t('MySQL Servers')],
    ['Microsoft.DBforPostgreSQL/flexibleServers', code => code.l10n.t('PostgreSQL Flexible Servers')],
    ['Microsoft.DBforPostgreSQL/servers', code => code.l10n.t('PostgreSQL Servers')],
    ['Microsoft.Devices/IotHubs', code => code.l10n.t('IoT Hubs')],
    ['Microsoft.DevTestLab/labs', code => code.l10n.t('DevTest Labs')],
    [CosmosDBLogicalType, code => code.l10n.t('Azure Cosmos DB')],
    [CosmosDBMongoLogicalType, code => code.l10n.t('Azure Cosmos DB for MongoDB (RU)')],
    [DocumentDbResourceType, code => code.l10n.t('Azure DocumentDB')],
    ['Microsoft.DurableTask/schedulers', code => code.l10n.t('Durable Task Schedulers')],
    [DurableTaskHubLogicalType, code => code.l10n.t('Durable Task Hubs')],
    ['Microsoft.EventGrid/domains', code => code.l10n.t('Event Grid Domains')],
    ['Microsoft.EventGrid/eventSubscriptions', code => code.l10n.t('Event Grid Subscriptions')],
    ['Microsoft.EventGrid/topics', code => code.l10n.t('Event Grid Topics')],
    ['Microsoft.EventHub/namespaces', code => code.l10n.t('Event Hubs')],
    ['Microsoft.ExtendedLocation/customLocations', code => code.l10n.t('Custom Locations')],
    ['Microsoft.HybridCompute/machines', code => code.l10n.t('Arc-enabled Servers')],
    ['Microsoft.Insights/components', code => code.l10n.t('Application Insights')],
    ['Microsoft.KeyVault/vaults', code => code.l10n.t('Key Vaults')],
    ['Microsoft.Kubernetes/connectedClusters', code => code.l10n.t('Arc-enabled Kubernetes Clusters')],
    ['Microsoft.Logic/workflows', code => code.l10n.t('Logic Apps')],
    [AIFoundryProjectLogicalType, code => code.l10n.t('Microsoft Foundry Projects')],
    ['Microsoft.ManagedIdentity/userAssignedIdentities', code => code.l10n.t('User-assigned Managed Identities')],
    ['Microsoft.Network/applicationGateways', code => code.l10n.t('Application Gateways')],
    ['Microsoft.Network/applicationSecurityGroups', code => code.l10n.t('Application Security Groups')],
    ['Microsoft.Network/loadBalancers', code => code.l10n.t('Load Balancers')],
    ['Microsoft.Network/localNetworkGateways', code => code.l10n.t('Local Network Gateways')],
    ['Microsoft.Network/networkInterfaces', code => code.l10n.t('Network Interfaces')],
    ['Microsoft.Network/networkSecurityGroups', code => code.l10n.t('Network Security Groups')],
    ['Microsoft.Network/networkWatchers', code => code.l10n.t('Network Watchers')],
    ['Microsoft.Network/publicIPAddresses', code => code.l10n.t('Public IP Addresses')],
    ['Microsoft.Network/publicIPPrefixes', code => code.l10n.t('Public IP Prefixes')],
    ['Microsoft.Network/routeTables', code => code.l10n.t('Route Tables')],
    ['Microsoft.Network/virtualNetworkGateways', code => code.l10n.t('Virtual Network Gateways')],
    ['Microsoft.Network/virtualNetworks', code => code.l10n.t('Virtual Networks')],
    ['Microsoft.NotificationHubs/namespaces', code => code.l10n.t('Notification Hubs')],
    ['Microsoft.OperationalInsights/workspaces', code => code.l10n.t('Log Analytics Workspaces')],
    ['Microsoft.OperationsManagement/solutions', code => code.l10n.t('Operations Management Solutions')],
    ['Microsoft.ServiceBus/namespaces', code => code.l10n.t('Service Bus Namespaces')],
    ['Microsoft.ServiceFabric/clusters', code => code.l10n.t('Service Fabric Clusters')],
    ['Microsoft.ServiceFabricMesh/applications', code => code.l10n.t('Service Fabric Mesh Applications')],
    ['Microsoft.SignalRService/SignalR', code => code.l10n.t('SignalR Service')],
    ['Microsoft.SignalRService/webPubSub', code => code.l10n.t('Web PubSub')],
    ['Microsoft.Sql/servers', code => code.l10n.t('SQL Servers')],
    ['Microsoft.Sql/servers/databases', code => code.l10n.t('SQL Databases')],
    ['Microsoft.Storage/storageAccounts', code => code.l10n.t('Storage Accounts')],
    ['Microsoft.Web/hostingEnvironments', code => code.l10n.t('App Service Environments')],
    ['Microsoft.Web/kubeEnvironments', code => code.l10n.t('Kubernetes Environments')],
    ['Microsoft.Web/serverFarms', code => code.l10n.t('App Service Plans')],
    [AppServiceLogicalType, code => code.l10n.t('App Services')],
    [FunctionAppLogicalType, code => code.l10n.t('Function Apps')],
    [LogicAppLogicalType, code => code.l10n.t('Logic Apps')],
    [StaticWebAppResourceType, code => code.l10n.t('Static Web Apps')],
];

const presentations = new CaselessMap(presentationEntries.map(([logicalType, name, iconName = logicalType]) =>
    [logicalType, { name, iconName }] as const,
));

/**
 * Gets the localized group name and bundled icon key for a known logical type.
 *
 * Returns `undefined` for types without presentation metadata; callers can
 * retain their raw type label and generic icon in that case.
 */
export function getResourceTypePresentation(code: IVsCode, logicalType: string): ResourceTypePresentation | undefined {
    const presentation = presentations.get(logicalType);
    return presentation && {
        name: presentation.name(code),
        iconName: presentation.iconName,
    };
}
