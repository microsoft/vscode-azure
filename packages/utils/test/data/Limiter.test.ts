/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { Limiter } from '../../src/data/Limiter';

describe('Limiter (unit)', () => {
    it('should throw if maxDegreeOfParallelism is less than 1', () => {
        expect(() => new Limiter(0)).to.throw('maxDegreeOfParallelism must be at least 1');
    });

    it('should run a single task and return its result', async () => {
        const limiter = new Limiter<number>(1);
        const result = await limiter.queue(() => Promise.resolve(42));
        expect(result).to.equal(42);
    });

    it('should limit concurrency to maxDegreeOfParallelism', async () => {
        const limiter = new Limiter<string>(2);
        let running = 0;
        let maxRunning = 0;

        const makeTask = (id: string) => () => new Promise<string>(resolve => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            setTimeout(() => {
                running--;
                resolve(id);
            }, 10);
        });

        const results = await Promise.all([
            limiter.queue(makeTask('a')),
            limiter.queue(makeTask('b')),
            limiter.queue(makeTask('c')),
            limiter.queue(makeTask('d')),
        ]);

        expect(maxRunning).to.equal(2);
        expect(results).to.deep.equal(['a', 'b', 'c', 'd']);
    });

    it('should propagate rejections to the correct caller', async () => {
        const limiter = new Limiter<string>(1);

        const p1 = limiter.queue(() => Promise.reject(new Error('fail1')));
        const p2 = limiter.queue(() => Promise.resolve('ok'));

        try {
            await p1;
            expect.fail('Expected rejection');
        } catch (e) {
            expect((e as Error).message).to.equal('fail1');
        }

        const result = await p2;
        expect(result).to.equal('ok');
    });

    it('should handle synchronous errors in the factory', async () => {
        const limiter = new Limiter<string>(1);

        try {
            await limiter.queue(() => { throw new Error('sync fail'); });
            expect.fail('Expected rejection');
        } catch (e) {
            expect((e as Error).message).to.equal('sync fail');
        }

        // Subsequent tasks should still work
        const result = await limiter.queue(() => Promise.resolve('ok'));
        expect(result).to.equal('ok');
    });

    it('should process tasks in queue order', async () => {
        const limiter = new Limiter<number>(1);
        const order: number[] = [];

        await Promise.all([
            limiter.queue(() => { order.push(1); return Promise.resolve(1); }),
            limiter.queue(() => { order.push(2); return Promise.resolve(2); }),
            limiter.queue(() => { order.push(3); return Promise.resolve(3); }),
        ]);

        expect(order).to.deep.equal([1, 2, 3]);
    });
});
