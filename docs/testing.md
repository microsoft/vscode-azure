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
- `messageResponses` — queue of button labels for `showInformationMessage` / `showWarningMessage` / `showErrorMessage`
- `tasks` — the mock `tasks` namespace (includes `executeTask` with call tracking)
- `taskProcessEndEmitter` — fire to simulate a task process ending with an exit code
- `authentication`, `commands`, `env`, `window`, `workspace` — the mock namespace objects for direct call-count assertions
- `textDocuments` / `shownDocuments` — documents opened via `workspace.openTextDocument` and passed to `window.showTextDocument`, in order

All tracked methods are `mock.fn()` instances from `node:test`. Use `.mock.callCount()` and `.mock.calls[n].arguments` for assertions, and `.mock.mockImplementation()` to change behavior. The namespace objects exposed on the result (`authentication`, `commands`, `env`, `window`, `workspace`, `tasks`) are typed so their methods expose `.mock` directly -- read `mockResult.window.showErrorMessage.mock.callCount()` with no cast. (Note: the namespaces on `mockResult.vscode` are typed as the real `IVsCode` module, so reach for the top-level handles when you need `.mock`.)

#### MockFileSystem

`MockFileSystem` is an in-memory implementation of `workspace.fs` with `stat`, `readFile`, `writeFile`, `createDirectory`, `readDirectory`, `copy`, and `delete`. Pre-populate entries with `addFile()`, `addDirectory()`, or `addSymbolicLink()`; parent directories are created implicitly:

```typescript
const { vscode: code, fs } = createMockVsCode();
fs.addFile(MockUri.file('/project/azure.yaml'));
fs.addFile(MockUri.file('/project/config.json'), '{"key": "value"}');

// code.workspace.fs.stat() now resolves for those paths (and for /project)
// code.workspace.fs.readFile() returns the content
// code.workspace.fs.readDirectory('/project') lists both files
```

Every method is a `mock.fn()` so you can assert call counts (e.g. `fs.createDirectory.mock.callCount()`).

