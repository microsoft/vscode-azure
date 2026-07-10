targetScope = 'subscription'

@minLength(1)
@description('Name of the azd environment; used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

var resourceToken = uniqueString(subscription().id, environmentName, location)
var tags = {
  'azd-env-name': environmentName
}

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module storage 'storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    location: location
    name: 'st${resourceToken}'
    tags: tags
  }
}

output AZURE_LOCATION string = location
output STORAGE_ACCOUNT_NAME string = storage.outputs.name
