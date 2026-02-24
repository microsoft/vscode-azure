# Instructions for Copilot

## General Instructions

* Use single quotes instead of double quotes for strings
* Use only ASCII characters in source
* Use `import type` for type-only imports
* Use `import * as vscode` for the VS Code API (the only namespace import)
* Prefer named exports; avoid default exports
* Use the `I`-prefix for DI service identifier interfaces (e.g., `IActionContext`)
* Use the following interfaces in place of the built-in `vscode` types when possible:
  - `IVsCode` instead of `vscode`
  - `IExtensionContext` instead of `vscode.ExtensionContext`
  - `IOutputChannel` instead of `vscode.OutputChannel`
  - `EventEmitter` instead of `vscode.EventEmitter`
  - `Disposable` instead of `vscode.Disposable`
* Mark interface properties as `readonly` by default
* Use PascalCase for files containing classes/interfaces, camelCase for function-oriented files
* Label test cases with `(unit)` or `(integration)` in the root `describe` description
* Include the Microsoft copyright header on every TypeScript/JavaScript file
* Use `void` prefix for intentionally un-awaited promises
* Use scoped `eslint-disable` comments on specific lines, never file-wide

## How to Lint, Build, and Test

* Before submitting PRs, always lint, build, and test locally to catch errors early
* Run `npm run lint` to check for linting errors
* Run `npm run build` to compile TypeScript to JavaScript
* Run `npm run test` to execute tests
* For individual workspaces, use the above commands, adding `--workspace=<workspace-name>` to target a specific package
