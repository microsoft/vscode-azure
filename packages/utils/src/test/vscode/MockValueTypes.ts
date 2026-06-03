/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Satisfies } from '../../types/Satisfies';
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
    public problemMatchers: string[] = [];
    public runOptions: vscode.RunOptions = {};

    constructor(
        public definition: vscode.TaskDefinition,
        public readonly scope: vscode.TaskScope | vscode.WorkspaceFolder | undefined,
        public name: string,
        public source: string,
        public execution?: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution,
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

// Compile-time checks: each value type is mutually assignable to its vscode
// counterpart, so the shapes are faithful in both directions.
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckThemeColor = Satisfies<MockThemeColor, vscode.ThemeColor>;
type ReverseCheckThemeColor = Satisfies<vscode.ThemeColor, MockThemeColor>;
type ForwardCheckThemeIcon = Satisfies<MockThemeIcon, vscode.ThemeIcon>;
type ReverseCheckThemeIcon = Satisfies<vscode.ThemeIcon, MockThemeIcon>;
type ForwardCheckShellExecution = Satisfies<MockShellExecution, vscode.ShellExecution>;
type ReverseCheckShellExecution = Satisfies<vscode.ShellExecution, MockShellExecution>;
type ForwardCheckTask = Satisfies<MockTask, vscode.Task>;
type ReverseCheckTask = Satisfies<vscode.Task, MockTask>;
type ForwardCheckRelativePattern = Satisfies<MockRelativePattern, vscode.RelativePattern>;
type ReverseCheckRelativePattern = Satisfies<vscode.RelativePattern, MockRelativePattern>;
/* eslint-enable @typescript-eslint/no-unused-vars */
