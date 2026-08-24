@description('The Azure region for the storage account.')
param location string

@description('Globally unique storage account name (3-24 lowercase alphanumeric).')
param name string

@description('Tags applied to the storage account.')
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

output name string = storageAccount.name
