/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICaselessSetReader } from '@microsoft/vscode-azure-utils';

/**
 * How much of a payload is withheld before it is shown.
 *
 * Omitting the policy entirely -- the common case for ARM, which keeps real secrets behind separate
 * `listKeys`/`listSecrets` calls -- shows the payload unchanged.
 */
export type RedactionPolicy =
    /** Redact the property names {@linkcode isSecretPropertyName} recognises. */
    | true
    /** Redact those names, plus these exact ones, compared case-insensitively. */
    | { readonly alsoRedact: readonly string[] };

/**
 * Placed where a redacted value used to be.
 *
 * A marker rather than a dropped key, so the reader can tell a property this resource does not have
 * apart from one that was withheld, and knows to go get it from the portal or a `listKeys` call
 * instead of concluding the payload is incomplete.
 */
export const RedactedMarker = '<redacted>';

/**
 * Words that make the property they end a secret.
 *
 * Matching is on the **last** word of a property name rather than anywhere in it, because Azure
 * payloads are full of names that merely mention a secret-ish noun: `keyVaultUri` is a URI,
 * `keySource` and `keyType` are encryption metadata, `keyName` and `keyVersion` identify a key
 * without containing one. Reading the last word treats a name as the compound noun it is -- the
 * head word says what the value *is*, everything before it says which one.
 */
const secretHeadWords = new Set([
    'authorization',
    'credential',
    'credentials',
    'key',
    'keys',
    'password',
    'passwords',
    'pwd',
    'sas',
    'secret',
    'secrets',
    'token',
    'tokens',
]);

/**
 * Whole names that are secret despite an innocent head word.
 *
 * `connectionString` is the one that matters in practice: its head word is `string`, but the value
 * routinely carries an embedded account key. These are anchored at the end so a qualified variant
 * (`primaryConnectionString`) is covered too.
 *
 * @remarks
 * The `value`/`hash` compounds close the case where a secret word is followed by a generic noun --
 * `secretValue`, `tokenValue`, `keyValue`, `passwordHash` -- which head-word matching alone lets
 * through. There is no general rule to be had here, only a judgement per compound: `keyData` is
 * exactly the same shape and holds the *public* half of an SSH key pair, so it stays visible.
 * Extend this list rather than looking for the pattern that would cover both.
 */
const secretNamePatterns: readonly RegExp[] = [
    /connection[_-]?strings?$/i,
    /sas[_-]?urls?$/i,
    /(?:credential|key|password|pwd|sas|secret|token)s?[_-]?(?:value|hash)$/i,
];

/**
 * Names whose head word is a secret word but whose value is not a credential.
 *
 * Deliberately short. It holds only values Azure publishes by definition (the public half of a key
 * pair) or that name a position rather than a secret (`partitionKey`). A name merely *believed* to
 * be harmless belongs on the redacted side of the line -- over-redacting costs a round trip to the
 * portal, under-redacting puts a credential in a file the user may well paste into an issue.
 */
const publicNamePatterns: readonly RegExp[] = [
    /public[_-]?keys?$/i,
    /partition[_-]?keys?$/i,
];

/** Whether a property with this name should have its value withheld. */
export function isSecretPropertyName(name: string): boolean {
    if (publicNamePatterns.some(pattern => pattern.test(name))) {
        return false;
    } else if (secretNamePatterns.some(pattern => pattern.test(name))) {
        return true;
    }

    const headWord = splitWords(name).at(-1);
    return headWord !== undefined && secretHeadWords.has(headWord);
}

/**
 * Apply a declared {@linkcode RedactionPolicy} to a payload.
 *
 * The single place a policy is honored, so an adapter declares one and never implements it.
 */
export function applyRedaction(policy: RedactionPolicy | undefined, value: unknown): unknown {
    if (!policy) {
        return value;
    }

    return redactSecrets(value, policy === true ? undefined : policy.alsoRedact);
}

/**
 * Return a copy of {@linkcode value} with every property whose name looks like a secret replaced by
 * {@linkcode RedactedMarker}.
 *
 * Arrays keep their shape and are walked element-wise; primitives pass through untouched, since
 * only a *name* can mark a value as secret. A reference already visited on the way down is dropped
 * rather than followed, so a self-referential payload still serializes.
 *
 * This is a best-effort screen over a payload of unknown shape, not an authorization boundary.
 * Never let it be the only thing standing between a caller and a credential.
 *
 * @param alsoRedact - Additional exact property names to withhold, compared case-insensitively.
 */
export function redactSecrets(value: unknown, alsoRedact?: readonly string[]): unknown {
    return redact(value, new WeakSet<object>(), alsoRedact?.length ? new CaselessSet(alsoRedact) : undefined);
}

/**
 * Split a property name into lower-cased words, understanding the casings that appear in Azure
 * payloads: `camelCase`, `PascalCase`, `snake_case`, and `kebab-case`.
 *
 * A run of capitals stays one word except for the final capital when a lowercase letter follows it,
 * which starts the next word -- so `SASToken` splits to `sas` + `token` rather than `sastoken`.
 */
function splitWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_\-.]+/)
        .filter(word => word)
        .map(word => word.toLowerCase());
}

function redact(value: unknown, seen: WeakSet<object>, alsoRedact: ICaselessSetReader | undefined): unknown {
    if (!value || typeof value !== 'object') {
        return value;
    } else if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => redact(item, seen, alsoRedact));
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
            key,
            alsoRedact?.has(key) || isSecretPropertyName(key) ? RedactedMarker : redact(child, seen, alsoRedact),
        ]),
    );
}
