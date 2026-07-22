# Source Acquisition

Goal: get a browsable copy of the source extension at a **pinned, recorded ref**, plus a map of its code.

## 1. Identify the extension and repo

Azure VS Code extensions published by `ms-azuretools` follow the naming `vscode-azure<service>`; their
repos live under `github.com/microsoft/vscode-azure<service>`. Common examples:

- `vscode-azurestaticwebapps`, `vscode-azurefunctions`, `vscode-azurevirtualmachines`,
  `vscode-azuredatabases`, `vscode-azurestorage`, `vscode-azureappservice`, `vscode-azurecontainerapps`.

If the user only names a service, confirm the exact repo before cloning. If a checkout already exists
locally, prefer it (but still record the commit SHA).

## 2. Clone to a temp dir (outside the monorepo)

Never clone into the monorepo working tree. Use the OS temp dir. On Windows PowerShell:

```powershell
$dest = Join-Path $env:TEMP '<repo>-src'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
git clone --depth 1 https://github.com/microsoft/<repo>.git $dest
git -C $dest rev-parse HEAD   # RECORD THIS SHA in the inventory
```

`--depth 1` is fine for inventory. If the user wants a specific tag/branch, add `--branch <ref>`.

## 3. Map the code surfaces

List the source files so you know where each feature category lives:

```powershell
Get-ChildItem -Recurse -File $dest\src |
  Where-Object { $_.Extension -in '.ts','.json' } |
  ForEach-Object { $_.FullName.Substring($dest.Length+1) } | Sort-Object
```

Typical directories to expect and what they contain:

| Dir / file | Feature category |
|------------|------------------|
| `src/extension.ts` | activation wiring, provider registration, exported API |
| `src/commands/registerCommands.ts` | command → handler registration (incl. code-only commands) |
| `src/commands/**` | command implementations, wizard step folders |
| `src/tree/**` | tree item hierarchy + `contextValue`s |
| `src/*Resolver.ts` | Azure Resources ARM-type resolver |
| `src/debug/**`, `src/vsCodeConfig/**` | debug config providers, launch/tasks generation |
| `src/cli/**` | external CLI integration + task providers |
| `src/detectors/**`, `src/buildPresets/**` | framework detection, scaffolding presets |
| `src/utils/**` | telemetry, git, azure clients, settings helpers |
| `src/*.d.ts` | exported extension API typings |
| `package.json`, `package.nls.json` | declarative surfaces + strings |

Record: repo, commit SHA, extension `name`/`displayName`/`version`/`publisher`, and
`extensionDependencies`. These go at the top of `INVENTORY.md`.
