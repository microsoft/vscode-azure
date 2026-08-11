/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { Container } from 'inversify';
import { mock } from 'node:test';
import { IAzdService } from '../../src/azd/AzdService';
import { IResourceEndpointProviders, IResourceEndpointResolver, ResourceEndpointResolver, type ResourceEndpointProvider } from '../../src/endpoints/ResourceEndpointResolver';
import { createMockAzdService } from '../azd/MockAzdService';

describe('ResourceEndpointResolver (unit)', () => {
    function createProvider(endpoint: string | undefined = 'fallback.example.com'): ResourceEndpointProvider & { getEndpoint: ReturnType<typeof mock.fn> } {
        return {
            canHandle: mock.fn(() => true),
            getEndpoint: mock.fn(() => Promise.resolve(endpoint)),
        };
    }

    it('should prefer an azd endpoint with an exact case-insensitive resource ID match', async () => {
        const mockResult = createMockVsCode();
        mockResult.workspaceFolders.push({ uri: MockUri.file('/project'), name: 'project', index: 0 });
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/project/azure.yaml')]));
        azd.show.mock.mockImplementation(() => Promise.resolve({
            services: {
                web: {
                    ingressUrl: 'https://from-azd.example.com',
                    target: {
                        resourceIds: ['/SUBSCRIPTIONS/SUB/RESOURCEGROUPS/RG/PROVIDERS/MICROSOFT.WEB/SITES/APP/'],
                    },
                },
            },
        }));
        const provider = createProvider();
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [provider]);
        const resource = makeGenericResource({
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
            tags: { 'azd-env-name': 'dev' },
        });

        const endpoint = await resolver.resolve(resource);

        expect(endpoint).to.equal('https://from-azd.example.com/');
        expect(provider.getEndpoint.mock.callCount()).to.equal(0);
        expect(azd.show.mock.calls[0].arguments[1]).to.equal('dev');
    });

    it('should inspect every azd project when one workspace contains many projects', async () => {
        const mockResult = createMockVsCode();
        mockResult.workspaceFolders.push({ uri: MockUri.file('/workspace'), name: 'workspace', index: 0 });
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([
            MockUri.file('/workspace/one/azure.yaml'),
            MockUri.file('/workspace/two/azure.yaml'),
            MockUri.file('/workspace/three/azure.yaml'),
        ]));
        azd.show.mock.mockImplementation((cwd: { path: string }) => Promise.resolve({
            services: {
                web: {
                    ingressUrl: cwd.path.endsWith('/three')
                        ? 'https://matching-project.example.com'
                        : 'https://other-project.example.com',
                    target: {
                        resourceIds: [cwd.path.endsWith('/three') ? '/resource/id' : `/resource${cwd.path}/id`],
                    },
                },
            },
        }));
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [createProvider()]);

        const endpoint = await resolver.resolve(makeGenericResource({ id: '/resource/id' }));

        expect(endpoint).to.equal('https://matching-project.example.com/');
        expect(azd.findAzureYaml.mock.calls[0].arguments[1]).to.be.undefined;
        expect(azd.show.mock.callCount()).to.equal(3);
    });

    it('should support the legacy azd ingresUrl spelling', async () => {
        const mockResult = createMockVsCode();
        mockResult.workspaceFolders.push({ uri: MockUri.file('/project'), name: 'project', index: 0 });
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/project/azure.yaml')]));
        azd.show.mock.mockImplementation(() => Promise.resolve({
            services: {
                web: {
                    ingresUrl: 'legacy.example.com',
                    target: { resourceIds: ['/resource/id'] },
                },
            },
        }));
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [createProvider()]);

        const endpoint = await resolver.resolve(makeGenericResource({ id: '/resource/id' }));

        expect(endpoint).to.equal('https://legacy.example.com/');
    });

    it('should fall back to the product provider when azd has no matching target', async () => {
        const mockResult = createMockVsCode();
        mockResult.workspaceFolders.push({ uri: MockUri.file('/project'), name: 'project', index: 0 });
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/project/azure.yaml')]));
        azd.show.mock.mockImplementation(() => Promise.resolve({
            services: {
                other: {
                    ingressUrl: 'https://wrong.example.com',
                    target: { resourceIds: ['/resource/other'] },
                },
            },
        }));
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [createProvider()]);

        const endpoint = await resolver.resolve(makeGenericResource({ id: '/resource/id' }));

        expect(endpoint).to.equal('https://fallback.example.com/');
    });

    it('should use the product provider when no azd workspace is open', async () => {
        const mockResult = createMockVsCode();
        const azd = createMockAzdService();
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [createProvider('localhost:3000')]);

        const endpoint = await resolver.resolve(makeGenericResource());

        expect(endpoint).to.equal('https://localhost:3000/');
        expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
    });

    it('should fall back when the matching azd endpoint has a non-http scheme', async () => {
        const mockResult = createMockVsCode();
        mockResult.workspaceFolders.push({ uri: MockUri.file('/project'), name: 'project', index: 0 });
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/project/azure.yaml')]));
        azd.show.mock.mockImplementation(() => Promise.resolve({
            services: {
                web: {
                    ingressUrl: 'ftp://invalid.example.com',
                    target: { resourceIds: ['/resource/id'] },
                },
            },
        }));
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [createProvider()]);

        const endpoint = await resolver.resolve(makeGenericResource({ id: '/resource/id' }));

        expect(endpoint).to.equal('https://fallback.example.com/');
    });

    it('should expose capability without invoking either endpoint source', () => {
        const mockResult = createMockVsCode();
        const azd = createMockAzdService();
        const provider = createProvider();
        const { executor } = createTestActionExecutor();
        const resolver = new ResourceEndpointResolver(mockResult.vscode, executor, azd, [provider]);

        expect(resolver.canHandle(makeGenericResource())).to.be.true;
        expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
        expect(provider.getEndpoint.mock.callCount()).to.equal(0);
    });

    it('should resolve from the container with the injected provider collection', async () => {
        const mockResult = createMockVsCode();
        const { executor } = createTestActionExecutor();
        const container = new Container();
        container.bind(IVsCode).toConstantValue(mockResult.vscode);
        container.bind(IActionExecutor).toConstantValue(executor);
        container.bind(IAzdService).toConstantValue(createMockAzdService());
        container.bind(IResourceEndpointProviders).toConstantValue(createProvider());
        container.bind(IResourceEndpointResolver).to(ResourceEndpointResolver).inSingletonScope();

        const resolver = container.get(IResourceEndpointResolver);

        expect(resolver.canHandle(makeGenericResource())).to.be.true;
        expect(await resolver.resolve(makeGenericResource())).to.equal('https://fallback.example.com/');
    });
});
