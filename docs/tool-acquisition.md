# Tool Acquisition

`IToolService` (in `extensions/vscode-azure/src/tools`) finds Azure developer
tools that are already installed, and installs them when they are not. It
currently covers `azd`, `func`, and `swa`.

## Public contract

Other extensions call the `vscode-azure/acquireTool` command with a request
object and get back an absolute path:

```ts
const { executablePath } = await vscode.commands.executeCommand<AcquireToolResult>(
    'vscode-azure/acquireTool',
    { toolId: 'azd', requestingExtensionId: 'publisher.name', versionRange: '>=1.25.0' },
);
```

The command is contributed in `package.json` like any other -- that is what makes
VS Code activate the extension when another extension invokes it -- and hidden
from the Command Palette with a `when: false` entry under `menus.commandPalette`.
Requests arriving from other extensions are validated against a Zod Mini schema,
which also normalizes the optional flags, and failures throw an `Error` whose
message is meant to be read by a user.

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

Installing is serialized per tool, keyed by tool id *and* signature policy.
Requests that want *different versions* still must not drive the same package
manager at once, so a caller arriving mid-install joins the one already running
and re-checks the result against its own range: one install may satisfy several
waiting callers, and any it does not satisfy fail individually. A caller that
passed `requireSignature`, however, never joins an install that did not — it
would otherwise be handed the result of an unverified one. Resolution itself is
not shared, since it only reads.

Cancellation is per-caller: a joining caller that cancels abandons its own wait
without terminating an install another caller started.

A caller-supplied `existingPath` is returned to that caller only. It is not
recorded as the resolved path, so one extension naming its own executable cannot
redirect the binary this extension runs for its own operations.

A request may set `force` to install even when an acceptable version is already
present, which is how a tool gets updated. The extension's own install commands
do this, so "Install Azure Developer CLI" updates an existing `azd` rather than
reporting success and doing nothing.

## Adding a tool

Add the id to `ToolIds`, implement `ToolInstaller`, and bind it to
`IToolInstaller` in `extension.ts`. An installer owns its own known paths,
version probe, and installation methods; nothing about *how* a tool installs
reaches the API.

`toolInstallerHelpers.ts` carries the parts that recur: choosing among ordered
install methods and running the winner as a foreground task
(`runInstallMethod`), reading a version out of `--version` output
(`getVersionFromOutput`), and the npm global install method and bin paths.

The three installers differ enough to show the range:

| | Windows | macOS | Linux |
|---|---|---|---|
| `azd` | winget, choco, script | brew, script | script |
| `func` | install script (v5 preview) | install script | install script |
| `swa` | npm | brew (core), npm | npm |

`func` installs the **v5 preview**, which ships only through the official
install scripts -- the winget, Chocolatey, Homebrew, and npm packages all still
carry v4. Its default range is `>=5.0.0-0`, prerelease-inclusive so the preview
actually satisfies it, and a v4 install found on the machine is handed to the
script for an upgrade (`-Force` / `--force`) rather than accepted.

`swa` ships only as an npm package, so it has no Windows package-manager entry
at all.

## Verifying what gets installed

`ToolInstaller.install` receives `requireSignature`, and an installer must throw
rather than fall back to a method that cannot establish that what it downloads
came from the publisher it claims.

Package managers do this for us, which is what makes them the preferred method
rather than merely the convenient one. npm is treated as unverified: it checks
the tarball against the registry's hash over HTTPS, which detects tampering in
transit but does not establish the publisher. Install scripts piped into a shell
cannot either. Both are ordered last, and `requireSignature` skips them.

In practice winget covers the large majority of Windows machines. Where it is
absent -- Windows Server, LTSC, or a Store-blocked fleet -- a caller passing
`requireSignature` gets a clean failure rather than an unverified install. The
same is true of `swa` anywhere but macOS, and of `func` everywhere while v5
remains preview.
