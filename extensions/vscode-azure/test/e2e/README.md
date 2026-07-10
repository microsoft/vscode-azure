# End-to-end (E2E) tests

These tests make **real network calls** against a live Azure subscription and
create/destroy real resources (resource groups, storage accounts). They are
long-running and **disabled by default**: they only run when
`ENABLE_LONG_RUNNING_TESTS=1` is set in the environment. In the normal test
suite the shared
[`describeLongRunning`](../../../../packages/utils/test/describeLongRunning.ts)
gate registers each suite as skipped, so these files are harmless even though
their `*.e2e.test.ts` names also match the default `*.test.ts` glob.
`describeLongRunning` also applies a long mocha timeout to accommodate real
provisioning/deployment.

## Running

Use the **Extension: Run E2E Tests** launch configuration (it sets
`ENABLE_LONG_RUNNING_TESTS=1` and runs the standard
[`.vscode-test.mjs`](../../../.vscode-test.mjs) runner). To run from the CLI, set
`ENABLE_LONG_RUNNING_TESTS=1` in your shell first:

```sh
ENABLE_LONG_RUNNING_TESTS=1 pnpm --filter vscode-azure run test
```

This reuses the single test runner; the normal unit/integration tests also run,
and the E2E suites activate via the `ENABLE_LONG_RUNNING_TESTS` gate. CI sets
`ENABLE_LONG_RUNNING_TESTS=1` (along with the `FC_SERVICE_CONNECTION_*`
variables) on its dedicated E2E job.

## Required environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AZURE_E2E_SUBSCRIPTION_ID` | No | active `az` subscription | Target subscription. |
| `AZURE_E2E_TENANT_ID` | No | active `az` tenant | Owning tenant. |
| `AZURE_E2E_LOCATION` | No | `westus2` | Region for created resources. |

Locally, the subscription and tenant default to whatever the Azure CLI (`az`)
is currently logged into (`az account show`), matching the `AzureCliCredential`
used for auth -- so a developer typically only needs to run `az login`. In CI,
the tenant comes from `FC_SERVICE_CONNECTION_TENANT_ID` and the subscription
from `AZURE_E2E_SUBSCRIPTION_ID`, so the CLI is never consulted.

## Authentication

[`applyOverrides`](../override/e2e.ts) selects a credential automatically:

- **CI (Azure Pipelines federated service connection):** when
  `FC_SERVICE_CONNECTION_TENANT_ID`, `FC_SERVICE_CONNECTION_CLIENT_ID`,
  `FC_SERVICE_CONNECTION_ID`, and `SYSTEM_ACCESSTOKEN` are all present, an
  `AzurePipelinesCredential` is used (federated, secret-less). These variables
  are set by the shared `vscode-azuretools` pipeline template's test step (see
  `azdo-pipelines/templates/test.yml`). Map `SYSTEM_ACCESSTOKEN` to
  `$(System.AccessToken)` for the job.
- **Local development:** otherwise an `AzureCliCredential` is used, which picks
  up `az login`. Run `az login` first.
