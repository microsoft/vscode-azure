/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mergeProcessEnv } from '../../src/base/mergeProcessEnv';

/**
 * Counts the spellings of {@linkcode name} present in {@linkcode env}. Anything
 * above one is rejected by `@azure/core-process` with `ERR_INVALID_ENVIRONMENT`.
 */
function spellingsOf(env: NodeJS.ProcessEnv, name: string): string[] {
    return Object.keys(env).filter((key) => key.toLowerCase() === name.toLowerCase());
}

describe('mergeProcessEnv (unit)', () => {
    it('layers overrides onto the process environment', () => {
        const merged = mergeProcessEnv({ ContosoTestVar: 'set-by-caller' });

        expect(merged.ContosoTestVar).to.equal('set-by-caller');
        // Inherited entries survive; a replacement environment would break PATH lookup.
        expect(merged.PATH ?? merged.Path).to.equal(process.env.PATH);
    });

    it('does not mutate the process environment', () => {
        mergeProcessEnv({ ContosoTestVar: 'set-by-caller' });

        expect(process.env.ContosoTestVar).to.be.undefined;
    });

    it('collapses several spellings of one override to a single key', function () {
        if (process.platform !== 'win32') {
            // Names are genuinely distinct off Windows, so there is nothing to collapse.
            this.skip();
        }

        const merged = mergeProcessEnv({ ContosoTestVar: 'first', contosotestvar: 'second' });

        expect(spellingsOf(merged, 'ContosoTestVar')).to.have.lengthOf(1);
        expect(merged.ContosoTestVar).to.equal('second');
    });

    it('replaces an inherited name spelled differently by the caller', function () {
        if (process.platform !== 'win32') {
            this.skip();
        }

        const merged = mergeProcessEnv({ Path: 'C:\\only-this' });

        expect(spellingsOf(merged, 'PATH')).to.deep.equal(['PATH']);
        expect(merged.PATH).to.equal('C:\\only-this');
    });

    it('keeps distinct casings apart off Windows', function () {
        if (process.platform === 'win32') {
            this.skip();
        }

        const merged = mergeProcessEnv({ ContosoTestVar: 'upper', contosotestvar: 'lower' });

        expect(merged.ContosoTestVar).to.equal('upper');
        expect(merged.contosotestvar).to.equal('lower');
    });
});
