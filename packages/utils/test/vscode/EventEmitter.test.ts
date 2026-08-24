/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from '../../src/vscode/Disposable';
import { EventEmitter } from '../../src/vscode/EventEmitter';

describe('EventEmitter (unit)', () => {
    it('should fire listener with the emitted value', () => {
        const emitter = new EventEmitter<number>();
        const received: number[] = [];

        emitter.event(value => received.push(value));
        emitter.fire(1);
        emitter.fire(2);

        expect(received).to.deep.equal([1, 2]);
    });

    it('should support multiple listeners', () => {
        const emitter = new EventEmitter<string>();
        const a: string[] = [];
        const b: string[] = [];

        emitter.event(v => a.push(v));
        emitter.event(v => b.push(v));
        emitter.fire('hello');

        expect(a).to.deep.equal(['hello']);
        expect(b).to.deep.equal(['hello']);
    });

    it('should return a Disposable that unsubscribes the listener', () => {
        const emitter = new EventEmitter<number>();
        const received: number[] = [];

        const sub = emitter.event(v => received.push(v));
        emitter.fire(1);
        sub.dispose();
        emitter.fire(2);

        expect(received).to.deep.equal([1]);
    });

    it('should bind thisArgs when provided', () => {
        const emitter = new EventEmitter<string>();
        const ctx = { values: [] as string[] };

        emitter.event(function (this: typeof ctx, v: string) {
            this.values.push(v);
        }, ctx);
        emitter.fire('bound');

        expect(ctx.values).to.deep.equal(['bound']);
    });

    it('should push disposable into disposables array when provided', () => {
        const emitter = new EventEmitter<number>();
        const disposables: Disposable[] = [];

        emitter.event(() => { /* noop */ }, undefined, disposables);

        expect(disposables).to.have.lengthOf(1);
        expect(disposables[0]).to.have.property('dispose').that.is.a('function');
    });

    it('should unsubscribe via disposable pushed into disposables array', () => {
        const emitter = new EventEmitter<number>();
        const disposables: Disposable[] = [];
        const received: number[] = [];

        emitter.event(v => received.push(v), undefined, disposables);
        emitter.fire(1);
        disposables[0].dispose();
        emitter.fire(2);

        expect(received).to.deep.equal([1]);
    });

    it('dispose() should remove all listeners', () => {
        const emitter = new EventEmitter<number>();
        const received: number[] = [];

        emitter.event(v => received.push(v));
        emitter.event(v => received.push(v * 10));
        emitter.fire(1);
        emitter.dispose();
        emitter.fire(2);

        expect(received).to.deep.equal([1, 10]);
    });

    it('should handle fire with no listeners without throwing', () => {
        const emitter = new EventEmitter<string>();
        expect(() => { emitter.fire('lonely'); }).to.not.throw();
    });

    it('should handle disposing the same subscription twice without throwing', () => {
        const emitter = new EventEmitter<number>();
        const sub = emitter.event(() => { /* noop */ });

        sub.dispose();
        expect(() => { sub.dispose(); }).to.not.throw();
    });

    it('should work with undefined as a fired value', () => {
        const emitter = new EventEmitter<undefined>();
        const received: undefined[] = [];

        emitter.event(v => received.push(v));
        emitter.fire(undefined);

        expect(received).to.deep.equal([undefined]);
    });

    it('should not prevent other listeners from being called when one throws', () => {
        const emitter = new EventEmitter<number>();
        const received: number[] = [];

        emitter.event(() => { throw new Error('boom'); });
        emitter.event(v => received.push(v));

        // fire() silently swallows errors, matching vscode.EventEmitter.
        expect(() => { emitter.fire(1); }).to.not.throw();
        expect(received).to.deep.equal([1]);
    });
});
