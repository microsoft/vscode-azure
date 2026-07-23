targetScope = 'resourceGroup'

param name string
param location string
param skuName string
param azdServiceName string
param environmentName string
param appLocation string
param apiLocation string
param outputLocation string
param repositoryUrl string
param branch string

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  tags: {
    'azd-env-name': environmentName
    'azd-service-name': azdServiceName
  }
  sku: {
    name: skuName
    tier: skuName
  }
  properties: union(union({
    buildProperties: {
      appLocation: appLocation
      apiLocation: apiLocation
      outputLocation: outputLocation
    }
  }, {
    // Accepted by the Static Sites create API but missing from current Bicep types.
    skipGithubActionWorkflowGeneration: true
  }), empty(repositoryUrl) ? {} : {
    branch: branch
    provider: 'GitHub'
    repositoryUrl: repositoryUrl
  })
}

output name string = staticWebApp.name
output endpoint string = 'https://${staticWebApp.properties.defaultHostname}'
