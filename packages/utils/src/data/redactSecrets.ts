/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type ICaselessSetReader } from './CaselessSet';

/**
 * How much of a payload is withheld before it is shown.
 *
 * Redaction is **on by default**: omitting a policy redacts, and `false` is the deliberate opt-out.
 * That ordering is the only one that fails safe, because a caller whose author never considered
 * secrets is indistinguishable from one that considered them and decided none could appear.
 *
 * @remarks
 * VS Code's telemetry API makes the same call from the same reasoning: everything logged through
 * {@linkcode vscode.TelemetryLogger TelemetryLogger} is cleaned, and `TelemetryTrustedValue` is the
 * wrapper that opts a single value out.
 */
export type RedactionPolicy =
    /** Redact recognised property names and values. `false` opens the payload unchanged. */
    | boolean
    /** Redact those, plus these exact property names, compared case-insensitively. */
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
 * Marker for a value withheld because of what the *value* looked like, naming what it was taken for.
 *
 * The label matters more here than for a name match: a reader who can see the property name can
 * usually infer why it was withheld, but a redacted value under an innocent name looks like a bug
 * until it says `<redacted: JWT>`. Borrowed from VS Code's `<REDACTED: JWT>` telemetry markers.
 */
function markerFor(label: string): string {
    return `<redacted: ${label}>`;
}

/**
 * Shortest value worth hunting for elsewhere in the payload.
 *
 * A recognised secret is withheld wherever it appears, but only once it is long enough that a second
 * occurrence means something. Scrubbing every instance of a four-character password would shred
 * unrelated text that merely contains those characters.
 */
const minimumScrubLength = 8;

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

/**
 * Values that are a credential whatever property they arrive under.
 *
 * Taken from VS Code's own telemetry cleaner (`userDataRegexes` in
 * `src/vs/platform/telemetry/common/telemetryUtils.ts`), which screens every property logged through
 * {@linkcode vscode.TelemetryLogger TelemetryLogger}. These earn their place by catching what a name
 * check structurally cannot: a token parked under `data`, `value`, or a name nobody thought to list.
 *
 * Three of VS Code's rules are deliberately **not** here, because a properties document exists to be
 * read while telemetry exists to be shipped, so the two disagree about what over-redaction costs:
 *
 * - `URL` (any `scheme://...`) would blank `loginServer`, `documentEndpoint`, and `templateLink.uri`,
 *   which are most of what makes this view worth opening. {@linkcode redactUrl} takes the signature
 *   out of the URL instead of taking the URL out of the document.
 * - `Generic Secret` (`(key|token|sig|secret|...)[^a-zA-Z0-9]`) matches a secret-ish word anywhere in
 *   a value, which also matches the perfectly public `https://my-key-vault.vault.azure.net/`.
 *   {@linkcode redactUrl} and {@linkcode redactConnectionString} apply that idea only to the `k=v`
 *   segments where a match actually means something.
 * - `Email` and the file-path anonymiser address PII in shipped telemetry, which is a different
 *   problem from a credential in a document the user asked to see.
 *
 * VS Code's separate `Microsoft Entra ID` rule is a narrower spelling of its `JWT` rule; one covers
 * both.
 */
