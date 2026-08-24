/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getStaticWebAppBuildPreset, staticWebAppBuildPresets, type StaticWebAppBuildPresetId } from '../../../src/commands/staticWebApps/buildPresets';

describe('Static Web Apps build presets (unit)', () => {
    it('should look up every preset by its own id', () => {
        // Round-tripping the whole table also catches a duplicated id, which would compile
        // but leave the shadowed preset permanently unreachable through the lookup.
        for (const preset of staticWebAppBuildPresets) {
            expect(getStaticWebAppBuildPreset(preset.id)).to.equal(preset);
        }
    });

    it('should reject an id that names no preset', () => {
        expect(() => getStaticWebAppBuildPreset('not-a-framework' as StaticWebAppBuildPresetId)).to.throw(RangeError);
    });
});
