/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { InflightMap } from '../../data/InflightMap';

describe('InflightMap (unit)', () => {
    describe('has', () => {
        it('should return false for unknown keys', () => {
            const map = new InflightMap<string>();
            expect(map.has('key')).to.be.false;
        });

        it('should return true while an operation is in-flight', async () => {
            const map = new InflightMap<string>();
            const { promise: inner, resolve } = Promise.withResolvers<string>();
            const promise = map.getOrRun('key', () => inner);

            expect(map.has('key')).to.be.true;
            resolve('done');
            await promise;
        });

        it('should return false after an operation completes (getOrRun)', async () => {
            const map = new InflightMap<string>();
            await map.getOrRun('key', () => Promise.resolve('done'));
            expect(map.has('key')).to.be.false;
        });
    });

    describe('getOrRun', () => {
        it('should call fn and return its result', async () => {
            const map = new InflightMap<number>();
            const fn = mock.fn(() => Promise.resolve(42));
            const result = await map.getOrRun('key', fn);
            expect(result).to.equal(42);
            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should deduplicate concurrent calls for the same key', async () => {
            const map = new InflightMap<number>();
            const fn = mock.fn(() => new Promise<number>(r => { setTimeout(() => { r(1); }, 10); }));

            const [a, b] = await Promise.all([
                map.getOrRun('key', fn),
                map.getOrRun('key', fn),
            ]);

            expect(fn.mock.callCount()).to.equal(1);
            expect(a).to.equal(b);
        });

        it('should not deduplicate calls for different keys', async () => {
            const map = new InflightMap<string>();
            const fnA = mock.fn(() => Promise.resolve('a'));
            const fnB = mock.fn(() => Promise.resolve('b'));

            const [a, b] = await Promise.all([
                map.getOrRun('a', fnA),
                map.getOrRun('b', fnB),
            ]);

            expect(fnA.mock.callCount()).to.equal(1);
            expect(fnB.mock.callCount()).to.equal(1);
            expect(a).to.equal('a');
            expect(b).to.equal('b');
        });

        it('should remove the entry after the promise settles', async () => {
            const map = new InflightMap<string>();
            await map.getOrRun('key', () => Promise.resolve('val'));
            expect(map.has('key')).to.be.false;
        });

        it('should remove the entry even if the promise rejects', async () => {
            const map = new InflightMap<string>();
            try {
                await map.getOrRun('key', () => Promise.reject(new Error('fail')));
            } catch { /* expected */ }
            expect(map.has('key')).to.be.false;
        });
    });

    describe('getOrCreate', () => {
        it('should call fn and return its result', async () => {
            const map = new InflightMap<number>();
            const fn = mock.fn(() => Promise.resolve(42));
            const result = await map.getOrCreate('key', fn);
            expect(result).to.equal(42);
            expect(fn.mock.callCount()).to.equal(1);
        });

        it('should keep the entry after the promise resolves', async () => {
            const map = new InflightMap<number>();
            await map.getOrCreate('key', () => Promise.resolve(42));
            expect(map.has('key')).to.be.true;
        });

        it('should return the cached result on subsequent calls', async () => {
            const map = new InflightMap<number>();
            const fn = mock.fn(() => Promise.resolve(99));

            const a = await map.getOrCreate('key', fn);
            const b = await map.getOrCreate('key', fn);

            expect(fn.mock.callCount()).to.equal(1);
            expect(a).to.equal(99);
            expect(b).to.equal(99);
        });

        it('should remove the entry on rejection and allow retry', async () => {
            const map = new InflightMap<string>();
            let shouldFail = true;

            const fn = mock.fn(() => {
                if (shouldFail) {
                    shouldFail = false;
                    return Promise.reject(new Error('transient'));
                }
                return Promise.resolve('ok');
            });

            try { await map.getOrCreate('key', fn); } catch { /* expected */ }
            expect(map.has('key')).to.be.false;

            const result = await map.getOrCreate('key', fn);
            expect(result).to.equal('ok');
            expect(fn.mock.callCount()).to.equal(2);
        });
    });
});
