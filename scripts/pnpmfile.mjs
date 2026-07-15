/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Azure Artifacts feed / package proxy sits behind a load balancer that answers each
 * request from a random backend shard (ms-feed-2, ms-feed-12, ms-feed-25, ...). Those shard
 * hostnames get embedded in each package's `dist.tarball`, and pnpm records any non-standard
 * tarball URL in the lockfile. Because the shard varies per request, the lockfile would churn
 * on every install and pin URLs to ephemeral shard hosts that can rotate out and break CI.

 * This hook rewrites those volatile shard hosts back to the stable, load-balanced entry point
 * (which serves the same tarballs) before the lockfile is written, making the lockfile
 * deterministic without any post-processing step.
 */

const SHARD_TARBALL = /^https:\/\/ms-feed-\d+\.pkgs\.visualstudio\.com\/1es-public\/_packaging\/npm-public\/npm\/registry\//;
const STABLE_TARBALL = 'https://packagefeedproxy.microsoft.io/npm/';

/**
 * @param {string | undefined} tarball
 * @returns {string | undefined}
 */
function normalizeTarball(tarball) {
    if (typeof tarball === 'string' && SHARD_TARBALL.test(tarball)) {
        return tarball.replace(SHARD_TARBALL, STABLE_TARBALL);
    }
    return tarball;
}

function afterAllResolved(lockfile) {
    for (const pkg of Object.values(lockfile.packages ?? {})) {
        if (pkg && pkg.resolution && typeof pkg.resolution.tarball === 'string') {
            const normalized = normalizeTarball(pkg.resolution.tarball);
            if (normalized !== undefined) {
                pkg.resolution.tarball = normalized;
            }
        }
    }
    return lockfile;
}

export const hooks = {
    afterAllResolved,
};
