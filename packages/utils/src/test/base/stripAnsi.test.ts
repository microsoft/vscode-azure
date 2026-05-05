/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { stripAnsi } from '../../base/stripAnsi';

describe('stripAnsi (unit)', () => {
    it('should return plain text unchanged', () => {
        expect(stripAnsi('hello world')).to.equal('hello world');
    });

    it('should return empty string unchanged', () => {
        expect(stripAnsi('')).to.equal('');
    });

    it('should strip SGR color codes', () => {
        expect(stripAnsi('\x1b[31mred\x1b[0m')).to.equal('red');
    });

    it('should strip bold and combined SGR codes', () => {
        expect(stripAnsi('\x1b[1;32mbold green\x1b[0m')).to.equal('bold green');
    });

    it('should strip cursor movement sequences', () => {
        expect(stripAnsi('abc\x1b[2Adef\x1b[3Bghi')).to.equal('abcdefghi');
    });

    it('should strip erase sequences', () => {
        expect(stripAnsi('line\x1b[2K\x1b[1Gnew line')).to.equal('linenew line');
    });

    it('should strip OSC hyperlinks (BEL terminated)', () => {
        expect(stripAnsi('\x1b]8;;https://example.com\x07click\x1b]8;;\x07')).to.equal('click');
    });

    it('should strip OSC hyperlinks (ST terminated)', () => {
        expect(stripAnsi('\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\')).to.equal('click');
    });

    it('should strip OSC title sequences', () => {
        expect(stripAnsi('\x1b]0;window title\x07content')).to.equal('content');
    });

    it('should strip simple two-byte escape codes', () => {
        // \x1b= (keypad application mode) and \x1b> (keypad numeric mode)
        expect(stripAnsi('\x1b=text\x1b>')).to.equal('text');
    });

    it('should handle mixed escape types in one string', () => {
        const input = '\x1b[1m\x1b]8;;https://portal.azure.com\x07View\x1b]8;;\x07\x1b[0m done';
        expect(stripAnsi(input)).to.equal('View done');
    });
});
