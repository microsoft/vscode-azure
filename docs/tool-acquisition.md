# Tool Acquisition

Azure developer tools are resolved and installed through
`IToolAcquisitionService` in `packages/azutils/src/tools`. The service is
independent of command presentation: it reports neutral progress events while
the extension decides whether to show a notification, write to the output
channel, or remain silent.

## Public contract

External extensions call the hidden `vscode-azure/acquireTool` command with one
request object. The request includes:

- A supported tool identifier and its typed tool-specific options
- The requesting extension ID
- An optional semver range
- An optional absolute executable path
- An optional target architecture
- Signature-verification policy
- Optional cancellation and progress callbacks

The command returns the absolute executable path, resolved version, acquisition
method, and whether installation occurred. It is not contributed to the Command
Palette. User-facing commands, such as `vscode-azure/installAzd`, call this same
command with notification progress enabled.

Programmatic requests are silent by default. Invalid input and acquisition
failures reject with `ToolAcquisitionError`; user-facing commands translate
those structured errors into localized messages and actions.

## Resolution and installation

The coordinator checks candidates in this order:

1. The request's explicit executable path
2. The current process `PATH`
3. Known locations declared by the tool definition
4. The first applicable installation strategy

`IProcessExecutor.resolveExecutable()` uses `@azure/core-process` to return an
absolute path and supports Windows command shims. Every candidate is version
probed before it is returned. After installation, the coordinator repeats PATH
and known-location discovery so a package manager that updates PATH cannot
cause a false failure in the current extension host.

Equivalent in-flight requests are coalesced to avoid racing package managers.
Each caller may stop waiting independently; the shared process is cancelled only
after no callers remain. The initial implementation acquires tools for the
extension host architecture and rejects a different requested architecture.

When `requireSignature` is explicitly `true`, acquisition fails unless an
applicable strategy provides signature verification or an equivalent trust
guarantee. When the field is omitted, verified strategies remain preferred, but
an unverifiable fallback may continue after reporting a warning.

## Adding a tool

Add the tool identifier and options to `ToolOptionsMap`, extend the centralized
runtime validator, and register a `ToolDefinition`. A definition supplies:

- Friendly metadata and executable name
- Known executable locations
- Version probing and parsing
- Ordered, platform-aware installation strategies
- Signature-verification metadata for each strategy

The initial registry contains only Azure Developer CLI (`azd`). Additional tools
should not require changes to the acquisition coordinator.

Successful acquisition paths are retained by the service for the current
extension-host lifetime. AZD command execution reads that path so an executable
found outside the original process PATH remains usable after acquisition.
