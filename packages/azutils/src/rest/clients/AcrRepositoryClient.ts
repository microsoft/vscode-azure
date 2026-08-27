/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient, ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { EnvironmentLike } from '../../auth/Environment';
import { createDataPlaneRestClient } from '../createAzureClient';
import { AcrChallengeCallbacks, AcrTokenExchange } from './AcrTokenExchange';

export type AcrRepositoryClientOptions = RestClientOptions;

/** A repository in a registry, together with the tags currently pointing into it. */
export interface RepositoryTags {
    /** Repository path within the registry, e.g. `store/api`. */
    readonly repository: string;
    /** Tags in the repository, most recently updated first. */
    readonly tags: readonly string[];
}

/**
 * Factory that creates an {@linkcode IAcrRepositoryClient} for a registry's
 * login server, e.g. `contoso.azurecr.io`.
 *
 * Takes the owning subscription rather than just the cloud, because the
 * credential has to be scoped to the tenant and account that can reach the
 * registry.
 */
export const IAcrRepositoryClientProvider: ServiceIdentifier<IAcrRepositoryClientProvider> = Symbol.for('IAcrRepositoryClientProvider');
export type IAcrRepositoryClientProvider = SyncFactory<IAcrRepositoryClient, [AzureSubscription, string]>;

/**
 * Interface describing the container registry **data-plane** APIs we use.
 *
 * Distinct from {@linkcode IAcrClient}, which is the ARM management plane:
 * that one manages registries as Azure resources, this one reads the images
 * inside a registry. They authenticate differently and have separate endpoints.
 */
export interface IAcrRepositoryClient {
    /** Lists repository paths in the registry. */
    listRepositories(): Promise<readonly string[]>;
    /**
     * Lists each repository's tags, most recently updated first.
     *
     * A repository with no tags is omitted: an image can only be deployed by a
     * tag it actually has.
     */
    listRepositoryTags(): Promise<readonly RepositoryTags[]>;
}

/** The API version every `/acr/v1` operation below is written against. */
const AcrApiVersion = '2021-07-01';

/**
 * Response body of `GET /acr/v1/_catalog`.
 *
 * Mirrors `Repositories` in `@azure/container-registry`. `link` is also
 * returned as a response header, which is where the continuation cursor is
 * actually read from.
 */
interface Repositories {
    readonly repositories?: readonly string[];
    readonly link?: string;
}

/**
 * One manifest's attributes.
 *
 * Mirrors `ManifestAttributesBase` in `@azure/container-registry`, using the
 * wire names rather than that package's renamed properties: `imageSize` is
 * exposed there as `size`, `createdTime`/`lastUpdateTime` as
 * `createdOn`/`lastUpdatedOn`, `os` as `operatingSystem`, and `references` as
 * `relatedArtifacts`.
 */
interface ManifestAttributesBase {
    readonly digest: string;
    readonly imageSize?: number;
    readonly createdTime: string;
    readonly lastUpdateTime: string;
    readonly architecture?: string | null;
    readonly os?: string | null;
    readonly references?: readonly unknown[];
    /** Absent, rather than empty, for the per-platform children of a multi-arch image. */
    readonly tags?: readonly string[];
    readonly changeableAttributes?: {
        readonly deleteEnabled?: boolean;
        readonly writeEnabled?: boolean;
        readonly listEnabled?: boolean;
        readonly readEnabled?: boolean;
    };
}

/**
 * Response body of `GET /acr/v1/{name}/_manifests`.
 *
 * Mirrors `AcrManifests` in `@azure/container-registry`, using the wire names:
 * `registry` is exposed there as `registryLoginServer` and `imageName` as
 * `repository`.
 */
interface AcrManifests {
    readonly registry?: string;
    readonly imageName?: string;
    readonly manifests?: readonly ManifestAttributesBase[];
    readonly link?: string;
}

