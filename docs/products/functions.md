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

## Remote actions

Start, Stop, and Restart use the shared `WebAppLifecycle` command, also used by
App Service and Logic App sites. Running sites offer Stop and Restart; stopped
sites offer Start. Unknown or transitional states have no lifecycle action.
Successful operations invalidate the selected site's subtree.

Execute Function prompts for raw input without saving it in recent-input
history. `FunctionsHostClient` submits the input to the host admin API using a
lazy management-plane master key in the `x-functions-key` header. The notification
reports acceptance, not completion. See the
[host invocation contract](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Controllers/FunctionsController.cs).

Copy Function URL is available for HTTP triggers. The command reads current
metadata, removes existing `code` parameters, and copies an HTTPS URL. Anonymous
functions need no key. Function-authenticated functions use a function key,
falling back to a host function key. Admin-authenticated functions require modal
confirmation before reading and copying the app-wide master key. Keys and URLs
are excluded from notifications and output-channel logging.

Enable and Disable preserve other application settings while writing
`AzureWebJobs.<FunctionName>.Disabled` through `WebAppSettingsAdapter`.
[Azure restarts the app when settings change](https://learn.microsoft.com/en-us/azure/azure-functions/disable-function).
Delete Function requires confirmation, tracks completion or failure in the
activity tree, and removes the cached function only after a successful ARM delete.
App deletion, portal navigation, website browsing, properties, and settings
document editing use the shared commands.

Go to Managed Identity reads the site's user-assigned identity ARM IDs. A single
identity is revealed directly; multiple identities prompt for selection.
`RevealResource` preserves cloud, account, and tenant context while navigating
across resource groups or subscriptions. Filtered or inaccessible targets produce
an actionable error.

## Application Insights log terminal

`FunctionAppLogStream` uses the shared `LogStreamTerminal` pseudoterminal also used
by Container Apps. Concurrent starts share initialization, existing sessions are
focused instead of duplicated, and terminal closure or service disposal cancels
polling and pending log queries. Discovery and initial-query failures occur
before terminal creation. Later failures remain visible in the terminal; opening
the stream again starts a fresh session.

The service reads the instrumentation GUID from
`APPLICATIONINSIGHTS_CONNECTION_STRING`, lists Application Insights components,
and compares their live ARM properties. It checks the app's subscription first,
then accessible subscriptions under the same account and tenant. Queries use the
component's subscription identity and cloud, not the connection string's ingestion
endpoint. Missing configuration, missing resources, and explicit permission
failures are surfaced.

The terminal polls every ten seconds. Queries normalize workspace
[`AppTraces`](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apptraces)
and [`AppRequests`](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apprequests),
and their classic `traces`/`requests` aliases. Results are filtered by cloud role
name matching the Function App name. Telemetry using a different custom role is
outside this view. Trace messages and request
names are printed with their event timestamps.

The initial ingestion lookback is five minutes. Each poll overlaps the
high-water ingestion timestamp by five minutes and deduplicates record IDs in
that window, including equal-time and sub-millisecond boundaries. Empty polls do
not advance the high-water mark. The query interval also limits event timestamps
to the preceding two days. This is a bounded log viewer, not an exactly-once
archive: [ingestion time is approximate](https://learn.microsoft.com/en-us/kusto/query/ingestion-time-function?view=azure-monitor),
and records outside those windows are not recovered. Malformed schemas and
explicit partial query failures stop the stream rather than returning an empty
success.

Logs are subject to [Application Insights ingestion delay](https://learn.microsoft.com/en-us/azure/azure-functions/analyze-telemetry-data)
and telemetry sampling. The terminal is not the Application Insights Live Metrics
stream. Connection strings, log rows, and request bodies are not copied into the
output channel.
