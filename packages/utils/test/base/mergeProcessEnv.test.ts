/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { mergeProcessEnv } from '../../src/base/mergeProcessEnv';

/**
 * Counts the spellings of {@linkcode name} present in {@linkcode env}. Anything
 * above one is rejected by `@azure/core-process` with `ERR_INVALID_ENVIRONMENT`.
 */
function spellingsOf(env: NodeJS.ProcessEnv, name: string): string[] {
    return Object.keys(env).filter((key) => key.toLowerCase() === name.toLowerCase());
}

describe('mergeProcessEnv (unit)', () => {
    beforeEach(() => {
        mock.property(process, 'env', { ContosoInheritedVar: 'inherited' });
    });

    afterEach(() => {
        mock.restoreAll();
    });

    it('copies the inherited environment when no overrides are supplied', () => {
        const merged = mergeProcessEnv();

        expect(merged).to.deep.equal(process.env);
        expect(merged).to.not.equal(process.env);
    });

    it('layers overrides onto the process environment', () => {
        const merged = mergeProcessEnv({ ContosoTestVar: 'set-by-caller' });

        expect(merged.ContosoTestVar).to.equal('set-by-caller');
        expect(merged.ContosoInheritedVar).to.equal('inherited');
    });

    it('does not mutate the process environment', () => {
        mergeProcessEnv({ ContosoTestVar: 'set-by-caller' });

        expect(process.env.ContosoTestVar).to.be.undefined;
    });

    it('collapses several spellings of one override to a single key on Windows', () => {
        mock.property(process, 'platform', 'win32');

        const merged = mergeProcessEnv({ ContosoTestVar: 'first', contosotestvar: 'second' });

        expect(spellingsOf(merged, 'ContosoTestVar')).to.have.lengthOf(1);
        expect(merged.ContosoTestVar).to.equal('second');
    });

    for (const inheritedName of ['PATH', 'Path', 'pAtH']) {
        it(`replaces inherited ${inheritedName} with a differently-cased override on Windows`, () => {
            mock.property(process, 'platform', 'win32');
            process.env[inheritedName] = 'C:\\inherited';
            const overrideName = inheritedName === 'PATH' ? 'Path' : 'PATH';
            const overrides = { [overrideName]: 'C:\\only-this' };
            const inherited = { ...process.env };

            const merged = mergeProcessEnv(overrides);

            expect(spellingsOf(merged, 'PATH')).to.deep.equal([inheritedName]);
            expect(merged[inheritedName]).to.equal('C:\\only-this');
            expect(merged.ContosoInheritedVar).to.equal('inherited');
            expect(process.env).to.deep.equal(inherited);
            expect(overrides).to.deep.equal({ [overrideName]: 'C:\\only-this' });
        });
    }

    it('keeps distinct casings apart off Windows', () => {
        mock.property(process, 'platform', 'linux');

        const merged = mergeProcessEnv({ ContosoTestVar: 'upper', contosotestvar: 'lower' });

        expect(merged.ContosoTestVar).to.equal('upper');
        expect(merged.contosotestvar).to.equal('lower');
    });
});
