/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { addLocationTelemetry, canAzdDeployStaticWebApp, isYamlSafeLocation } from '../../../src/commands/staticWebApps/steps/locationUtils';

describe('Static Web Apps location utilities (unit)', () => {
    it('should preserve the location telemetry taxonomy without recording paths', () => {
        const context = createActionContext('test');
        addLocationTelemetry(context, 'appLocation', 'src', '/', 'src');
        addLocationTelemetry(context, 'apiLocation', '', 'api', undefined);
        addLocationTelemetry(context, 'outputLocation', 'other', 'build', 'configured');

        expect(context.telemetry.properties.appLocation).to.equal('setting');
        expect(context.telemetry.properties.appLocationHasSetting).to.equal('true');
        expect(context.telemetry.properties.appLocationMatchesSetting).to.equal('false');
        expect(context.telemetry.properties.apiLocation).to.equal('empty');
        expect(context.telemetry.properties.outputLocation).to.equal('nonDefault');
    });

    it('should validate YAML scalars and direct azd output support', () => {
        expect(isYamlSafeLocation('src/app', 'app_location')).to.be.true;
        expect(isYamlSafeLocation('src\napp', 'app_location')).to.be.false;
        expect(isYamlSafeLocation('src"app', 'app_location')).to.be.false;
        expect(canAzdDeployStaticWebApp('build')).to.be.true;
        expect(canAzdDeployStaticWebApp('')).to.be.false;
        expect(canAzdDeployStaticWebApp('/')).to.be.false;
    });
});
