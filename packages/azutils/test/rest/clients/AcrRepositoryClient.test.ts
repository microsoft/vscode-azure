/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureChinaCloud, AzurePublicCloud } from '../../../src/auth/Environment';
import { AcrRepositoryClient } from '../../../src/rest/clients/AcrRepositoryClient';
import { makeCredential } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

/** Routes the registry's repository and manifest endpoints to canned bodies. */
function createHttpClient(repositories: string[], manifestsByRepository: Record<string, { tags: string[] }[]>) {
    return new MockHttpClient({
        handler: req => {
            const manifestMatch = /\/acr\/v1\/([^/]+)\/_manifests/.exec(req.url);
            if (manifestMatch) {
                const repository = decodeURIComponent(manifestMatch[1]);
                const manifests = manifestsByRepository[repository] ?? [];
                return makeResponse(req, 200, JSON.stringify({
                    registry: 'contoso.azurecr.io',
                    imageName: repository,
                    manifests: manifests.map((manifest, index) => ({
                        digest: `sha256:${index}`,
                        tags: manifest.tags,
                        createdTime: '2026-01-01T00:00:00Z',
                        lastUpdateTime: '2026-01-01T00:00:00Z',
                        architecture: 'amd64',
                        os: 'linux',
                        changeableAttributes: {},
                    })),
                }));
            }

            return makeResponse(req, 200, JSON.stringify({ repositories }));
        },
    });
}

describe('AcrRepositoryClient (unit)', () => {
    it('should list repository names', async () => {
        const httpClient = createHttpClient(['store/api', 'store/web'], {});

        const client = AcrRepositoryClient.create(makeCredential(), 'contoso.azurecr.io', AzurePublicCloud, { httpClient });

        expect(await client.listRepositories()).to.deep.equal(['store/api', 'store/web']);
    });

    it('should pair each repository with its tags', async () => {
        const httpClient = createHttpClient(['store/api'], {
            'store/api': [{ tags: ['v2', 'latest'] }, { tags: ['v1'] }],
        });

        const client = AcrRepositoryClient.create(makeCredential(), 'contoso.azurecr.io', AzurePublicCloud, { httpClient });
        const result = await client.listRepositoryTags();

        // One manifest may carry several tags, and every tag is deployable.
        expect(result).to.deep.equal([{ repository: 'store/api', tags: ['v2', 'latest', 'v1'] }]);
    });

    it('should omit a repository that has no tags', async () => {
        // An untagged image cannot be referenced by a deployment, so offering
        // the repository would produce an unusable choice.
        const httpClient = createHttpClient(['store/api', 'store/untagged'], {
            'store/api': [{ tags: ['v1'] }],
            'store/untagged': [{ tags: [] }],
        });

        const client = AcrRepositoryClient.create(makeCredential(), 'contoso.azurecr.io', AzurePublicCloud, { httpClient });
        const result = await client.listRepositoryTags();

        expect(result.map(entry => entry.repository)).to.deep.equal(['store/api']);
    });

    it('should accept a login server that already carries a scheme', async () => {
        const httpClient = createHttpClient([], {});

        const client = AcrRepositoryClient.create(makeCredential(), 'https://contoso.azurecr.io', AzurePublicCloud, { httpClient });
        await client.listRepositories();

        expect(httpClient.requests[0].url.startsWith('https://contoso.azurecr.io/')).to.be.true;
    });

    it('should reach a sovereign-cloud registry at its own login server', async () => {
        const httpClient = createHttpClient([], {});

        const client = AcrRepositoryClient.create(makeCredential(), 'contoso.azurecr.cn', AzureChinaCloud, { httpClient });
        await client.listRepositories();

        expect(httpClient.requests[0].url).to.contain('contoso.azurecr.cn');
    });
});