The same module also exports the `vscode` value types a `FileSystemProvider` under test needs: `MockFileType`, `MockFilePermission`, `MockFileChangeType`, and `MockFileSystemError` (whose static factories mirror the real API, and which is identified by `code` rather than class identity).

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
- `mockAzure.ts` — `makeAccount()`, `makeTenant()`, `makeSubscription()`, `makeCredential()`, `makeResourceGroup()`, `makeGenericResource()`, `makeVirtualGroup()`, `makeVirtualResource()` using the `AzurePublicCloud` preset; plus `createMockAccountDataProvider()`, `createMockSubscriptionClient()`, and `createMockWebAppClient()` (whose application settings are a mutable store, so read-modify-write flows work without re-stubbing)
- `mockPipeline.ts` — `makeRequest()`, `makeResponse()` (using SDK's `createHttpHeaders`), and `MockHttpClient` for injecting into Azure SDK clients
- `tree/mockTree.ts` — `createMockViewItemTree()`, `createMockDataItemTree()`, `createMockHierarchicalDataItemTree()` for testing `Choose*Step` classes and pick-based wizards

### Reusing and Adapting Fixtures

**Search the testing barrels before you write a fixture.** Re-authoring a mock
that already exists is the most common review comment on test PRs in this repo.
The decision order is:

1. **Use the existing helper as-is.** Most `make*` factories take a `Partial<...>`
   overrides argument — pass only the fields the test cares about and let the
   factory supply the rest.
2. **Adapt the existing helper.** If a shared fixture is close but not quite
   right, extend it *additively* — add an optional override, an optional
   parameter with a backward-compatible default, or a thin wrapper next to it.
   Adapting the shared fixture is nearly always better than forking it, because
   the next test that needs the same shape gets it for free.
3. **Add a new shared helper** in the appropriate barrel (`mockAzure.ts` /
   `mockTree.ts` in azutils for Azure entity and tree fixtures; utils for generic
   primitives) and export it from that package's `testing.ts`.
4. **Write a local fixture** only when it is genuinely single-use and specific to
   one test file. The moment a second file needs the same shape, promote it to a
   shared helper rather than copying it.

Never do this:

```typescript
// BAD -- a hand-rolled near-duplicate of makeSubscription()
const subscription = {
    subscriptionId: 'sub-1',
    displayName: 'Test Subscription',
    tenantId: 'tenant-1',
    environment: AzurePublicCloud,
    // ...several more fields copied from another test file
} as AzureSubscription;
```

```typescript
// GOOD -- reuse the shared factory, override only what matters
const subscription = makeSubscription({ subscriptionId: 'sub-1' });
```

If the shared factory can't express what you need, change the shared factory.

### Debounced Work

Code that debounces work should depend on `IDebounceScheduler` rather than
timers directly. Tests inject `ManualDebounceScheduler` from
`@microsoft/vscode-azure-utils/testing`, assert that work was scheduled
(`hasPending`), and then `await scheduler.flush()` to run it to completion.
This avoids interleaving fake timers with real promise continuations, which is
a common source of flakiness.

### Integration Tests

Integration tests use the real VS Code API and extension infrastructure:

```typescript
it('(integration) should execute without error', async () => {
    await vscode.commands.executeCommand('vscode-azure/resources/refresh');
});
```

### Assertion Library

All tests use **chai** for assertions (`expect` style). `expect` is registered as
a global by `@microsoft/vscode-azext-eng`, so tests use it without importing
chai. That same eng entry supplies every other test global too -- mocha's
`describe`/`it` and the `chai-as-promised` augmentation -- so `types` names it
alone rather than listing `mocha` and `chai-as-promised` separately:

```jsonc
"types": [
    "node",
    "@microsoft/vscode-azext-eng/mocha/test-globals",
]
```

`chai-as-promised` is registered by `@microsoft/vscode-azext-eng` for every test
package, so assert on rejections through `expect` rather than `try`/`catch` with
`expect.fail()`, or `assert.rejects` from `node:assert`:
```ts
// Assert the rejection and its message
await expect(command.execute()).to.be.rejectedWith(/no longer available/);

// Capture the error when you need to assert more than the message
const error = await expect(command.execute()).to.be.rejected;
expect(CancellationError.test(error)).to.be.true;

// Or assert the error type
await expect(walk(token)).to.be.rejectedWith(CancellationError);

// `.eventually` asserts on the RESOLVED value; it is not needed for rejections
await expect(client.getVersion()).to.eventually.equal('1.2.3');
```

Always `await` these assertions -- including `.eventually` ones, which return a
thenable rather than asserting synchronously. An un-awaited rejection assertion
surfaces as an unhandled rejection rather than failing the test that created it.

## What Not to Test

Tests exist to catch **regressions** — changes that break behavior nobody meant
to break. A test that can only fail when someone deliberately changes something
catches no mistakes; it just converts intentional edits into mechanical churn.
Every such test is a permanent maintenance cost with no offsetting benefit.
Avoid these categories:

### Don't test that a constant is still what it currently is

Nobody accidentally edits the value of a constant, so a test that pins one to its
current value can never catch a mistake. It fails only when someone deliberately
changes the value, at which point the test is already stale and the failure is
pure noise: the author updates the expected literal to match the new declaration
and learns nothing.

```typescript
// BAD -- restates the declaration
expect(AcrResourceType).to.equal('Microsoft.ContainerRegistry/registries');

// BAD -- same thing, one level removed
expect(command.id).to.equal('vscode-azure/resources/refresh');
expect(getDefaultSettings()).to.deep.equal({ pageSize: 50, autoRefresh: true });

// BAD -- a snapshot of the current shape, with nothing asserted about behavior
expect(Object.keys(iconsByType)).to.have.members(['acr', 'functionapp', /* ... */]);
```

The same reasoning rules out snapshot-style assertions that freeze a literal
structure without exercising any behavior. Both change only when someone means to
change them, and both turn intentional edits into mechanical test churn.

Test what the constant *does* instead. Assert behavior that would break by
accident:

```typescript
// GOOD -- exercises the logic that consumes the constant
const item = provider.getTreeItem(makeGenericResource({ logicalType: AcrResourceType }));
expect(item.iconPath).to.not.be.undefined;

// GOOD -- catches a real mistake: paging that ignores the configured size
const pages = await collectPages(provider.getChildren(resource));
expect(pages[0].items).to.have.lengthOf(configuredPageSize);
```

Note that referencing the constant (rather than its literal) in an assertion is
fine and encouraged — the problem is when the constant *is* the subject.

The exception is a value that is a genuine cross-boundary **contract**, where two
independent sources must agree and can drift apart: a command ID declared in
`package.json` and registered in code, an icon filename derived from a logical
type, a serialized format that persisted state must still parse. Those tests are
valuable, but write them as consistency checks between the two sources — read
both sides and compare — not as an assertion against a hardcoded literal.

### Don't test that removed behavior stays removed

After deleting a feature, flag, command, or code path, do **not** add a test
asserting that it's gone. These tests document history rather than behavior, they
pass trivially forever, and they make the deleted concept permanently visible to
everyone who reads the suite.

```typescript
// BAD
it('(unit) should no longer register the legacy refresh command', () => {
    expect(registeredCommands.has('vscode-azure.legacyRefresh')).to.be.false;
});

it('(unit) should not fall back to the old provider', () => {
    expect(result.usedLegacyProvider).to.be.undefined;
});
```

The type system, the build, and the existing tests for the surviving behavior
already cover this. Delete the old tests along with the old code and move on.

The narrow exception is a **regression test for a real bug** — e.g. a removed
code path that caused data loss, or a security fix. In that case assert the
correct *positive* behavior ("writes are not duplicated"), reference the issue,
and phrase it in terms of what the system does today, not what was deleted.

### Don't test the test fixtures

Mocks and factories are test infrastructure, not production code. A test whose
subject is `makeSubscription()` or `MockVsCode` only asserts that the fixture
does what its own code literally says.

```typescript
// BAD -- asserts the fixture against itself
it('(unit) makeSubscription should default the tenant id', () => {
    expect(makeSubscription().tenantId).to.equal('mock-tenant');
});

// BAD -- exercises the mock, not the code under test
it('(unit) MockFileSystem should read back what was written', async () => {
    await fs.writeFile(uri, content);
    expect(await fs.readFile(uri)).to.deep.equal(content);
});
```

Fixtures are validated implicitly: if a factory is wrong, the tests that use it
fail. The exception is a fixture with real, non-trivial logic of its own that
tests depend on subtly (e.g. `respondToPrompts()`'s back-navigation handling or
`MockHttpClient`'s request matching) — behavior complex enough that a bug in it
would silently produce false passes. Test that logic, not the plain factories.

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
