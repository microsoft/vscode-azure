/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CredentialFactoryOptions } from '@microsoft/vscode-azure-azutils';
import { expect } from 'chai';
import { getAmbientCredentialOptions, runWithCredentialOptions } from '../../../tree/resources/credentialOptionsScope';

describe('credentialOptionsScope (unit)', () => {
    const silent: CredentialFactoryOptions = { sessionOptions: { silent: true } };

    it('should report no options outside any scope', () => {
        expect(getAmbientCredentialOptions()).to.equal(undefined);
    });

    it('should expose the options synchronously inside a scope', () => {
        const observed = runWithCredentialOptions(silent, () => getAmbientCredentialOptions());
        expect(observed).to.deep.equal(silent);
    });

    it('should keep the options active across awaited continuations', async () => {
        const observed = await runWithCredentialOptions(silent, async () => {
            await Promise.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
            return getAmbientCredentialOptions();
        });
        expect(observed).to.deep.equal(silent);
    });

    it('should keep the options active while draining an async iterator', async () => {
        async function* iterate(): AsyncIterable<CredentialFactoryOptions | undefined> {
            yield getAmbientCredentialOptions();
            await Promise.resolve();
            yield getAmbientCredentialOptions();
        }

        const observed = await runWithCredentialOptions(silent, async () => {
            const seen: Array<CredentialFactoryOptions | undefined> = [];
            for await (const value of iterate()) {
                seen.push(value);
            }
            return seen;
        });

        expect(observed).to.deep.equal([silent, silent]);
    });

    it('should replace (not merge) the outer options when scopes nest', () => {
        const outer: CredentialFactoryOptions = { tenantId: 'outer' };
        const inner: CredentialFactoryOptions = { sessionOptions: { silent: true } };

        const observed = runWithCredentialOptions(outer, () =>
            runWithCredentialOptions(inner, () => getAmbientCredentialOptions()),
        );

        expect(observed).to.deep.equal(inner);
    });

    it('should restore no options after the scope settles', async () => {
        await runWithCredentialOptions(silent, async () => {
            await Promise.resolve();
        });
        expect(getAmbientCredentialOptions()).to.equal(undefined);
    });

    it('should return the callback result verbatim', () => {
        expect(runWithCredentialOptions(silent, () => 42)).to.equal(42);
    });
});
