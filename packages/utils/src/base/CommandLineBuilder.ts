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

/** Options for {@linkcode CommandLineBuilder.namedArg}. */
export interface NamedArgOptions {
    /**
     * Join the name and value into a single token using this separator instead
     * of emitting two separate `name` and `value` tokens. Typically `'='` (for
     * `--name=value`), but some CLIs use other separators (e.g. `':'` for
     * `--name:value`, which `dotnet msbuild` expects). When set,
     * {@linkcode NamedArgOptions.quoting} is ignored.
     */
    readonly assignCharacter?: string;
    /**
     * Attach shell-quoting metadata to the value (for foreground task
     * execution). Omit to pass the value verbatim, which is the correct choice
     * for argv-first background execution.
     */
    readonly quoting?: ShellQuoting;
}

/**
 * A fluent, chainable builder for a command line, represented as its own
 * argument vector.
 *
 * @remarks
 * Create one with {@linkcode command}. A `CommandLineBuilder` **is** a
 * {@linkcode CommandLineArgs} array whose first element is the executable and
 * whose remaining elements are its arguments -- there is no separate `command`
 * field and no terminal `build()` step. Because it is a real array you can pass
 * it anywhere a {@linkcode CommandLineArgs} is expected, spread it, index it, or
 * iterate it directly. Empty/`null`/`undefined` argument values are skipped.
 *
 * The executable is only separated from the arguments at execution time (when
 * decomposing for a direct spawn or a `vscode.ShellExecution`).
 *
 * Argument-adding methods ({@linkcode CommandLineBuilder.arg arg},
 * {@linkcode CommandLineBuilder.flagArg flagArg}, and {@linkcode CommandLineBuilder.namedArg namedArg}
 * without a `quoting` option) append plain strings so argv-first execution never
 * performs implicit shell parsing. Use {@linkcode CommandLineBuilder.quotedArg quotedArg}
 * or the `quoting` option on `namedArg` when the value needs VS Code shell-quoting
 * metadata for a task.
 *
 * @example
 * ```ts
 * command('azd').arg('provision').namedArg('--location', 'westus').flagArg('--force', force);
 * // -> ['azd', 'provision', '--location', 'westus', '--force']  (when `force`)
 * ```
 */
export class CommandLineBuilder extends Array<CommandLineArg> {
    /**
     * Ensures inherited `Array` methods (`map`, `filter`, `slice`, ...) produce
     * plain arrays instead of trying to construct a `CommandLineBuilder` (whose
     * constructor expects an executable, not a length).
     */
    public static override get [Symbol.species](): ArrayConstructor {
        return Array;
    }

    private constructor(command: string) {
        // `Array`'s single-string overload yields a one-element array, so the
        // executable becomes element 0 (unlike a single-number length arg).
        super(command);
    }

    /**
     * Creates a builder seeded with the given executable.
     * @internal Prefer the {@linkcode command} factory.
     */
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
                this.push(value);
            }
        }
        return this;
    }

    /**
     * Appends one or more arguments with {@linkcode ShellQuoting.Strong} quoting
     * metadata, for values that must survive shell interpretation during
     * foreground task execution.
     */
    public quotedArg(...values: Array<string | null | undefined>): this {
        for (const value of values) {
            if (isNonEmptyArg(value)) {
                this.push({ value, quoting: ShellQuoting.Strong });
            }
        }
        return this;
    }

    /**
     * Conditionally appends a boolean flag such as `--force`.
     *
     * Prefer {@linkcode CommandLineBuilder.arg arg} for a flag that is always
     * present: passing no {@linkcode include} makes this equivalent, while
     * implying a condition the reader will look for and not find.
     *
     * @param name - The flag token.
     * @param include - When falsy, the flag is omitted. Defaults to `true`.
     */
    public flagArg(name: string, include: boolean = true): this {
        if (include) {
            this.push(name);
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
    public namedArg(
        name: string,
        value: string | ReadonlyArray<string | null | undefined> | null | undefined,
        options?: NamedArgOptions,
    ): this {
        const values: ReadonlyArray<string | null | undefined> = Array.isArray(value) ? value : [value];
        for (const v of values) {
            if (!isNonEmptyArg(v)) {
                continue;
            }
            if (options?.assignCharacter !== undefined) {
                this.push(`${name}${options.assignCharacter}${v}`);
            } else if (options?.quoting !== undefined) {
                this.push(name, { value: v, quoting: options.quoting });
            } else {
                this.push(name, v);
            }
        }
        return this;
    }
}

/**
 * Creates a {@linkcode CommandLineBuilder} for {@linkcode command}.
 *
 * @example
 * ```ts
 * command('azd').arg('env', 'list').namedArg('--output', 'json');
 * ```
 */
export function command(command: string): CommandLineBuilder {
    return CommandLineBuilder.create(command);
}

function isNonEmptyArg(value: CommandLineArg | null | undefined): value is CommandLineArg {
    return value !== null && value !== undefined && value !== '';
}

/**
 * Flattens a single {@linkcode CommandLineArg} to its plain string value,
 * discarding any {@linkcode ShellQuoting} metadata.
 *
 * @remarks
 * This is the canonical way to turn an argument-vector element into a raw
 * string for argv-first execution or for inspecting a command line in tests.
 * Prefer {@linkcode argsToStrings} for a whole vector.
 */
export function argToString(arg: CommandLineArg): string {
    return typeof arg === 'string' ? arg : arg.value;
}

/**
 * Flattens a {@linkcode CommandLineArgs} vector (or any
 * {@linkcode CommandLineArg} array, including a {@linkcode CommandLineBuilder})
 * to plain strings, discarding {@linkcode ShellQuoting} metadata.
 */
export function argsToStrings(args: readonly CommandLineArg[]): string[] {
    return args.map(argToString);
}
