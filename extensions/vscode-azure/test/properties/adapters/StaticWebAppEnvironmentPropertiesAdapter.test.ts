/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { StaticWebAppEnvironmentPropertiesAdapter } from '../../../src/properties/adapters/StaticWebAppEnvironmentPropertiesAdapter';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('StaticWebAppEnvironmentPropertiesAdapter (unit)', () => {
    const adapter = new StaticWebAppEnvironmentPropertiesAdapter();

    it('serves Static Web Apps environments', () => {
        expect(adapter.canHandle(makeStaticWebAppEnvironment())).to.be.true;
    });

    it('leaves the Static Web App itself and unrelated nodes to other adapters', () => {
        expect(adapter.canHandle(makeStaticWebApp())).to.be.false;
        expect(adapter.canHandle(makeGenericResource())).to.be.false;
        expect(adapter.canHandle(makeVirtualResource())).to.be.false;
    });

    it('returns the build payload already retained on the environment', async () => {
        const environment = makeStaticWebAppEnvironment({
            data: { buildId: '42', status: 'Building', sourceBranch: 'feature' },
        });

        expect(await adapter.read(environment)).to.equal(environment.data);
    });

    it('declares redaction, so a credential added to the build payload is withheld by default', () => {
        expect(adapter.redact).to.equal(true);
    });
});
