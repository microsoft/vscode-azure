# Conventions

Coding conventions and best practices established in this project.

## Strings

- Use **single quotes** for strings
- Use only **ASCII characters** in source

## Imports

- Use `import type` for type-only imports
- Use `import * as vscode` for the VS Code API
- Prefer named exports; avoid default exports

## Naming

- **`I`-prefix** for DI service identifier interfaces: `IVsCode`, `IActionExecutor`, `IOutputChannel`
- **PascalCase** for files containing classes/interfaces: `DataItemTree.ts`, `GenericResource.ts`
- **camelCase** for function-oriented files: `contextValueHelpers.ts`, `registerCommands.ts`

## VS Code API

Use the following DI interfaces instead of the built-in `vscode` types:

| Instead of | Use |
|------------|-----|
| `vscode` | `IVsCode` |
| `vscode.ExtensionContext` | `IExtensionContext` |
| `vscode.OutputChannel` | `IOutputChannel` |
| `vscode.EventEmitter` | `EventEmitter` |
| `vscode.Disposable` | `Disposable` |

Only `extension.ts` should import `vscode` directly as a runtime/value dependency.
Type-only imports from `vscode` (for example, `import type * as vscode from 'vscode'` to reference `vscode.Uri`) are allowed when needed.

## File System

Use `vscode.workspace.fs` and `vscode.Uri` instead of Node's `fs`/`fs/promises` and string paths in product code. This ensures compatibility with virtual file systems and remote workspaces.

- Use `vscode.Uri.joinPath()` instead of `path.join()`
- Use `vscode.workspace.fs.stat()` to check for file existence (prefer over `workspace.findFiles()` which is workspace-scoped)
- Use `extensionContext.extensionUri` with `Uri.joinPath()` instead of `extensionContext.asAbsolutePath()`
- Pass `vscode.Uri` through interfaces instead of `string` file paths
- `Uri.fsPath` is acceptable when an API requires a string path (e.g. `child_process` `cwd`)

## Localization

User-facing strings **must** use `IVsCode.l10n.t()`:

```typescript
// Simple message
this.code.l10n.t('Hello, from the Azure extension!')

// With placeholders
this.code.l10n.t('Loading details for \'{0}\'...', resource.name)

// Multiple placeholders
this.code.l10n.t('Resource: {0}, SKU: {1}', registry.name, registry.sku.name)
```

Debug and trace output to the output channel is exempt from localization.

## Logging

Use `IOutputChannel` directly via DI for extension logging. Do not add a wrapper class, do not fold `IOutputChannel` into `IExtensionContext`, and do not add a log-level setting (users control this from VS Code's output-channel log level UI).

- Prefix every line with a bracketed subsystem: `[activate]`, `[cmd]`, `[data]`, `[view]`, `[cache]`, `[rest]`, `[auth]`, `[wizard]`, `[activity]`, etc.
- Use supported string interpolation (for example `output.debug(\`[cmd] ${id} start\`)`)
- Pass `Error` objects directly to `output.error(...)`
- Levels:
  - `error`: user-visible failure
  - `warn`: unexpected but recovered
  - `info`: coarse lifecycle landmarks
  - `debug`: command/cache/wizard lifecycle
  - `trace`: per-item / per-request detail
- `info`/`warn`/`error` messages must use `IVsCode.l10n.t(...)`; `debug`/`trace` are English-only developer logs
- Never log PII/secrets (tokens, auth secrets, request/response bodies, user emails/display names, file contents). Resource IDs/names are allowed.

```typescript
output.debug(`[cmd] ${callbackId} start`);
```

## Promises

- Prefix intentionally un-awaited promises with `void`
- Exception: promises with `.then()` (two arguments for resolve/reject) or `.catch()` handlers

```typescript
// Good
void this.code.window.showInformationMessage(message);

// Also fine (has error handling)
promise.catch(() => { /* noop */ });
```

## Error Handling

A value caught in a `catch` clause has type `unknown`, so it may not be an `Error`. When you need a human-readable message string from it (for logging, telemetry, or display), use `stringifyError()` from `@microsoft/vscode-azure-utils` instead of hand-rolling the `instanceof Error` check.

```typescript
import { stringifyError } from '@microsoft/vscode-azure-utils';

try {
    await doWork();
} catch (error) {
    this.output.warn(this.code.l10n.t('[cmd] work failed: {0}', stringifyError(error)));
}
```

```typescript
// Bad — repeated inline coercion
const message = error instanceof Error ? error.message : String(error);
```

`stringifyError()` returns the `message` for `Error` values, returns strings unchanged, and falls back to `util.inspect()` for everything else.

## ARM Resource Types

When checking `GenericResource.type` or `GenericResource.logicalType`, always compare **case-insensitively** against a constant:

```typescript
// Good
import { AcrResourceType } from './constants';
if (resource.type.toLowerCase() === AcrResourceType.toLowerCase()) { ... }

// Bad — string literal, case-sensitive
if (resource.type === 'Microsoft.ContainerRegistry/registries') { ... }
```

## Context Values

Commands that appear in tree item context menus should:

1. Define a static `ContextValue` property on the command class
2. The view provider should use it in the tree item's `contextValue` via `combineContextValues()`
3. In `package.json`, the `when` clause should use a regex with word boundaries:

```json
"when": "viewItem =~ /\\bopenInPortal\\b/i"
```

The `\b` prevents unintended partial matches.

## Comments and Documentation

Comments and docs describe the code **as it is now**, not how it got that way. The
diff, the commit message, and the PR description are where change history belongs.

Don't write change-log commentary in the source or in `docs/`:

```typescript
// BAD -- describes a change, not the code
// Removed the legacy retry helper; callers now use RetryPolicy directly.
// Note: this used to accept a string; it no longer does.
// (previously handled in AzureResourceProvider before it was deleted)

// GOOD -- describes current behavior, or nothing at all
// Retries are capped so a throttled subscription can't stall activation.
```

This applies to every kind of prose: inline comments, JSDoc, `docs/` pages,
README updates, and test names. A reader who has never seen the old code should
not encounter references to it. In particular:

- Don't document that a function/option/setting "no longer" exists, or that a
  behavior "was removed". If it's gone, say nothing.
- Don't leave a comment marking where deleted code used to live.
- When editing an existing doc, delete the stale prose outright rather than
  appending a note that it's obsolete.

The exception is a deliberate, user-facing deprecation contract -- `@deprecated`
JSDoc on a symbol that still exists, or a CHANGELOG entry. Those describe the
current API surface, not the edit that produced it.

## ESLint

- Use scoped `eslint-disable` comments on specific lines
- Avoid file-wide disables unless the same disable would need to be repeated many times

## Copyright Header

Every TypeScript/JavaScript file must include the Microsoft copyright header:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
```

## Interface Properties

Mark interface properties as `readonly` by default.

## Test Labels

Label test cases with `(unit)` or `(integration)` **after** the name in the root `describe` description:

```typescript
describe('RefreshResourcesView (unit)', () => {
    it('should invalidate the cache', async () => { ... });
});

describe('RefreshResourcesView (integration)', () => {
    it('should execute without error', async () => { ... });
});
```