/**
 * Client for the container registry data-plane API.
 *
 * Issues the two read operations we need directly against the registry, so
 * requests run on the shared pipeline (see
 * {@linkcode createDataPlaneRestClient}) and no registry SDK has to be bundled.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class AcrRepositoryClient implements IAcrRepositoryClient {
    private constructor(
        private readonly client: RestClient,
    ) { }

    /**
     * Create a new {@linkcode AcrRepositoryClient} for a registry.
     *
     * @param loginServer - The registry's login server, with or without a
     *   scheme (e.g. `contoso.azurecr.io`).
     * @param environment - The cloud the registry lives in. Its ARM scope is the
     *   audience of the token that gets traded for a registry token, so a
     *   sovereign-cloud registry is authenticated against that cloud rather
     *   than public Azure.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        loginServer: string,
        environment: EnvironmentLike,
        options?: AcrRepositoryClientOptions,
    ): AcrRepositoryClient {
        const endpoint = loginServer.startsWith('https://') ? loginServer : `https://${loginServer}`;

        // The token-exchange endpoints authenticate from the request body, so
        // they get their own client with no auth policy attached.
        const authClient = createDataPlaneRestClient(ctx, executor, { name: 'acr-auth', endpoint }, options);

        return new AcrRepositoryClient(createDataPlaneRestClient(ctx, executor, {
            name: 'acr',
            endpoint,
            credential,
            scopes: [environment.resourceManagerDefaultScope],
            challengeCallbacks: new AcrChallengeCallbacks(new AcrTokenExchange(authClient)),
        }, options));
    }

    /** @inheritdoc */
    public async listRepositories(): Promise<readonly string[]> {
        const names: string[] = [];

        for await (const page of this.pages<Repositories>('/acr/v1/_catalog')) {
            names.push(...page.repositories ?? []);
        }

        return names;
    }

    /** @inheritdoc */
    public async listRepositoryTags(): Promise<readonly RepositoryTags[]> {
        const repositories = await this.listRepositories();

        // Each repository's manifests are a separate round trip, so they are
        // issued together rather than serially -- a registry with many
        // repositories would otherwise take one latency per repository.
        const results = await Promise.all(repositories.map(async repository => ({
            repository,
            tags: await this.listTags(repository),
        })));

        return results.filter(result => result.tags.length > 0);
    }

    /** Lists a repository's tags, most recently updated first. */
    private async listTags(repository: string): Promise<string[]> {
        const tags: string[] = [];

        // Tags live on manifests, and one manifest may carry several. Ordering
        // by last update puts the tag a user most likely wants at the top.
        //
        // The repository path is percent-encoded whole, slashes included, which
        // is the form the registry expects for a nested path like `store/api`.
        const path = `/acr/v1/${encodeURIComponent(repository)}/_manifests`;

        for await (const page of this.pages<AcrManifests>(path, { orderby: 'timedesc' })) {
            for (const manifest of page.manifests ?? []) {
                // An untagged manifest is ordinary -- the per-platform children
                // of a multi-arch image carry no tags of their own -- and
                // contributes nothing here.
                tags.push(...manifest.tags ?? []);
            }
        }

        return tags;
    }

    /**
     * Walks a paged `/acr/v1` collection.
     *
     * The registry caps a response at its own page size and points at the rest
     * with an RFC 5988 `Link` header, so a listing that stops at the first
     * response silently truncates a large registry.
     */
    private async *pages<T>(path: string, queryParameters?: Record<string, string>): AsyncGenerator<T> {
        let next: string | undefined = path;

        while (next) {
            const response = await this.client.pathUnchecked(next).get({
                queryParameters: {
                    'api-version': AcrApiVersion,
                    // A continuation link already carries its own parameters,
                    // and re-adding these would override the cursor it encodes.
                    ...(next === path ? queryParameters : undefined),
                },
            });

            if (response.status !== '200') {
                throw new Error(`Container registry request to '${path}' failed (HTTP ${response.status}).`);
            }

            yield response.body as T;
            next = parseNextLink(response.headers.link);
        }
    }
}

/**
 * Extracts the URL from an RFC 5988 `Link` header, e.g.
 * `</acr/v1/_catalog?last=store%2Fapi&n=100>; rel="next"`.
 *
 * Returns `undefined` for an absent header or one that advertises no `next`
 * relation, both of which mean the listing is complete.
 */
function parseNextLink(header: string | undefined): string | undefined {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(header ?? '');
    return match?.[1];
}
