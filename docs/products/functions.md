# Azure Functions

## Creation and deployment

Function App creation uses the pinned `avm/ptn/app/function-app:0.1.0` pattern
module with Flex Consumption FC1, managed identity, storage, Application Insights,
Log Analytics, and role assignments. Runtime and version selection use the shared
wizard. Workspace deployment detects `FUNCTIONS_WORKER_RUNTIME` from the selected
service's local settings, then selects its runtime version. Relative azd service
paths resolve against the selected IaC folder.

Provisioning offers Node.js, Python, .NET isolated, Java, and PowerShell stacks.
Custom handlers are not supported by the pinned provisioning module; their local
settings leave stack selection to the provisioning picker.

Deploy is available from a local Functions project, an Explorer folder, or the
command palette in a trusted, non-virtual workspace. A nested project targets its
own folder. The azd wizard hydrates existing infrastructure and environments
instead of replacing their configuration.

Remote Deploy requires an `azd-service-name` tag and an indexed azd project whose
active environment reports the selected app's ARM ID under that service's
`target.resourceIds`. Matching is case-insensitive for ARM IDs. A service name
alone cannot establish a target. Unmatched apps explain the requirement and offer
workspace deployment; dismissing the offer makes no deployment. A match runs
`azd deploy <service>` through the shared deployment step and activity tracking.
The external contract is
[azd's show result](https://github.com/Azure/azure-dev/blob/main/cli/azd/pkg/contracts/show.go).

Completion lists management-plane HTTP invocation templates, preserving actual
routes rather than constructing `/api/<name>` URLs. Authentication query parameters
are excluded, and keys are not retrieved. Copy Function URL remains the action for
authenticated URLs. Missing endpoints and failed endpoint discovery are reported
without changing a completed deployment's status.

`function.json` and `host.json` receive the published SchemaStore schemas.
The `function.json` association applies to runtime v4 projects with file-based
bindings, including [PowerShell](https://learn.microsoft.com/azure/azure-functions/functions-reference-powershell),
[Node.js v3](https://learn.microsoft.com/azure/azure-functions/functions-reference-node#programming-model),
and [Python v1](https://learn.microsoft.com/azure/azure-functions/functions-reference-python#programming-model).
Node.js v4 and Python v2 define bindings in code instead. Programming-model
versions are distinct from the Functions runtime and Core Tools CLI versions.

## Local development tools

F5 requires Core Tools `>=5.0.0-preview.3`, acquired through the shared installer's
official v5 preview scripts. Tool acquisition remains user-action driven.
Owned hosts consume both output generators concurrently and opt into
[shared process-tree cancellation](../architecture.md#process-output-and-lifetime).

## F5 and project initialization

The `azure-functions` debugger supports Node.js, Python, Java, PowerShell,
.NET isolated, and native Go projects in trusted, non-virtual workspace folders. Initial and
dynamic configuration providers discover indexed `host.json` projects, including
nested projects. F5 and the local project's Debug action share the same provider;
neither requires `tasks.json` or `launch.json`. Multiple projects prompt for a
selection, remembering the last choice per workspace.

The initial resolution hook normalizes the configuration. VS Code substitutes
variables and runs a configured `preLaunchTask` before the substituted-variable
hook selects, validates, and starts the project. Each launch captures local settings,
launch environment overrides, and the selected Python environment or Go tool paths
once. Validation, Go compilation, and worker startup consume that launch snapshot;
subsequent launches resolve their own settings and tools. Core Tools builds ordinary
projects and restores their dependencies. `preLaunchTask` replaces compilation;
`skipBuild: true` also suppresses compilation, but Core Tools can still restore
dependencies. Go uses an extension-owned debug build.

| Runtime | Preparation | Debugger prerequisite |
|---|---|---|
| Node.js | Core Tools installs missing dependencies with `npm install` and runs the package's build script when present | Built-in JavaScript debugger (`pwa-node`) |
| Python | Core Tools installs `requirements.txt` into the selected virtual environment | Python and Python Debugger extensions; selected virtual environment |
| Java | Core Tools runs `mvn clean package`, preferring the project's Maven wrapper, and locates the staged app | Maven or its project wrapper and a matching JDK; Java debugger extension |
| PowerShell | Start the worker with a session-specific pipe | PowerShell extension |
| .NET isolated | Core Tools builds the project and resolves its output through MSBuild | Matching .NET SDK; C# extension (`coreclr`) |
| Native Go (preview) | `go build -gcflags="all=-N -l" -o bin/app .` (`app.exe` on Windows) | Go 1.24+; Go extension (`golang.Go`); Delve (`dlv`) |

Core Tools compilation and restoration output appears in the owned host task.
Go's debug build runs as a separate visible task. Java's CLI startup selects the
most recently written staged app when multiple outputs exist; offline tree
listing reports ambiguity instead of selecting an app.
The stack preparation contracts are implemented by Core Tools'
[Node](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/Node/NodeFunctionsProject.cs),
[Python](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/Python/PythonFunctionsProject.cs),
[Java](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/Java/JavaFunctionsProject.cs),
and [.NET](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/DotNet/DotNetSourceProject.cs)
workloads.
Python uses the owning extensions' public
[environment API](https://github.com/microsoft/vscode-python/blob/main/src/client/api/types.ts)
and [debugpy launcher API](https://github.com/microsoft/vscode-python-debugger/blob/061023c85cf721731569c2d0d670c129fc1f45c4/src/extension/api.ts),
including the selected executable rather than a guessed `python` command.
The selected environment must have `pyvenv.cfg`. Its root is passed as
`VIRTUAL_ENV` so Core Tools uses that environment even when it is outside the
project. Core Tools' Python workload also restores `requirements.txt` at startup.
Project settings and launch environment overrides take precedence over Python
environment defaults; the owned debugger arguments, interpreter, and virtual environment take precedence
over those overrides. The selected interpreter's directory leads `PATH`, with
case-insensitive environment variable names on Windows and case-sensitive names
on other platforms.

Native Go projects require `FUNCTIONS_WORKER_RUNTIME=native` and `go.mod`.
Go and Delve paths come from the Go extension's resource-scoped public
[tool execution API](https://github.com/golang/vscode-go/blob/master/extension/src/export.d.ts),
including workspace-specific tool paths. Both tools are checked before host
acquisition. The built-in build disables optimizations and inlining; a
replacement `preLaunchTask` or `skipBuild` must leave a debug-friendly
`bin/app` (`bin/app.exe` on Windows). Core Tools starts with `--no-build` so
it cannot overwrite that binary with an optimized build.

The native worker executable is headless
[Delve](https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_exec.md)
running `dlv exec` for the compiled application. `--continue` lets the worker
initialize while the Go extension connects with a remote `dlv-dap` attach
request. Delve listens only on the reserved IPv4 loopback port and belongs to
the host process tree, so host cleanup also terminates Delve and its target.
Attach readiness requires that the owned worker output reports Delve listening
on that exact loopback port, as well as a successful loopback probe.
Native worker executable/argument overrides in project settings are rejected;
use `debugPort` for its transport and `preLaunchTask` for a replacement build.
The extension neither searches for unrelated Go processes nor adopts/kills
existing Delve servers. Native Go scaffolding and provisioning/runtime selection
are separate migration work; code deployment uses the shared azd route with an
azd version supporting Go Functions. Custom handlers are not debugged.

Pre-debug validation requires runtime v4 settings, storage configuration, and
saved local settings. `UseDevelopmentStorage=true` requires Azurite on its three
default loopback ports; automatic emulator startup and custom proxy validation
are outside this flow. Identity-based storage settings are accepted. Core Tools
starts with `--no-azurite` to leave emulator management to the user. Host startup
uses the released v5
[run contract](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Func/Commands/Start/StartCommand.cs).
Native Go compilation/output and `--no-build` behavior follow
[GoFunctionsProject](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/Go/GoFunctionsProject.cs).
Go requires the Core Tools Go worker workload, installed with
`func workload install go-worker --prerelease`.

`LocalFunctionsHostProcess` starts `func run <project>` in an owned custom task with
available host/debugger ports, or explicit validated `hostPort`/`debugPort`
options. It passes `--no-build` for Go and for launches with `skipBuild` or
`preLaunchTask`. Node, Python, and Java attach through their worker port; PowerShell uses
its unique pipe; .NET isolated uses the structured worker PID emitted by
`--dotnet-isolated-debug --enable-json-output --output=json`.
The PID parser accepts startup events embedded in v5 NDJSON messages and the
tooling-category worker debug message, following the
[.NET output contract](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/DotNet/DotNetHostOutputInterceptor.cs).
Other workers use `--output=plain`. Workers are restricted to one per
host. Protected transport, output, build, runtime, worker-debugger, and process-count options cannot be
overridden through `hostArgs` or `env`.

Paused workers expose their debugger before the host can finish initialization.
Attach readiness has a five-minute bound when Core Tools owns the build and a
two-minute bound when compilation is skipped. HTTP readiness is polled
independently and can remain pending while startup code is paused at a breakpoint. Only an
owned host reporting HTTP state `Running` enters `LocalFunctionsHostTracker`.
Task/terminal closure, cancellation, attach failure, session termination, and
service disposal stop the owned process tree and remove its registration.
Readiness and shutdown failures are surfaced without copying settings or host
response bodies into the output channel.
Failed host tasks retain their diagnostic output and end with a nonzero exit
code after the process-tree shutdown attempt completes.

Initialize Project for VS Code selects a missing worker runtime and appends
workspace extension recommendations. Supported runtimes offer an optional
`azure-functions` launch entry for customization or compound launches. JSONC
comments, existing entries, and unrelated properties are preserved; malformed,
duplicate-property, and dirty files are rejected. Initialization refreshes the
selected project without evicting unrelated projects. Custom handlers receive
recommendations and an explanation of the supported debugging runtimes.
Runtime selection, recommendation editing, and the optional launch offer are
separate stages. Recommendation IDs are matched case-insensitively while
preserving the existing file's spelling.

The debugger schema and snippets expose `projectPath`, `hostArgs`, `env`,
`hostPort`, `debugPort`, and `skipBuild`; standard `preLaunchTask` and
`postDebugTask` options also apply. Existing project tasks/configurations are
untouched. Project/function scaffolding and gallery-backed quickstarts are
deferred; Slice 5 records their future CLI v5 ownership.

## Local workspace tree

`FunctionsWorkspaceDataProvider` discovers projects through the shared workspace
index's `host.json` tags. Nested projects have workspace-relative labels.
Functions appear directly beneath their owning project, without a grouping node.

`FunctionsProjectReader` uses a registered, ready local host as the authoritative
source of function metadata. Offline script-model projects use immediate-child
`function.json` files. Code-first projects without file metadata show a
"Start debugging to update this list..." hint; language source is not parsed.
This distinction follows the
[Node programming-model contract](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?pivots=nodejs-model-v4).
`host.json.functions`, when supplied, limits the visible function names.

Offline .NET isolated projects read the most recently modified
`functions.metadata` under `bin`, with path ordering as a tie-breaker. The
[Worker SDK copies this metadata into the build output](https://github.com/Azure/azure-functions-dotnet-worker/blob/main/sdk/Sdk/Targets/Microsoft.Azure.Functions.Worker.Sdk.targets).
Java projects read immediate-child `function.json` files under the single
packaged app in `target/azure-functions`, following the Maven plugin's
[staging-directory contract](https://github.com/microsoft/azure-maven-plugins/blob/975dd140d802c0fcb4fd61f4083095e6d299f7be/azure-appservice-maven-plugin-lib/src/main/java/com/microsoft/azure/maven/appservice/AbstractAppServiceMojo.java)
and [package step](https://github.com/microsoft/azure-maven-plugins/blob/975dd140d802c0fcb4fd61f4083095e6d299f7be/azure-functions-maven-plugin/src/main/java/com/microsoft/azure/maven/function/PackageMojo.java).
Precompiled listings include a build hint because output can be stale.
Multiple Java app outputs produce an actionable error rather than choosing one.

Generated output stays excluded from the shared source index. Output watcher
events are debounced for 250 milliseconds and refresh each affected project once
per burst. Explicit output reads are bounded to 2,000 directory entries and four
descendant-directory levels, skipping symbolic links and the `.azurefunctions`,
`lib`, and `runtimes` dependency directories. Exceeding these limits is a visible listing error.
Custom build-output locations require the running-host path.

Malformed functions remain visible beside readable siblings. Project validation
shows invalid metadata or a missing worker runtime without putting local settings
values in nodes. Invalid and hint nodes offer workspace refresh only.
Source metadata, local settings, and project-file changes use the shared index
watcher. A separate string-glob subscription matches `bin` and `target`
directories and their descendants, including directory deletion events;
generated-output and host-registration events invalidate the affected project
subtree. Workspace refresh invalidates the complete workspace tree.

## Local actions and host ownership

The local tree reuses Execute Function, Copy Function URL, Enable, and Disable.
Local actions require a file project in an open, trusted workspace; workspace
menus are gated independently of the same commands' remote resource actions.
Programmatic calls validate the project, and invocation rechecks it after the
input prompt.
Execute and HTTP URL copying require a ready host registered for the exact
project URI and port. `LocalFunctionsHostTracker` owns registrations, not host
processes: disposal of an older registration cannot remove its replacement.
`LocalFunctionsHostProcess` starts Core Tools, waits for readiness, and populates
this registry for debugging.
An arbitrary process on the default port is not treated as this project's host.

Local execution submits raw input through `FunctionsHostClient` without Azure
authentication or recent-input persistence. Copy URL reads current host metadata,
validates the HTTP trigger, and uses its actual invocation template, preserving
custom routes. Only HTTP loopback URLs on the registered port, without embedded
credentials, are accepted. No authentication key is manufactured.

Enable and Disable edit only `Values["AzureWebJobs.<FunctionName>.Disabled"]` in
`local.settings.json`. `LocalFunctionSettings` uses the shared `JsoncSettingsFormat`
validation and surgical JSONC edits, preserving comments, unrelated settings,
`Host`, and `ConnectionStrings`. Missing files receive a `Values` object.
`LocalFunctionSettings` reads `Values` setting names case-insensitively and
preserves existing key casing during JSONC edits.
Encrypted, malformed, duplicate-property, and dirty files are rejected before
writing. Successful writes refresh the owning project and explain that the host
must restart to apply the setting. Settings values are neither uploaded nor
displayed in a local settings tree. See the
[local settings contract](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local#local-settings-file)
and [disable-function setting](https://learn.microsoft.com/en-us/azure/azure-functions/disable-function).

The project tree offers initialization when its worker runtime is missing and
debugging for supported runtimes. Project/function creation is deferred in Slice 5;
initialization configures existing projects, not new source/template generation.

## Remote resources tree

Function Apps are identified by `FunctionAppLogicalType`, not by the shared
`Microsoft.Web/sites` ARM type. `FunctionAppDataProvider` owns site enrichment,
settings children, and remote function data. The Functions data and view
providers are registered before their shared Web App fallbacks.

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
before terminal creation. Later polling failures finish the terminal with a
nonzero exit code while retaining its error output; opening the stream again
starts a fresh active session.

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
