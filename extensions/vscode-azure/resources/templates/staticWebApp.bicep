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

var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module staticWebApp 'br/public:avm/res/web/static-site:0.9.5' = {
  scope: rg
  name: 'staticWebApp'
  params: {
    name: take('${environmentName}-${uniqueString(subscription().id, environmentName)}', 40)
    location: location
    sku: staticWebAppSkuName
    tags: union(tags, { 'azd-service-name': azdServiceName })
    buildProperties: {
      appLocation: appLocation
      apiLocation: apiLocation
      outputLocation: outputLocation
    }
    provider: 'None'
  }
}
