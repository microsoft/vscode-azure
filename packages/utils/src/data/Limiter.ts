/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is lifted directly from https://github.com/microsoft/vscode/blob/f8e2f71c2f78ac1ce63389e761e2aefc724646fc/extensions/git/src/util.ts#L411-L454,
// which itself looks like just a simplified version of https://github.com/microsoft/vscode/blob/f8e2f71c2f78ac1ce63389e761e2aefc724646fc/src/vs/base/common/async.ts#L696-L786
// A few small changes have been made

interface ILimitedTaskFactory<T> {
    readonly factory: () => Promise<T>;
    readonly c: (value: T | Promise<T>) => void;
    readonly e: (error?: unknown) => void;
}

/**
 * Limits the number of promises that may run concurrently.
 *
 * Tasks are queued via {@linkcode queue} and run as soon as the number
 * of currently-running promises drops below {@linkcode maxDegreeOfParallelism}.
 *
 * Lifted from the VSCode git extension with small adaptations.
 */
export class Limiter<T> {

    private runningPromises: number;
    private maxDegreeOfParallelism: number;
    private outstandingPromises: ILimitedTaskFactory<T>[];

    /**
     * @param maxDegreeOfParallelism - Maximum number of promises that may run concurrently. Must be at least 1.
     * @throws if `maxDegreeOfParallelism` is less than 1.
     */
    constructor(maxDegreeOfParallelism: number) {
        if (maxDegreeOfParallelism < 1) {
            throw new Error('maxDegreeOfParallelism must be at least 1');
        }

        this.maxDegreeOfParallelism = maxDegreeOfParallelism;
        this.outstandingPromises = [];
        this.runningPromises = 0;
    }

    /**
     * Queue a task to run when a slot is available. Returns a promise that
     * resolves (or rejects) with the result of `factory()`.
     */
    queue(factory: () => Promise<T>): Promise<T> {
        return new Promise<T>((c, e) => {
            this.outstandingPromises.push({ factory, c, e });
            this.consume();
        });
    }

    /**
     * Map an async source through `factory`, running at most
     * {@linkcode maxDegreeOfParallelism} tasks at once and yielding results in
     * **source order**, not completion order.
     *
     * The source stays lazy: a new item is pulled only once a slot frees up, so
     * at most {@linkcode maxDegreeOfParallelism} items are ever read ahead of
     * the results the caller has consumed. That matters when merely *reading*
     * the source costs something -- a paged listing, say -- and a caller that
     * stops early must not have paid for work it never asked for.
     *
     * Tasks are submitted through {@linkcode queue}, so a limiter shared with
     * other callers still bounds total concurrency across all of them.
     *
     * @remarks A caller that abandons the iteration early leaves the in-flight
     * tasks unawaited. If `factory` can reject, it must settle its own failures
     * (or the caller must consume to completion), or an abandoned task will
     * surface as an unhandled rejection.
     */
    async *map<I>(source: AsyncIterable<I>, factory: (item: I) => Promise<T>): AsyncIterable<T> {
        const inFlight: Array<Promise<T>> = [];

        for await (const item of source) {
            inFlight.push(this.queue(() => factory(item)));
            while (inFlight.length >= this.maxDegreeOfParallelism) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                yield await inFlight.shift()!;
            }
        }

        for (const pending of inFlight) {
            yield await pending;
        }
    }

    private consume(): void {
        while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParallelism) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const iLimitedTask = this.outstandingPromises.shift()!;
            this.runningPromises++;

            let promise: Promise<T>;
            try {
                promise = iLimitedTask.factory();
            } catch (error) {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                promise = Promise.reject(error);
            }
            promise.then(iLimitedTask.c, iLimitedTask.e);
            promise.then(() => { this.consumed(); }, () => { this.consumed(); });
        }
    }

    private consumed(): void {
        this.runningPromises--;

        if (this.outstandingPromises.length > 0) {
            this.consume();
        }
    }
}
