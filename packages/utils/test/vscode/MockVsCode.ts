/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { minimatch } from 'minimatch';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { Disposable } from '../../src/vscode/Disposable';
import { EventEmitter } from '../../src/vscode/EventEmitter';
import type { ICodeContext, IExtensionContext, IVsCode } from '../../src/vscode/IVsCode';
import { MockMemento } from './config/MockMemento';
import { MockWorkspaceConfiguration } from './config/MockWorkspaceConfiguration';
import { MockInputBox } from './input/MockInputBox';
import { MockQuickPick } from './input/MockQuickPick';
import { MockFileChangeType, MockFilePermission, MockFileSystem, MockFileSystemError, MockFileType } from './MockFileSystem';
import { MockOutputChannel } from './MockOutputChannel';
import { MockUri } from './MockUri';
import { MockConfigurationTarget, MockMarkdownString, MockProgressLocation, MockQuickPickItemKind, MockRelativePattern, MockShellExecution, MockTask, MockTaskScope, MockThemeColor, MockThemeIcon, MockTreeItemCollapsibleState } from './MockValueTypes';
import { MockTreeItem } from './tree/MockTreeItem';

/**
 * Maps each method of a `vscode` namespace to its `node:test` {@linkcode Mock}
 * wrapper so tests can read `.mock` (call counts, arguments,
 * `mockImplementation`) without casting. Non-function members pass through
 * unchanged. Passing the original member type to {@linkcode Mock} preserves
 * overload signatures, and because {@linkcode Mock} is `F & { mock }`, a mapped
 * namespace is still callable and remains assignable to the real `vscode`
 * namespace it stands in for.
 */
