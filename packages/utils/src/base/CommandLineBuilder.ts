/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Shell-quoting styles, mirroring `vscode.ShellQuoting`. Attach one to a value
 * via {@linkcode ShellQuotedString} when a command runs as a VS Code task so the
 * editor knows how to quote it for the target shell.
 */
export const ShellQuoting = {
    /** Character escaping (e.g. `\` on bash, `` ` `` on PowerShell). */
    Escape: 1,
    /** Strong quoting -- treats the value as a literal string. */
    Strong: 2,
    /** Weak quoting -- still allows some evaluation inside the quotes. */
    Weak: 3,
} as const satisfies Record<string, vscode.ShellQuoting>;

/** A shell-quoting style. Structurally identical to `vscode.ShellQuoting`. */
export type ShellQuoting = vscode.ShellQuoting;

/**
 * A string paired with a {@linkcode ShellQuoting} style. Structurally compatible
 * with `vscode.ShellQuotedString` so it can be passed straight to a
 * `vscode.ShellExecution` for foreground task execution.
 */
export interface ShellQuotedString {
    readonly value: string;
    readonly quoting: ShellQuoting;
}

/** A single command-line argument: a raw string or a quoted string. */
export type CommandLineArg = string | ShellQuotedString;

/** An ordered list of command-line arguments. */
export type CommandLineArgs = Array<CommandLineArg>;

/** Options for {@linkcode CommandLineBuilder.named}. */
export interface NamedArgOptions {
    /**
     * Emit as a single `name=value` token instead of two separate `name` and
     * `value` tokens. When set, {@linkcode NamedArgOptions.quoting} is ignored.
     */
    readonly assign?: boolean;
    /**
     * Attach shell-quoting metadata to the value (for foreground task
     * execution). Omit to pass the value verbatim, which is the correct choice
     * for argv-first background execution.
     */
    readonly quoting?: ShellQuoting;
}

/**
 * A fluent, chainable builder for a command and its arguments.
 *
 * @remarks
 * Create one with {@linkcode command}. The builder carries the executable
 * ({@linkcode CommandLineBuilder.command command}) plus an ordered argument
 * list; there is no terminal `build()` step. Iterate it, spread it, or call
 * {@linkcode CommandLineBuilder.toArray toArray} to get the arguments as a plain
 * array. Empty/`null`/`undefined` argument values are skipped.
 *
 * Argument-adding methods ({@linkcode CommandLineBuilder.arg arg},
 * {@linkcode CommandLineBuilder.flag flag}, and {@linkcode CommandLineBuilder.named named}
 * without a `quoting` option) append plain strings so argv-first execution never
 * performs implicit shell parsing. Use {@linkcode CommandLineBuilder.quoted quoted}
 * or the `quoting` option on `named` when the value needs VS Code shell-quoting
 * metadata for a task.
 *
 * @example
 * ```ts
 * command('azd').arg('provision').named('--location', 'westus').flag('--force');
 * ```
 */
export class CommandLineBuilder implements Iterable<CommandLineArg> {
    private readonly _args: CommandLineArgs = [];

    private constructor(
        /** The executable to run. */
        public readonly command: string,
    ) { }

    /** Creates a builder for the given executable. Prefer the {@linkcode command} factory. */
    public static create(command: string): CommandLineBuilder {
        return new CommandLineBuilder(command);
    }

    /**
     * Appends one or more positional arguments verbatim. `null`, `undefined`,
     * and empty-string values are skipped.
     */
    public arg(...values: Array<CommandLineArg | null | undefined>): this {
        for (const value of values) {
            if (isNonEmptyArg(value)) {
                this._args.push(value);
            }
        }
        return this;
    }

    /**
     * Appends one or more arguments with {@linkcode ShellQuoting.Strong} quoting
     * metadata, for values that must survive shell interpretation during
     * foreground task execution.
     */
    public quoted(...values: Array<string | null | undefined>): this {
        for (const value of values) {
            if (isNonEmptyArg(value)) {
                this._args.push({ value, quoting: ShellQuoting.Strong });
            }
        }
        return this;
    }

    /**
     * Conditionally appends a boolean flag such as `--force`.
     *
     * @param name - The flag token.
     * @param include - When falsy, the flag is omitted. Defaults to `true`.
     */
    public flag(name: string, include: boolean = true): this {
        if (include) {
            this._args.push(name);
        }
        return this;
    }

    /**
     * Appends a named argument such as `--location westus`. Accepts a single
     * value or an array of values (the name is repeated for each). Empty values
     * are skipped.
     *
     * @param name - The argument name (e.g. `--location`).
     * @param value - The value(s) for the argument.
     * @param options - Formatting/quoting options; see {@linkcode NamedArgOptions}.
     */
    public named(
        name: string,
        value: string | ReadonlyArray<string | null | undefined> | null | undefined,
        options?: NamedArgOptions,
    ): this {
        const values: ReadonlyArray<string | null | undefined> =
            typeof value === 'string' || value === null || value === undefined
                ? [value]
                : value;
        for (const v of values) {
            if (v === null || v === undefined || v === '') {
                continue;
            }
            if (options?.assign) {
                this._args.push(`${name}=${v}`);
            } else if (options?.quoting !== undefined) {
                this._args.push(name, { value: v, quoting: options.quoting });
            } else {
                this._args.push(name, v);
            }
        }
        return this;
    }

    /** The accumulated arguments as a new plain array (excludes the executable). */
    public get args(): CommandLineArgs {
        return [...this._args];
    }

    /** Returns the accumulated arguments as a new plain array (excludes the executable). */
    public toArray(): CommandLineArgs {
        return [...this._args];
    }

    /** Iterates the accumulated arguments (excludes the executable). */
    public [Symbol.iterator](): Iterator<CommandLineArg> {
        return this._args[Symbol.iterator]();
    }
}

/**
 * Type guard that returns `true` when {@linkcode value} is a
 * {@linkcode CommandLineBuilder}.
 */
export function isCommandLineBuilder(value: unknown): value is CommandLineBuilder {
    return value instanceof CommandLineBuilder;
}

/**
 * Creates a {@linkcode CommandLineBuilder} for {@linkcode command}.
 *
 * @example
 * ```ts
 * command('azd').arg('env', 'list').named('--output', 'json');
 * ```
 */
export function command(command: string): CommandLineBuilder {
    return CommandLineBuilder.create(command);
}

function isNonEmptyArg(value: CommandLineArg | null | undefined): value is CommandLineArg {
    return value !== null && value !== undefined && value !== '';
}
