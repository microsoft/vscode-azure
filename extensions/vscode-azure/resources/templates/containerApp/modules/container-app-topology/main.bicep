metadata name = 'Container App Topology'
metadata description = '''Provisions a complete Azure Container Apps topology: a Log Analytics workspace,
a managed environment, a container registry, a user-assigned managed identity for the app, the AcrPull
role assignment for the deployment registry, and the app itself.

This module exists because no published Azure Verified Module covers the whole topology -- the closest
published pattern modules each cover one part of it, and every azd reference template composes them by
hand. It is deliberately AVM-shaped and composes those published modules rather than re-implementing
them, so it can be replaced by a single `br/public:avm/ptn/azd/...` reference once such a module is
published. Tracked by https://github.com/microsoft/vscode-azure/issues/329.

Registry authentication uses managed identity rather than a registry password. The app receives the
Application Insights connection string for use by application-owned instrumentation.'''

import { withApplicationInsights } from 'environment.bicep'

@minLength(1)
@maxLength(48)
@description('Required. Name of the azd environment; used to derive resource names and to tag resources.')
param environmentName string

@minLength(1)
@description('Required. Azure region for all resources.')
param location string

@description('Optional. Tags applied to every resource in the topology.')
param tags object = {}

@description('Optional. Value applied as the `azd-service-name` tag on the container app only, so `azd deploy` can target it.')
param azdServiceName string = ''

@description('Optional. Whether the container app accepts ingress traffic.')
param ingressEnabled bool = true

@description('Optional. Whether ingress is reachable from outside the environment.')
param ingressExternal bool = true

@description('Optional. Port the container listens on for ingress traffic.')
param targetPort int = 80

@description('Optional. Name of an already deployed container app. When set, provision preserves its current image; otherwise a deterministic name is generated.')
param containerAppName string = ''

@description('Optional. Enable Azure Verified Modules telemetry for the composed modules.')
param enableTelemetry bool = true

// A deterministic suffix keeps globally-scoped names (the registry in particular)
// unique per environment without asking the user to invent one.
var resourceToken = uniqueString(subscription().id, resourceGroup().id, environmentName)

var appName = empty(containerAppName) ? 'ca-${resourceToken}' : containerAppName
var containerAppExists = !empty(containerAppName)
var containerRegistryName = 'cr${resourceToken}'
var managedEnvironmentName = 'cae-${resourceToken}'
var logAnalyticsWorkspaceName = 'log-${resourceToken}'
var userAssignedIdentityName = 'id-${resourceToken}'

module monitoring 'br/public:avm/ptn/azd/monitoring:0.1.0' = {
  name: 'monitoring-${resourceToken}'
  params: {
    location: location
    tags: tags
    logAnalyticsName: logAnalyticsWorkspaceName
    applicationInsightsName: 'appi-${resourceToken}'
    applicationInsightsDashboardName: 'dash-${resourceToken}'
  }
}

module containerAppsStack 'br/public:avm/ptn/azd/container-apps-stack:0.4.0' = {
  name: 'container-apps-stack-${resourceToken}'
  params: {
    location: location
    tags: tags
    containerAppsEnvironmentName: managedEnvironmentName
    containerRegistryName: containerRegistryName
    logAnalyticsWorkspaceName: monitoring.outputs.logAnalyticsWorkspaceName
    publicNetworkAccess: ingressEnabled && ingressExternal ? 'Enabled' : 'Disabled'
    // Zone redundancy requires an infrastructure subnet; this topology does not provision one.
    zoneRedundant: false
    // The app authenticates to the registry with its managed identity, so the
    // admin account is left disabled.
    acrAdminUserEnabled: false
    enableTelemetry: enableTelemetry
  }
}

module appIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.1' = {
  name: 'app-identity-${resourceToken}'
  params: {
    name: userAssignedIdentityName
    location: location
    tags: tags
    enableTelemetry: enableTelemetry
  }
}

resource existingApp 'Microsoft.App/containerApps@2025-01-01' existing = if (containerAppExists) {
  name: appName
}

var existingEnvironment = containerAppExists ? (existingApp!.properties.template.containers[0].?env ?? []) : []

module containerApp 'br/public:avm/ptn/azd/container-app-upsert:0.4.0' = {
  name: 'container-app-${resourceToken}'
  params: {
    name: appName
    location: location
    // `azd deploy` finds its target by tag, and only the app is a deployment
    // target -- the supporting resources deliberately do not carry it.
    tags: empty(azdServiceName) ? tags : union(tags, { 'azd-service-name': azdServiceName })
    containerAppsEnvironmentName: containerAppsStack.outputs.environmentName
    containerRegistryName: containerAppsStack.outputs.registryName
    // The ARM login server supplies the suffix for the deployment's Azure cloud.
    containerRegistryHostSuffix: join(skip(split(containerAppsStack.outputs.registryLoginServer, '.'), 1), '.')
    identityType: 'UserAssigned'
    identityName: appIdentity.outputs.name
    userAssignedIdentityResourceId: appIdentity.outputs.resourceId
    identityPrincipalId: appIdentity.outputs.principalId
    // An empty image selects quickstart on creation and preserves the live image on updates.
    imageName: ''
    exists: containerAppExists
    env: withApplicationInsights(existingEnvironment, monitoring.outputs.applicationInsightsConnectionString)
    ingressEnabled: ingressEnabled
    external: ingressExternal
    targetPort: targetPort
    containerMinReplicas: 1
    enableTelemetry: enableTelemetry
  }
}

@description('Name of the container app.')
output containerAppName string = containerApp.outputs.name

@description('Resource ID of the container app.')
output containerAppResourceId string = containerApp.outputs.resourceId

@description('Public endpoint of the container app, or an empty string when ingress is disabled.')
output containerAppUri string = containerApp.outputs.uri

@description('Name of the container registry used by azd to push and deploy images.')
output containerRegistryName string = containerAppsStack.outputs.registryName

@description('Login server of the container registry, for pushing images.')
output containerRegistryLoginServer string = containerAppsStack.outputs.registryLoginServer

@description('Name of the managed environment hosting the app.')
output managedEnvironmentName string = containerAppsStack.outputs.environmentName

@description('Resource ID of the user-assigned identity the app runs as.')
output identityResourceId string = appIdentity.outputs.resourceId
