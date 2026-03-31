targetScope = 'resourceGroup'

// Parameters

@minLength(3)
@description('Globally unique name for the function app.')
param functionAppName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Hosting plan.')
@allowed(['FlexConsumption', 'Premium', 'AppServicePlan'])
param hostingPlan string = 'FlexConsumption'

@description('Language runtime.')
@allowed(['dotnet-isolated', 'node', 'python', 'java', 'powershell', 'custom'])
param runtimeStack string = 'node'

@description('Runtime version string (e.g. "Node|20", "Python|3.11"). Used as linuxFxVersion on Linux.')
param runtimeVersion string = 'Node|20'

@description('Operating system. Flex Consumption always uses Linux regardless of this value.')
@allowed(['linux', 'windows'])
param operatingSystem string = 'linux'

@description('[Flex Consumption] Instance memory in MB.')
@allowed([512, 1024, 2048, 4096])
param flexInstanceMemoryMB int = 2048

@description('[Flex Consumption] Maximum instance count for auto-scale.')
@minValue(1)
@maxValue(1000)
param flexMaximumInstanceCount int = 100

@description('[Premium] Elastic Premium SKU.')
@allowed(['EP1', 'EP2', 'EP3'])
param premiumSkuName string = 'EP1'

@description('[App Service Plan] Dedicated plan SKU.')
param appServicePlanSkuName string = 'S1'

@description('Tags applied to every resource.')
param tags object = {}

// Derived flags

var isLinux = operatingSystem == 'linux' || hostingPlan == 'FlexConsumption'
var isFlex = hostingPlan == 'FlexConsumption'
var isPremium = hostingPlan == 'Premium'
var isAppServicePlan = hostingPlan == 'AppServicePlan'

// Naming

var storageAccountName = take(padLeft(toLower(replace('st${functionAppName}', '-', '')), 3, '0'), 24)
var functionAppKind = isLinux ? 'functionapp,linux' : 'functionapp'

// SKU mapping

var planSkuName = isFlex ? 'FC1' : isPremium ? premiumSkuName : appServicePlanSkuName

// Flex Consumption expects just the version number (e.g. '20'), not the linuxFxVersion format ('Node|20')
var flexRuntimeVersion = contains(runtimeVersion, '|') ? split(runtimeVersion, '|')[1] : runtimeVersion

// Storage connection helpers

var storageEndpointSuffix = environment().suffixes.storage
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${storageEndpointSuffix};AccountKey=${storageAccount.listKeys().keys[0].value}'

// App settings

var runtimeAppSettings = isFlex
  ? {}
  : {
      FUNCTIONS_EXTENSION_VERSION: '~4'
      FUNCTIONS_WORKER_RUNTIME: runtimeStack
    }

var contentSettings = isPremium
  ? {
      WEBSITE_CONTENTAZUREFILECONNECTIONSTRING: storageConnectionString
      WEBSITE_CONTENTSHARE: toLower(functionAppName)
    }
  : {}

var deploymentStorageSettings = isFlex ? {} : {}

var runFromPackageSettings = (!isLinux)
  ? {
      WEBSITE_RUN_FROM_PACKAGE: '1'
    }
  : {}

var javaAgentSettings = (isPremium && runtimeStack == 'java')
  ? {
      APPLICATIONINSIGHTS_ENABLE_AGENT: 'true'
    }
  : {}

var customAppSettings = union(
  runtimeAppSettings,
  contentSettings,
  deploymentStorageSettings,
  runFromPackageSettings,
  javaAgentSettings
)

// Site config

var siteConfig = union(
  { alwaysOn: isAppServicePlan, use32BitWorkerProcess: false },
  (isLinux && !isFlex) ? { linuxFxVersion: runtimeVersion } : {}
)

// ===========================================================================
// Resources
// ===========================================================================

// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    defaultToOAuthAuthentication: true
    allowSharedKeyAccess: !isFlex
    minimumTlsVersion: 'TLS1_2'
  }
  tags: tags
}

// Storage Blob Data Contributor role assignment
resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, 'StorageBlobDataContributor', functionAppName)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )
    principalId: managedIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Log Analytics Workspace
module logAnalyticsWorkspace 'br/public:avm/res/operational-insights/workspace:0.11.0' = {
  name: 'logAnalytics-${uniqueString(resourceGroup().id, functionAppName)}'
  params: {
    name: 'log-${functionAppName}'
    location: location
    tags: tags
  }
}

// Application Insights
module appInsights 'br/public:avm/res/insights/component:0.6.0' = {
  name: 'appInsights-${uniqueString(resourceGroup().id, functionAppName)}'
  params: {
    name: 'appi-${functionAppName}'
    location: location
    kind: 'web'
    applicationType: 'web'
    workspaceResourceId: logAnalyticsWorkspace.?outputs.?resourceId ?? ''
    tags: tags
  }
}

// User-Assigned Managed Identity
module managedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.0' = {
  name: 'managedIdentity-${uniqueString(resourceGroup().id, functionAppName)}'
  params: {
    name: 'id-${functionAppName}'
    location: location
    tags: tags
  }
}

// App Service Plan
module appServicePlan 'br/public:avm/res/web/serverfarm:0.4.0' = {
  name: 'appServicePlan-${uniqueString(resourceGroup().id, functionAppName)}'
  params: {
    name: isFlex ? 'FLEX-${functionAppName}' : 'ASP-${functionAppName}'
    location: location
    kind: isLinux ? 'linux' : 'app'
    skuName: planSkuName
    tags: tags
  }
}

// Function App
module functionApp 'br/public:avm/res/web/site:0.22.0' = {
  name: 'functionApp-${uniqueString(resourceGroup().id, functionAppName)}'
  params: {
    name: functionAppName
    location: location
    kind: functionAppKind
    serverFarmResourceId: appServicePlan.outputs.resourceId
    tags: tags
    clientAffinityEnabled: false
    httpsOnly: true
    siteConfig: siteConfig
    managedIdentities: {
      userAssignedResourceIds: [managedIdentity.outputs.resourceId]
    }
    functionAppConfig: isFlex
      ? {
          deployment: {
            storage: {
              type: 'blobContainer'
              value: '${storageAccount.properties.primaryEndpoints.blob}app-package-${take(toLower(functionAppName), 32)}-${uniqueString(resourceGroup().id)}'
              authentication: {
                type: 'UserAssignedIdentity'
                userAssignedIdentityResourceId: managedIdentity.outputs.resourceId
              }
            }
          }
          runtime: { name: runtimeStack, version: flexRuntimeVersion }
          scaleAndConcurrency: {
            maximumInstanceCount: flexMaximumInstanceCount
            instanceMemoryMB: flexInstanceMemoryMB
          }
        }
      : null
    configs: [
      {
        name: 'appsettings'
        storageAccountResourceId: storageAccount.id
        storageAccountUseIdentityAuthentication: true
        applicationInsightResourceId: appInsights.outputs.resourceId
        properties: customAppSettings
      }
    ]
    autoGeneratedDomainNameLabelScope: 'TenantReuse'
  }
}

// ===========================================================================
// Outputs
// ===========================================================================
output functionAppName string = functionApp.outputs.name
output functionAppResourceId string = functionApp.outputs.resourceId
output defaultHostname string = functionApp.outputs.defaultHostname
output storageAccountName string = storageAccount.name
output appInsightsResourceId string = appInsights.outputs.resourceId
output appServicePlanResourceId string = appServicePlan.outputs.resourceId
output managedIdentityResourceId string = managedIdentity.outputs.resourceId
