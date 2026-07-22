# Code Surfaces (behavioral layer, `B`)

The manifest cannot express behavior. Read the code to capture what the extension actually *does*. For a
large extension, parallelize the five areas below with independent `explore` subagents, each pointed at
the cloned temp dir with an explicit file list.

> When delegating to `explore`: give the absolute temp path, the exact files to read, and instruct it to
> report **features + exact `contextValue`/command-id strings**, not code blocks. Subagents are stateless
> — provide full context in each prompt.

## 1. Activation wiring + exported API (`extension.ts`)

Read `activate()` and record **every** side effect:
- Each `register*` call: `registerCommand(s)`, `registerDebugConfigurationProvider` (note the `type` and
  the `DebugConfigurationProviderTriggerKind` — Dynamic/Initial), `registerTaskProvider`,
  `registerFoldingRangeProvider` / other language providers (note custom URI `scheme`s),
  `registerApplicationResourceResolver` (the `AzExtResourceType` → ARM type mapping).
- Authentication sessions requested at startup (e.g. silent `getSession` that adds an accounts badge).
- Experimentation / telemetry service creation, output channel.
- **The return value of `activate()`** — this is the extension's public API surface. Trace the returned
  object/provider and enumerate its methods, properties, and events (e.g. `revealTreeItem`, git-provider
  registration, `onDid*` events). Cross-check against any `*.api.d.ts` file.

## 2. Code-only commands (`registerCommands.ts`)

List every `registerCommand*` id and compare to `package.json` `commands`. Any id present here but **not**
in the manifest is a **code-only command (`B`)** — a real feature. Watch for:
- Documentation/help commands that just `openUrl(...)`.
- Commands referenced as a tree item's click `commandId` but never contributed to a menu or palette.
- `registerReportIssueCommand`, error handlers (e.g. suppressing the default Report Issue button),
  debounce args, and `...WithTreeNodeUnwrapping` variants.

## 3. Tree view (`src/tree/**`, `*Resolver.ts`)

Produce the full node hierarchy as a nested tree. For **each** node type capture:
- Display label + description logic.
- **Exact `contextValue` string(s)** — including dynamic/status variants (e.g.
  `...ActionCompleted` vs `...ActionInProgress`) and error variants (`invalid*`, `parseYamlError*`).
  These are the migration contract with menus; copy verbatim.
- Icon (theme icon id or resource path), `collapsibleState`, click `command`.
- Children source (SDK iterator, Octokit, filesystem scan), pagination (`hasMoreChildren`/load-more),
  and refresh/polling behavior (e.g. in-progress runs re-fetched).
- Error handling wrapper (e.g. `createTreeItemsWithErrorHandling` → `invalid*` context values).
- The resolver: which `AzExtResourceType` / ARM type (`microsoft.*/...`) it resolves and the resolved
  interface shape.

## 4. Wizards (`src/commands/<create|delete|...>/**`)

For each wizard (create, create-advanced, delete, and any sub-wizards like create-repo / create-function):
- The **ordered** `AzureWizardPromptStep`s: what each prompts, default source (workspace setting → preset
  → hardcoded), validation rules, and conditional `shouldPrompt`.
- The **ordered** `AzureWizardExecuteStep`s with their `priority` numbers and what each does.
- Basic-vs-advanced deltas (which prompts are auto-filled vs shown).
- Post-execution behavior (polling, success prompts with action buttons).
- Telemetry properties/measurements captured.
- Supporting data: build presets (framework → app/api/output/port/startCommand), framework detectors
  (which files/deps they inspect, what they emit), and any scaffolding templates.

## 5. Integrations

- **External CLI lifecycle**: install/update/uninstall a global npm package, version detection,
  min-version + latest-version checks, activation-time warnings gated by a setting.
- **Task providers**: task `type`, background flag, generated command line + flags, env vars, and the
  problem matcher used; emulator/dev-server addresses.
- **Debug providers**: `provideDebugConfigurations` (from config file + detected apps) and
  `resolveDebugConfiguration` (validation gates, auto-starting companion debug sessions).
- **Config files**: scaffolding (`create*ConfigFile`) and parsing (`tryGet*Config`), plus
  `jsonValidation` schemas from the manifest; note related files (e.g. a DAB / database config).
- **SDK/API clients**: which Azure SDK (`@azure/arm-*`) and which operations; `IAppSettingsClient` or
  similar wrappers; prod-vs-staging variants.
- **Git / GitHub / auth**: auth provider id + scopes, Octokit usage (Actions monitor/rerun/cancel, repo
  create/fork), custom log viewers/content providers, git abstraction (VS Code Git API vs Remote Repos).

Mark everything found here source layer `B`. Phase 4 merges with `A` items.
