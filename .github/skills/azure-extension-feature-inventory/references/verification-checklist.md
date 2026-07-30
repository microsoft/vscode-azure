# Verification Checklist

Before declaring the inventory done, confirm each item. Report gaps explicitly rather than omitting them.

## Completeness (every declared thing appears)
- [ ] Every `package.json` `contributes.commands` entry is in the Commands table.
- [ ] Every `configuration` setting is in the Settings table (including `deprecationMessage` ones).
- [ ] Every `menus` group entry is represented, with its `when` clause captured verbatim.
- [ ] Every `submenus`, `views`, `viewsContainers`, `debuggers`, `taskDefinitions`,
      `problemMatchers`, `jsonValidation` entry present is listed.
- [ ] Every `activationEvents` and `x-azResources` entry is recorded.

## Code coverage (behavior captured)
- [ ] Every `register*` call in `activate()` is reflected in section 0 or the relevant section.
- [ ] Command ids in `registerCommands.ts` were diffed against the manifest; code-only commands are
      marked `B`.
- [ ] The exported extension API (activate return value) is enumerated.
- [ ] Every tree node type has an exact `contextValue` (incl. status + `invalid*` variants), icon,
      children source, and pagination/refresh behavior.
- [ ] Every wizard has ordered Prompt + Execute steps with priorities and validation.
- [ ] Every create/provision wizard records the complete primary/supporting resource topology, deployment
      scope, dependencies, required inputs/defaults, and outputs used after creation.

## Reconciliation quality
- [ ] Each feature has a source layer (`A`, `B`, `A+B`, or `C`).
- [ ] Orphan/dead NLS keys are listed and marked DO NOT MIGRATE (confirmed no code + no contribution).
- [ ] `commandPalette when: never` commands are noted as context-menu/programmatic only.
- [ ] `enablement` gates (`!isWeb`, `!virtualWorkspace`) recorded per command.
- [ ] Docs-only claims are marked `C` and flagged unverified; docs never removed a real feature.

## Telemetry usage (collect + analyze)
- [ ] Every instrumented feature has a derived EventName `<extensionId>/<callbackId>` (lowercased).
- [ ] The one generic query was run against `ddtelvscode` (corp-tenant auth) and its result attached
      per-feature — OR, if telemetry was unreachable, that's stated and per-feature + roll-up deeplinks are
      emitted instead.
- [ ] Each feature's usage shows the counts (external users, Succeeded/Failed/Canceled, last-seen), the
      window, and an **advisory** suggestion — never a bare Migrate/Drop verdict.
- [ ] Guardrails applied: derived-name misses reconciled (renamed/suppressed != unused); suppressed callbacks
      flagged as non-adoption signals; Canceled kept distinct from Failed; small-N/window noted.
- [ ] Non-instrumented surfaces (settings, menu containers, orphan strings) are marked "no telemetry event"
      rather than given fabricated numbers.
- [ ] A top-of-file Usage Summary (ranked table + roll-up deeplink) is present, stating cluster/window/date.
- [ ] Corporate VPN was confirmed before collecting (or the unreachable fallback path was taken).
- [ ] If the inventory is going to a **tracked/committed** folder, raw telemetry numbers are **redacted** —
      qualitative signal + suggestion + query link only; full counts kept in the session copy.

## Header hygiene
- [ ] Repo + exact commit SHA + version recorded at the top.

## Counts (sanity)
State the counts so the reader can gauge scope. To keep counts reproducible, use these **explicit definitions** (the two areas testers most often disagree on):
- **Commands** = count `package.json` `contributes.commands` (contributed) + code-only commands separately, e.g. `28 commands (27 contributed A+B + 1 code-only B + 0 manifest-without-handler)`.
- **Tree nodes** = count distinct node *types/classes* first, then report status/`invalid*`/external-regex variants separately, e.g. `13 node types + 5 invalid variants + 2 app-settings regex contracts`.
- **Wizards** = count true `AzureWizard` flows (create/delete) separately from non-wizard interactive prompt flows (e.g. create-config-file, create-function), e.g. `2 AzureWizard flows + 4 other interactive flows`.
- Also report: settings, debuggers, task providers/definitions, problem matchers, jsonValidation, menu entries, submenus, orphan NLS keys.

Example:
`N commands (M contributed + K code-only), P settings, Q node types (+ variants), R wizards (+ flows),
S debuggers, T tasks.`
If any count is 0, say so explicitly (absence is a finding, not an omission).
