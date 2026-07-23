/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GitHubRepository } from '../../services/StaticWebAppsGitHubService';

/** Azure Static Web Apps product documentation. */
export const staticWebAppsDocumentationUrl = 'https://aka.ms/AA92xai';
/** Azure Functions API guidance for Static Web Apps. */
export const staticWebAppsFunctionsDocumentationUrl = 'https://aka.ms/AAacf3z';
/** Build preset guidance used by the creation picker. */
export const staticWebAppsBuildPresetsUrl = 'https://aka.ms/SWABuildPresets';
/** Application source location guidance. */
export const staticWebAppsAppLocationUrl = 'https://aka.ms/SwaAppLoc';
/** Functions API location guidance. */
export const staticWebAppsApiLocationUrl = 'https://aka.ms/SwaApiLoc';
/** Build output location guidance. */
export const staticWebAppsOutputLocationUrl = 'https://aka.ms/SwaOutLoc';

/** Builds a canonical github.com repository URL from a parsed identity. */
export function getGitHubRepositoryUrl(repository: GitHubRepository): string {
    return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

/** Encodes a GitHub branch while preserving slash-separated branch names. */
export function encodeGitHubBranch(branch: string): string {
    return branch.split('/').map(segment => encodeURIComponent(segment)).join('/');
}
