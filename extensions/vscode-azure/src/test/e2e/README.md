# End-to-end (E2E) tests

These tests make **real network calls** against a live Azure subscription and
create/destroy real resources (resource groups, storage accounts). They are
long-running and **disabled by default**: they only run when `RUN_E2E=1` is set
in the environment. In the normal test suite the
[`describeE2e`](./e2eConfig.ts) gate registers each suite as skipped, so these
files are harmless even though their `*.e2e.test.ts` names also match the
default `*.test.ts` glob. `describeE2e` also applies a long mocha timeout to
accommodate real provisioning/deployment.

## Running

Use the **Extension: Run E2E Tests** launch configuration (it sets `RUN_E2E=1`
and runs the standard [`.vscode-test.mjs`](../../../.vscode-test.mjs) runner).
To run from the CLI, set `RUN_E2E=1` in your shell first:

```sh
RUN_E2E=1 pnpm --filter vscode-azure run test
```

This reuses the single test runner; the normal unit/integration tests also run,
and the E2E suites activate via the `RUN_E2E` gate. CI sets `RUN_E2E=1` (along
with the `FC_SERVICE_CONNECTION_*` variables) on its dedicated E2E job.

## Required environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AZURE_E2E_SUBSCRIPTION_ID` | Yes | -- | Target subscription. |
| `AZURE_E2E_TENANT_ID` | Yes | -- | Owning tenant. |
| `AZURE_E2E_LOCATION` | No | `eastus` | Region for created resources. |

## Authentication

[`applyOverrides`](../../debug/e2e.ts) selects a credential automatically:

- **CI (Azure Pipelines federated service connection):** when
  `FC_SERVICE_CONNECTION_TENANT_ID`, `FC_SERVICE_CONNECTION_CLIENT_ID`,
  `FC_SERVICE_CONNECTION_ID`, and `SYSTEM_ACCESSTOKEN` are all present, an
  `AzurePipelinesCredential` is used (federated, secret-less). These variables
  are set by the shared `vscode-azuretools` pipeline template's test step (see
  `azdo-pipelines/templates/test.yml`). Map `SYSTEM_ACCESSTOKEN` to
  `$(System.AccessToken)` for the job.
- **Local development:** otherwise a `DefaultAzureCredential` is used, which
  picks up `az login`, environment, and managed-identity credentials. Run
  `az login` first.

## Suites

- [`azdUp.e2e.test.ts`](./azdUp.e2e.test.ts) -- copies the
  [`azd-sample`](./fixtures/azd-sample) fixture to a temp directory, runs the
  extension's `azd up` command (auth delegated to the in-process
  `AzdAuthServer`), asserts the provisioned storage account is reported, then
  tears the deployment back down via the extension's `azd down` command. Skips
  automatically when the `azd` CLI is not installed.
