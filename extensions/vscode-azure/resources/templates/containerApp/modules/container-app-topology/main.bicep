metadata name = 'Container App Topology'
metadata description = '''Provisions a complete Azure Container Apps topology: a Log Analytics workspace,
a managed environment, a container registry, a user-assigned managed identity for the app, AcrPull
role assignments for the deployment registry and an optional existing image registry, and the app itself.

This module exists because no published Azure Verified Module covers the whole topology -- the closest
published pattern modules each cover one part of it, and every azd reference template composes them by
hand. It is deliberately AVM-shaped and composes those published modules rather than re-implementing
them, so it can be replaced by a single `br/public:avm/ptn/azd/...` reference once such a module is
published. Tracked by https://github.com/microsoft/vscode-azure/issues/329.

Registry authentication is managed identity only: no admin user, no registry password, and no secret of
any kind is written to the template, to ARM, or to disk.'''

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

@description('Optional. Image for the first provision, or a placeholder when empty. An existing app retains its deployed image regardless of this initial value.')
param imageName string = ''

@description('Optional. Resource ID of an existing Azure Container Registry containing the selected image, including registries in another resource group.')
param imageRegistryId string = ''

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
var containerRegistryResourceId = resourceId('Microsoft.ContainerRegistry/registries', containerRegistryName)
var useImageRegistry = !empty(imageRegistryId) && toLower(imageRegistryId) != toLower(containerRegistryResourceId)
var imageRegistryIdParts = split(imageRegistryId, '/')
var imageRegistrySubscriptionId = useImageRegistry ? imageRegistryIdParts[2] : subscription().subscriptionId
var imageRegistryResourceGroupName = useImageRegistry ? imageRegistryIdParts[4] : resourceGroup().name
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource existingApp 'Microsoft.App/containerApps@2025-01-01' existing = if (containerAppExists) {
  name: appName
}

resource imageRegistry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = if (useImageRegistry) {
  scope: resourceGroup(imageRegistrySubscriptionId, imageRegistryResourceGroupName)
  name: last(imageRegistryIdParts)
}

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

module deploymentRegistryAccess 'br/public:avm/ptn/authorization/resource-role-assignment:0.1.2' = {
  name: 'deployment-registry-access-${resourceToken}'
  params: {
    resourceId: resourceId('Microsoft.ContainerRegistry/registries', containerAppsStack.outputs.registryName)
    principalId: appIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
    enableTelemetry: enableTelemetry
  }
}

module imageRegistryAccess 'br/public:avm/ptn/authorization/resource-role-assignment:0.1.2' = if (useImageRegistry) {
  scope: resourceGroup(imageRegistrySubscriptionId, imageRegistryResourceGroupName)
  name: 'image-registry-access-${resourceToken}'
  params: {
    resourceId: imageRegistry!.id
    principalId: appIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
    enableTelemetry: enableTelemetry
  }
}

module containerApp 'br/public:avm/res/app/container-app:0.19.0' = {
  name: 'container-app-${resourceToken}'
  params: {
    name: appName
    location: location
    // `azd deploy` finds its target by tag, and only the app is a deployment
    // target -- the supporting resources deliberately do not carry it.
    tags: empty(azdServiceName) ? tags : union(tags, { 'azd-service-name': azdServiceName })
    environmentResourceId: containerAppsStack.outputs.environmentResourceId
    managedIdentities: {
      userAssignedResourceIds: [appIdentity.outputs.resourceId]
    }
    // ARM login servers carry the active cloud's suffix. Both registries are
    // configured so an existing image and a subsequent azd deploy can pull.
    registries: concat([
      {
        server: containerAppsStack.outputs.registryLoginServer
        identity: appIdentity.outputs.resourceId
      }
    ], useImageRegistry ? [
      {
        server: imageRegistry!.properties.loginServer
        identity: appIdentity.outputs.resourceId
      }
    ] : [])
    containers: [
      {
        name: 'main'
        image: containerAppExists
          ? existingApp!.properties.template.containers[0].image
          : (!empty(imageName) ? imageName : 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')
        resources: {
          cpu: json('0.5')
          memory: '1.0Gi'
        }
      }
    ]
    scaleSettings: {
      minReplicas: 2
      maxReplicas: 10
    }
    disableIngress: !ingressEnabled
    ingressExternal: ingressExternal
    ingressTargetPort: targetPort
    corsPolicy: {
      allowedOrigins: [
        'https://portal.azure.com'
        'https://ms.portal.azure.com'
      ]
    }
    enableTelemetry: enableTelemetry
  }
  dependsOn: [
    deploymentRegistryAccess
    imageRegistryAccess
  ]
}

@description('Name of the container app.')
output containerAppName string = containerApp.outputs.name

@description('Resource ID of the container app.')
output containerAppResourceId string = containerApp.outputs.resourceId

@description('Public endpoint of the container app, or an empty string when ingress is disabled.')
output containerAppUri string = ingressEnabled ? 'https://${containerApp.outputs.fqdn}' : ''

@description('Name of the container registry used by azd to push and deploy images.')
output containerRegistryName string = containerAppsStack.outputs.registryName

@description('Login server of the container registry, for pushing images.')
output containerRegistryLoginServer string = containerAppsStack.outputs.registryLoginServer

@description('Name of the managed environment hosting the app.')
output managedEnvironmentName string = containerAppsStack.outputs.environmentName

@description('Resource ID of the user-assigned identity the app runs as.')
output identityResourceId string = appIdentity.outputs.resourceId
