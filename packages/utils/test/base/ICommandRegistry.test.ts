/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { CommandRegistry } from '../../src/base/ICommandRegistry';
import { createTestActionExecutor } from '../createTestActionExecutor';
import { createMockVsCode } from '../vscode/MockVsCode';

describe('CommandRegistry (unit)', () => {
    it('should register a command that invokes the callback within telemetry', async () => {
        const { executor } = createTestActionExecutor();
        const { vscode: code, registeredCommands } = createMockVsCode();
        const registry = new CommandRegistry(executor, code);

        let wasCalled = false;
        registry.registerCommand('test.cmd', () => { wasCalled = true; });

        expect(registeredCommands.has('test.cmd')).to.be.true;
        await registeredCommands.get('test.cmd')!();
        expect(wasCalled).to.be.true;
    });

    it('should pass arguments through to the callback', async () => {
        const { executor } = createTestActionExecutor();
        const { vscode: code, registeredCommands } = createMockVsCode();
        const registry = new CommandRegistry(executor, code);

        let receivedArgs: unknown[] = [];
        registry.registerCommand('test.cmd', (_ctx, ...args) => { receivedArgs = args; });

        await registeredCommands.get('test.cmd')!('arg1', 'arg2');
        expect(receivedArgs).to.deep.equal(['arg1', 'arg2']);
    });

    it('should dispose all registered commands', () => {
        const { executor } = createTestActionExecutor();
        const { vscode: code, registeredCommands } = createMockVsCode();
        const registry = new CommandRegistry(executor, code);

        registry.registerCommand('test.a', () => { /* noop */ });
        registry.registerCommand('test.b', () => { /* noop */ });

        expect(registeredCommands.size).to.equal(2);
        registry.dispose();
        expect(registeredCommands.size).to.equal(0);
    });
});
