/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import type { DataProvider, DataProviderChangeEvent } from '../../tree/DataProvider';
import { ProviderRegistry } from '../../tree/ProviderRegistry';
import { Everything } from '../../tree/Selector';
import { EventEmitter } from '../../vscode/EventEmitter';

interface TestResource {
    readonly type: string;
    readonly id: string;
}

type TestProvider = DataProvider<TestResource>;

// Concrete subclass since ProviderRegistry is abstract
class TestRegistry extends ProviderRegistry<TestResource, TestProvider> {
    public readonly onProviderChangedFn = mock.fn<(event: DataProviderChangeEvent<TestResource>) => void>();

    protected override onProviderChanged(event: DataProviderChangeEvent<TestResource>): void {
        this.onProviderChangedFn(event);
    }

    // Expose protected methods for testing
    public find(resource: unknown): TestProvider | undefined {
        return this.findProvider(resource);
    }

    public roots(): TestProvider[] {
        return this.getRootProviders();
    }
}

function makeProvider(canHandle: (r: unknown) => boolean, isRoot = false): TestProvider {
    return {
        canHandle,
        isRoot,
        getChildren: () => [],
    } as unknown as TestProvider;
}

describe('ProviderRegistry (unit)', () => {
    it('should register a provider and find it', () => {
        const registry = new TestRegistry();
        const provider = makeProvider(() => true);
        registry.registerProvider(provider);

        expect(registry.find({})).to.equal(provider);
    });

    it('should return undefined when no provider matches', () => {
        const registry = new TestRegistry();
        registry.registerProvider(makeProvider(() => false));

        expect(registry.find({})).to.be.undefined;
    });

    it('should return the first matching provider (registration order)', () => {
        const registry = new TestRegistry();
        const specific = makeProvider((r) => (r as TestResource).type === 'A');
        const broad = makeProvider(() => true);

        registry.registerProvider(specific);
        registry.registerProvider(broad);

        expect(registry.find({ type: 'A' })).to.equal(specific);
        expect(registry.find({ type: 'B' })).to.equal(broad);
    });

    it('should unregister a provider via the returned Disposable', () => {
        const registry = new TestRegistry();
        const provider = makeProvider(() => true);
        const disposable = registry.registerProvider(provider);

        expect(registry.find({})).to.equal(provider);

        disposable.dispose();
        expect(registry.find({})).to.be.undefined;
    });

    it('should return root providers', () => {
        const registry = new TestRegistry();
        const rootProvider = makeProvider(() => false, true);
        const nonRootProvider = makeProvider(() => false, false);

        registry.registerProvider(rootProvider);
        registry.registerProvider(nonRootProvider);

        const roots = registry.roots();
        expect(roots).to.have.length(1);
        expect(roots[0]).to.equal(rootProvider);
    });

    it('should clear registrations on dispose', () => {
        const registry = new TestRegistry();
        registry.registerProvider(makeProvider(() => true));
        registry.registerProvider(makeProvider(() => true));

        registry.dispose();
        expect(registry.find({})).to.be.undefined;
        expect(registry.roots()).to.have.length(0);
    });

    it('should subscribe to provider onDidChange and call onProviderChanged', () => {
        const registry = new TestRegistry();
        const emitter = new EventEmitter<DataProviderChangeEvent<TestResource>>();
        const provider: TestProvider = {
            canHandle: (_r: unknown): _r is TestResource => true,
            getChildren: () => [],
            onDidChange: emitter.event,
        };

        registry.registerProvider(provider);
        const event: DataProviderChangeEvent<TestResource> = { target: Everything };
        emitter.fire(event);

        expect(registry.onProviderChangedFn.mock.callCount()).to.equal(1);
        expect(registry.onProviderChangedFn.mock.calls[0].arguments[0]).to.equal(event);
    });

    it('should dispose provider onDidChange subscription when registration is disposed', () => {
        const registry = new TestRegistry();
        const emitter = new EventEmitter<DataProviderChangeEvent<TestResource>>();
        const provider: TestProvider = {
            canHandle: (_r: unknown): _r is TestResource => true,
            getChildren: () => [],
            onDidChange: emitter.event,
        };

        const registration = registry.registerProvider(provider);
        registration.dispose();

        emitter.fire({ target: Everything });
        expect(registry.onProviderChangedFn.mock.callCount()).to.equal(0);
    });
});
