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
 *
 * Rewriting the shard host to a stable host does not work: on a frozen install pnpm re-fetches
 * the registry metadata (which still returns a random shard host) and verifies the lockfile's
 * tarball URL against it, failing with ERR_PNPM_TARBALL_URL_MISMATCH.
 *
 * Instead, this hook DELETES the tarball field for these entries. With no explicit tarball URL,
 * pnpm derives the standard `<registry>/<name>/-/<name>-<version>.tgz` URL from the configured
 * registry (which serves the same tarballs) and has nothing to verify against metadata. The
 * lockfile becomes deterministic with no shard hosts and no post-processing step.
 */

const SHARD_TARBALL = /^https:\/\/ms-feed-\d+\.pkgs\.visualstudio\.com\/1es-public\/_packaging\/npm-public\/npm\/registry\//;
const STABLE_TARBALL = 'https://packagefeedproxy.microsoft.io/npm/';

/**
 * A tarball URL is volatile if it points at a load-balancer shard host, or at the stable
 * proxy host (a leftover from a previous rewrite). Either way it should be dropped so pnpm
 * re-derives the standard registry URL.
 *
 * @param {string} tarball
 * @returns {boolean}
 */
function isVolatileTarball(tarball) {
    return SHARD_TARBALL.test(tarball) || tarball.startsWith(STABLE_TARBALL);
}

function afterAllResolved(lockfile) {
    for (const pkg of Object.values(lockfile.packages ?? {})) {
        if (pkg && pkg.resolution && typeof pkg.resolution.tarball === 'string' && isVolatileTarball(pkg.resolution.tarball)) {
            delete pkg.resolution.tarball;
        }
    }
    return lockfile;
}

export const hooks = {
    afterAllResolved,
};
