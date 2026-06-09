/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

describe('extension', () => {
    it('should activate', async () => {
        const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azure');
        if (!extension) {
            expect.fail('Extension not found');
        }

        await extension.activate();
    });
});

describe('bundle size guardrail (integration)', () => {
    // Baseline size (in bytes) of the packaged VSIX.
    //
    // This is a guardrail, NOT a target. The intent is to notice when the extension
    // bundle grows or shrinks unexpectedly -- for example, a stray namespace import
    // that drags in a whole SDK, or a dependency that inadvertently ships its source
    // maps. The +/-10% tolerance below is deliberately generous to avoid noisy failures
    // on normal churn, so a failure here almost always means something real.
    //
    // DO NOT bump this baseline casually. Before changing it, confirm that the size
    // delta is expected and justified (e.g. a new Azure service, a deliberate SDK
    // upgrade). A PR that touches this number should explain, in its description,
    // *why* the bundle legitimately grew or shrank. If you cannot explain it,
    // investigate before updating the baseline.
    const VSIX_BASELINE_BYTES = 277479;
    const VSIX_TOLERANCE = 0.1;
    const VSIX_WARN_THRESHOLD = 0.05;

    it('should be within 10% of the baseline size', function () {
        const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azure');
        if (!extension) {
            expect.fail('Extension not found');
        }

        // `vsce package` emits the VSIX next to package.json (e.g. `vscode-azure-1.0.0.vsix`).
        // In local dev runs the VSIX typically isn't built, so we skip rather than fail.
        // Under GitHub Actions, however, a missing VSIX means this guardrail would never
        // run, so fail fast instead of silently skipping.
        // If multiple VSIXs are present (e.g. stale artifacts from prior versions), pick the
        // highest semver to measure the current build. `localeCompare` with `numeric: true`
        // orders embedded version numbers correctly (e.g. `1.10.0` > `1.2.0`).
        const extensionPath = extension.extensionPath;
        const vsixFiles = fs.readdirSync(extensionPath).filter((name) => name.endsWith('.vsix'));
        if (vsixFiles.length === 0) {
            if (process.env.GITHUB_ACTIONS === 'true') {
                expect.fail(
                    `No .vsix file found under ${extensionPath}. Build/package the extension ` +
                    `before running the bundle size guardrail in CI.`,
                );
            }
            this.skip();
        }

        const latestVsix = vsixFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

        const vsixPath = path.join(extensionPath, latestVsix);
        const actualBytes = fs.statSync(vsixPath).size;

        const lower = VSIX_BASELINE_BYTES * (1 - VSIX_TOLERANCE);
        const upper = VSIX_BASELINE_BYTES * (1 + VSIX_TOLERANCE);
        const deltaPercent = ((actualBytes - VSIX_BASELINE_BYTES) / VSIX_BASELINE_BYTES) * 100;

        // Mocha has no native "warn" state. When drift is past the warn threshold but
        // still within the hard tolerance, log to the console (might get buried in Mocha
        // output, but worth a shot) and emit a GitHub Actions `::warning::` annotation
        // under CI so it surfaces in the PR checks UI without failing the run.
        if (
            Math.abs(deltaPercent) >= VSIX_WARN_THRESHOLD * 100 &&
            Math.abs(deltaPercent) < VSIX_TOLERANCE * 100
        ) {
            const message =
                `VSIX size ${actualBytes} bytes is ${deltaPercent.toFixed(1)}% off baseline ` +
                `${VSIX_BASELINE_BYTES} bytes (warn threshold ${VSIX_WARN_THRESHOLD * 100}%, ` +
                `fail threshold ${VSIX_TOLERANCE * 100}%).`;
            console.warn(`[bundle-size] ${message}`);
            if (process.env.GITHUB_ACTIONS === 'true') {
                // GitHub Actions workflow commands require `%`, `\r`, and `\n` in the message
                // to be URL-encoded, otherwise the annotation parses incorrectly.
                // See https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#example-setting-a-warning-message
                const encoded = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
                console.log(`::warning title=Bundle size drift::${encoded}`);
            }
        }

        expect(
            actualBytes,
            `VSIX size ${actualBytes} bytes is ${deltaPercent.toFixed(1)}% off baseline ` +
            `${VSIX_BASELINE_BYTES} bytes (allowed range ${lower.toFixed(0)}-${upper.toFixed(0)}). ` +
            `If this change is intentional, update VSIX_BASELINE_BYTES -- but please read the ` +
            `comment above it first and justify the change in your PR description.`,
        )
            .to.be.at.least(lower)
            .and.at.most(upper);
    });
});
