/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree, makeGenericResource, makeResourceGroup } from '@microsoft/vscode-azure-azutils/testing';
import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
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
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        const result = await service.find(resource);

        expect(result?.azureYamlUri.path).to.equal('/project/azure.yaml');
        expect(result?.environmentName).to.equal('dev');
    });

    it('inherits the cached parent resource group tag', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|dev': {
                [SubscriptionValue]: 'sub-1',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const resourceGroup = makeResourceGroup({
            id: ResourceGroupId,
            name: 'rg-1',
            groupingValue: 'rg-1',
            tags: { 'azd-env-name': 'dev' },
        });
        const resource = makeGenericResource({
            id: ResourceId,
            subscription: resourceGroup.subscription,
            tags: {},
        });
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([resourceGroup]));

        const result = await service.find(resource);

        expect(result?.azureYamlUri.path).to.equal('/project/azure.yaml');
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
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        const result = await service.find(resourceGroup);

        expect(result?.azureYamlUri.path).to.equal('/project/azure.yaml');
    });

    it('returns no match when any ownership value differs', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        setEnvironmentValues(azd, {
            '/project|dev': {
                [SubscriptionValue]: 'other-subscription',
                [ResourceGroupValue]: 'rg-1',
            },
        });
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        expect(await service.find(resource)).to.be.undefined;
    });

    it('returns no match for an untagged resource without a cached parent', async () => {
        const azd = createMockAzdService([{ Name: 'dev', IsDefault: true }]);
        setProjects(azd, ['/project']);
        const resource = makeGenericResource({ id: ResourceId, tags: {} });
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        expect(await service.find(resource)).to.be.undefined;
        expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
    });

    it('selects the first matching project and environment deterministically', async () => {
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
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        const result = await service.find(resource);

        expect(result?.azureYamlUri.path).to.equal('/a-project/azure.yaml');
        expect(azd.envList.mock.callCount()).to.equal(1);
        expect(azd.envGetValues.mock.calls[0].arguments[0]).to.equal('dev');
    });

    it('propagates unexpected azd errors', async () => {
        const azd = createMockAzdService();
        setProjects(azd, ['/project']);
        const expectedError = new Error('azd env list failed');
        azd.envList.mock.mockImplementation(() => Promise.reject(expectedError));
        const resource = makeGenericResource({ id: ResourceId, tags: { 'azd-env-name': 'dev' } });
        const service = new AzdResourceAssociationService(azd, createMockDataItemTree([]));

        let actualError: unknown;
        try {
            await service.find(resource);
        } catch (error) {
            actualError = error;
        }

        expect(actualError).to.equal(expectedError);
    });
});
