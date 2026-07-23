targetScope = 'subscription'

@minLength(1)
@maxLength(48)
@description('Name of the azd environment.')
param environmentName string

@minLength(1)
@description('Azure region for all resources.')
param location string

@allowed([
  'Free'
  'Standard'
])
@description('Static Web Apps SKU.')
param staticWebAppSkuName string = 'Free'

@description('Application source location relative to the repository root.')
param appLocation string = '/'

@description('Azure Functions source location relative to the repository root, or empty for no API.')
param apiLocation string = ''

@description('Build output location relative to the application source.')
param outputLocation string = ''

@description('Value applied as the azd service tag so azd can discover the resource.')
param azdServiceName string = 'web'

@description('Existing GitHub repository URL retained as optional resource metadata.')
param repositoryUrl string = ''

@description('Existing Git branch retained with repositoryUrl.')
param branch string = ''

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

module staticWebApp './staticWebApp.module.bicep' = {
  scope: rg
  name: 'staticWebApp'
  params: {
    name: take('${environmentName}-${uniqueString(subscription().id, environmentName)}', 40)
    location: location
    skuName: staticWebAppSkuName
    azdServiceName: azdServiceName
    environmentName: environmentName
    appLocation: appLocation
    apiLocation: apiLocation
    outputLocation: outputLocation
    repositoryUrl: repositoryUrl
    branch: branch
  }
}

output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppEndpoint string = staticWebApp.outputs.endpoint
