/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { getStaticWebAppBuildPreset, staticWebAppBuildPresets } from '../../../src/commands/staticWebApps/buildPresets';

describe('Static Web Apps build presets (unit)', () => {
    it('should retain the authoritative preset order and identifiers', () => {
        expect(staticWebAppBuildPresets.map(preset => preset.id)).to.deep.equal([
            'angular',
            'react',
            'svelte',
            'vuejs',
            'blazor',
            'nextjs',
            'nextjs-export',
            'nuxt3',
            'svelte-kit',
            'html',
            'gatsby',
            'hugo',
            'vuepress',
        ]);
    });

    it('should retain path, port, command, and grouping data', () => {
        expect(staticWebAppBuildPresets.map(preset => [
            preset.appLocation,
            preset.apiLocation,
            preset.outputLocation,
            preset.port,
            preset.startCommand,
            preset.group,
        ])).to.deep.equal([
            ['/', 'api', 'dist/<project-name>', 4200, undefined, 'framework'],
            ['/', 'api', 'build', 3000, 'npm start', 'framework'],
            ['/', 'api', 'public', 5000, undefined, 'framework'],
            ['/', 'api', 'dist', 8080, 'npm run serve', 'framework'],
            ['Client', 'Api', 'wwwroot', 5000, undefined, 'framework'],
            ['/', '', '', 3000, undefined, 'framework'],
            ['/', '', 'out', 3000, undefined, 'framework'],
            ['/', '.output/server', '.output/public', 3000, undefined, 'framework'],
            ['/', 'build/server', 'build/static', 3000, undefined, 'framework'],
            ['/', '', '/', 3000, undefined, 'framework'],
            ['/', 'api', 'public', 8000, undefined, 'ssg'],
            ['/', 'api', 'public', 1313, undefined, 'ssg'],
            ['/', 'api', '.vuepress/dist', 8080, undefined, 'ssg'],
        ]);
        expect(getStaticWebAppBuildPreset('react').displayName).to.equal('React');
    });
});
