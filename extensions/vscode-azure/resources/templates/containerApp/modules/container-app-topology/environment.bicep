type environmentVariable = {
  name: string
  value: string?
  secretRef: string?
}

@export()
@description('Preserves unrelated environment entries, including secret references, and sets one Application Insights connection string.')
func withApplicationInsights(environment environmentVariable[], connectionString string) environmentVariable[] => concat(
  filter(environment, entry => entry.name != 'APPLICATIONINSIGHTS_CONNECTION_STRING'),
  [
    {
      name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
      value: connectionString
    }
  ]
)
