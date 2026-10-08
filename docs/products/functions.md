# Azure Functions

## Remote resources tree

Function Apps are identified by `FunctionAppLogicalType`, not by the shared
`Microsoft.Web/sites` ARM type. `WebAppDataProvider` owns site enrichment and
remote function data. `FunctionAppViewProvider` renders Function Apps before
the shared Web App fallback provider.

A readable Function App has Application Settings followed by a Functions
group. The settings node uses `getSettingsNodes` and `WebAppSettingsAdapter`;
setting values are edited in a document, not displayed in the tree.

The Functions group lazily lists management-plane function metadata through
`WebAppClient.webApps.listFunctions`. Page boundaries and `hasMore` flags are
preserved for the shared tree's pagination. Function leaves show their trigger,
HTTP access level when reported, and disabled state. Azure's `isDisabled`
value takes precedence over the configuration's `disabled` flag.

Site enrichment mutates the cached resource in place, preserving its tree
identity. Non-running state is shown in the description. Flex Consumption is
identified by the site's `functionAppConfig`, following the
[source resource contract](https://github.com/microsoft/vscode-azurefunctions/blob/801689c66f96b31bc9d7c79ff6cc8d65e41b6965/src/tree/ResolvedFunctionAppResource.ts).
The matching Function App SVG is resolved through the shared logical-type icon
convention. A reported hostname enables the shared Browse Website action.

## Errors and refresh

A failed site read marks the app invalid, clears its website capability and
site metadata, and exposes an error child. A malformed function remains a
visible error leaf beside readable siblings. A failed listing exposes an
error child without discarding pages already loaded. Error tooltips retain
the failure details; logs identify the failed operation without copying
service responses or settings.

Invalid nodes expose only the shared refresh action. Refresh invalidates the
resources tree, including failed reads and loaded function pages, and clears
the shared account, tenant, and subscription listing cache. Successful retries
clear the error state and rebuild the children. Title-bar and context-menu
refresh use the same global action.

Resource selection uses `ResourceSelector` and ordinary `AzureNodeId` keys.
Functions have the Functions group as their view parent, while settings and
the group are children of the ARM resource.
