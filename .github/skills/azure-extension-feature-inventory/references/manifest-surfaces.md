# Manifest Surfaces (declarative layer, `A`)

Enumerate **every** entry — do not summarize or sample. Read `package.json` fully (it can exceed 20KB;
use ranged reads or fetch the raw file). Resolve every `%key%` against `package.nls.json`.

## Extension-level shape (outside `contributes`)

- `name`, `displayName`, `version`, `publisher`, `preview`, `engines.vscode`.
- `extensionDependencies` — which host/peer extensions it needs (almost always
  `ms-azuretools.vscode-azureresourcegroups`).
- `activationEvents` — list each; note `onDebug*`, `workspaceContains:**/<file>`, `onCommand:*`,
  `onView:*`, `onResolve*`.
- `capabilities.virtualWorkspaces` / `untrustedWorkspaces` — support level.
- `x-azResources` — Azure Resources API integration: `azure.branches[].type`, `commands[]`,
  `activation.onResolve[]` (the ARM types this extension resolves), `workspace` contributions.

## `contributes` — enumerate each of these that is present

| Key | Capture per entry |
|-----|-------------------|
| `commands` | `command` id, resolved `title`, `category`, `icon`, `enablement` |
| `configuration` (settings) | full setting id, `type`, `scope`, `default`, `description`, `deprecationMessage`, enum + enumDescriptions |
| `menus` | for each menu group (`view/title`, `view/item/context`, `commandPalette`, `explorer/context`, `editor/title`, ...): the `command`/`submenu`, `when`, `group`. **Copy `when` clauses verbatim** — the `contextValue` regexes are the command→node contract. Note `commandPalette` entries with `when: never` (context-menu-only commands). |
| `submenus` | id, label, icon, and which menu hosts it |
| `views` / `viewsContainers` | view id, name, containing container, `when` |
| `debuggers` | `type`, `label`, `configurationAttributes`, `initialConfigurations`, `configurationSnippets` |
| `taskDefinitions` | `type`, required/optional properties |
| `problemMatchers` | `name`, `owner`, background `beginsPattern`/`endsPattern` |
| `jsonValidation` | `fileMatch` → schema `url` |
| `keybindings`, `languages`, `grammars`, `walkthroughs`, `viewsWelcome` | capture if present |

## NLS cross-reference (`package.nls.json`)

1. Every `%key%` in `package.json` resolves to a string here — use it for titles/descriptions.
2. **List every NLS key that the manifest does NOT reference.** These are *candidate orphans*. Do not
   conclude they're dead yet — some are used only from code via `localize('key', ...)`. They get
   resolved in Phase 4 (Reconciliation): a key with no manifest use AND no code reference is DEAD.

## Output of this phase

A per-surface list with exact ids/keys and resolved strings, ready to be merged with the code layer.
Mark each item's source layer `A` for now; Phase 4 upgrades items to `A+B` when code adds behavior.
