/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applyRedaction, isSecretPropertyName, RedactedMarker, redactSecrets } from '../../src/properties/redactSecrets';

/**
 * Names a substring matcher over `key`/`secret`/`token` gets wrong, drawn from real ARM payloads.
 * Each is a name whose value is metadata, an identifier, or public by definition.
 */
const publicNames = [
    'keyVaultUri',
    'keyVaultReferenceIdentity',
    'keySource',
    'keyType',
    'keyName',
    'keyVersion',
    'sshPublicKeys',
    'publicKey',
    'partitionKey',
    'secretName',
    'secretUri',
    'tokenEndpoint',
    'passwordPolicy',
    // The public half of an SSH key pair. Shaped exactly like the `keyValue` compound below, which
    // is why the compounds are an enumerated list rather than a rule.
    'keyData',
];

/** Names whose value is a credential and must never be shown. */
const secretNames = [
    'primaryKey',
    'secondaryKey',
    'accessKey',
    'apiKey',
    'InstrumentationKey',
    'connectionString',
    'ConnectionString',
    'primaryConnectionString',
    'connection_string',
    'adminPassword',
    'password',
    'pwd',
    'clientSecret',
    'refreshToken',
    'SASToken',
    'sas-token',
    'authorization',
    'credentials',
    'keys',
    // A secret word followed by a generic noun, which head-word matching alone would let through.
    'secretValue',
    'tokenValue',
    'keyValue',
    'passwordHash',
];

describe('redactSecrets (unit)', () => {
    for (const name of publicNames) {
        it(`keeps '${name}', which is metadata rather than a credential`, () => {
            expect(isSecretPropertyName(name)).to.be.false;
            expect(redactSecrets({ [name]: 'visible' })).to.deep.equal({ [name]: 'visible' });
        });
    }

    for (const name of secretNames) {
        it(`redacts '${name}'`, () => {
            expect(isSecretPropertyName(name)).to.be.true;
            expect(redactSecrets({ [name]: 'shhh' })).to.deep.equal({ [name]: RedactedMarker });
        });
    }

    it('redacts nested and array-held properties while preserving shape', () => {
        const payload = {
            properties: {
                siteConfig: {
                    appSettings: [
                        { name: 'AzureWebJobsStorage', connectionString: 'secret-value' },
                        { name: 'Public', keyVaultUri: 'https://vault.vault.azure.net/' },
                    ],
                },
            },
        };

        expect(redactSecrets(payload)).to.deep.equal({
            properties: {
                siteConfig: {
                    appSettings: [
                        { name: 'AzureWebJobsStorage', connectionString: RedactedMarker },
                        { name: 'Public', keyVaultUri: 'https://vault.vault.azure.net/' },
                    ],
                },
            },
        });
    });

    it('leaves values of other kinds untouched, since only a name marks a secret', () => {
        expect(redactSecrets({ count: 3, enabled: false, missing: null, absent: undefined, name: 'app1' }))
            .to.deep.equal({ count: 3, enabled: false, missing: null, absent: undefined, name: 'app1' });
        expect(redactSecrets('a string')).to.equal('a string');
        expect(redactSecrets(undefined)).to.be.undefined;
    });

    it('serializes a payload that references itself', () => {
        const payload: Record<string, unknown> = { name: 'app1', apiKey: 'shhh' };
        payload.self = payload;
        payload.siblings = [payload];

        const redacted = redactSecrets(payload) as Record<string, unknown>;

        expect(redacted).to.deep.equal({ name: 'app1', apiKey: RedactedMarker, self: undefined, siblings: [undefined] });
        expect(() => JSON.stringify(redacted)).to.not.throw();
    });

    it('walks a repeated but acyclic reference only once', () => {
        const shared = { apiKey: 'shhh' };

        // The second occurrence is dropped rather than redacted a second time. Distinguishing it
        // from a true cycle would need a path-scoped walk, and the cost of getting that wrong -- a
        // payload that cannot be serialized -- is worse than a dropped duplicate.
        expect(redactSecrets({ first: shared, second: shared }))
            .to.deep.equal({ first: { apiKey: RedactedMarker }, second: undefined });
    });
});

describe('applyRedaction (unit)', () => {
    it('opens the payload unchanged when no policy is declared', () => {
        const payload = { apiKey: 'shhh' };

        expect(applyRedaction(undefined, payload)).to.equal(payload);
    });

    it('redacts recognised names when the policy is declared', () => {
        expect(applyRedaction(true, { apiKey: 'shhh', name: 'app1' }))
            .to.deep.equal({ apiKey: RedactedMarker, name: 'app1' });
    });

    it('redacts additional names alongside the recognised ones, ignoring case', () => {
        const payload = { appId: 'app-id', APPID: 'app-id', apiKey: 'shhh', name: 'app1' };

        expect(applyRedaction({ alsoRedact: ['appId'] }, payload)).to.deep.equal({
            appId: RedactedMarker,
            APPID: RedactedMarker,
            apiKey: RedactedMarker,
            name: 'app1',
        });
    });
});
