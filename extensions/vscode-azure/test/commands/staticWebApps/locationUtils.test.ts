/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { addLocationTelemetry, canAzdDeployStaticWebApp } from '../../../src/commands/staticWebApps/steps/locationUtils';

describe('Static Web Apps location utilities (unit)', () => {
    it('should classify locations without recording the paths themselves', () => {
        const context = createActionContext('test');
        addLocationTelemetry(context, 'appLocation', '/', '/');
        addLocationTelemetry(context, 'apiLocation', '', 'api');
        addLocationTelemetry(context, 'outputLocation', 'other', 'build');

        expect(context.telemetry.properties.appLocation).to.equal('default');
        expect(context.telemetry.properties.apiLocation).to.equal('empty');
        expect(context.telemetry.properties.outputLocation).to.equal('nonDefault');
    });

    it('should deploy a build output that is distinct from the app root', () => {
        expect(canAzdDeployStaticWebApp('build')).to.be.true;
        expect(canAzdDeployStaticWebApp('./dist')).to.be.true;
        expect(canAzdDeployStaticWebApp('')).to.be.false;
        expect(canAzdDeployStaticWebApp('/')).to.be.false;
        expect(canAzdDeployStaticWebApp('.')).to.be.false;
    });

    it('should refuse a server build the CLI cannot distinguish from a static export', () => {
        expect(canAzdDeployStaticWebApp('.next')).to.be.false;
        expect(canAzdDeployStaticWebApp('.\\.next')).to.be.false;
    });
});
