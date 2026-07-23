/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelineRequest } from '@azure/core-rest-pipeline';
import { collectPageItems, createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { StaticWebAppClient } from '../../../src/rest/clients/StaticWebAppClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('StaticWebAppClient (unit)', () => {
    it('should get a static site and list its builds', async () => {
        const httpClient = new MockHttpClient({
            handler: (req) => {
                if (req.url.includes('/builds')) {
                    return makeResponse(req, 200, JSON.stringify({
                        value: [
                            {
                                id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/site1/builds/default',
                                name: 'default',
                                type: 'Microsoft.Web/staticSites/builds',
                                properties: {
                                    buildId: 'default',
                                    sourceBranch: 'main',
                                    hostname: 'site1.azurestaticapps.net',
                                    status: 'Ready',
                                },
                            },
                        ],
                    }));
                }

                return makeResponse(req, 200, staticSiteBody);
            },
        });
        const client = createClient(httpClient);

        const site = await client.staticSites.getStaticSite('rg1', 'site1');
        const builds = await collectPageItems(client.staticSites.listStaticSiteBuilds('rg1', 'site1'));

        expect(site.name).to.equal('site1');
        expect(site.defaultHostname).to.equal('site1.azurestaticapps.net');
        expect(builds).to.have.length(1);
        expect(builds[0].buildId).to.equal('default');
    });

    it('should get a build and list production and build functions', async () => {
        const httpClient = new MockHttpClient({
            handler: (req) => {
                if (req.url.includes('/functions')) {
                    const functionName = req.url.includes('/builds/') ? 'previewApi' : 'productionApi';
                    return makeResponse(req, 200, JSON.stringify({
                        value: [
                            {
                                id: `${req.url}/${functionName}`,
                                name: functionName,
                                type: 'Microsoft.Web/staticSites/functions',
                                properties: {
                                    functionName,
                                    triggerType: 'HttpTrigger',
                                },
                            },
                        ],
                    }));
                }

                return makeResponse(req, 200, staticSiteBuildBody);
            },
        });
        const client = createClient(httpClient);

        const build = await client.staticSites.getStaticSiteBuild('rg1', 'site1', 'preview');
        const productionFunctions = await collectPageItems(client.staticSites.listStaticSiteFunctions('rg1', 'site1'));
        const buildFunctions = await collectPageItems(client.staticSites.listStaticSiteBuildFunctions('rg1', 'site1', 'preview'));

        expect(build.buildId).to.equal('preview');
        expect(productionFunctions[0].functionName).to.equal('productionApi');
        expect(buildFunctions[0].functionName).to.equal('previewApi');
    });

    it('should list and update production and build function app settings', async () => {
        const httpClient = new MockHttpClient({
            handler: (req) => {
                if (req.method === 'PUT') {
                    return makeResponse(req, 200, requestBody(req));
                }
                return makeResponse(req, 200, JSON.stringify({
                    properties: {
                        greeting: req.url.includes('/builds/') ? 'preview' : 'production',
                    },
                }));
            },
        });
        const client = createClient(httpClient);

        const production = await client.staticSites.listStaticSiteFunctionAppSettings('rg1', 'site1');
        const build = await client.staticSites.listStaticSiteBuildFunctionAppSettings('rg1', 'site1', 'preview');
        const updatedProduction = await client.staticSites.createOrUpdateStaticSiteFunctionAppSettings(
            'rg1',
            'site1',
            { properties: { greeting: 'updated-production' } },
        );
        const updatedBuild = await client.staticSites.createOrUpdateStaticSiteBuildFunctionAppSettings(
            'rg1',
            'site1',
            'preview',
            { properties: { greeting: 'updated-preview' } },
        );

        expect(production.properties?.greeting).to.equal('production');
        expect(build.properties?.greeting).to.equal('preview');
        expect(updatedProduction.properties?.greeting).to.equal('updated-production');
        expect(updatedBuild.properties?.greeting).to.equal('updated-preview');
        expect(httpClient.requests.filter(req => req.method === 'PUT')).to.have.length(2);
    });

    it('should wait for static site and build deletions', async () => {
        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200),
        });
        const client = createClient(httpClient);

        await client.staticSites.deleteStaticSiteBuild('rg1', 'site1', 'preview');
        await client.staticSites.deleteStaticSite('rg1', 'site1');

        const deleteRequests = httpClient.requests.filter(req => req.method === 'DELETE');
        expect(deleteRequests).to.have.length(2);
        expect(deleteRequests[0].url).to.include('/builds/preview');
    });
});

const staticSiteBody = JSON.stringify({
    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/site1',
    name: 'site1',
    type: 'Microsoft.Web/staticSites',
    location: 'eastus2',
    properties: {
        defaultHostname: 'site1.azurestaticapps.net',
        repositoryUrl: 'https://github.com/example/site1',
        branch: 'main',
    },
});

const staticSiteBuildBody = JSON.stringify({
    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/site1/builds/preview',
    name: 'preview',
    type: 'Microsoft.Web/staticSites/builds',
    properties: {
        buildId: 'preview',
        sourceBranch: 'example:feature',
        hostname: 'preview.azurestaticapps.net',
        status: 'Ready',
    },
});

function createClient(httpClient: MockHttpClient): StaticWebAppClient {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    return StaticWebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });
}

function requestBody(request: PipelineRequest): string {
    if (typeof request.body !== 'string') {
        throw new TypeError('Expected a string request body.');
    }
    return request.body;
}
