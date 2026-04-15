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
- **camelCase** for function-oriented files: `combineContextValues.ts`, `registerCommands.ts`

## VS Code API

Use the following DI interfaces instead of the built-in `vscode` types:

| Instead of | Use |
|------------|-----|
| `vscode` | `IVsCode` |
| `vscode.ExtensionContext` | `IExtensionContext` |
| `vscode.OutputChannel` | `IOutputChannel` |
| `vscode.EventEmitter` | `EventEmitter` |
| `vscode.Disposable` | `Disposable` |

Only `extension.ts` should import `vscode` directly.

## File System

Use `vscode.workspace.fs` and `vscode.Uri` instead of Node's `fs`/`fs/promises` and string paths in product code. This ensures compatibility with virtual file systems and remote workspaces.

- Use `vscode.Uri.joinPath()` instead of `path.join()`
- Use `vscode.workspace.findFiles()` to check for file existence
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

## Promises

- Prefix intentionally un-awaited promises with `void`
- Exception: promises with `.then()` (two arguments for resolve/reject) or `.catch()` handlers

```typescript
// Good
void this.code.window.showInformationMessage(message);

// Also fine (has error handling)
promise.catch(() => { /* noop */ });
```

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
describe('Hello command (unit)', () => {
    it('should set telemetry property', async () => { ... });
});

describe('Hello command (integration)', () => {
    it('should execute without error', async () => { ... });
});
```
