/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { CommandLineBuilder, ShellQuoting, command, isCommandLineBuilder, type CommandLineArg } from '../../src/base/CommandLineBuilder';

/** Flattens builder args to plain strings for value assertions. */
function values(args: readonly CommandLineArg[]): string[] {
    return args.map(a => typeof a === 'string' ? a : a.value);
}

describe('CommandLineBuilder (unit)', () => {
    it('should carry the executable on .command', () => {
        const builder = command('azd');
        expect(builder.command).to.equal('azd');
        expect(builder.toArray()).to.deep.equal([]);
    });

    it('should be recognized by isCommandLineBuilder', () => {
        expect(isCommandLineBuilder(command('azd'))).to.be.true;
        expect(isCommandLineBuilder('azd')).to.be.false;
        expect(isCommandLineBuilder(undefined)).to.be.false;
    });

    it('should append positional args in order and chain fluently', () => {
        const builder = command('azd').arg('env', 'new').arg('dev');
        expect(builder).to.be.instanceOf(CommandLineBuilder);
        expect(builder.toArray()).to.deep.equal(['env', 'new', 'dev']);
    });

    it('should skip null, undefined, and empty-string positional args', () => {
        const builder = command('azd').arg('a', undefined, '', null, 'b');
        expect(builder.toArray()).to.deep.equal(['a', 'b']);
    });

    it('should append named args as two tokens by default', () => {
        const builder = command('azd').named('--location', 'westus');
        expect(builder.toArray()).to.deep.equal(['--location', 'westus']);
    });

    it('should skip named args with empty values', () => {
        const builder = command('azd').named('--location', undefined).named('--sub', '');
        expect(builder.toArray()).to.deep.equal([]);
    });

    it('should repeat the name for each value in an array', () => {
        const builder = command('azd').named('--set', ['a', 'b']);
        expect(builder.toArray()).to.deep.equal(['--set', 'a', '--set', 'b']);
    });

    it('should emit a single name=value token when assign is set', () => {
        const builder = command('azd').named('--output', 'json', { assign: true });
        expect(builder.toArray()).to.deep.equal(['--output=json']);
    });

    it('should attach quoting metadata to a named value when quoting is set', () => {
        const builder = command('azd').named('--path', 'a b', { quoting: ShellQuoting.Strong });
        const args = builder.toArray();
        expect(args[0]).to.equal('--path');
        expect(args[1]).to.deep.equal({ value: 'a b', quoting: ShellQuoting.Strong });
    });

    it('should conditionally include flags', () => {
        const builder = command('azd').flag('--force').flag('--purge', false).flag('--no-prompt', true);
        expect(builder.toArray()).to.deep.equal(['--force', '--no-prompt']);
    });

    it('should attach Strong quoting metadata via quoted()', () => {
        const builder = command('azd').quoted('needs quoting', '');
        const args = builder.toArray();
        expect(args).to.have.lengthOf(1);
        expect(args[0]).to.deep.equal({ value: 'needs quoting', quoting: ShellQuoting.Strong });
    });

    it('should expose args via getter, toArray, and iteration without aliasing internal state', () => {
        const builder = command('azd').arg('a', 'b');

        expect(values(builder.args)).to.deep.equal(['a', 'b']);
        expect(values([...builder])).to.deep.equal(['a', 'b']);

        // Mutating a returned array must not affect the builder.
        builder.toArray().push('c');
        expect(builder.toArray()).to.deep.equal(['a', 'b']);
    });

    it('should compose a realistic command', () => {
        const builder = command('azd')
            .arg('provision')
            .named('--location', 'westus')
            .flag('--force');
        expect(builder.command).to.equal('azd');
        expect(builder.toArray()).to.deep.equal(['provision', '--location', 'westus', '--force']);
    });
});
