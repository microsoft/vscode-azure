# Testing

## Test Organization

Tests live in a `test/` directory that sits as a sibling of `src/` within each workspace:

```
packages/utils/test/
packages/azutils/test/
extensions/vscode-azure/test/
```

## Test Labels

Label tests with `(unit)`, `(integration)`, or `(e2e)` **after** the name in the root `describe` description:

```typescript
describe('AzureNodeId (unit)', () => {
    it('should round-trip a subscription node ID', () => { ... });
});

describe('RefreshResourcesView (integration)', () => {
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
import { Everything } from '@microsoft/vscode-azure-utils';

it('(unit) should invalidate the cache', async () => {
    const mockCache = { invalidate: mock.fn() };
    const command = new RefreshResourcesView(mockCache);
    command.execute();

    expect(mockCache.invalidate.mock.callCount()).to.equal(1);
    expect(mockCache.invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
});
```

`createMockVsCode()` returns a `MockVsCodeResult` with:
- `vscode` — an `IVsCode` mock with tracked methods, suitable for DI injection
- `quickPicks` — all `MockQuickPick` instances created, for driving and asserting user interactions
- `inputBoxes` — all `MockInputBox` instances created
- `settings` — backing store for `workspace.getConfiguration()`
- `registeredCommands` — commands registered via `commands.registerCommand`
- `fs` — a `MockFileSystem` (in-memory `workspace.fs`; see below)
- `workspaceFolders` — mutable array backing `workspace.workspaceFolders`
- `messageResponses` — queue of button labels for `showInformationMessage` / `showWarningMessage` / `showErrorMessage`- `tasks` -- the mock `tasks` namespace (includes `executeTask` with call tracking)
- `taskProcessEndEmitter` -- fire to simulate a task process ending with an exit code- `authentication`, `commands`, `env`, `window`, `workspace` — the mock namespace objects for direct call-count assertions

All tracked methods are `mock.fn()` instances from `node:test`. Use `.mock.callCount()` and `.mock.calls[n].arguments` for assertions, and `.mock.mockImplementation()` to change behavior. The namespace objects exposed on the result (`authentication`, `commands`, `env`, `window`, `workspace`, `tasks`) are typed so their methods expose `.mock` directly -- read `mockResult.window.showErrorMessage.mock.callCount()` with no cast. (Note: the namespaces on `mockResult.vscode` are typed as the real `IVsCode` module, so reach for the top-level handles when you need `.mock`.)

#### MockFileSystem

`MockFileSystem` is an in-memory implementation of `workspace.fs` with `stat`, `readFile`, `writeFile`, `createDirectory`, `copy`, and `delete`. Pre-populate files with `addFile()`:

```typescript
const { vscode: code, fs } = createMockVsCode();
fs.addFile(MockUri.file('/project/azure.yaml'));
fs.addFile(MockUri.file('/project/config.json'), '{"key": "value"}');

// code.workspace.fs.stat() now resolves for those paths
// code.workspace.fs.readFile() returns the content
```

Every method is a `mock.fn()` so you can assert call counts (e.g. `fs.createDirectory.mock.callCount()`).

#### Workspace Folders

Push entries to `workspaceFolders` to simulate a workspace. When the array is empty, `workspace.workspaceFolders` returns `undefined` (matching real VS Code behavior):

```typescript
const { vscode: code, workspaceFolders } = createMockVsCode();
workspaceFolders.push({ uri: MockUri.file('/workspace'), name: 'my-project', index: 0 } as never);
```

#### Message Responses

Push button labels to `messageResponses` to simulate the user clicking a button on notification messages. Responses are consumed in order across all three message types. When the queue is empty the mock returns `undefined` (dismissal):

```typescript
const mockResult = createMockVsCode();
mockResult.messageResponses.push('Delete');  // first show*Message call returns 'Delete'
// second call returns undefined (dismissed)
```

For tests that also need an `ICodeContext`, use `createMockCodeContext()`:

```typescript
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';

const { ctx, mock: mockResult } = createMockCodeContext();
// ctx has both .code (IVsCode) and .extensionContext (IExtensionContext)
// extensionContext includes extensionUri, storageUri, globalStorageUri, etc.
// mockResult is the full MockVsCodeResult with fs, workspaceFolders, messageResponses, etc.
```

