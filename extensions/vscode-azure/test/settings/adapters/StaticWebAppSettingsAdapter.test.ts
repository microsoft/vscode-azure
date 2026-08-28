/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { StaticWebAppSettingsAdapter } from '../../../src/settings/adapters/StaticWebAppSettingsAdapter';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

function createAdapter(properties: Record<string, string> = {}) {
    const code = createMockVsCode();
    const staticSites = {
        listStaticSiteAppSettings: mock.fn(() => Promise.resolve({ properties })),
        listStaticSiteBuildAppSettings: mock.fn(() => Promise.resolve({ properties })),
        createOrUpdateStaticSiteAppSettings: mock.fn(() => Promise.resolve({ properties })),
        createOrUpdateStaticSiteBuildAppSettings: mock.fn(() => Promise.resolve({ properties })),
        // Present so the tests below can assert this adapter never reaches for them.
        listStaticSiteFunctionAppSettings: mock.fn(() => Promise.resolve({ properties })),
        listStaticSiteBuildFunctionAppSettings: mock.fn(() => Promise.resolve({ properties })),
    };

    const adapter = new StaticWebAppSettingsAdapter(code.vscode, () => ({ staticSites }) as never);
    return { adapter, staticSites };
}

describe('StaticWebAppSettingsAdapter (unit)', () => {
    it('should claim environments and nothing else', () => {
        const { adapter } = createAdapter();

        expect(adapter.canHandle(makeStaticWebAppEnvironment())).to.be.true;
        // The site itself has no settings of its own: they all belong to an environment.
        expect(adapter.canHandle(makeStaticWebApp())).to.be.false;
    });

    it('should read production settings from the site-level endpoint, sorted', async () => {
        const { adapter, staticSites } = createAdapter({ ZED: '2', ALPHA: '1' });

        const snapshot = await adapter.read(makeStaticWebAppEnvironment());

        expect(snapshot.entries).to.deep.equal([{ key: 'ALPHA', value: '1' }, { key: 'ZED', value: '2' }]);
        expect(snapshot.resourceName).to.equal('mySwa (Production)');
        expect(snapshot.writable).to.be.true;
        expect(staticSites.listStaticSiteAppSettings.mock.callCount()).to.equal(1);
        expect(staticSites.listStaticSiteBuildAppSettings.mock.callCount()).to.equal(0);
    });

    it('should read preview settings from the build-level endpoint keyed by build id', async () => {
        const { adapter, staticSites } = createAdapter({ A: '1' });

        await adapter.read(makeStaticWebAppEnvironment({ buildId: '7' }));

        expect(staticSites.listStaticSiteAppSettings.mock.callCount()).to.equal(0);
        expect(staticSites.listStaticSiteBuildAppSettings.mock.callCount()).to.equal(1);
        expect(staticSites.listStaticSiteBuildAppSettings.mock.calls[0].arguments).to.deep.equal(['rg1', 'mySwa', '7']);
    });

    it('should write production settings as a whole dictionary', async () => {
        const { adapter, staticSites } = createAdapter();

        await adapter.write(makeStaticWebAppEnvironment(), [{ key: 'A', value: '1' }]);

        expect(staticSites.createOrUpdateStaticSiteAppSettings.mock.calls[0].arguments).to.deep.equal([
            'rg1', 'mySwa', { properties: { A: '1' } },
        ]);
        expect(staticSites.createOrUpdateStaticSiteBuildAppSettings.mock.callCount()).to.equal(0);
    });

    it('should write preview settings against the build', async () => {
        const { adapter, staticSites } = createAdapter();

        await adapter.write(makeStaticWebAppEnvironment({ isProduction: false, buildId: '7' }), [{ key: 'A', value: '1' }]);

        expect(staticSites.createOrUpdateStaticSiteAppSettings.mock.callCount()).to.equal(0);
        expect(staticSites.createOrUpdateStaticSiteBuildAppSettings.mock.calls[0].arguments).to.deep.equal([
            'rg1', 'mySwa', '7', { properties: { A: '1' } },
        ]);
    });

    it('should read the app settings dictionary, never the function app settings one', async () => {
        // ARM rejects the function app settings endpoints with 'A function must first be deployed
        // to use this method.' until a managed API exists, so reaching for them would make the
        // document unopenable on any site without one. App settings have no such precondition.
        const { adapter, staticSites } = createAdapter({ A: '1' });

        await adapter.read(makeStaticWebAppEnvironment());
        await adapter.read(makeStaticWebAppEnvironment({ isProduction: false, buildId: '7' }));

        expect(staticSites.listStaticSiteFunctionAppSettings.mock.callCount()).to.equal(0);
        expect(staticSites.listStaticSiteBuildFunctionAppSettings.mock.callCount()).to.equal(0);
    });

    it('should reject a blank setting name before calling Azure', async () => {
        const { adapter, staticSites } = createAdapter();

        await expect(adapter.write(makeStaticWebAppEnvironment(), [{ key: '  ', value: '1' }])).to.be.rejected;
        expect(staticSites.createOrUpdateStaticSiteAppSettings.mock.callCount()).to.equal(0);
    });

    it('should refuse an owner that is not an environment', async () => {
        const { adapter, staticSites } = createAdapter();

        await expect(adapter.read(makeStaticWebApp())).to.be.rejected;
        expect(staticSites.listStaticSiteAppSettings.mock.callCount()).to.equal(0);
    });
});