type MockedNamespace<T> = {
    [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : T[K];
};

/**
 * Result of {@linkcode createMockVsCode}. Provides both the injectable
 * `IVsCode` value and test-inspection surfaces.
 *
 * The namespace handles exposed here (e.g. {@linkcode MockVsCodeResult.window window},
 * {@linkcode MockVsCodeResult.commands commands}) are typed via
 * {@linkcode MockedNamespace} so their methods expose `.mock` directly -- no
 * cast is needed:
 *
 * ```ts
 * const result = createMockVsCode();
 * expect(result.window.createQuickPick.mock.callCount()).to.equal(1);
 * ```
 *
 * Or use the collected {@linkcode quickPicks} / {@linkcode inputBoxes} arrays to
 * inspect and drive the created UI elements directly. (Note: the namespaces on
 * {@linkcode MockVsCodeResult.vscode vscode} are typed as the real `IVsCode`
 * module, so reach for these top-level handles when you need `.mock`.)
 */
/**
 * A watcher created by the mock `workspace.createFileSystemWatcher`, exposing
 * the glob it was created with and letting a test raise events on it.
 */
export interface MockFileSystemWatcher {
    /** The pattern the watcher was created with. */
    readonly pattern: vscode.GlobPattern;
    fireCreate(uri: vscode.Uri): void;
    fireChange(uri: vscode.Uri): void;
    fireDelete(uri: vscode.Uri): void;
}

export interface MockVsCodeResult {
    /** The mock suitable for DI injection as {@linkcode IVsCode}. */
    readonly vscode: IVsCode;

    /** All {@linkcode MockQuickPick} instances created so far, in creation order. */
    readonly quickPicks: readonly MockQuickPick<vscode.QuickPickItem>[];

    /** All {@linkcode MockInputBox} instances created so far, in creation order. */
    readonly inputBoxes: readonly MockInputBox[];

    /**
     * The backing store for `workspace.getConfiguration()`. Keyed by
     * fully-qualified setting name (e.g. `'myExtension.featureFlag'`).
     *
     * Mutate directly or use {@linkcode withSettings} for scoped overrides.
     */
    readonly settings: Map<string, unknown>;

    /** Commands registered via `vscode.commands.registerCommand`. Keyed by command ID. */
    readonly registeredCommands: Map<string, (...args: unknown[]) => unknown>;

    /** The in-memory file system backing `workspace.fs`. */
    readonly fs: MockFileSystem;

    /**
     * Every watcher created via `workspace.createFileSystemWatcher`, in
     * creation order. Use {@linkcode fireFileSystemEvent} to drive them.
     */
    readonly fileSystemWatchers: readonly MockFileSystemWatcher[];

    /**
     * The workspace folders list backing `workspace.workspaceFolders`.
     * Mutate this array to simulate single- or multi-root workspaces.
     */
    readonly workspaceFolders: vscode.WorkspaceFolder[];

    /** The mock `authentication` namespace -- access `.getSession.mock` for assertions. */
    readonly authentication: MockedNamespace<typeof vscode.authentication>;

    /** The mock `commands` namespace -- access `.executeCommand.mock` etc. for assertions. */
    readonly commands: MockedNamespace<typeof vscode.commands>;

    /** The mock `env` namespace -- access `.openExternal.mock` for assertions. */
    readonly env: MockedNamespace<typeof vscode.env>;

    /** The mock `window` namespace -- access `.showWarningMessage.mock` etc. for assertions. */
    readonly window: MockedNamespace<typeof vscode.window>;

    /** The mock `workspace` namespace -- access `.getConfiguration.mock` etc. for assertions. */
    readonly workspace: MockedNamespace<typeof vscode.workspace>;

    /**
     * Fire this emitter to simulate a workspace configuration change.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * m.configChangeEmitter.fire({
     *     affectsConfiguration: (s) => s === 'mySection.mySetting',
     * });
     * ```
     */
    readonly configChangeEmitter: EventEmitter<{ affectsConfiguration(section: string): boolean }>;

    /**
     * Fire this emitter to simulate a change in authentication sessions
     * (e.g. sign-in / sign-out) for a given provider.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * m.sessionsChangeEmitter.fire({ provider: { id: 'microsoft', label: 'Microsoft' } });
     * ```
     */
    readonly sessionsChangeEmitter: EventEmitter<vscode.AuthenticationSessionsChangeEvent>;

    /**
     * Fire this emitter to simulate a workspace folder change.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * m.workspaceFolders.push({ uri: m.vscode.Uri.file('/repo'), name: 'repo', index: 0 });
     * m.workspaceFoldersChangeEmitter.fire({ added: [...], removed: [] });
     * ```
     */
    readonly workspaceFoldersChangeEmitter: EventEmitter<vscode.WorkspaceFoldersChangeEvent>;

    /** The mock `tasks` namespace. */
    readonly tasks: MockedNamespace<typeof vscode.tasks>;

    /**
     * Fire this emitter to simulate a task process ending.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * const execution = await m.vscode.tasks.executeTask(task);
     * m.taskProcessEndEmitter.fire({ execution, exitCode: 0 });
     * ```
     */
    readonly taskProcessEndEmitter: EventEmitter<vscode.TaskProcessEndEvent>;

    /** Documents opened via `workspace.openTextDocument`, in order. */
    readonly textDocuments: vscode.TextDocument[];

    /** Documents passed to `window.showTextDocument`, in order. */
    readonly shownDocuments: vscode.TextDocument[];
}

/**
 * Creates a mock `IVsCode` instance with call tracking, suitable for
 * injection in unit and component tests.
 *
 * The returned object covers the `vscode` APIs used by
 * `showSmartQuickPick`, `showSmartInputBox`, `createOutputChannel`,
 * and the wizard pick-step infrastructure.
 *
 * @example
 * ```ts
 * const mock = createMockVsCode();
 * const ctx: ICodeContext = { code: mock.vscode, extensionContext };
 *
 * const resultPromise = showSmartQuickPick(ctx, items);
 *
 * // Simulate user accepting the first item
 * const qp = mock.quickPicks[0];
 * qp.activeItems = [items[0]];
 * qp.accept();
 *
 * expect(await resultPromise).to.equal(items[0]);
 * expect(mock.quickPicks).to.have.lengthOf(1);
 * ```
 */
export function createMockVsCode(overrides?: Partial<IVsCode>): MockVsCodeResult {
    const quickPicks: MockQuickPick<vscode.QuickPickItem>[] = [];
    const inputBoxes: MockInputBox[] = [];

    const createQuickPick = mock.fn(() => {
        const qp = new MockQuickPick<vscode.QuickPickItem>();
        quickPicks.push(qp);
        return qp;
    });

    const createInputBox = mock.fn(() => {
        const ib = new MockInputBox();
        inputBoxes.push(ib);
        return ib;
    });

    const createOutputChannel = mock.fn(
        (name: string) => new MockOutputChannel(name),
    );

    const showInformationMessage = mock.fn(() => Promise.resolve(undefined));
    const showWarningMessage = mock.fn(() => Promise.resolve(undefined));
    const showErrorMessage = mock.fn(() => Promise.resolve(undefined));

    const showOpenDialog = mock.fn(
        () => Promise.resolve(undefined),
    );

    const showWorkspaceFolderPick = mock.fn(
        () => Promise.resolve(undefined),
    );

    const withProgress = mock.fn(
        <T>(_options: vscode.ProgressOptions, task: () => Thenable<T>) => Promise.resolve(task()),
    );

    const t = mock.fn(
        (message: string, ...args: unknown[]) => {
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            return message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`));
        }
    );

    const QuickInputButtons = {
        Back: { iconPath: new MockThemeIcon('arrow-left') } satisfies vscode.QuickInputButton,
    };

    const settings = new Map<string, unknown>();

    const getConfiguration = mock.fn(
        (section?: string) => new MockWorkspaceConfiguration(settings, section),
    );

    const openExternal = mock.fn(
        () => Promise.resolve(true),
    );

    const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

    const executeCommand = mock.fn(
        () => Promise.resolve(undefined),
    );

    const registerCommand = mock.fn(
        (id: string, handler: (...args: unknown[]) => unknown) => {
            registeredCommands.set(id, handler);
            return { dispose: () => { registeredCommands.delete(id); } };
        },
    );

    const getSession = mock.fn(
        () => Promise.resolve(undefined),
    );

    const getAccounts = mock.fn(
        () => Promise.resolve([] as readonly vscode.AuthenticationSessionAccountInformation[]),
    );

    const sessionsChangeEmitter = new EventEmitter<vscode.AuthenticationSessionsChangeEvent>();

    const fs = new MockFileSystem();
    const workspaceFolders: vscode.WorkspaceFolder[] = [];

    const getWorkspaceFolder = mock.fn(
        (uri: vscode.Uri): vscode.WorkspaceFolder | undefined => {
            const uriStr = uri.toString();
            return workspaceFolders.find(f => uriStr.startsWith((f.uri).toString()));
        },
    );

    // Matches files in the mock file system against a glob, with no real
    // filesystem access. VS Code resolves a relative glob against workspace
    // folders, so a pattern without a path separator matches by basename
    // anywhere; we mirror that with a `**/` prefix. `dot: true` because VS
    // Code's glob matches dot-directories. The RelativePattern base is not
    // scoped.
    const findFiles = mock.fn(
        (include: vscode.GlobPattern, _exclude?: unknown, maxResults?: number) => {
            const raw = typeof include === 'string' ? include : include.pattern;
            const pattern = raw.includes('/') ? raw : `**/${raw}`;

            const matched: vscode.Uri[] = [];
            for (const filePath of fs.files.keys()) {
                if (maxResults !== undefined && matched.length >= maxResults) {
                    break;
                }
                if (minimatch(filePath, pattern, { dot: true })) {
                    // `fs.files` is keyed by `uri.path`, so rehydrate from URI
                    // components rather than treating the key as a filesystem
                    // path (which would mishandle drive letters / schemes).
                    matched.push(MockUri.from({ scheme: 'file', path: filePath }));
                }
            }
            return Promise.resolve(matched);
        },
    );
    const authentication = {
        getSession,
        getAccounts,
        onDidChangeSessions: sessionsChangeEmitter.event,
    };
    const commands = {
        executeCommand,
        registerCommand,
    };
    const env = {
        appHost: 'desktop',
        language: 'en',
        openExternal,
        remoteName: undefined,
    };
    const shownDocuments: vscode.TextDocument[] = [];

    const showTextDocument = mock.fn(
        (document: vscode.TextDocument, _options?: vscode.TextDocumentShowOptions) => {
            shownDocuments.push(document);
            return Promise.resolve({
                document,
                revealRange: mock.fn(),
                selection: undefined,
            } as unknown as vscode.TextEditor);
        },
    );

    const window = {
        createQuickPick,
        createInputBox,
        createOutputChannel,
        showInformationMessage,
        showWarningMessage,
        showErrorMessage,
        showOpenDialog,
        showWorkspaceFolderPick,
        showTextDocument,
        withProgress,
    };
    const configChangeEmitter = new EventEmitter<{ affectsConfiguration(section: string): boolean }>();
    const workspaceFoldersChangeEmitter = new EventEmitter<vscode.WorkspaceFoldersChangeEvent>();
    const taskProcessEndEmitter = new EventEmitter<vscode.TaskProcessEndEvent>();

    const textDocuments: vscode.TextDocument[] = [];
    const textDocumentContentProviders = new Map<string, vscode.TextDocumentContentProvider>();
    let untitledDocumentCount = 0;

    const registerFileSystemProvider = mock.fn(
        (_scheme: string, _provider: vscode.FileSystemProvider) => ({ dispose: () => undefined }),
    );

    const registerTextDocumentContentProvider = mock.fn(
        (scheme: string, provider: vscode.TextDocumentContentProvider) => {
            if (textDocumentContentProviders.has(scheme)) {
                throw new Error(`A text document content provider is already registered for '${scheme}'.`);
            }

            textDocumentContentProviders.set(scheme, provider);
            return {
                dispose: () => {
                    textDocumentContentProviders.delete(scheme);
                },
            };
        },
    );

    const readUriText = async (uri: vscode.Uri): Promise<string> => {
        const provider = textDocumentContentProviders.get(uri.scheme);
        if (provider) {
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => Disposable.None,
            } satisfies vscode.CancellationToken;
            return (await Promise.resolve(provider.provideTextDocumentContent(uri, token))) ?? '';
        }

        return Buffer.from(fs.files.get(uri.path) ?? new Uint8Array()).toString();
    };

    const nextUntitledUri = (): vscode.Uri => {
        untitledDocumentCount += 1;
        return MockUri.from({ scheme: 'untitled', path: `/Untitled-${untitledDocumentCount}` });
    };

    const openTextDocument = mock.fn(
        async (target: vscode.Uri | { language?: string; content?: string }): Promise<vscode.TextDocument> => {
            // `workspace.openTextDocument` is overloaded: a URI opens the file at that path, while an
            // options bag creates an untitled document from in-memory content. Discriminating on
            // `scheme` follows the real overloads, so an empty options bag still opens an untitled
            // document rather than being mistaken for a URI.
            const isUri = 'scheme' in target;
            const content = isUri ? await readUriText(target) : target.content ?? '';
            const document = {
                uri: isUri ? target : nextUntitledUri(),
                isUntitled: !isUri,
                languageId: isUri ? languageFromPath(target.path) : target.language ?? 'plaintext',
                getText: () => content,
                lineAt: (line: number) => ({ text: content.split(/\r?\n/)[line] ?? '' }),
                validateRange: (range: vscode.Range) => range,
            } as unknown as vscode.TextDocument;
            textDocuments.push(document);
            return Promise.resolve(document);
        },
    );

    const fileSystemWatchers: MockFileSystemWatcher[] = [];
    const createFileSystemWatcher = mock.fn(
        (pattern: vscode.GlobPattern): vscode.FileSystemWatcher => {
            const create = new EventEmitter<vscode.Uri>();
            const change = new EventEmitter<vscode.Uri>();
            const del = new EventEmitter<vscode.Uri>();
            const watcher = {
                ignoreCreateEvents: false,
                ignoreChangeEvents: false,
                ignoreDeleteEvents: false,
                onDidCreate: create.event,
                onDidChange: change.event,
                onDidDelete: del.event,
                dispose: () => { Disposable.disposeAll(create, change, del); },
            };
            fileSystemWatchers.push({
                pattern,
                fireCreate: uri => { create.fire(uri); },
                fireChange: uri => { change.fire(uri); },
                fireDelete: uri => { del.fire(uri); },
            });
            return watcher;
        },
    );

    const workspace = {
        createFileSystemWatcher,
        findFiles,
        getConfiguration,
        getWorkspaceFolder,
        onDidChangeConfiguration: configChangeEmitter.event,
        onDidChangeWorkspaceFolders: workspaceFoldersChangeEmitter.event,
        get workspaceFolders() { return workspaceFolders.length > 0 ? workspaceFolders : undefined; },
        fs,
        registerFileSystemProvider,
        registerTextDocumentContentProvider,
        openTextDocument,
    };

    const executeTask = mock.fn(
        (task: vscode.Task) => {
            const execution = { task, terminate: mock.fn() } as unknown as vscode.TaskExecution;
            return Promise.resolve(execution);
        },
    );

    const tasks = {
        executeTask,
        onDidEndTaskProcess: taskProcessEndEmitter.event,
    };
    const extensions = {
        all: [],
        getExtension: mock.fn(() => undefined),
    };

    const mockVsCode = {
        authentication,
        commands,
        env,
        extensions,
        tasks,
        window,
        workspace,
        l10n: { t },
        QuickInputButtons,
        QuickPickItemKind: MockQuickPickItemKind,
        TreeItem: MockTreeItem,
        TreeItemCollapsibleState: MockTreeItemCollapsibleState,
        ConfigurationTarget: MockConfigurationTarget,
        FileType: MockFileType,
        FilePermission: MockFilePermission,
        FileChangeType: MockFileChangeType,
        FileSystemError: MockFileSystemError,
        ProgressLocation: MockProgressLocation,
        ThemeIcon: MockThemeIcon,
        ThemeColor: MockThemeColor,
        MarkdownString: MockMarkdownString,
        ShellExecution: MockShellExecution,
        RelativePattern: MockRelativePattern,
        Task: MockTask,
        TaskScope: MockTaskScope,
        Uri: MockUri,
        ...overrides,
    } as unknown as IVsCode;

    return {
        vscode: mockVsCode,
        quickPicks,
        inputBoxes,
        settings,
        registeredCommands,
        fs,
        fileSystemWatchers,
        workspaceFolders,
        authentication,
        commands,
        env,
        window,
        workspace,
        configChangeEmitter,
        sessionsChangeEmitter,
        workspaceFoldersChangeEmitter,
        tasks,
        taskProcessEndEmitter,
        textDocuments,
        shownDocuments,
    } as unknown as MockVsCodeResult;
}

function languageFromPath(path: string): string | undefined {
    if (path.endsWith('.json')) {
        return 'json';
    }

    if (path.endsWith('.jsonc')) {
        return 'jsonc';
    }

    return undefined;
}

/**
 * Result of {@linkcode createMockCodeContext}. Bundles a ready-to-use
 * `ICodeContext` with the underlying mock for test assertions.
 */
export interface MockCodeContextResult {
    /** The `ICodeContext` ready for `showSmartQuickPick`, `showSmartInputBox`, etc. */
    readonly ctx: ICodeContext;

    /** The underlying {@linkcode MockVsCodeResult} for assertions and event control. */
    readonly mock: MockVsCodeResult;
}

/**
 * Convenience factory that builds a mock {@linkcode ICodeContext} ready
 * for use with `showSmartQuickPick`, `showSmartInputBox`, and the
 * wizard pick steps.
 *
 * @example
 * ```ts
 * const { ctx, mock } = createMockCodeContext();
 *
 * const resultPromise = showSmartInputBox(ctx, { prompt: 'Name?' });
 *
 * const ib = mock.inputBoxes[0];
 * ib.value = 'hello';
 * ib.accept();
 *
 * expect(await resultPromise).to.equal('hello');
 * ```
 */
export function createMockCodeContext(): MockCodeContextResult {
    const mockResult = createMockVsCode();
    const extensionContext = {
        workspaceState: new MockMemento(),
        globalState: Object.assign(new MockMemento(), {
            setKeysForSync: () => { /* noop */ },
        }),
        extension: {
            id: 'test-publisher.test-extension',
            packageJSON: { version: '0.0.0-test' },
        },
        extensionPath: '/mock/extension/path',
        extensionUri: MockUri.file('/mock/extension/path'),
        storageUri: MockUri.file('/mock/storage'),
        globalStorageUri: MockUri.file('/mock/globalStorage'),
    } as unknown as IExtensionContext;

    return {
        ctx: { code: mockResult.vscode, extensionContext },
        mock: mockResult,
    };
}

/**
 * Adds a workspace folder rooted at `path`, along with the backing directory in
 * the mock file system, and returns it.
 *
 * The folder name is the last path segment and the index is its position, so
 * repeated calls build a multi-root workspace.
 *
 * @example
 * ```ts
 * const m = createMockVsCode();
 * addWorkspaceFolder(m, '/repo');
 * addWorkspaceFile(m, '/repo/package.json', '{}');
 * ```
 */
export function addWorkspaceFolder(mock: MockVsCodeResult, path: string): vscode.WorkspaceFolder {
    const uri = mock.vscode.Uri.file(path);
    const folder: vscode.WorkspaceFolder = {
        uri,
        name: path.split('/').filter(Boolean).pop() ?? path,
        index: mock.workspaceFolders.length,
    };
    mock.workspaceFolders.push(folder);
    mock.fs.addDirectory(uri);
    return folder;
}

/**
 * Writes a file into the mock file system at `path`, creating the directories
 * above it. Convenience wrapper over {@linkcode MockFileSystem.addFile} that
 * saves building a `Uri` at each call site.
 */
export function addWorkspaceFile(mock: MockVsCodeResult, path: string, contents = ''): vscode.Uri {
    const uri = mock.vscode.Uri.file(path);
    mock.fs.addFile(uri, contents);
    return uri;
}

/**
 * Raises a file system event for `path` on every watcher whose glob matches it,
 * mirroring the filtering VS Code does before delivering to a watcher.
 *
 * Matching uses `dot: true`, because VS Code reports changes to dot-directories
 * (its default `files.watcherExclude` excludes `**‍/.git/objects/**`, which only
 * makes sense if `.git` paths are otherwise reported). Node's built-in
 * `matchesGlob` has no such option and silently drops them.
 *
 * @param kind - Which of the three watcher events to raise. Defaults to
 *   `'change'`.
 */
export function fireFileSystemEvent(
    mock: MockVsCodeResult,
    path: string,
    kind: 'create' | 'change' | 'delete' = 'change',
): void {
    const uri = mock.vscode.Uri.file(path);

    for (const watcher of mock.fileSystemWatchers) {
        if (typeof watcher.pattern !== 'string' || !minimatch(path, watcher.pattern, { dot: true })) {
            continue;
        }
        if (kind === 'create') {
            watcher.fireCreate(uri);
        } else if (kind === 'delete') {
            watcher.fireDelete(uri);
        } else {
            watcher.fireChange(uri);
        }
    }
}

/**
 * Run a callback with temporary configuration settings applied to the
 * mock. The original values are restored after the callback completes
 * (or throws), regardless of whether the callback is sync or async.
 *
 * @example
 * ```ts
 * const { ctx, mock } = createMockCodeContext();
 *
 * const result = await withSettings(mock, { 'myExt.timeout': 5000 }, async () => {
 *     // code under test reads vscode.workspace.getConfiguration('myExt').get('timeout')
 *     return await doSomething(ctx);
 * });
 * ```
 */
export function withSettings<T>(
    mockResult: MockVsCodeResult,
    overrides: Record<string, unknown>,
    callback: () => T | Promise<T>,
): T | Promise<T> {
    const { settings } = mockResult;
    const saved = new Map<string, { existed: boolean; value: unknown }>();

    // Apply overrides, saving originals
    for (const [key, value] of Object.entries(overrides)) {
        saved.set(key, {
            existed: settings.has(key),
            value: settings.get(key),
        });
        settings.set(key, value);
    }

    const restore = () => {
        for (const [key, prev] of saved) {
            if (prev.existed) {
                settings.set(key, prev.value);
            } else {
                settings.delete(key);
            }
        }
    };

    try {
        const result = callback();

        // Handle async callbacks
        if (result instanceof Promise) {
            return result.then(
                (v) => { restore(); return v; },
                (e: unknown) => { restore(); throw e; },
            );
        }

        restore();
        return result;
    } catch (e: unknown) {
        restore();
        throw e;
    }
}

/**
 * A single queued response for {@linkcode respondToPrompts}.
 *
 * - `{ pick: 'label' }` -- select a QuickPick item by its label
 * - `{ pickMany: ['a', 'b'] }` -- select multiple QuickPick items by label
 * - `{ input: 'text' }` -- type a value into an InputBox and accept
 * - `{ value: 'text' }` -- type a value into a combobox-style QuickPick (one
 *   that reacts to {@linkcode vscode.QuickPick.onDidChangeValue}) and accept the
 *   resulting active item
 * - `{ button: 'label' }` -- click a button on an information, warning, or error message
 * - `'acceptDefault'` -- accept the current value without changes
 * - `'goBack'` -- press the Back button (rejects with {@linkcode GoBackError})
 * - `'cancel'` -- dismiss the UI (modal UI rejects with {@linkcode CancellationError})
 */
export type WizardResponse =
    | { readonly pick: string }
    | { readonly pickMany: readonly string[] }
    | { readonly input: string }
    | { readonly value: string }
    | { readonly button: string }
    | 'acceptDefault'
    | 'goBack'
    | 'cancel';

/**
 * Returned by {@linkcode respondToPrompts} for post-run assertions.
 */
export interface ResponseTracker {
    /** Number of responses remaining in the queue. */
    readonly remaining: number;

    /** Throws if any responses were not consumed. */
    assertAllConsumed(): void;
}

/**
 * Pre-programs the mock to automatically respond to QuickPicks, InputBoxes,
 * and messages as they appear. Use this to drive wizards and other multi-step
 * UI flows in tests.
 *
 * Responses are consumed in order: the first response answers the
 * first supported UI shown, the second answers the next, etc.
 *
 * Notifications shown without any buttons are fire-and-forget and do not
 * consume a response, since there is nothing for a test to answer.
 *
 * @example
 * ```ts
 * const { ctx, mock } = createMockCodeContext();
 * const tracker = respondToPrompts(mock, [
 *     { pick: 'My Subscription' },
 *     { input: 'my-resource' },
 *     { button: 'Deploy' },
 * ]);
 *
 * const wizard = new Wizard(
 *     { picks: [] },
 *     [new SubscriptionPickStep(ctx), new NameInputStep(ctx)],
 * );
 * const result = await wizard.run();
 *
 * tracker.assertAllConsumed();
 * ```
 */
export function respondToPrompts(
    mockResult: MockVsCodeResult,
    responses: readonly WizardResponse[],
): ResponseTracker {
    const queue = [...responses];
    const backButton = mockResult.vscode.QuickInputButtons.Back;

    const createQPCtx = (mockResult.vscode.window.createQuickPick as unknown as UnknownMock).mock;
    const createIBCtx = (mockResult.vscode.window.createInputBox as unknown as UnknownMock).mock;
    const showInformationMessageCtx = (mockResult.vscode.window.showInformationMessage as unknown as UnknownMock).mock;
    const showWarningMessageCtx = (mockResult.vscode.window.showWarningMessage as unknown as UnknownMock).mock;
    const showErrorMessageCtx = (mockResult.vscode.window.showErrorMessage as unknown as UnknownMock).mock;

    const nextResponse = (ui: string): WizardResponse => {
        const response = queue.shift();
        if (response === undefined) {
            throw new Error(`Unexpected ${ui} shown: no more responses in queue`);
        }
        return response;
    };

    createQPCtx.mockImplementation(() => {
        const qp = new MockQuickPick<vscode.QuickPickItem>();
        (mockResult.quickPicks as MockQuickPick<vscode.QuickPickItem>[]).push(qp);

        qp.show.mock.mockImplementation(() => {
            applyToQuickPick(qp, nextResponse('QuickPick'), backButton);
        });

        return qp;
    });

    createIBCtx.mockImplementation(() => {
        const ib = new MockInputBox();
        (mockResult.inputBoxes as MockInputBox[]).push(ib);

        ib.show.mock.mockImplementation(() => {
            applyToInputBox(ib, nextResponse('InputBox'), backButton);
        });

        return ib;
    });

    const respondToMessage = (...args: unknown[]): Promise<string | undefined> => {
        const buttons = args.slice(1).filter((arg): arg is string => typeof arg === 'string');
        if (buttons.length === 0) {
            // A notification with no buttons is fire-and-forget: there is
            // nothing for the caller to answer, so it must not consume a
            // queued response. Otherwise adding a toast to product code would
            // break every test that drives unrelated UI through this queue.
            return Promise.resolve(undefined);
        }

        const response = nextResponse('message');
        if (response === 'cancel') {
            return Promise.resolve(undefined);
        }
        if (typeof response !== 'object' || !('button' in response)) {
            throw new Error('Got a non-button response but a message was shown');
        }

        if (!buttons.includes(response.button)) {
            throw new Error(`Message does not have a '${response.button}' button`);
        }
        return Promise.resolve(response.button);
    };

    showInformationMessageCtx.mockImplementation(respondToMessage);
    showWarningMessageCtx.mockImplementation(respondToMessage);
    showErrorMessageCtx.mockImplementation(respondToMessage);

    return {
        get remaining() { return queue.length; },
        assertAllConsumed() {
            if (queue.length > 0) {
                throw new Error(`${String(queue.length)} UI response(s) were not consumed`);
            }
        },
    };
}

function applyToQuickPick(
    qp: MockQuickPick<vscode.QuickPickItem>,
    response: WizardResponse,
    backButton: vscode.QuickInputButton,
): void {
    if (response === 'goBack') {
        qp.pressButton(backButton);
        return;
    } else if (response === 'cancel') {
        qp.triggerHide();
        return;
    } else if (response === 'acceptDefault') {
        qp.accept();
        return;
    } else if ('input' in response) {
        throw new Error('Got an \'input\' response but a QuickPick was shown');
    } else if ('button' in response) {
        throw new Error('Got a \'button\' response but a QuickPick was shown');
    } else if ('value' in response) {
        // Combobox: type a value (firing onDidChangeValue so the production
        // code can synthesize an item), then accept whatever it made active.
        qp.changeValue(response.value);
        qp.accept();
        return;
    } else if ('pickMany' in response) {
        const wanted = new Set(response.pickMany);
        const items = [...qp.items].filter(i => wanted.has(i.label));
        if (items.length !== wanted.size) {
            const available = [...qp.items].map(i => i.label).join(', ');
            throw new Error(
                `Not all pickMany items found. Wanted: [${[...wanted].join(', ')}]. Available: [${available}]`,
            );
        }
        qp.selectedItems = items;
        qp.accept();
        return;
    } else {
        // { pick: string }
        const item = [...qp.items].find(i => i.label === response.pick);
        if (!item) {
            const available = [...qp.items].map(i => i.label).join(', ');
            throw new Error(
                `No QuickPick item with label '${response.pick}'. Available: [${available}]`,
            );
        }
        qp.activeItems = [item];
        qp.accept();
    }
}

function applyToInputBox(
    ib: MockInputBox,
    response: WizardResponse,
    backButton: vscode.QuickInputButton,
): void {
    if (response === 'goBack') {
        ib.pressButton(backButton);
        return;
    } else if (response === 'cancel') {
        ib.triggerHide();
        return;
    } else if (response === 'acceptDefault') {
        ib.accept();
        return;
    } else if ('pick' in response || 'pickMany' in response || 'value' in response || 'button' in response) {
        throw new Error('Got a non-input response but an InputBox was shown');
    } else {
        // { input: string }
        ib.changeValue(response.input);
        ib.accept();
    }
}

type UnknownMock = Mock<(...args: unknown[]) => unknown>;
