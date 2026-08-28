/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock, type Mock } from 'node:test';
import { StaticWebAppEnvironmentPropertiesAdapter } from '../../../src/properties/adapters/StaticWebAppEnvironmentPropertiesAdapter';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('StaticWebAppEnvironmentPropertiesAdapter (unit)', () => {
    it('serves Static Web Apps environments', () => {
        const { adapter } = createAdapter();

        expect(adapter.canHandle(makeStaticWebAppEnvironment())).to.be.true;
    });

    it('leaves the Static Web App itself and unrelated nodes to other adapters', () => {
        const { adapter } = createAdapter();

        expect(adapter.canHandle(makeStaticWebApp())).to.be.false;
        expect(adapter.canHandle(makeGenericResource())).to.be.false;
        expect(adapter.canHandle(makeVirtualResource())).to.be.false;
    });

    it('reads the build behind the environment rather than the site', async () => {
        const environment = makeStaticWebAppEnvironment({ buildId: '42' });
        const { adapter, getStaticSiteBuild } = createAdapter();

        await adapter.read(environment);

        expect(getStaticSiteBuild.mock.calls[0].arguments).to.deep.equal([
            'rg1',
            environment.azureResource.name,
            '42',
        ]);
    });

    it('returns the build payload as the service sent it', async () => {
        const build = { buildId: '42', status: 'Ready', sourceBranch: 'main' };
        const { adapter } = createAdapter({
            getStaticSiteBuild: mock.fn(() => Promise.resolve(build)),
        });

        expect(await adapter.read(makeStaticWebAppEnvironment())).to.deep.equal(build);
    });

    it('fails when the owning site id carries no resource group to read the build from', async () => {
        const { adapter, getStaticSiteBuild } = createAdapter();
        const environment = makeStaticWebAppEnvironment({
            azureResource: makeStaticWebApp({ id: '/subscriptions/sub1' }),
        });

        await expect(adapter.read(environment)).to.be.rejectedWith(/resource group/i);
        expect(getStaticSiteBuild.mock.callCount()).to.equal(0);
    });

    it('declares redaction, so a credential added to the build payload is withheld by default', () => {
        const { adapter } = createAdapter();

        expect(adapter.redact).to.equal(true);
    });
});

type GetStaticSiteBuild = Mock<(resourceGroup: string, name: string, buildId: string) => Promise<unknown>>;

interface AdapterSetup {
    readonly adapter: StaticWebAppEnvironmentPropertiesAdapter;
    readonly getStaticSiteBuild: GetStaticSiteBuild;
}

function createAdapter(options: { readonly getStaticSiteBuild?: GetStaticSiteBuild } = {}): AdapterSetup {
    const getStaticSiteBuild = options.getStaticSiteBuild
        ?? mock.fn((_resourceGroup: string, _name: string, _buildId: string) => Promise.resolve({ status: 'Ready' }));

    const container = new Container();
    container.bind(ICodeContext).toConstantValue(createMockCodeContext().ctx);
    container.bind(IStaticWebAppClientProvider).toConstantValue(() => ({
        staticSites: { getStaticSiteBuild },
    }) as unknown as ReturnType<IStaticWebAppClientProvider>);
    container.bind(StaticWebAppEnvironmentPropertiesAdapter).toSelf();

    return { adapter: container.get(StaticWebAppEnvironmentPropertiesAdapter), getStaticSiteBuild };
}
