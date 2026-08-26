/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

        await expect(p1).to.be.rejectedWith('fail1');

        const result = await p2;
        expect(result).to.equal('ok');
    });

    it('should handle synchronous errors in the factory', async () => {
        const limiter = new Limiter<string>(1);

        await expect(limiter.queue(() => { throw new Error('sync fail'); })).to.be.rejectedWith('sync fail');

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

    describe('map', () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        async function* range(count: number, pulled?: number[]): AsyncIterable<number> {
            for (let i = 0; i < count; i++) {
                pulled?.push(i);
                yield i;
            }
        }

        const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
            const items: T[] = [];
            for await (const item of source) {
                items.push(item);
            }
            return items;
        };

        it('yields results in source order, not completion order', async () => {
            const limiter = new Limiter<number>(4);

            // Earlier items finish last, so completion order is the reverse.
            const results = await collect(limiter.map(range(4), async item => {
                await new Promise(resolve => setTimeout(resolve, (4 - item) * 10));
                return item;
            }));

            expect(results).to.deep.equal([0, 1, 2, 3]);
        });

        it('runs no more than the window at once', async () => {
            const limiter = new Limiter<number>(3);
            let running = 0;
            let maxRunning = 0;

            await collect(limiter.map(range(10), async item => {
                running++;
                maxRunning = Math.max(maxRunning, running);
                await new Promise(resolve => setTimeout(resolve, 5));
                running--;
                return item;
            }));

            expect(maxRunning).to.equal(3);
        });

        it('reads no further than the window ahead of the consumer', async () => {
            const limiter = new Limiter<number>(2);
            const pulled: number[] = [];
            const started: number[] = [];

            for await (const item of limiter.map(range(10, pulled), item => {
                started.push(item);
                return Promise.resolve(item);
            })) {
                if (item === 0) {
                    break;
                }
            }

            // A caller that stops at the first result must not have paid to
            // enumerate the whole source, nor started work it never consumed.
            expect(pulled).to.deep.equal([0, 1]);
            expect(started).to.deep.equal([0, 1]);
        });

        it('shares its bound across concurrent callers', async () => {
            const limiter = new Limiter<number>(2);
            let running = 0;
            let maxRunning = 0;

            const task = async (item: number): Promise<number> => {
                running++;
                maxRunning = Math.max(maxRunning, running);
                await new Promise(resolve => setTimeout(resolve, 5));
                running--;
                return item;
            };

            await Promise.all([
                collect(limiter.map(range(6), task)),
                collect(limiter.map(range(6), task)),
            ]);

            expect(maxRunning).to.equal(2);
        });

        it('propagates a rejection from the mapped task', async () => {
            const limiter = new Limiter<number>(2);

            await expect(collect(limiter.map(range(4), item => {
                return item === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(item);
            }))).to.be.rejectedWith('boom');
        });

        it('yields nothing for an empty source', async () => {
            const limiter = new Limiter<number>(2);
            expect(await collect(limiter.map(range(0), item => Promise.resolve(item)))).to.deep.equal([]);
        });
    });
});
