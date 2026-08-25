# Tool Acquisition

`IToolService` (in `extensions/vscode-azure/src/tools`) finds Azure developer
tools that are already installed, and installs them when they are not.

## Public contract

Other extensions call the `vscode-azure/acquireTool` command with a request
object and get back an absolute path:

```ts
const { executablePath } = await vscode.commands.executeCommand<AcquireToolResult>(
    'vscode-azure/acquireTool',
    { toolId: 'azd', requestingExtensionId: 'publisher.name', versionRange: '>=1.25.0' },
);
```

The command is not contributed to the Command Palette, so an `onCommand`
activation event keeps it callable before the extension has activated. Requests
arriving from other extensions are validated field by field, and failures throw
an `Error` whose message is meant to be read by a user.

The extension's own install commands are that same `AcquireTool` command
registered with a `userToolRequest('<toolId>')` prefix argument, which asks for
the tool's default version range, forces the install so an existing tool is
updated, and shows progress with a revealed install task.

## Resolution

`acquire()` looks for a usable executable in order: the caller's `existingPath`,
the `PATH`, then the locations the installer declares. Each candidate is
version-checked by actually running it. Only if nothing acceptable is found does
the tool get installed, after which the same search runs again -- package
managers often install somewhere that is not on the current process's `PATH`, so
re-checking known locations is what makes the tool usable without a reload.
`getResolvedPath()` hands that path to callers such as `AzdService`.

Concurrent requests for the same tool and version range share one install, so
two callers cannot race the same package manager.

A request may set `force` to install even when an acceptable version is already
present, which is how a tool gets updated. The extension's own install commands
do this, so "Install Azure Developer CLI" updates an existing `azd` rather than
reporting success and doing nothing. Forced requests do not share an install
with unforced ones, which may stop at a merely acceptable version.

## Adding a tool

Add the id to `ToolId`, implement `ToolInstaller`, and bind it to
`IToolInstaller` in `extension.ts`. An installer owns its own known paths,
version probe, and installation methods; nothing about *how* a tool installs
reaches the API.

## Verifying what gets installed

`ToolInstaller.install` receives `requireSignature`, and an installer must throw
rather than fall back to a method that cannot establish that what it downloads
came from the publisher it claims.

Package managers do this for us. Where a platform offers only an install script,
the installer verifies it directly if it can: the Windows script is downloaded,
checked for a valid Microsoft Authenticode signature, and only then run.
PowerShell's execution policy is deliberately not relied on for this -- it does
not apply to `-Command`, and `AllSigned` further requires the publisher be
enrolled in the machine's `TrustedPublisher` store, which Microsoft is not by
default, so a validly signed script would still prompt or fail. The Linux/macOS
shell script has no equivalent, so it stays unverified and runs only after a
warning to the output channel.
