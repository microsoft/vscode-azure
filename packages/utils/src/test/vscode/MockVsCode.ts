/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { Disposable } from '../../vscode/Disposable';
import { DebugOutputChannel } from '../../vscode/IOutputChannel';
import type { ICodeContext, IExtensionContext, IVsCode } from '../../vscode/IVsCode';
import { MockMemento } from './config/MockMemento';
import { MockWorkspaceConfiguration } from './config/MockWorkspaceConfiguration';
import { MockInputBox } from './input/MockInputBox';
import { MockQuickPick } from './input/MockQuickPick';
import { MockTreeItem } from './tree/MockTreeItem';

/**
 * Minimal stand-in for `vscode.Uri` used by {@linkcode createMockVsCode}.
 *
 * Only implements the subset of `Uri` relied on by code under test:
 * `scheme`, `path`, `fsPath`, `toString()`, and the static `file` /
 * `joinPath` factories.
 */
export class MockUri {
    constructor(
        public readonly scheme: string,
        public readonly path: string,
        public readonly fsPath: string = path,
    ) { }
    /** Returns `scheme://path`. */
    toString() { return `${this.scheme}://${this.path}`; }
    /** Creates a `file:` scheme {@linkcode MockUri} for the given path. */
    static file(path: string) { return new MockUri('file', path); }
    /** Joins additional path segments onto `base` using `/` as separator. */
    static joinPath(base: MockUri, ...segments: string[]) {
        return new MockUri(base.scheme, [base.path, ...segments].join('/'));
    }
}

/**
 * Result of {@linkcode createMockVsCode}. Provides both the injectable
 * `IVsCode` value and test-inspection surfaces.
 *
 * All tracked methods on the `IVsCode` are Node.js `mock.fn()` instances.
 * To access the `.mock` property for assertions, cast to the concrete type:
 *
 * ```ts
 * const fn = result.vscode.window.createQuickPick as unknown as Mock<...>;
 * expect(fn.mock.callCount()).to.equal(1);
 * ```
 *
 * Or use the collected {@linkcode quickPicks} / {@linkcode inputBoxes} arrays to
 * inspect and drive the created UI elements directly.
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
        (name: string) => new DebugOutputChannel(name),
    );

    const showInformationMessage = mock.fn(
        () => Promise.resolve(),
    );

    const showWarningMessage = mock.fn(
        () => Promise.resolve(),
    );

    const showErrorMessage = mock.fn(
        () => Promise.resolve(),
    );

    const showOpenDialog = mock.fn(
        () => Promise.resolve(undefined),
    );

    const showWorkspaceFolderPick = mock.fn(
        () => Promise.resolve(undefined),
    );

    const t = mock.fn(
        (message: string, ...args: unknown[]) => {
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            return message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`));
        }
    );

    const QuickInputButtons = {
        Back: { iconPath: { id: 'arrow-left' } } satisfies vscode.QuickInputButton,
    };

    const TreeItemCollapsibleState = {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    } satisfies typeof vscode.TreeItemCollapsibleState;

    const settings = new Map<string, unknown>();

    const getConfiguration = mock.fn(
        (section?: string) => new MockWorkspaceConfiguration(settings, section),
    );

    const ConfigurationTarget = {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3,
    } satisfies typeof vscode.ConfigurationTarget;

    class MockThemeIcon {
        constructor(public readonly id: string, public readonly color?: unknown) { }
    }

    class MockThemeColor {
        constructor(public readonly id: string) { }
    }

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

    const mockVsCode = {
        authentication: {
            getSession,
        },
        commands: {
            executeCommand,
            registerCommand,
        },
        env: {
            appHost: 'desktop',
            language: 'en',
            openExternal,
            remoteName: undefined,
        },
        window: {
            createQuickPick,
            createInputBox,
            createOutputChannel,
            showInformationMessage,
            showWarningMessage,
            showErrorMessage,
            showOpenDialog,
            showWorkspaceFolderPick,
        },
        workspace: {
            getConfiguration,
            onDidChangeConfiguration: () => Disposable.None,
        },
        l10n: { t },
        QuickInputButtons,
        TreeItem: MockTreeItem,
        TreeItemCollapsibleState,
        ConfigurationTarget,
        ThemeIcon: MockThemeIcon,
        ThemeColor: MockThemeColor,
        Uri: MockUri,
        ...overrides,
    } as unknown as IVsCode;

    return {
        vscode: mockVsCode,
        quickPicks,
        inputBoxes,
        settings,
        registeredCommands,
    };
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
 * - `'acceptDefault'` -- accept the current value without changes
 * - `'goBack'` -- press the Back button (rejects with {@linkcode GoBackError})
 * - `'cancel'` -- dismiss the UI (rejects with {@linkcode CancellationError})
 */
export type WizardResponse =
    | { readonly pick: string }
    | { readonly pickMany: readonly string[] }
    | { readonly input: string }
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
    } else if ('pick' in response || 'pickMany' in response) {
        throw new Error('Got a \'pick\'/\'pickMany\' response but an InputBox was shown');
    } else {
        // { input: string }
        ib.changeValue(response.input);
        ib.accept();
    }
}

type UnknownMock = Mock<(...args: unknown[]) => unknown>;
