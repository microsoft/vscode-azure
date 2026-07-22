# Inventory Template

Write `INVENTORY.md` in this section order. Use tables. List every item explicitly — never "etc." or
"and others". Keep exact ids and `contextValue` strings verbatim (they are the migration contract).

```markdown
# <Extension displayName> — Feature Inventory

Source: `microsoft/<repo>` @ <ref> (<commit SHA>), v<version>, publisher `<publisher>`.
Method: reconcile package.json + package.nls.json + code (activate/registerCommands + src) + docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

## 0. Extension-level shape
- extensionDependencies: <...>
- activationEvents (A): <list>
- capabilities: virtualWorkspaces = <...>; command gates in use (!isWeb / !virtualWorkspace)
- x-azResources (A): branches <type>; create commands; activation.onResolve <ARM types>
- Exported extension API (B): <return value of activate(); methods/properties/events>
- Activation wiring (B): <providers, resolvers, task/debug/language registrations, auth session, telemetry>
- Telemetry (B): <notable custom telemetry>

## 1. Commands (A + B)
| Command id | Title | Layer | Notes / enablement / when |
|---|---|---|---|
| ... | ... | A+B | ... |
> Code-only commands (B, not in manifest): <list with where they're invoked>
> Orphan strings (flag, DO NOT migrate): <dead NLS keys>

## 2. Settings / Configuration (A)
| Setting id | Type | Scope | Default | Notes (deprecation, enum, code usage) |
|---|---|---|---|---|

## 3. Tree view (A branch + B behavior)
- Registered under views: <view ids>. Resolver: <class> for ARM `<type>`.
- Hierarchy with exact contextValues (nested code block).
- Per-node: label/description, contextValue(s) incl. status + invalid variants, icon, click command,
  children source, pagination, refresh/polling.
- Menus (A): view/title, view/item/context (with when clauses), commandPalette hides.
- Submenus (A): <id> and its members.

## 4. Debugging + tasks (A + B)
- Debuggers (A): <types/labels>.
- Debug provider behavior (B): provide/resolve, validation gates, companion sessions.
- Task providers (B): task type, background, generated command + flags, env.
- problemMatchers (A): <name + background patterns>. Dev-server/emulator addresses.

## 5. Wizards (B)
- For each wizard: ordered Prompt steps (prompt/default/validation), ordered Execute steps (priority),
  basic-vs-advanced deltas, post-execution, telemetry.
- Build presets table (framework → app/api/output/port/startCommand).
- Framework detection (what it inspects, what it emits).

## 6. Config-file features (A + B)
- jsonValidation schemas (A). Scaffolding + parsing commands (B). Related config files.

## 7. External integrations (B)
- CLI lifecycle, SDK/API clients, git/GitHub/auth, custom viewers/providers.

## 8. Docs layer (C) — supplementary only
- Doc URLs consulted; features described only in docs (unverified); noted gaps (404s, omissions).

## Migration-relevant cross-cutting notes
- Host-API dependence, shared-lib coupling, and anything that maps onto the monorepo's DI /
  DataItemTree-ViewItemTree / ManagedCommand / wizard conventions.
```

## Placement

- Default: write to the current session's artifacts dir, or a path the user specifies.
- If a migration workspace exists, offer to place it there (e.g. `docs/migrations/<service>-inventory.md`).
- Always print the final path.
