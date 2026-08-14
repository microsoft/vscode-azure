/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource, makeResourceGroup } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzdResourceAssociationService } from '../../src/azd/AzdResourceAssociationService';
import { createMockAzdService, type MockAzdService } from './MockAzdService';

const ResourceId = '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/app-1';
const ResourceGroupId = '/subscriptions/sub-1/resourceGroups/rg-1';
const SubscriptionValue = 'AZURE_SUBSCRIPTION_ID';
const ResourceGroupValue = 'AZURE_RESOURCE_GROUP';

function setProjects(azd: MockAzdService, paths: string[]): void {
    azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve(paths.map(path => MockUri.file(`${path}/azure.yaml`))));
}

function setEnvironmentValues(
    azd: MockAzdService,
    valuesByProjectAndEnvironment: Readonly<Record<string, Readonly<Record<string, string>>>>,
): void {
    azd.envGetValues.mock.mockImplementation((environmentName: string, cwd: { path: string }) => {
        return Promise.resolve(valuesByProjectAndEnvironment[`${cwd.path}|${environmentName}`] ?? {});
    });
}

function createService(azd: MockAzdService): AzdResourceAssociationService {
    return new AzdResourceAssociationService(createMockVsCode().vscode, azd);
}

describe('AzdResourceAssociationService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('matches a directly tagged resource', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = createService(azd);

        const result = await service.find(resource);

        expect(result?.azureYamlUri.path).to.equal('/project/azure.yaml');
        expect(result?.environmentName).to.equal('dev');
    });

    it('rejects an untagged resource without spawning azd', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const untagged = makeGenericResource({ id: ResourceId, tags: {} });
        const noTags = makeGenericResource({ id: ResourceId, tags: undefined });
        const service = createService(azd);

        expect(await service.find(untagged)).to.be.undefined;
        expect(await service.find(noTags)).to.be.undefined;
        expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
        expect(azd.envList.mock.callCount()).to.equal(0);
        expect(azd.envGetValues.mock.callCount()).to.equal(0);
    });

    it('matches tag keys, names, subscription ids, and resource groups case-insensitively', async () => {
        const azd = createMockAzdService([{ Name: 'DEV', IsDefault: false }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|DEV': {
                [SubscriptionValue]: 'SUB-1',
                [ResourceGroupValue]: 'RG-1',
            },
        });
        const resourceGroup = makeResourceGroup({
            id: ResourceGroupId,
            name: 'rg-1',
            groupingValue: 'rg-1',
            tags: { 'AZD-ENV-NAME': 'dev' },
        });
        const service = createService(azd);

        const result = await service.find(resourceGroup);

        expect(result?.azureYamlUri.path).to.equal('/project/azure.yaml');
    });

    it('returns no match when the tagged environment values differ', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|dev': {
                [SubscriptionValue]: 'other-subscription',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = createService(azd);

        expect(await service.find(resource)).to.be.undefined;
    });

    it('returns no match when multiple project and environment associations match', async () => {
        const azd = createMockAzdService();
        setProjects(azd, ['/z-project', '/a-project']);
        azd.envList.mock.mockImplementation((cwd: { path: string }) => Promise.resolve(
            cwd.path === '/a-project'
                ? [{ Name: 'z-env', IsDefault: true }, { Name: 'dev', IsDefault: false }]
                : [{ Name: 'dev', IsDefault: true }],
        ));
        setEnvironmentValues(azd, {
            '/a-project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
            '/z-project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = createService(azd);

        expect(await service.find(resource)).to.be.undefined;
        expect(azd.envList.mock.callCount()).to.equal(2);
        expect(azd.envGetValues.mock.callCount()).to.equal(2);
    });

    it('returns the unique match amid nonmatching projects', async () => {
        const azd = createMockAzdService();
        setProjects(azd, ['/matching-project', '/other-environment', '/other-target']);
        azd.envList.mock.mockImplementation((cwd: { path: string }) => Promise.resolve(
            cwd.path === '/other-environment'
                ? [{ Name: 'prod', IsDefault: true }]
                : [{ Name: 'dev', IsDefault: true }],
        ));
        setEnvironmentValues(azd, {
            '/matching-project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
            '/other-target|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'other-rg',
            },
        });
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = createService(azd);

        const result = await service.find(resource);

        expect(result?.azureYamlUri.path).to.equal('/matching-project/azure.yaml');
        expect(result?.environmentName).to.equal('dev');
        expect(azd.envList.mock.callCount()).to.equal(3);
        expect(azd.envGetValues.mock.callCount()).to.equal(2);
    });

    it('propagates unexpected azd errors', async () => {
        const azd = createMockAzdService();
        setProjects(azd, ['/project']);
        const expectedError = new Error('azd env list failed');
        azd.envList.mock.mockImplementation(() => Promise.reject(expectedError));
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = createService(azd);

        let actualError: unknown;
        try {
            await service.find(resource);
        } catch (error) {
            actualError = error;
        }

        expect(actualError).to.equal(expectedError);
    });
});
