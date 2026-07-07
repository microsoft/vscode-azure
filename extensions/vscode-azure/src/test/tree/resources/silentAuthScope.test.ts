/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { isSilentAuth, runWithSilentAuth } from '../../../tree/resources/silentAuthScope';

describe('silentAuthScope (unit)', () => {
    it('should report not-silent outside any scope', () => {
        expect(isSilentAuth()).to.equal(false);
    });

    it('should report silent synchronously inside a scope', () => {
        const observed = runWithSilentAuth(() => isSilentAuth());
        expect(observed).to.equal(true);
    });

    it('should keep the scope active across awaited continuations', async () => {
        const observed = await runWithSilentAuth(async () => {
            await Promise.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
            return isSilentAuth();
        });
        expect(observed).to.equal(true);
    });

    it('should keep the scope active while draining an async iterator', async () => {
        async function* iterate(): AsyncIterable<boolean> {
            yield isSilentAuth();
            await Promise.resolve();
            yield isSilentAuth();
        }

        const observed = await runWithSilentAuth(async () => {
            const seen: boolean[] = [];
            for await (const value of iterate()) {
                seen.push(value);
            }
            return seen;
        });

        expect(observed).to.deep.equal([true, true]);
    });

    it('should restore not-silent after the scope settles', async () => {
        await runWithSilentAuth(async () => {
            await Promise.resolve();
        });
        expect(isSilentAuth()).to.equal(false);
    });

    it('should return the callback result verbatim', () => {
        expect(runWithSilentAuth(() => 42)).to.equal(42);
    });
});
