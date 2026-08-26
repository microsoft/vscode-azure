targetScope = 'subscription'

@minLength(1)
@maxLength(48)
@description('Name of the azd environment.')
param environmentName string

@minLength(1)
@description('Azure region for all resources.')
param location string

@description('Value applied as the `azd-service-name` tag on the container app so `azd deploy` can target it.')
param azdServiceName string = 'app'

@description('Container image to deploy. Leave empty to deploy a placeholder image until the first `azd deploy`.')
param imageName string = ''

@description('Port the container listens on for ingress traffic.')
param targetPort int = 80

var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// The topology lives in its own module so this file stays a thin consumer:
// subscription scope, the resource group, and the azd placeholders. See that
// module's metadata for why it is local rather than a `br/public:avm/ptn/...`
// reference -- https://github.com/microsoft/vscode-azure/issues/329.
module containerAppTopology 'modules/container-app-topology/main.bicep' = {
  scope: rg
  name: 'container-app-topology'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    azdServiceName: azdServiceName
    imageName: imageName
    targetPort: targetPort
  }
}

output AZURE_CONTAINER_APP_NAME string = containerAppTopology.outputs.containerAppName
output AZURE_CONTAINER_APP_URI string = containerAppTopology.outputs.containerAppUri
output AZURE_CONTAINER_REGISTRY_NAME string = containerAppTopology.outputs.containerRegistryName
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerAppTopology.outputs.containerRegistryLoginServer
output AZURE_RESOURCE_GROUP string = rg.name
