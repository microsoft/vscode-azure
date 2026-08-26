/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerRegistryClient as SdkContainerRegistryClient, type ContainerRegistryClientOptions } from '@azure/container-registry';
import type { TokenCredential } from '@azure/core-auth';
import type { SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { EnvironmentLike } from '../../auth/Environment';

export type { ContainerRegistryClientOptions };

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

/**
 * Wrapper around the `@azure/container-registry` data-plane SDK.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class AcrRepositoryClient implements IAcrRepositoryClient {
    private constructor(
        private readonly inner: SdkContainerRegistryClient,
    ) { }

    /**
     * Create a new {@linkcode AcrRepositoryClient} for a registry.
     *
     * @param loginServer - The registry's login server, with or without a
     *   scheme (e.g. `contoso.azurecr.io`).
     * @param environment - The cloud the registry lives in. Its ARM endpoint is
     *   the authentication audience, so a sovereign-cloud registry is
     *   authenticated against that cloud rather than public Azure.
     */
    public static create(
        credential: TokenCredential,
        loginServer: string,
        environment: EnvironmentLike,
        options?: ContainerRegistryClientOptions,
    ): AcrRepositoryClient {
        const endpoint = loginServer.startsWith('https://') ? loginServer : `https://${loginServer}`;

        return new AcrRepositoryClient(new SdkContainerRegistryClient(endpoint, credential, {
            audience: environment.resourceManagerEndpointUrl,
            ...options,
        }));
    }

    /** @inheritdoc */
    public async listRepositories(): Promise<readonly string[]> {
        const names: string[] = [];
        for await (const name of this.inner.listRepositoryNames()) {
            names.push(name);
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
        const manifests = this.inner
            .getRepository(repository)
            .listManifestProperties({ order: 'LastUpdatedOnDescending' });

        // An untagged manifest is ordinary -- the per-platform children of a
        // multi-arch image carry no tags of their own -- and contributes
        // nothing here. The SDK normalizes that case to an empty array
        // (`toArtifactManifestProperties` does `tags: from.tags ?? []`), so
        // this spread is safe without a further guard.
        for await (const manifest of manifests) {
            tags.push(...manifest.tags);
        }

        return tags;
    }
}
