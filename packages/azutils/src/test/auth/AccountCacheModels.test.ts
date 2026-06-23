/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import {
    AccountCacheFormatVersion,
    buildAccountCacheData,
    environmentFingerprintsMatch,
    fingerprintEnvironment,
    fromSerializedAccount, fromSerializedSubscription, fromSerializedTenant,
    hydrateAccountCache,
    tenantCacheKey,
    toSerializedAccount, toSerializedSubscription, toSerializedTenant,
} from '../../auth/AccountCacheModels';
import { AzureChinaCloud, AzurePublicCloud, AzureUSGovernment, createEnvironment } from '../../auth/Environment';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';

/** Round-trip a value through JSON to model what persistence actually does on disk. */
function throughJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

describe('AccountCacheModels (unit)', () => {
    describe('fingerprintEnvironment', () => {
        it('should capture the cloud name, ARM endpoint, and custom flag', () => {
            const fingerprint = fingerprintEnvironment(AzurePublicCloud);
            expect(fingerprint).to.deep.equal({
                name: 'AzureCloud',
                resourceManagerEndpointUrl: 'https://management.azure.com',
                isCustomCloud: false,
            });
        });

        it('should survive a JSON round-trip (no closures)', () => {
            const fingerprint = throughJson(fingerprintEnvironment(AzureUSGovernment));
            expect(environmentFingerprintsMatch(fingerprint, fingerprintEnvironment(AzureUSGovernment))).to.be.true;
        });
    });

    describe('environmentFingerprintsMatch', () => {
        it('should match identical clouds and reject different ones', () => {
            expect(environmentFingerprintsMatch(fingerprintEnvironment(AzurePublicCloud), fingerprintEnvironment(AzurePublicCloud))).to.be.true;
            expect(environmentFingerprintsMatch(fingerprintEnvironment(AzurePublicCloud), fingerprintEnvironment(AzureChinaCloud))).to.be.false;
        });

        it('should reject a custom cloud that shares a name but differs in ARM endpoint', () => {
            const a = fingerprintEnvironment(createEnvironment({ ...basicCustomParams, resourceManagerEndpointUrl: 'https://one.example.com' }, true));
            const b = fingerprintEnvironment(createEnvironment({ ...basicCustomParams, resourceManagerEndpointUrl: 'https://two.example.com' }, true));
            expect(environmentFingerprintsMatch(a, b)).to.be.false;
        });
    });

    describe('serialization round-trips', () => {
        it('should drop the environment on serialize and restore it on deserialize for accounts', () => {
            const account = makeAccount({ id: 'acct-1', label: 'Account One' });
            const serialized = throughJson(toSerializedAccount(account));

            expect(serialized).to.not.have.property('environment');
            expect(serialized).to.deep.equal({ id: 'acct-1', label: 'Account One' });

            const restored = fromSerializedAccount(serialized, AzurePublicCloud);
            expect(restored.environment).to.equal(AzurePublicCloud);
            // The restored environment still has working (non-dropped) builders.
            expect(restored.environment.storageEndpoint('acct')).to.equal('https://acct.blob.core.windows.net');
        });

        it('should round-trip a tenant, preserving arm fields and re-attaching the environment', () => {
            const tenant = makeTenant({ tenantId: 't-1', displayName: 'Tenant One', accountId: 'acct-1', tenantCategory: 'Home' });
            const serialized = throughJson(toSerializedTenant(tenant));

            expect(serialized).to.not.have.property('environment');
            expect(serialized.tenantId).to.equal('t-1');
            expect(serialized.accountId).to.equal('acct-1');

            const restored = fromSerializedTenant(serialized, AzureChinaCloud);
            expect(restored.environment).to.equal(AzureChinaCloud);
            expect(restored.environment.containerRegistryEndpoint('reg')).to.equal('https://reg.azurecr.cn');
            expect(restored.displayName).to.equal('Tenant One');
        });

        it('should round-trip a subscription, preserving ids and re-attaching the environment', () => {
            const subscription = makeSubscription({ subscriptionId: 's-1', displayName: 'Sub One', tenantId: 't-1', accountId: 'acct-1' });
            const serialized = throughJson(toSerializedSubscription(subscription));

            expect(serialized).to.not.have.property('environment');
            expect(serialized.subscriptionId).to.equal('s-1');
            expect(serialized.tenantId).to.equal('t-1');
            expect(serialized.accountId).to.equal('acct-1');

            const restored = fromSerializedSubscription(serialized, AzureUSGovernment);
            expect(restored.environment).to.equal(AzureUSGovernment);
            expect(restored.environment.azureWebSitesEndpoint('site')).to.equal('https://site.azurewebsites.us');
        });

        it('should not mutate the source object when stripping the environment', () => {
            const subscription = makeSubscription();
            toSerializedSubscription(subscription);
            expect(subscription.environment).to.equal(AzurePublicCloud);
        });
    });

    describe('tree build/hydrate round-trips', () => {
        it('should round-trip a full account -> tenant -> subscription tree through JSON', () => {
            const account = makeAccount({ id: 'acct-1', label: 'Account One' });
            const tenant = makeTenant({ tenantId: 't-1', displayName: 'Tenant One', accountId: 'acct-1' });
            const subscription = makeSubscription({ subscriptionId: 's-1', displayName: 'Sub One', tenantId: 't-1', accountId: 'acct-1' });

            const data = buildAccountCacheData(
                AzurePublicCloud,
                [account],
                new Map([['acct-1', [tenant]]]),
                new Map([[tenantCacheKey('acct-1', 't-1'), [subscription]]]),
            );

            // The persisted form must carry no environment closures anywhere.
            const persisted = throughJson(data);
            expect(persisted.version).to.equal(AccountCacheFormatVersion);
            expect(persisted.environment.name).to.equal('AzureCloud');
            expect(persisted.accounts[0]).to.not.have.property('environment');
            expect(persisted.accounts[0].tenants[0]).to.not.have.property('environment');
            expect(persisted.accounts[0].tenants[0].subscriptions[0]).to.not.have.property('environment');

            const hydrated = hydrateAccountCache(persisted, AzureChinaCloud);
            expect(hydrated.accounts.map(a => a.id)).to.deep.equal(['acct-1']);
            expect(hydrated.accounts[0].environment).to.equal(AzureChinaCloud);
            expect(hydrated.tenantsByAccountId.get('acct-1')?.map(t => t.tenantId)).to.deep.equal(['t-1']);
            const subs = hydrated.subscriptionsByTenantKey.get(tenantCacheKey('acct-1', 't-1'));
            expect(subs?.map(s => s.subscriptionId)).to.deep.equal(['s-1']);
            expect(subs?.[0].environment).to.equal(AzureChinaCloud);
            expect(subs?.[0].environment.storageEndpoint('acct')).to.equal('https://acct.blob.core.chinacloudapi.cn');
        });

        it('should omit empty tenant and subscription lists from the hydrated maps', () => {
            const account = makeAccount({ id: 'acct-empty' });

            const data = buildAccountCacheData(AzurePublicCloud, [account], new Map(), new Map());
            const hydrated = hydrateAccountCache(throughJson(data), AzurePublicCloud);

            expect(hydrated.accounts.map(a => a.id)).to.deep.equal(['acct-empty']);
            expect(hydrated.tenantsByAccountId.size).to.equal(0);
            expect(hydrated.subscriptionsByTenantKey.size).to.equal(0);
        });

        it('should keep subscriptions of same-named tenants under different accounts separate', () => {
            const accountA = makeAccount({ id: 'acct-a' });
            const accountB = makeAccount({ id: 'acct-b' });
            const tenantA = makeTenant({ tenantId: 'shared', displayName: 'Shared', accountId: 'acct-a' });
            const tenantB = makeTenant({ tenantId: 'shared', displayName: 'Shared', accountId: 'acct-b' });
            const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: 'shared', accountId: 'acct-a' });
            const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: 'shared', accountId: 'acct-b' });

            const data = buildAccountCacheData(
                AzurePublicCloud,
                [accountA, accountB],
                new Map([['acct-a', [tenantA]], ['acct-b', [tenantB]]]),
                new Map([
                    [tenantCacheKey('acct-a', 'shared'), [subA]],
                    [tenantCacheKey('acct-b', 'shared'), [subB]],
                ]),
            );
            const hydrated = hydrateAccountCache(throughJson(data), AzurePublicCloud);

            expect(hydrated.subscriptionsByTenantKey.get(tenantCacheKey('acct-a', 'shared'))?.map(s => s.subscriptionId)).to.deep.equal(['sub-a']);
            expect(hydrated.subscriptionsByTenantKey.get(tenantCacheKey('acct-b', 'shared'))?.map(s => s.subscriptionId)).to.deep.equal(['sub-b']);
        });
    });
});

const basicCustomParams = {
    name: 'Custom',
    resourceManagerEndpointUrl: 'https://management.example.com',
    portalUrl: 'https://portal.example.com',
    storageEndpointSuffix: 'storage.example.com',
    containerRegistryDnsSuffix: 'acr.example.com',
    azureWebSitesEndpointSuffix: 'sites.example.com',
};
