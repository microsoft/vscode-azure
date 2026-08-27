/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelineRequest, PipelineResponse } from '@azure/core-rest-pipeline';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { AzureChinaCloud, AzurePublicCloud, type EnvironmentLike } from '../../../src/auth/Environment';
import { AcrRepositoryClient } from '../../../src/rest/clients/AcrRepositoryClient';
import { makeCredential } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

interface RegistryContents {
    /** Repository names, optionally split across pages to exercise the `Link` header. */
    readonly repositoryPages?: readonly (readonly string[])[];
    readonly manifestsByRepository?: Record<string, { tags?: string[] }[]>;
    /** When true, every `/acr/v1` request draws a challenge until a registry token is presented. */
    readonly requireChallenge?: boolean;
}

/**
 * Serves a registry: the two `oauth2` exchange endpoints, a paged `_catalog`,
 * and `_manifests` per repository.
 */
function createRegistry(contents: RegistryContents = {}) {
    const repositoryPages = contents.repositoryPages ?? [[]];
    const manifestsByRepository = contents.manifestsByRepository ?? {};

    return new MockHttpClient({
        handler: (req): PipelineResponse => {
            const url = new URL(req.url);

            if (url.pathname === '/oauth2/exchange') {
                // eslint-disable-next-line @typescript-eslint/naming-convention -- OAuth 2.0 wire field
                return makeResponse(req, 200, JSON.stringify({ refresh_token: 'acr-refresh-token' }));
            }

            if (url.pathname === '/oauth2/token') {
                const scope = new URLSearchParams(req.body as string).get('scope');
                // eslint-disable-next-line @typescript-eslint/naming-convention -- OAuth 2.0 wire field
                return makeResponse(req, 200, JSON.stringify({ access_token: `acr-access-token-for:${scope}` }));
            }

            const requiredScope = url.pathname === '/acr/v1/_catalog'
                ? 'registry:catalog:*'
                : `repository:${decodeURIComponent(url.pathname.split('/')[3])}:metadata_read`;

            // A registry issues per-scope tokens and rejects one minted for a
            // different scope, so a token is only good for the path it was
            // requested against.
            if (contents.requireChallenge && req.headers.get('Authorization') !== `Bearer acr-access-token-for:${requiredScope}`) {
                return makeResponse(req, 401, null, {
                    'WWW-Authenticate': `Bearer realm="https://contoso.azurecr.io/oauth2/token",service="${url.host}",scope="${requiredScope}"`,
                });
            }

            if (url.pathname === '/acr/v1/_catalog') {
                const pageIndex = Number(url.searchParams.get('page') ?? '0');
                const hasMore = pageIndex < repositoryPages.length - 1;
                return makeResponse(
                    req,
                    200,
                    JSON.stringify({ repositories: repositoryPages[pageIndex] }),
                    hasMore ? { link: `</acr/v1/_catalog?page=${pageIndex + 1}>; rel="next"` } : undefined,
                );
            }

            const repository = decodeURIComponent(url.pathname.split('/')[3]);
            return makeResponse(req, 200, JSON.stringify({
                registry: url.host,
                imageName: repository,
                manifests: (manifestsByRepository[repository] ?? []).map((manifest, index) => ({
                    digest: `sha256:${index}`,
                    ...manifest,
                    createdTime: '2026-01-01T00:00:00Z',
                    lastUpdateTime: '2026-01-01T00:00:00Z',
                })),
            }));
        },
    });
}

/** Builds a client over a registry, with the contexts the pipeline needs. */
function createClient(httpClient: MockHttpClient, loginServer = 'contoso.azurecr.io', environment: EnvironmentLike = AzurePublicCloud) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    return AcrRepositoryClient.create(ctx, executor, makeCredential(), loginServer, environment, { httpClient });
}

/** The `/acr/v1` requests, excluding the token-exchange traffic. */
function dataRequests(httpClient: MockHttpClient): PipelineRequest[] {
    return httpClient.requests.filter(req => new URL(req.url).pathname.startsWith('/acr/v1'));
}

