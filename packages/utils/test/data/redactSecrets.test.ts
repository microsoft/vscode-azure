/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applyRedaction, isSecretPropertyName, RedactedMarker, redactSecrets } from '../../src/data/redactSecrets';

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

    it('leaves values of other kinds untouched, since a bare value carries no name to judge it by', () => {
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

    it('walks a reference that appears twice on different branches', () => {
        const shared = { apiKey: 'shhh' };

        expect(redactSecrets({ first: shared, second: shared }))
            .to.deep.equal({ first: { apiKey: RedactedMarker }, second: { apiKey: RedactedMarker } });
    });
});

describe('redactSecrets values (unit)', () => {
    it('redacts a credential recognised by its own shape, naming what it was taken for', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'; // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]

        expect(redactSecrets({ scriptContent: jwt })).to.deep.equal({ scriptContent: '<redacted: JWT>' });
    });

    it('redacts a private key block wherever it arrives', () => {
        const payload = { data: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----' }; // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]

        expect(redactSecrets(payload)).to.deep.equal({ data: '<redacted: private key>' });
    });

    it('withholds a signature from a URL while keeping the URL readable', () => {
        const payload = { packageUri: 'https://acct.blob.core.windows.net/c/app.zip?sv=2021-08-06&sig=abc123def456&se=2030-01-01' }; // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]

        expect(redactSecrets(payload)).to.deep.equal({
            packageUri: `https://acct.blob.core.windows.net/c/app.zip?sv=${RedactedMarker}&sig=${RedactedMarker}&se=${RedactedMarker}`,
        });
    });

    it('keeps a URL that carries only allowed parameters', () => {
        const url = 'https://management.azure.com/subscriptions/sub1?api-version=2021-04-01';

        expect(redactSecrets({ nextLink: url })).to.deep.equal({ nextLink: url });
    });

    it('keeps a URL with no query string', () => {
        const url = 'https://my-key-vault.vault.azure.net/';

        expect(redactSecrets({ keyVaultUri: url })).to.deep.equal({ keyVaultUri: url });
    });

    it('withholds only the credential-bearing segments of a connection string', () => {
        const payload = {
            endpoint: 'Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=abc123def456ghi=', // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]
        };

        expect(redactSecrets(payload)).to.deep.equal({
            endpoint: `Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=${RedactedMarker}`,
        });
    });

    it('leaves prose that merely contains a semicolon alone', () => {
        const payload = { description: 'first; second; third' };

        expect(redactSecrets(payload)).to.deep.equal(payload);
    });

    it('withholds a recognised secret everywhere it appears, including percent-encoded', () => {
        const payload = {
            accessKey: 'abc123def456ghi789', // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]
            // The same key, reached by a name nothing would flag on its own.
            mirror: 'abc123def456ghi789', // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]
            embedded: 'https://host/path?token=abc123def456ghi789&api-version=2021-04-01', // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]
            encoded: 'value=abc123def456ghi789%2Fmore', // [SuppressMessage("Microsoft.Security", "CS001:SecretInline", Justification="Fake credential for testing.")]
        };

        expect(redactSecrets(payload)).to.deep.equal({
            accessKey: RedactedMarker,
            mirror: RedactedMarker,
            embedded: `https://host/path?token=${RedactedMarker}&api-version=2021-04-01`,
            encoded: `value=${RedactedMarker}%2Fmore`,
        });
    });

    it('does not hunt for a withheld value too short to mean anything', () => {
        const payload = { pwd: 'abc', note: 'abc is a common prefix' };

        expect(redactSecrets(payload)).to.deep.equal({ pwd: RedactedMarker, note: 'abc is a common prefix' });
    });
});

describe('applyRedaction (unit)', () => {
    it('redacts when no policy is declared, so an adapter is safe before its author thought about it', () => {
        expect(applyRedaction(undefined, { apiKey: 'shhh', name: 'app1' }))
            .to.deep.equal({ apiKey: RedactedMarker, name: 'app1' });
    });

    it('opens the payload unchanged only when redaction is declined outright', () => {
        const payload = { apiKey: 'shhh' };

        expect(applyRedaction(false, payload)).to.equal(payload);
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
