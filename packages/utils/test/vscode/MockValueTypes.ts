/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Satisfies } from '../../src/types/Satisfies';
import { MockUri } from './MockUri';

/**
 * Test-only stand-ins for `vscode`'s pure value/data types.
 *
 * These carry no editor coupling -- they are plain data holders -- so they are
 * implemented here as real classes rather than mocked. Each is paired with
 * bidirectional {@linkcode Satisfies} checks against its `vscode` counterpart
 * so the shapes cannot silently drift. They live under `test/` because product
 * code constructs the editor's real types at runtime; the `Mock` prefix keeps
 * IntelliSense from auto-importing them into product code by mistake.
 */

/** Test stand-in for {@linkcode vscode.ThemeColor}. */
export class MockThemeColor implements vscode.ThemeColor {
    constructor(public readonly id: string) { }
}

/** Test stand-in for {@linkcode vscode.ThemeIcon}, including the `File`/`Folder` statics. */
export class MockThemeIcon implements vscode.ThemeIcon {
    public static readonly File = new MockThemeIcon('file');
    public static readonly Folder = new MockThemeIcon('folder');

    constructor(public readonly id: string, public readonly color?: vscode.ThemeColor) { }
}

/**
 * Test stand-in for {@linkcode vscode.MarkdownString}.
 *
 * The editor's implementation parses and renders the markdown; this one only
 * accumulates it, which is all a test needs to assert what a tree item's
 * tooltip says.
 */
export class MockMarkdownString implements vscode.MarkdownString {
    public supportThemeIcons?: boolean;
    public supportHtml?: boolean;
    public baseUri?: vscode.Uri;

    constructor(
        public value: string = '',
        public isTrusted?: boolean | { readonly enabledCommands: readonly string[] },
    ) { }

    public appendText(value: string): vscode.MarkdownString {
        this.value += escapeMarkdown(value);
        return this;
    }

    public appendMarkdown(value: string): vscode.MarkdownString {
        this.value += value;
        return this;
    }

    public appendCodeblock(value: string, language: string = ''): vscode.MarkdownString {
        this.value += `\n\`\`\`${language}\n${value}\n\`\`\`\n`;
        return this;
    }
}

/** Escapes the markdown control characters, matching `appendText`'s contract. */
function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
}

/** Test stand-in for {@linkcode vscode.ShellExecution} created from a command and arguments. */
export class MockShellExecution implements vscode.ShellExecution {
    public readonly commandLine: string | undefined = undefined;

    constructor(
        public readonly command: string | vscode.ShellQuotedString | undefined,
        public readonly args: Array<string | vscode.ShellQuotedString> | undefined,
        public readonly options?: vscode.ShellExecutionOptions,
    ) { }
}

/** Test stand-in for {@linkcode vscode.Task}. */
export class MockTask implements vscode.Task {
    public isBackground = false;
    public presentationOptions: vscode.TaskPresentationOptions = {};
    public problemMatchers: string[];
    public runOptions: vscode.RunOptions = {};

    constructor(
        public definition: vscode.TaskDefinition,
        public readonly scope: vscode.TaskScope | vscode.WorkspaceFolder | undefined,
        public name: string,
        public source: string,
        public execution?: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution,
        problemMatchers?: string | string[],
    ) {
        this.problemMatchers = typeof problemMatchers === 'string'
            ? [problemMatchers]
            : problemMatchers ?? [];
    }
}

/** Test stand-in for {@linkcode vscode.FoldingRange}. */
export class MockFoldingRange implements vscode.FoldingRange {
    constructor(
        public start: number,
        public end: number,
        public kind?: vscode.FoldingRangeKind,
    ) { }
}

/** Test stand-in for {@linkcode vscode.RelativePattern}. */
export class MockRelativePattern implements vscode.RelativePattern {
    public readonly baseUri: vscode.Uri;
    public readonly base: string;

    constructor(
        from: vscode.WorkspaceFolder | vscode.Uri | string,
        public readonly pattern: string,
    ) {
        this.baseUri = typeof from === 'string' ? MockUri.file(from)
            : 'uri' in from ? from.uri
                : from;
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- mirrors vscode's deprecated `base` string form
        this.base = typeof from === 'string' ? from : this.baseUri.fsPath;
    }
}

/** Test stand-in for {@linkcode vscode.TreeItemCollapsibleState}. */
export const MockTreeItemCollapsibleState = {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
} satisfies typeof vscode.TreeItemCollapsibleState;

/** Test stand-in for {@linkcode vscode.ConfigurationTarget}. */
export const MockConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
} satisfies typeof vscode.ConfigurationTarget;

/** Test stand-in for {@linkcode vscode.TaskScope}. */
export const MockTaskScope = {
    Global: 1,
    Workspace: 2,
} satisfies typeof vscode.TaskScope;

/** Test stand-in for {@linkcode vscode.ProgressLocation}. */
export const MockProgressLocation = {
    SourceControl: 1,
    Window: 10,
    Notification: 15,
} satisfies typeof vscode.ProgressLocation;

// Compile-time checks: each value type is mutually assignable to its vscode
// counterpart, so the shapes are faithful in both directions.
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckThemeColor = Satisfies<MockThemeColor, vscode.ThemeColor>;
type ReverseCheckThemeColor = Satisfies<vscode.ThemeColor, MockThemeColor>;
type ForwardCheckThemeIcon = Satisfies<MockThemeIcon, vscode.ThemeIcon>;
type ReverseCheckThemeIcon = Satisfies<vscode.ThemeIcon, MockThemeIcon>;
type ForwardCheckMarkdownString = Satisfies<MockMarkdownString, vscode.MarkdownString>;
type ReverseCheckMarkdownString = Satisfies<vscode.MarkdownString, MockMarkdownString>;
type ForwardCheckShellExecution = Satisfies<MockShellExecution, vscode.ShellExecution>;
type ReverseCheckShellExecution = Satisfies<vscode.ShellExecution, MockShellExecution>;
type ForwardCheckTask = Satisfies<MockTask, vscode.Task>;
type ReverseCheckTask = Satisfies<vscode.Task, MockTask>;
type ForwardCheckFoldingRange = Satisfies<MockFoldingRange, vscode.FoldingRange>;
type ReverseCheckFoldingRange = Satisfies<vscode.FoldingRange, MockFoldingRange>;
type ForwardCheckRelativePattern = Satisfies<MockRelativePattern, vscode.RelativePattern>;
type ReverseCheckRelativePattern = Satisfies<vscode.RelativePattern, MockRelativePattern>;
/* eslint-enable @typescript-eslint/no-unused-vars */
