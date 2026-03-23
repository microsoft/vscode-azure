# Testing

## Test Organization

Tests live alongside source code in `src/test/` directories within each workspace:

```
packages/utils/src/test/
packages/azutils/src/test/
extensions/vscode-azure/src/test/
```

## Test Labels

Label tests with `(unit)` or `(integration)` **after** the name in the root `describe` description:

```typescript
describe('AzureNodeId (unit)', () => {
    it('should round-trip a subscription node ID', () => { ... });
});

describe('Hello command (integration)', () => {
    it('should execute without error', async () => { ... });
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
- `vscode` — an `IVsCode` mock with tracked methods (`window.showInformationMessage`, `l10n.t`, `window.createQuickPick`, `commands.registerCommand`, `authentication.getSession`, etc.)
- `quickPicks` — all `MockQuickPick` instances created, for driving and asserting user interactions
- `inputBoxes` — all `MockInputBox` instances created
- `settings` — backing store for `workspace.getConfiguration()`
- `registeredCommands` — commands registered via `commands.registerCommand`

All tracked methods are `mock.fn()` instances from `node:test`. Use `.mock.callCount()` and `.mock.calls[n].arguments` for assertions, and `.mock.mockImplementation()` to change behavior.

For tests that also need an `ICodeContext`, use `createMockCodeContext()`:

```typescript
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';

const { ctx: codeContext, mock: mockResult } = createMockCodeContext();
// codeContext has both .code (IVsCode) and .extensionContext (IExtensionContext)
// extensionContext includes extension.id and extension.packageJSON
```

Key patterns:
- Prefer `createMockVsCode()` / `createMockCodeContext()` over hand-rolled mocks for consistency and completeness
- Use real implementations (`ActionExecutor`, `createActionContext`) instead of mocking them — they work fine in tests
- Use `NullTelemetryReporter` from `@microsoft/vscode-azure-utils/testing` for the `ActionExecutor` constructor
- Use `Mock` from `node:test` to track call counts and arguments — prefer over manual `let callCount = 0` patterns
- For Azure environments in azutils tests, use `Environment.AzureCloud` from `@azure/ms-rest-azure-env` instead of hand-rolled environment objects

### Driving Wizard UI in Tests

Use `respondToPrompts()` to pre-program responses to QuickPicks and InputBoxes:

```typescript
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';

const { ctx, mock } = createMockCodeContext();
const tracker = respondToPrompts(mock, [
    { pick: 'My Subscription $(chevron-right)' },  // pick an intermediate item (note chevron suffix)
    { input: 'my-resource' },                        // type into an input box
    { pickMany: ['A', 'B'] },                        // multi-select
    'goBack',                                        // press back button
    'cancel',                                        // dismiss the UI
]);

// ... run wizard ...
tracker.assertAllConsumed();  // verify all responses were used
```

Note: intermediate items in the pick step get ` $(chevron-right)` appended to their labels. Use the full label including the suffix when specifying picks.

### Shared Test Fixtures (azutils)

`packages/azutils/src/test/` provides shared helpers:
- `mockAzure.ts` — `makeAccount()`, `makeTenant()`, `makeSubscription()` using `Environment.AzureCloud`
- `mockPipeline.ts` — `makeRequest()`, `makeResponse()` (using SDK's `createHttpHeaders`), and `MockHttpClient` for injecting into Azure SDK clients

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

Packages use **c8** (V8 native coverage) with Mocha:

```bash
npm run testcov --workspace=packages/utils
npm run testcov --workspace=packages/azutils
```

### Extension Coverage

The extension uses `@vscode/test-cli`'s built-in `--coverage` flag, which leverages V8 native coverage and c8:

```bash
vscode-test --coverage --coverage-reporter=html --coverage-output=coverage
```

When source maps are available, coverage from the bundled extension can be remapped back to original source files. This means the report can merge coverage from:
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
