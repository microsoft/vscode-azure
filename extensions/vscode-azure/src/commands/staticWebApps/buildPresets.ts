/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Stable identifiers for the retained Static Web Apps build presets. */
export type StaticWebAppBuildPresetId =
    | 'angular'
    | 'react'
    | 'svelte'
    | 'vuejs'
    | 'blazor'
    | 'nextjs'
    | 'nextjs-export'
    | 'nuxt3'
    | 'svelte-kit'
    | 'html'
    | 'gatsby'
    | 'hugo'
    | 'vuepress';

/** Pure build metadata shared by creation now and local task generation later. */
export interface StaticWebAppBuildPreset {
    readonly id: StaticWebAppBuildPresetId;
    readonly displayName: string;
    readonly appLocation: string;
    readonly apiLocation: string;
    readonly outputLocation: string;
    readonly port: number;
    readonly startCommand?: string;
    readonly group: 'framework' | 'ssg';
}

/**
 * Source-compatible Static Web Apps build preset table.
 *
 * Display names are data rather than localized UI; the picker localizes its
 * surrounding group labels, prompt, and Custom entry.
 */
export const staticWebAppBuildPresets: readonly StaticWebAppBuildPreset[] = [
    { id: 'angular', displayName: 'Angular', appLocation: '/', apiLocation: 'api', outputLocation: 'dist/<project-name>', port: 4200, group: 'framework' },
    { id: 'react', displayName: 'React', appLocation: '/', apiLocation: 'api', outputLocation: 'build', port: 3000, startCommand: 'npm start', group: 'framework' },
    { id: 'svelte', displayName: 'Svelte', appLocation: '/', apiLocation: 'api', outputLocation: 'public', port: 5000, group: 'framework' },
    { id: 'vuejs', displayName: 'Vue.js', appLocation: '/', apiLocation: 'api', outputLocation: 'dist', port: 8080, startCommand: 'npm run serve', group: 'framework' },
    { id: 'blazor', displayName: 'Blazor', appLocation: 'Client', apiLocation: 'Api', outputLocation: 'wwwroot', port: 5000, group: 'framework' },
    { id: 'nextjs', displayName: 'Next.js (SSR)', appLocation: '/', apiLocation: '', outputLocation: '', port: 3000, group: 'framework' },
    { id: 'nextjs-export', displayName: 'Next.js (static export)', appLocation: '/', apiLocation: '', outputLocation: 'out', port: 3000, group: 'framework' },
    { id: 'nuxt3', displayName: 'Nuxt 3', appLocation: '/', apiLocation: '.output/server', outputLocation: '.output/public', port: 3000, group: 'framework' },
    { id: 'svelte-kit', displayName: 'SvelteKit', appLocation: '/', apiLocation: 'build/server', outputLocation: 'build/static', port: 3000, group: 'framework' },
    { id: 'html', displayName: 'HTML', appLocation: '/', apiLocation: '', outputLocation: '/', port: 3000, group: 'framework' },
    { id: 'gatsby', displayName: 'Gatsby', appLocation: '/', apiLocation: 'api', outputLocation: 'public', port: 8000, group: 'ssg' },
    { id: 'hugo', displayName: 'Hugo', appLocation: '/', apiLocation: 'api', outputLocation: 'public', port: 1313, group: 'ssg' },
    { id: 'vuepress', displayName: 'VuePress', appLocation: '/', apiLocation: 'api', outputLocation: '.vuepress/dist', port: 8080, group: 'ssg' },
];

/** Looks up one retained preset by stable ID. */
export function getStaticWebAppBuildPreset(id: StaticWebAppBuildPresetId): StaticWebAppBuildPreset {
    const preset = staticWebAppBuildPresets.find(candidate => candidate.id === id);
    if (!preset) {
        throw new RangeError(`Unknown Static Web Apps build preset: ${id}`);
    }
    return preset;
}
