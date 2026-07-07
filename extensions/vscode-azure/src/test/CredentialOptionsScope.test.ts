/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { CredentialOptionsScope } from '../CredentialOptionsScope';

describe('CredentialOptionsScope (unit)', () => {
    it('should expose no ambient options outside a scope', () => {
        const scope = new CredentialOptionsScope();
        expect(scope.current).to.be.undefined;
    });

    it('should expose the ambient options synchronously inside run', () => {
        const scope = new CredentialOptionsScope();

        const observed = scope.run({ sessionOptions: { silent: true } }, () => scope.current);

        expect(observed?.sessionOptions?.silent).to.equal(true);
    });

    it('should return the callback result from run', () => {
        const scope = new CredentialOptionsScope();

        const result = scope.run({ tenantId: 't1' }, () => 42);

        expect(result).to.equal(42);
    });

    it('should propagate the ambient options across awaits', async () => {
        const scope = new CredentialOptionsScope();

        const observed = await scope.run({ sessionOptions: { silent: true } }, async () => {
            await Promise.resolve();
            return scope.current;
        });

        expect(observed?.sessionOptions?.silent).to.equal(true);
    });

    it('should restore the previous ambient options after run settles', async () => {
        const scope = new CredentialOptionsScope();

        await scope.run({ tenantId: 'outer' }, async () => {
            await Promise.resolve();
        });

        expect(scope.current).to.be.undefined;
    });

    it('should replace the ambient options for the duration of a nested scope', () => {
        const scope = new CredentialOptionsScope();

        const observed = scope.run({ tenantId: 'outer' }, () => {
            const inner = scope.run({ tenantId: 'inner' }, () => scope.current?.tenantId);
            return { inner, afterInner: scope.current?.tenantId };
        });

        expect(observed.inner).to.equal('inner');
        expect(observed.afterInner).to.equal('outer');
    });

    it('should isolate concurrent async flows', async () => {
        const scope = new CredentialOptionsScope();

        const [a, b] = await Promise.all([
            scope.run({ tenantId: 'a' }, async () => {
                await Promise.resolve();
                return scope.current?.tenantId;
            }),
            scope.run({ tenantId: 'b' }, async () => {
                await Promise.resolve();
                return scope.current?.tenantId;
            }),
        ]);

        expect(a).to.equal('a');
        expect(b).to.equal('b');
    });
});
