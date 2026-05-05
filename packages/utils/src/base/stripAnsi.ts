/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Regex matching ANSI escape sequences: CSI sequences (colors, cursor
 * movement, erase), OSC sequences (hyperlinks, title setting), and
 * simple two-byte escape codes.
 */
// eslint-disable-next-line no-control-regex
const ansiPattern = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]/g;

/**
 * Strips ANSI escape sequences from terminal output, returning plain text.
 *
 * Handles CSI sequences (e.g. `\x1b[31m` for color), OSC sequences
 * (e.g. hyperlinks), and simple two-byte escapes.
 */
export function stripAnsi(input: string): string {
    return input.replace(ansiPattern, '');
}
