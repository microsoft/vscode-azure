/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { CommandLineBuilder, ShellQuoting, argsToStrings, command } from '../../src/base/CommandLineBuilder';

describe('CommandLineBuilder (unit)', () => {
    it('should be an array whose first element is the executable', () => {
        const builder = command('azd');
        expect(builder).to.be.instanceOf(CommandLineBuilder);
        expect(Array.isArray(builder)).to.be.true;
        expect([...builder]).to.deep.equal(['azd']);
    });

    it('should append positional args after the executable and chain fluently', () => {
        const builder = command('azd').arg('env', 'new').arg('dev');
        expect([...builder]).to.deep.equal(['azd', 'env', 'new', 'dev']);
    });

    it('should skip null, undefined, and empty-string positional args', () => {
        const builder = command('azd').arg('a', undefined, '', null, 'b');
        expect([...builder]).to.deep.equal(['azd', 'a', 'b']);
    });

    it('should append named args as two tokens by default', () => {
        const builder = command('azd').named('--location', 'westus');
        expect([...builder]).to.deep.equal(['azd', '--location', 'westus']);
    });

    it('should skip named args with empty values', () => {
        const builder = command('azd').named('--location', undefined).named('--sub', '');
        expect([...builder]).to.deep.equal(['azd']);
    });

    it('should repeat the name for each value in an array', () => {
        const builder = command('azd').named('--set', ['a', 'b']);
        expect([...builder]).to.deep.equal(['azd', '--set', 'a', '--set', 'b']);
    });

    it('should emit a single name=value token when assign is set', () => {
        const builder = command('azd').named('--output', 'json', { assign: true });
        expect([...builder]).to.deep.equal(['azd', '--output=json']);
    });

    it('should attach quoting metadata to a named value when quoting is set', () => {
        const builder = command('azd').named('--path', 'a b', { quoting: ShellQuoting.Strong });
        expect(builder[1]).to.equal('--path');
        expect(builder[2]).to.deep.equal({ value: 'a b', quoting: ShellQuoting.Strong });
    });

    it('should conditionally include flags', () => {
        const builder = command('azd').flag('--force').flag('--purge', false).flag('--no-prompt', true);
        expect([...builder]).to.deep.equal(['azd', '--force', '--no-prompt']);
    });

    it('should attach Strong quoting metadata via quoted()', () => {
        const builder = command('azd').quoted('needs quoting', '');
        expect(builder).to.have.lengthOf(2);
        expect(builder[1]).to.deep.equal({ value: 'needs quoting', quoting: ShellQuoting.Strong });
    });

    it('should behave as a plain array under spread, slice, and iteration', () => {
        const builder = command('azd').arg('a', 'b');

        // Spreading yields the full vector including the executable.
        expect(argsToStrings([...builder])).to.deep.equal(['azd', 'a', 'b']);
        // Array methods return plain arrays (via Symbol.species), not builders.
        const sliced = builder.slice(1);
        expect(sliced).to.not.be.instanceOf(CommandLineBuilder);
        expect(argsToStrings(sliced)).to.deep.equal(['a', 'b']);
    });

    it('should compose a realistic command', () => {
        const builder = command('azd')
            .arg('provision')
            .named('--location', 'westus')
            .flag('--force');
        expect([...builder]).to.deep.equal(['azd', 'provision', '--location', 'westus', '--force']);
    });
});