const secretValuePatterns: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    { label: 'JWT', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/ },
    { label: 'Google API key', pattern: /AIza[A-Za-z0-9_\\-]{35}/ },
    { label: 'GitHub token', pattern: /gh[psuro]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/ },
    { label: 'Slack token', pattern: /xox[pbar]-[A-Za-z0-9]/ },
    { label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/**
 * Query parameters kept verbatim in a URL whose other parameters are withheld.
 *
 * An allow list rather than a deny list, matching `Sanitizer` in `@typespec/ts-http-runtime` -- what
 * `@azure/core-rest-pipeline` sanitizes request URLs with before logging them. A query string is a
 * small enough surface to enumerate the safe half of, which is exactly what makes the inverted
 * default affordable here and unaffordable for a payload of unknown shape.
 */
const allowedQueryParameters: ICaselessSetReader = new CaselessSet(['api-version']);

/** A URL with a query string, captured as prefix / query / fragment so it can be rebuilt verbatim. */
const urlWithQuery = /^([a-z][a-z0-9+.-]*:\/\/[^?#\s]*)\?([^#\s]*)(#\S*)?$/i;

/** A `key=value` segment of a connection string, as the whole segment must look to be treated as one. */
const connectionSegment = /^\s*[A-Za-z][\w .-]*=/;

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
 * The single place a policy is honored, so a caller declares one and never implements it.
 */
export function applyRedaction(policy: RedactionPolicy | undefined, value: unknown): unknown {
    if (policy === false) {
        return value;
    }

    return redactSecrets(value, typeof policy === 'object' ? policy.alsoRedact : undefined);
}

/**
 * Return a copy of {@linkcode value} with everything that looks like a credential replaced by a
 * redaction marker.
 *
 * A value is withheld when its property name says it is a secret, when the value itself is
 * recognisably a credential, or when it carries a signature in a URL query string or a
 * `key=value;` connection string. Anything withheld on one of those grounds is then withheld
 * *wherever else* it appears in the payload, so a key that also sits embedded in some URI does not
 * survive because only one of its two homes was recognised.
 *
 * Arrays keep their shape and are walked element-wise. A reference that is currently being walked --
 * a true cycle -- is dropped rather than followed, so a self-referential payload still serializes;
 * a reference merely seen before on another branch is walked again, since it is a distinct
 * occurrence in the output.
 *
 * This is a best-effort screen over a payload of unknown shape, not an authorization boundary.
 * Never let it be the only thing standing between a caller and a credential.
 *
 * @param alsoRedact - Additional exact property names to withhold, compared case-insensitively.
 */
export function redactSecrets(value: unknown, alsoRedact?: readonly string[]): unknown {
    const found = new Set<string>();
    const redacted = redact(
        value,
        new Set<object>(),
        alsoRedact?.length ? new CaselessSet(alsoRedact) : undefined,
        found,
    );

    const scrubList = buildScrubList(found);
    return scrubList.length > 0 ? scrubEverywhere(redacted, scrubList) : redacted;
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

/**
 * Walk a payload, replacing withheld values and collecting them for the scrub pass.
 *
 * @param active - The references on the path currently being walked, so a cycle is detected without
 *   mistaking a repeated sibling for one. Entries are removed on the way back up.
 */
function redact(
    value: unknown,
    active: Set<object>,
    alsoRedact: ICaselessSetReader | undefined,
    found: Set<string>,
): unknown {
    if (typeof value === 'string') {
        return redactValue(value, found);
    } else if (!value || typeof value !== 'object') {
        return value;
    } else if (active.has(value)) {
        return undefined;
    }

    active.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map(item => redact(item, active, alsoRedact, found));
        }

        const entries: [string, unknown][] = Object.entries(value);
        const namedValue = entries.find(([key]) => key === 'name')?.[1];
        const namedValueIsSecret = typeof namedValue === 'string'
            && (alsoRedact?.has(namedValue) || isSecretPropertyName(namedValue));

        return Object.fromEntries(
            entries.map(([key, child]) => {
                if (alsoRedact?.has(key) || isSecretPropertyName(key) || (key === 'value' && namedValueIsSecret)) {
                    return [key, withhold(child, found)];
                }

                return [key, redact(child, active, alsoRedact, found)];
            }),
        );
    } finally {
        active.delete(value);
    }
}

/** Withhold a value the property name condemned, remembering it if it can be hunted for elsewhere. */
function withhold(value: unknown, found: Set<string>): string {
    if (typeof value === 'string') {
        found.add(value);
    }

    return RedactedMarker;
}

/**
 * Screen a string on its own merits, for the case where the property name gave nothing away.
 *
 * Order is deliberate: a value that is *entirely* a credential is replaced outright, and only a
 * value that merely *carries* one -- a signed URL, a connection string -- is rewritten in place so
 * the parts worth reading survive.
 */
function redactValue(value: string, found: Set<string>): string {
    const recognised = secretValuePatterns.find(({ pattern }) => pattern.test(value));
    if (recognised) {
        found.add(value);
        return markerFor(recognised.label);
    }

    return redactUrl(value, found) ?? redactConnectionString(value, found) ?? value;
}

/**
 * Withhold the query parameters of a URL while keeping the URL itself readable.
 *
 * A SAS URL is the case that matters: the signature is in `sig`, but so much of what makes the
 * document useful is the scheme, host, and path that dropping the whole value to protect one
 * parameter is a bad trade. The parameters are rebuilt by hand rather than through `URLSearchParams`
 * so that the untouched ones keep their original encoding and the marker is not percent-escaped.
 *
 * @returns The rewritten URL, or `undefined` when this is not a URL with anything to withhold.
 */
function redactUrl(value: string, found: Set<string>): string | undefined {
    const match = urlWithQuery.exec(value);
    if (!match) {
        return undefined;
    }

    const [, prefix, query, fragment = ''] = match;

    const rebuilt = query.split('&').map(parameter => {
        const separator = parameter.indexOf('=');
        if (separator <= 0) {
            return parameter;
        }

        const name = parameter.slice(0, separator);
        const parameterValue = parameter.slice(separator + 1);
        if (!parameterValue || allowedQueryParameters.has(name)) {
            return parameter;
        }

        remember(parameterValue, found);
        return `${name}=${RedactedMarker}`;
    }).join('&');

    return rebuilt === query ? undefined : `${prefix}?${rebuilt}${fragment}`;
}

/**
 * Withhold the credential-bearing segments of a `key=value;` connection string.
 *
 * Which segments those are is decided by {@linkcode isSecretPropertyName}, which already draws the
 * line in the right place for the shapes Azure emits: it withholds `AccountKey` and `SharedAccessKey`
 * while keeping `Endpoint`, `AccountName`, and -- because its head word is `name` -- the
 * `SharedAccessKeyName` that says which key was used.
 *
 * @returns The rewritten value, or `undefined` when this is not a connection string with anything to
 *   withhold.
 */
function redactConnectionString(value: string, found: Set<string>): string | undefined {
    const segments = value.split(';');
    const populated = segments.filter(segment => segment.trim());
    if (populated.length < 2 || !populated.every(segment => connectionSegment.test(segment))) {
        return undefined;
    }

    const rebuilt = segments.map(segment => {
        const separator = segment.indexOf('=');
        if (separator <= 0) {
            return segment;
        }

        const name = segment.slice(0, separator);
        const segmentValue = segment.slice(separator + 1);
        if (!segmentValue || !isSecretPropertyName(name.trim())) {
            return segment;
        }

        remember(segmentValue, found);
        return `${name}=${RedactedMarker}`;
    }).join(';');

    return rebuilt === value ? undefined : rebuilt;
}

/** Remember a withheld fragment, ignoring the surrounding whitespace a segment may carry. */
function remember(value: string, found: Set<string>): void {
    found.add(value.trim());
}

/**
 * Expand the withheld values into every spelling worth searching for.
 *
 * Percent-encoding is included because the same key routinely appears raw in one property and
 * encoded inside a URI in another. Longest first, so a secret that contains a shorter one is
 * replaced whole rather than left as a mangled remainder.
 */
function buildScrubList(found: ReadonlySet<string>): readonly string[] {
    const spellings = new Set<string>();

    for (const value of found) {
        if (value.length < minimumScrubLength) {
            continue;
        }

        spellings.add(value);
        spellings.add(encodeURIComponent(value));
    }

    return [...spellings].sort((first, second) => second.length - first.length);
}

/**
 * Second pass: withhold every remaining occurrence of a value already recognised as a secret.
 *
 * Recognising a credential in one property says something about the whole payload, which a
 * per-property check cannot act on. This is the idea behind `@zapier/secret-scrubber`'s two-phase
 * scrub, without the dependency or its salted-hash markers.
 *
 * Walks the already-redacted copy, which is a freshly built tree, so cycles are gone by now.
 */
function scrubEverywhere(value: unknown, scrubList: readonly string[]): unknown {
    if (typeof value === 'string') {
        return scrubString(value, scrubList);
    } else if (!value || typeof value !== 'object') {
        return value;
    } else if (Array.isArray(value)) {
        return value.map(item => scrubEverywhere(item, scrubList));
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, scrubEverywhere(child, scrubList)]),
    );
}

function scrubString(value: string, scrubList: readonly string[]): string {
    return scrubList.reduce(
        (scrubbed, secret) => scrubbed.split(secret).join(RedactedMarker),
        value,
    );
}
