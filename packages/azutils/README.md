# Azure Utils for Azure for Visual Studio Code

Azure-specific utilities shared across the [vscode-azure](https://github.com/microsoft/vscode-azure) repository. Builds on [`@microsoft/vscode-azure-utils`](../utils/README.md) with Azure functionality.

Includes:

- **Azure SDK client wrappers** -- thin wrappers around the Azure SDKs (resources, deployments, ACR, web apps, subscriptions) with shared pipeline setup via `createAzureClient`.
- **Resource models** -- `AzureNode`, `GenericResource`, `AzureNodeId`, and grouping/virtual-resource helpers.
- **Authentication** -- `VsCodeExtensionCredential` for acquiring Azure tokens.
- **Pick experiences & wizard steps** -- reusable steps for choosing a subscription, resource group, resource, or location.