describe('AcrRepositoryClient (unit)', () => {
    it('should list repository names', async () => {
        const httpClient = createRegistry({ repositoryPages: [['store/api', 'store/web']] });

        expect(await createClient(httpClient).listRepositories()).to.deep.equal(['store/api', 'store/web']);
    });

    it('should pair each repository with its tags', async () => {
        const httpClient = createRegistry({
            repositoryPages: [['store/api']],
            manifestsByRepository: { 'store/api': [{ tags: ['v2', 'latest'] }, { tags: ['v1'] }] },
        });

        // One manifest may carry several tags, and every tag is deployable.
        expect(await createClient(httpClient).listRepositoryTags()).to.deep.equal([
            { repository: 'store/api', tags: ['v2', 'latest', 'v1'] },
        ]);
    });

    it('should omit a repository that has no tags', async () => {
        // An untagged image cannot be referenced by a deployment, so offering
        // the repository would produce an unusable choice.
        const httpClient = createRegistry({
            repositoryPages: [['store/api', 'store/untagged']],
            manifestsByRepository: { 'store/api': [{ tags: ['v1'] }], 'store/untagged': [{ tags: [] }] },
        });

        const result = await createClient(httpClient).listRepositoryTags();

        expect(result.map(entry => entry.repository)).to.deep.equal(['store/api']);
    });

    it('should tolerate a manifest the service returns with no tags field at all', async () => {
        // The per-platform children of a multi-arch image are untagged, and the
        // service omits `tags` entirely rather than sending an empty array.
        const httpClient = createRegistry({
            repositoryPages: [['store/api']],
            manifestsByRepository: { 'store/api': [{}, { tags: ['v1'] }] },
        });

        expect(await createClient(httpClient).listRepositoryTags()).to.deep.equal([
            { repository: 'store/api', tags: ['v1'] },
        ]);
    });

    it('should load manifests from at most five repositories concurrently', async () => {
        const repositories = Array.from({ length: 6 }, (_, index) => `store/app-${index}`);
        const fiveStarted = Promise.withResolvers<boolean>();
        const sixStarted = Promise.withResolvers<boolean>();
        const releases: Array<() => void> = [];
        let active = 0;
        let maxActive = 0;
        let started = 0;

        const httpClient = new MockHttpClient({
            handler: req => {
                if (!req.url.includes('_manifests')) {
                    return makeResponse(req, 200, JSON.stringify({ repositories }));
                }

                active++;
                started++;
                maxActive = Math.max(maxActive, active);
                if (started === 5) {
                    fiveStarted.resolve(true);
                } else if (started === 6) {
                    sixStarted.resolve(true);
                }

                return new Promise<PipelineResponse>(resolve => {
                    releases.push(() => {
                        active--;
                        resolve(makeResponse(req, 200, JSON.stringify({ manifests: [] })));
                    });
                });
            },
        });

        const result = createClient(httpClient).listRepositoryTags();
        await fiveStarted.promise;

        expect(started).to.equal(5);
        releases.shift()?.();
        await sixStarted.promise;
        expect(maxActive).to.equal(5);

        for (const release of releases) {
            release();
        }
        await result;
    });

    it('should follow the Link header rather than stopping at the first page', async () => {
        // A registry caps a response at its own page size, so a listing that
        // reads one response silently truncates.
        const httpClient = createRegistry({
            repositoryPages: [['store/api'], ['store/web'], ['store/worker']],
        });

        expect(await createClient(httpClient).listRepositories()).to.deep.equal([
            'store/api', 'store/web', 'store/worker',
        ]);
    });

    it('should ask for the manifests ordered most recently updated first', async () => {
        const httpClient = createRegistry({
            repositoryPages: [['store/api']],
            manifestsByRepository: { 'store/api': [{ tags: ['v1'] }] },
        });

        await createClient(httpClient).listRepositoryTags();

        const manifests = dataRequests(httpClient).find(req => req.url.includes('_manifests'));
        expect(manifests?.url).to.contain('orderby=timedesc');
    });

    it('should send the api version on every data-plane request', async () => {
        const httpClient = createRegistry({
            repositoryPages: [['store/api']],
            manifestsByRepository: { 'store/api': [{ tags: ['v1'] }] },
        });

        await createClient(httpClient).listRepositoryTags();

        for (const request of dataRequests(httpClient)) {
            expect(request.url, request.url).to.contain('api-version=2021-07-01');
        }
    });

    it('should percent-encode a nested repository path', async () => {
        const httpClient = createRegistry({
            repositoryPages: [['store/api']],
            manifestsByRepository: { 'store/api': [{ tags: ['v1'] }] },
        });

        await createClient(httpClient).listRepositoryTags();

        // The path segment is one repository name, not two.
        const manifests = dataRequests(httpClient).find(req => req.url.includes('_manifests'));
        expect(manifests?.url).to.contain('/acr/v1/store%2Fapi/_manifests');
    });

    describe('registry token exchange', () => {
        it('should trade the Entra ID token for a registry token when challenged', async () => {
            const httpClient = createRegistry({
                requireChallenge: true,
                repositoryPages: [['store/api']],
            });

            expect(await createClient(httpClient).listRepositories()).to.deep.equal(['store/api']);

            const paths = httpClient.requests.map(req => new URL(req.url).pathname);
            expect(paths).to.deep.equal([
                '/acr/v1/_catalog',   // challenged
                '/oauth2/exchange',   // Entra ID token -> registry refresh token
                '/oauth2/token',      // refresh token -> scoped access token
                '/acr/v1/_catalog',   // retried, now authorized
            ]);
        });

        it('should request the scope the registry asked for', async () => {
            const httpClient = createRegistry({
                requireChallenge: true,
                repositoryPages: [['store/api']],
                manifestsByRepository: { 'store/api': [{ tags: ['v1'] }] },
            });

            await createClient(httpClient).listRepositoryTags();

            // A registry scopes reads per repository, so the scope cannot be
            // predicted from the request alone.
            const scopes = httpClient.requests
                .filter(req => req.url.includes('/oauth2/token'))
                .map(req => new URLSearchParams(req.body as string).get('scope'));
            expect(scopes).to.deep.equal(['registry:catalog:*', 'repository:store/api:metadata_read']);
        });

        it('should exchange for a refresh token only once across a fan-out', async () => {
            // Every repository is challenged separately and concurrently; each
            // needs its own access token, but they all share one refresh token.
            const httpClient = createRegistry({
                requireChallenge: true,
                repositoryPages: [['store/api', 'store/web', 'store/worker']],
                manifestsByRepository: {
                    'store/api': [{ tags: ['v1'] }],
                    'store/web': [{ tags: ['v1'] }],
                    'store/worker': [{ tags: ['v1'] }],
                },
            });

            await createClient(httpClient).listRepositoryTags();

            const paths = httpClient.requests.map(req => new URL(req.url).pathname);
            expect(paths.filter(path => path === '/oauth2/exchange')).to.have.lengthOf(1);
        });

        it('should send the Entra ID token in the exchange body rather than a header', async () => {
            const httpClient = createRegistry({ requireChallenge: true });

            await createClient(httpClient).listRepositories();

            // The exchange endpoint is unauthenticated; attaching a bearer token
            // there would recurse into the challenge it exists to satisfy.
            const exchange = httpClient.requests.find(req => req.url.includes('/oauth2/exchange'));
            expect(exchange?.headers.get('Authorization')).to.be.undefined;
            expect(new URLSearchParams(exchange?.body as string).get('access_token')).to.not.be.empty;
        });

        it('should surface a refused exchange rather than retrying forever', async () => {
            const httpClient = new MockHttpClient({
                handler: req => new URL(req.url).pathname === '/oauth2/exchange'
                    ? makeResponse(req, 403, JSON.stringify({ errors: [{ code: 'DENIED' }] }))
                    : makeResponse(req, 401, null, {
                        'WWW-Authenticate': 'Bearer realm="https://contoso.azurecr.io/oauth2/token",service="contoso.azurecr.io",scope="registry:catalog:*"',
                    }),
            });

            await expect(createClient(httpClient).listRepositories()).to.be.rejectedWith(/token exchange/i);
        });

        it('should give up on a challenge it cannot satisfy', async () => {
            // A 401 with no usable challenge is not worth retrying identically.
            const httpClient = new MockHttpClient({
                handler: req => makeResponse(req, 401, null, { 'WWW-Authenticate': 'Basic realm="registry"' }),
            });

            await expect(createClient(httpClient).listRepositories()).to.be.rejected;
            expect(httpClient.requests).to.have.lengthOf(1);
        });
    });

    it('should accept a login server that already carries a scheme', async () => {
        const httpClient = createRegistry();

        await createClient(httpClient, 'https://contoso.azurecr.io').listRepositories();

        expect(httpClient.requests[0].url.startsWith('https://contoso.azurecr.io/')).to.be.true;
    });

    it('should reach a sovereign-cloud registry at its own login server', async () => {
        const httpClient = createRegistry();

        await createClient(httpClient, 'contoso.azurecr.cn', AzureChinaCloud).listRepositories();

        expect(httpClient.requests[0].url).to.contain('contoso.azurecr.cn');
    });
});
