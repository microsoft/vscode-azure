# Inventory Template

Write `INVENTORY.md` in this section order. Use tables. List every item explicitly — never "etc." or
"and others". Keep exact ids and `contextValue` strings verbatim (they are the migration contract).

```markdown
# <Extension displayName> — Feature Inventory

Source: `microsoft/<repo>` @ <ref> (<commit SHA>), v<version>, publisher `<publisher>`.
Method: reconcile package.json + package.nls.json + code (activate/registerCommands + src) + docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: collected from `cluster('ddtelvscode')` (window: <e.g. 90d>; collected <date>). See the Usage Summary section below. Roll-up deeplink: [all events, external usage](<adx-deeplink>)

## 0. Extension-level shape
- extensionDependencies: <...>
- activationEvents (A): <list>
- capabilities: virtualWorkspaces = <...>; command gates in use (!isWeb / !virtualWorkspace)
- x-azResources (A): branches <type>; create commands; activation.onResolve <ARM types>
- Exported extension API (B): <return value of activate(); methods/properties/events>
- Activation wiring (B): <providers, resolvers, task/debug/language registrations, auth session, telemetry>
- Telemetry (B): <notable custom telemetry>. EventName convention: `<extensionId>/<callbackId>` (lowercased). Per-feature usage is collected once via the generic query and shown in the Usage Summary + each feature's Telemetry cell.

## 1. Commands (A + B)
| Command id | Title | Layer | Telemetry | Notes / enablement / when |
|---|---|---|---|---|
| ... | ... | A+B | E:<extUsers> · ok<n>/fail<n>/cancel<n> · <suggestion> [usage](<deeplink>) | ... |
> Telemetry cell = collected usage for EventName `<extId>/<commandId>` (lowercased): external users, result split, and an **advisory** suggestion (`lean Migrate` / `candidate Drop` / `needs a human` / `no data — verify`). `-` if no callback. `[usage]` drills into ADX. Numbers only — the Migrate/Drop call is the human's.
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
- For each create/provision wizard, include a provisioning record:
  - primary ARM resource type, supporting ARM resource types, deployment scope, and dependencies;
  - source step responsible for each resource;
  - required provisioning inputs/defaults, tags/configuration, outputs, and post-create consumers.
  Keep this factual; AVM resource-vs-pattern selection is performed by the migration skill.
- Build presets table (framework → app/api/output/port/startCommand).
- Framework detection (what it inspects, what it emits).

## 6. Config-file features (A + B)
- jsonValidation schemas (A). Scaffolding + parsing commands (B). Related config files.

## 7. External integrations (B)
- CLI lifecycle, SDK/API clients, git/GitHub/auth, custom viewers/providers.

## 8. Docs layer (C) — supplementary only
- Doc URLs consulted; features described only in docs (unverified); noted gaps (404s, omissions).

## 9. Usage Summary (telemetry) — WORKING COPY ONLY, do not commit raw numbers
- Cluster / window / collected-on: `ddtelvscode` · <window, e.g. 90d> · <date>. (If telemetry was
  unreachable — e.g. not on VPN — say so here and provide the roll-up + per-feature deeplinks instead of numbers.)
- Ranked usage table (from the one generic query). **This table with raw counts stays in the session/working
  copy only.** Before committing `INVENTORY.md` to a tracked folder, replace the counts with a qualitative
  band + suggestion + link (see Placement):

| EventName | Feature | ExternalUsers | Succeeded | Failed | Canceled | LastSeen | Suggestion |
|---|---|---|---|---|---|---|---|
| `<extId>/<callbackId>` | <feature> | <n> | <n> | <n> | <n> | <date> | lean Migrate |

- Notes: features whose derived EventName had **no** result row (verify renamed/suppressed, not "unused");
  framework/plumbing rows with no user feature (e.g. `call-tas-error`, `resolveresource`); any suppressed
  callbacks flagged in Phase 3.

## Migration-relevant cross-cutting notes
- Host-API dependence, shared-lib coupling, and anything that maps onto the monorepo's DI /
  DataItemTree-ViewItemTree / ManagedCommand / wizard conventions.
```

## Placement

- **Default (not optional): `docs/migrations/<service>/INVENTORY.md` in the target repo, committed.** The
  inventory is the migration's contract, so it is tracked alongside the code it drives. `TRIAGE.md` and
  `MIGRATION-PLAN.md` (produced later by the migration skill) live in that same folder. The migration skill
  treats a missing tracked inventory as a hard stop.
- **Before committing, redact raw telemetry** (per `.github/copilot-instructions.md`): keep the advisory
  suggestion, a qualitative rationale ("low external usage per telemetry"), and the ADX deeplink; strip the
  ExternalUsers/Succeeded/Failed/Canceled counts and the Usage Summary numbers.
- Keep the full-number working copy in the session artifacts dir only. Never commit it, and never move it
  into the tracked folder.
- A user-specified path overrides the default only if they ask; say explicitly that the migration skill needs
  a tracked copy before it can start.
- Always print both paths (committed + session working copy).
