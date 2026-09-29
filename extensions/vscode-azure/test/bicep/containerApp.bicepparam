using none

import { withApplicationInsights } from '../../resources/templates/containerApp/modules/container-app-topology/environment.bicep'

param firstCreation = withApplicationInsights([], 'test-connection')

param reprovision = withApplicationInsights([
  { name: 'APP_MODE', value: 'production' }
  { name: 'API_KEY', secretRef: 'api-key' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: 'old-connection' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'old-connection-secret' }
], 'test-connection')

param repeatedProvision = withApplicationInsights(reprovision, 'test-connection')
