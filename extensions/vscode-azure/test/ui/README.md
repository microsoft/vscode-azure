# UI tests (Playwright)

These tests drive the **real VS Code workbench** with the extension loaded and the Azure
services rebound to mock data, so tree rendering, view titles, and command wiring are
covered end to end without any Azure auth or network access.

Everything here is built on the existing `AZURE_MOCK_DATA=1` mode (see
[`test/override/mock.ts`](../override/mock.ts)). Every label asserted in a spec comes from
that file -- change the mock data and the specs should fail loudly.

## Layout

```
test/ui/
  fixtures/
    paths.ts               shared paths + the mock-data environment
    vscodeExecutable.ts    resolves/downloads desktop VS Code
    vscodeApp.ts           Playwright fixtures: `workbench` (Page) and `wb` (Workbench)
    workbench.ts           helpers: runCommand, focusView, treeItem, expandTreeItem, ...
    vscodeServer.ts        downloads + runs the VS Code *server* build (web mode)
    harnessExtension.ts    packages + installs the extension into that server
  resourcesTree.spec.ts    the Azure Resources / Activity tree suite
  serveWeb.ts              `ui:serve` -- the interactive harness
  workspace/               the folder the desktop run opens
```

Specs are named `*.spec.ts`, not `*.test.ts`, so the `@vscode/test-cli` mocha runner
(which globs `test/**/*.test.ts`) never picks them up.

## Running

```bash
pnpm --filter vscode-azure run build      # the tests run the built extension
pnpm --filter vscode-azure run test:ui        # desktop VS Code (Electron)
pnpm --filter vscode-azure run test:ui:web    # browser-hosted VS Code server
pnpm --filter vscode-azure run test:ui:report # open the HTML report
```

The same specs run in both projects. Notes:

- Electron has no headless mode, so `test:ui` opens a real VS Code window. It is
  non-interactive and closes itself.
- The first run downloads VS Code (~1 GB) and, for web mode, the server build (~200 MB),
  both into `.vscode-test/`. Run `pnpm run link-test-cache` once to share that across
  worktrees, and do not run the UI suite concurrently with `pnpm run test` in a linked
  worktree -- they share the cache.
- On failure, a screenshot and a Playwright trace are attached to the report.
  `pnpm --filter vscode-azure run test:ui:report`, or
  `pnpm exec playwright show-trace test-results/artifacts/<test>/trace.zip`.

## Interactive harness (for Copilot / manual poking)

```bash
pnpm --filter vscode-azure run ui:serve
```

This serves the workbench over http and prints one machine-readable line:

```
VSCODE_AZURE_UI_URL=http://localhost:<port>/
```

Open that URL with browser tooling (`openBrowserPage`, then `readPage` / `clickElement`)
and drive the Azure views live. `VSCODE_AZURE_UI_PORT` pins the port and
`VSCODE_AZURE_UI_VERBOSE=1` echoes server output.

Two things to know when clicking around:

- The URL deliberately opens an **empty window**. Workspace trust in the browser lives in
  the browser profile, so any served folder opens in Restricted Mode, which disables this
  extension outright. The Azure views do not need a workspace.
- The side bar starts collapsed and the extension takes a few seconds to activate. Wait for
  the **Azure** icon to appear in the activity bar, then click it. Clicking by *coordinates*
  (take a screenshot, click the icon's pixel position) is the most reliable route -- the
  activity-bar item's accessibility node sometimes reports a stale bounding box.

## How the two hosts differ

| | `electron` project / F5 | `web` project / `ui:serve` |
|---|---|---|
| Host | desktop VS Code | VS Code server build + Chromium |
| Extension loaded via | `--extensionDevelopmentPath` | packaged VSIX, installed into a temp extensions dir |
| Extension mode | Development | Production |

Released server builds reject `--extensionDevelopmentPath`
(`Ignoring option 'extensionDevelopmentPath': not supported for server.`) -- only VS Code's
own from-source server honours it. So the harness packages a VSIX (cached under
`test-results/harness/`, rebuilt whenever `dist/extension.bundle.js` is newer) and installs
it, then copies `dist/test/mock.bundle.js` into the installed copy. That file's presence is
exactly what lets `main.js` apply the mock overrides in production mode; `.vscodeignore`
keeps `dist/test/**` out of every published package, so a shipped build can never do the
same.

## Writing a spec

```typescript
import { expect, test } from './fixtures/vscodeApp';
import { resourcesViewName } from './fixtures/workbench';

test.describe('My feature (ui)', () => {
    test('does the thing', async ({ wb }) => {
        await wb.focusView(resourcesViewName);
        await expect(wb.treeItem('Mock Subscription')).toBeVisible();
    });
});
```

- Label the root `describe`/`test.describe` with `(ui)`.
- Prefer role/name locators (`getByRole('treeitem', { name })`) over VS Code's internal CSS.
- Commands hidden from the palette (`"when": "false"` under `menus.commandPalette`, e.g.
  `Group By...`) cannot be run with `runCommand`. Use `wb.runViewTitleAction()` instead.
