/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesGlob } from 'node:path/posix';
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
import { MockConfigurationTarget, MockProgressLocation, MockRelativePattern, MockShellExecution, MockTask, MockTaskScope, MockThemeColor, MockThemeIcon, MockTreeItemCollapsibleState } from './MockValueTypes';
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
 * A watcher created via `workspace.createFileSystemWatcher`, captured so tests
 * can assert on the pattern it watches and fire file events at the code under
 * test.
 */
export interface MockFileSystemWatcher {
    /** The glob the watcher was created for. */
    readonly pattern: vscode.GlobPattern;
    /** Fire to simulate a file being created. */
    readonly createEmitter: EventEmitter<vscode.Uri>;
    /** Fire to simulate a file being changed. */
    readonly changeEmitter: EventEmitter<vscode.Uri>;
    /** Fire to simulate a file being deleted. */
    readonly deleteEmitter: EventEmitter<vscode.Uri>;
    /** Whether the code under test has disposed this watcher. */
    disposed: boolean;
}

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
     * Pre-programmed responses for `showInformationMessage`,
     * `showWarningMessage`, and `showErrorMessage`.
     *
     * Push button labels (e.g. `'Delete'`) to simulate the user
     * clicking a button. Push `undefined` to simulate dismissal
     * (the default when the queue is empty).
     *
     * Responses are consumed in order across all three message types.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * m.messageResponses.push('Delete');
     *
     * // code under test calls showWarningMessage('Sure?', 'Delete', 'Cancel')
     * // => resolves to 'Delete'
     * ```
     */
    readonly messageResponses: (string | undefined)[];

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

    /**
     * Watchers created via `workspace.createFileSystemWatcher`, in creation
     * order, each paired with the pattern it was created for and emitters the
     * test can fire to simulate file events.
     *
     * @example
     * ```ts
     * const m = createMockVsCode();
     * // code under test calls createFileSystemWatcher('**\/host.json')
     * m.fileSystemWatchers[0].createEmitter.fire(m.vscode.Uri.file('/repo/host.json'));
     * ```
     */
    readonly fileSystemWatchers: readonly MockFileSystemWatcher[];

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

    const messageResponses: (string | undefined)[] = [];
    const nextMessageResponse = () => Promise.resolve(messageResponses.shift());

    const showInformationMessage = mock.fn(nextMessageResponse);
    const showWarningMessage = mock.fn(nextMessageResponse);
    const showErrorMessage = mock.fn(nextMessageResponse);

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

    // Matches files in the mock file system against a glob, using Node's
    // pure `path.matchesGlob` (no real filesystem access). VS Code resolves a
    // relative glob against workspace folders, so a pattern without a path
    // separator matches by basename anywhere; we mirror that with a `**/`
    // prefix. The RelativePattern base is not scoped.
    const findFiles = mock.fn(
        (include: vscode.GlobPattern, _exclude?: unknown, maxResults?: number) => {
            const raw = typeof include === 'string' ? include : include.pattern;
            const pattern = raw.includes('/') ? raw : `**/${raw}`;

            const matched: vscode.Uri[] = [];
            for (const filePath of fs.files.keys()) {
                if (maxResults !== undefined && matched.length >= maxResults) {
                    break;
                }
                if (matchesGlob(filePath, pattern)) {
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
        (document: vscode.TextDocument) => {
            shownDocuments.push(document);
            return Promise.resolve({ document } as unknown as vscode.TextEditor);
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

    const registerFileSystemProvider = mock.fn(
        (_scheme: string, _provider: vscode.FileSystemProvider) => ({ dispose: () => undefined }),
    );

    const fileSystemWatchers: MockFileSystemWatcher[] = [];

    const openTextDocument = mock.fn(
        (uri: vscode.Uri): Promise<vscode.TextDocument> => {
            const document = { uri } as vscode.TextDocument;
            textDocuments.push(document);
            return Promise.resolve(document);
        },
    );

    const createFileSystemWatcher = mock.fn(
        (pattern: vscode.GlobPattern): vscode.FileSystemWatcher => {
            const create = new EventEmitter<vscode.Uri>();
            const change = new EventEmitter<vscode.Uri>();
            const del = new EventEmitter<vscode.Uri>();
            const entry: MockFileSystemWatcher = {
                pattern,
                createEmitter: create,
                changeEmitter: change,
                deleteEmitter: del,
                disposed: false,
            };
            fileSystemWatchers.push(entry);

            return {
                ignoreCreateEvents: false,
                ignoreChangeEvents: false,
                ignoreDeleteEvents: false,
                onDidCreate: create.event,
                onDidChange: change.event,
                onDidDelete: del.event,
                dispose: () => {
                    Disposable.disposeAll(create, change, del);
                    entry.disposed = true;
                },
            };
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

    const mockVsCode = {
        authentication,
        commands,
        env,
        tasks,
        window,
        workspace,
        l10n: { t },
        QuickInputButtons,
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
        workspaceFolders,
        authentication,
        commands,
        env,
        window,
        workspace,
        messageResponses,
        configChangeEmitter,
        sessionsChangeEmitter,
        workspaceFoldersChangeEmitter,
        fileSystemWatchers,
        tasks,
        taskProcessEndEmitter,
        textDocuments,
        shownDocuments,
    } as unknown as MockVsCodeResult;
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
 * - `'acceptDefault'` -- accept the current value without changes
 * - `'goBack'` -- press the Back button (rejects with {@linkcode GoBackError})
 * - `'cancel'` -- dismiss the UI (rejects with {@linkcode CancellationError})
 */
export type WizardResponse =
    | { readonly pick: string }
    | { readonly pickMany: readonly string[] }
    | { readonly input: string }
    | { readonly value: string }
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
 * Pre-programs the mock to automatically respond to QuickPicks and
 * InputBoxes as they appear. Use this to drive wizards and other
 * multi-step UI flows in tests.
 *
 * Responses are consumed in order: the first response answers the
 * first QuickPick or InputBox shown, the second answers the next, etc.
 *
 * @example
 * ```ts
 * const { ctx, mock } = createMockCodeContext();
 * const tracker = respondToPrompts(mock, [
 *     { pick: 'My Subscription' },
 *     { input: 'my-resource' },
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

    createQPCtx.mockImplementation(() => {
        const qp = new MockQuickPick<vscode.QuickPickItem>();
        (mockResult.quickPicks as MockQuickPick<vscode.QuickPickItem>[]).push(qp);

        qp.show.mock.mockImplementation(() => {
            const response = queue.shift();
            if (response === undefined) {
                throw new Error('Unexpected QuickPick shown: no more responses in queue');
            }
            applyToQuickPick(qp, response, backButton);
        });

        return qp;
    });

    createIBCtx.mockImplementation(() => {
        const ib = new MockInputBox();
        (mockResult.inputBoxes as MockInputBox[]).push(ib);

        ib.show.mock.mockImplementation(() => {
            const response = queue.shift();
            if (response === undefined) {
                throw new Error('Unexpected InputBox shown: no more responses in queue');
            }
            applyToInputBox(ib, response, backButton);
        });

        return ib;
    });

    return {
        get remaining() { return queue.length; },
        assertAllConsumed() {
            if (queue.length > 0) {
                throw new Error(`${String(queue.length)} wizard response(s) were not consumed`);
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
    } else if ('pick' in response || 'pickMany' in response || 'value' in response) {
        throw new Error('Got a \'pick\'/\'pickMany\'/\'value\' response but an InputBox was shown');
    } else {
        // { input: string }
        ib.changeValue(response.input);
        ib.accept();
    }
}

type UnknownMock = Mock<(...args: unknown[]) => unknown>;