Key patterns:
- Prefer `createMockVsCode()` / `createMockCodeContext()` over hand-rolled mocks for consistency and completeness
- Use the built-in `fs`, `workspaceFolders`, and `messageResponses` on the result instead of passing `overrides` or using `mockImplementation` to set up workspace/fs/message state
- Access namespace objects directly from the result (e.g. `mockResult.commands.executeCommand.mock.callCount()`) for call-count assertions -- they are typed to expose `.mock`, so no `as unknown as Mock<...>` cast is needed
- Use real implementations (`ActionExecutor`, `createActionContext`, `TempDirManager`) instead of mocking them when they work against `MockVsCode` — they often do
- Use `NullTelemetryReporter` from `@microsoft/vscode-azure-utils/testing` for the `ActionExecutor` constructor
- Use `Mock` from `node:test` to track call counts and arguments — prefer over manual `let callCount = 0` patterns
- Use `makeVirtualResource()` from `@microsoft/vscode-azure-azutils/testing` instead of hand-rolling `VirtualResource` objects
- For Azure environments in azutils tests, use the `AzurePublicCloud` preset (or `AzureUSGovernment` / `AzureChinaCloud`) from `@microsoft/vscode-azure-azutils` instead of hand-rolled environment objects. Test credentials come from `makeCredential()` in `mockAzure.ts`.

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

`packages/azutils/test/` provides shared helpers, exported from the `@microsoft/vscode-azure-azutils/testing` barrel:
- `mockAzure.ts` — `makeAccount()`, `makeTenant()`, `makeSubscription()`, `makeCredential()`, `makeResourceGroup()`, `makeGenericResource()`, `makeVirtualGroup()`, `makeVirtualResource()` using the `AzurePublicCloud` preset; plus `createMockAccountDataProvider()`
- `mockPipeline.ts` — `makeRequest()`, `makeResponse()` (using SDK's `createHttpHeaders`), and `MockHttpClient` for injecting into Azure SDK clients
- `tree/mockTree.ts` — `createMockViewItemTree()`, `createMockDataItemTree()`, `createMockHierarchicalDataItemTree()` for testing `Choose*Step` classes and pick-based wizards

### Integration Tests

Integration tests use the real VS Code API and extension infrastructure:

```typescript
it('(integration) should execute without error', async () => {
    await vscode.commands.executeCommand('vscode-azure/resources/refresh');
});
```

### Assertion Library

All tests use **chai** for assertions (`expect` style).

`chai-as-promised` is registered for every test package (see
`scripts/chaiSetup.mjs`), so assert on rejections through `expect` rather than
`try`/`catch` with `expect.fail()`, or `assert.rejects` from `node:assert`:
```ts
// Assert the rejection and its message
await expect(command.execute()).to.be.rejectedWith(/no longer available/);

// Capture the error when you need to assert more than the message
const error = await expect(command.execute()).to.be.rejected;
expect(CancellationError.test(error)).to.be.true;
```

Always `await` these assertions. An un-awaited rejection assertion surfaces as
an unhandled rejection rather than failing the test that created it.

## Running Tests

```bash
# All workspaces
pnpm run test

# Single workspace
pnpm --filter @microsoft/vscode-azure-utils run test
pnpm --filter vscode-azure run test

# With coverage (packages)
pnpm --filter @microsoft/vscode-azure-utils run testcov

# With coverage (extension)
pnpm --filter vscode-azure run testcov
```

## Coverage

### Package Coverage

Packages use **c8** (V8 native coverage) with Mocha:

```bash
pnpm --filter @microsoft/vscode-azure-utils run testcov
pnpm --filter @microsoft/vscode-azure-azutils run testcov
```

### Extension Coverage

The extension uses `@vscode/test-cli`'s built-in `--coverage` flag, which leverages V8 native coverage and c8:

```bash
vscode-test --coverage
```

When source maps are available, coverage from the bundled extension can be remapped back to original source files. This means the report can merge coverage from:
- **Unit tests** that import source files directly (via tsx)
- **Integration tests** that exercise the extension bundle (via source map remapping)

## Test Configuration

Extension test configuration lives in `.vscode-test.mjs`:

```javascript
export { azExtTestConfig as default } from '@microsoft/vscode-azext-eng/vscode-test'; // Other configurations exist
```

Package test configuration lives in `package.json`:

```json
"mocha": {
    "node-option": ["import=tsx"],
    "spec": ["test/**/*.test.ts"]
}
```
