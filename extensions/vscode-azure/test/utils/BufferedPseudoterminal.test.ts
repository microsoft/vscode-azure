/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { mock } from 'node:test';
import { BufferedPseudoterminal } from '../../src/utils/BufferedPseudoterminal';

describe('BufferedPseudoterminal (unit)', () => {
    it('delivers buffered failure details before ending an unopened task without opening its process', () => {
        const onOpen = mock.fn();
        const onClose = mock.fn();
        const terminal = new BufferedPseudoterminal({ onOpen, onClose });
        const written = mock.fn<(text: string) => void>();
        const finished = mock.fn<(code: number) => void>();
        terminal.onDidWrite(written);
        terminal.onDidClose(finished);
        terminal.write('Startup failed.\n');
        terminal.finish(1);
        expect(finished.mock.callCount()).to.equal(0);
        terminal.open();
        terminal.open();
        terminal.finish(1);
        expect(written.mock.calls.map(call => call.arguments[0])).to.deep.equal(['Startup failed.\r\n']);
        expect(finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
        expect(onOpen.mock.callCount()).to.equal(0);
        expect(onClose.mock.callCount()).to.equal(1);
    });

    it('opens at most once and never opens after close', () => {
        const onOpen = mock.fn();
        const closed = new BufferedPseudoterminal({ onOpen, onClose: mock.fn() });
        closed.close();
        closed.open();
        expect(onOpen.mock.callCount()).to.equal(0);
        const terminal = new BufferedPseudoterminal({ onOpen, onClose: mock.fn() });
        terminal.open();
        terminal.open();
        expect(onOpen.mock.callCount()).to.equal(1);
        terminal.close();
    });

    it('runs onClose once however the terminal ends', () => {
        const onClose = mock.fn();
        const terminal = new BufferedPseudoterminal({ onClose });
        terminal.open();
        terminal.finish(0);
        terminal.close();
        expect(onClose.mock.callCount()).to.equal(1);
    });

    it('does not run onOpen when closed while buffered output is delivered', () => {
        const onOpen = mock.fn();
        const terminal = new BufferedPseudoterminal({ onOpen, onClose: mock.fn() });
        terminal.write('output');
        terminal.onDidWrite(() => { terminal.close(); });
        terminal.open();
        expect(onOpen.mock.callCount()).to.equal(0);
    });
});
