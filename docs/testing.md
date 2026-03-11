# Testing

## Test Organization

Tests live alongside source code in `src/test/` directories within each workspace:

```
packages/utils/src/test/
packages/azutils/src/test/
extensions/vscode-azure/src/test/
```

## Test Labels

Label tests with `(unit)` or `(integration)` in the test description (either root or per-test):

```typescript
describe('Hello command', () => {
    it('(unit) should set telemetry property', async () => { ... });
    it('(integration) should execute without error', async () => { ... });
});
```

## Test Runners

| Workspace | Runner | Environment |
|-----------|--------|-------------|
| `packages/utils` | Mocha (via tsx) | Node.js |
| `packages/azutils` | Mocha (via tsx) | Node.js |
| `extensions/vscode-azure` | `@vscode/test-cli` | VS Code extension host |

Package tests run directly in Node.js with tsx for TypeScript support. Extension tests run inside a VS Code instance via `@vscode/test-electron`.

## Mocking Strategy

### Unit Tests

Unit tests instantiate classes directly with mocked dependencies. Use `createMockVsCode()` from the utils testing package to get a pre-built mock with call tracking:

```typescript
import { createActionContext, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';

it('(unit) should set telemetry property', async () => {
    const context = createActionContext('test');
    const { vscode: mockVsCode } = createMockVsCode();

    const hello = new Hello(context, mockVsCode);
    await hello.execute();

    expect(context.telemetry.properties.hello).to.equal('world');
});
```

`createMockVsCode()` returns a `MockVsCodeResult` with:
- `vscode` — an `IVsCode` mock with tracked methods (`window.showInformationMessage`, `l10n.t`, `window.createQuickPick`, etc.)
- `quickPicks` — all `MockQuickPick` instances created, for driving and asserting user interactions
- `inputBoxes` — all `MockInputBox` instances created
- `settings` — backing store for `workspace.getConfiguration()`

For tests that also need an `ICodeContext`, use `createMockCodeContext()`:

```typescript
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';

const { context: codeContext, mock: mockResult } = createMockCodeContext();
// codeContext has both .code (IVsCode) and .extensionContext (IExtensionContext)
```

Key patterns:
- Prefer `createMockVsCode()` over hand-rolled mocks for consistency and completeness
- Use `createActionContext('test')` for a real context with empty telemetry
- Access `mock.fn()` call info via the returned mock result for assertions
- For simulating quick pick interactions, use `mockResult.quickPicks[0].accept()` etc.

### Integration Tests

Integration tests use the real VS Code API and extension infrastructure:

```typescript
it('(integration) should execute without error', async () => {
    await vscode.commands.executeCommand('azure.hello');
});
```

### Assertion Library

All tests use **chai** for assertions (`expect` style).

## Running Tests

```bash
# All workspaces
npm run test

# Single workspace
npm run test --workspace=packages/utils
npm run test --workspace=extensions/vscode-azure

# With coverage (packages)
npm run testcov --workspace=packages/utils

# With coverage (extension)
npm run testcov --workspace=extensions/vscode-azure
```

## Coverage

### Package Coverage

Packages use **nyc** (Istanbul) with Mocha:

```bash
npx nyc --reporter=html mocha
```

### Extension Coverage

The extension uses `@vscode/test-cli`'s built-in `--coverage` flag, which leverages V8 native coverage and c8:

```bash
vscode-test --coverage --coverage-reporter=html --coverage-output=coverage
```

With esbuild source maps enabled (`sourcemap: 'linked'` in `esbuild.mjs`), coverage from the bundled extension is remapped back to original source files. This means the report merges coverage from:
- **Unit tests** that import source files directly (via tsx)
- **Integration tests** that exercise the extension bundle (via source map remapping)

See [coverage-changes.md](temp/coverage-changes.md) for details on upstream patches needed for full source map support.

## Test Configuration

Extension test configuration lives in `.vscode-test.mjs`:

```javascript
export { azExtSrcTestConfig as default } from '@microsoft/vscode-azext-eng/vscode-test'; // Other configurations exist
```

Package test configuration lives in `package.json`:

```json
"mocha": {
    "node-option": ["import=tsx"],
    "spec": ["src/test/**/*.test.ts"]
}
```
