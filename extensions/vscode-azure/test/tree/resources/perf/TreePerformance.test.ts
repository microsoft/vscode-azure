/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { TreePerfBaselines, type TreePerfBaseline } from './baselines';
import { scenarios } from './scenarios';
import { measureScenario, type PerfScenario, type TreeMetrics } from './treeMetrics';

/**
 * Set to `1` to make a regression fail the build instead of only annotating it.
 *
 * The gate ships in report-only mode on purpose. A performance gate is only
 * worth having if people trust it, and trust is earned by a stretch of runs in
 * which it never fires spuriously -- not by a design argument. Flip this on (or
 * change the default here) once the baselines have survived a few weeks of real
 * PR traffic without a false positive.
 */
const EnforceEnvVar = 'TREE_PERF_ENFORCE';

/** Which way a counter moved relative to its baseline. */
type Verdict = 'match' | 'improved' | 'regressed';

/** One counter compared against its baseline. */
interface Comparison {
    readonly metric: keyof TreePerfBaseline;
    readonly baseline: number;
    readonly actual: number;
    readonly verdict: Verdict;
}

/**
 * Performance guardrails for the Azure resource tree.
 *
 * Each scenario drives the real data/view tree stack over a synthetic ARM
 * endpoint and records three counters that move independently of each other:
 * total ARM round trips, the depth of the dependent-request chain, and the
 * number of whole-tree refreshes the view asks VS Code for. See
 * `docs/tree-perf-gates.md` for what this does and does not catch.
 *
 * Deliberately *not* asserted on: wall-clock time, and the counters that are
 * simply `renderCycles x treeSize` (tree-item renders, cache hits, `loadAll`
 * calls). Those are recorded as diagnostics to explain a movement in the three
 * that are gated.
 */
describe('Tree load performance (integration)', () => {
    const enforce = process.env[EnforceEnvVar] === '1';
    const isCi = process.env.GITHUB_ACTIONS === 'true';

    for (const scenario of scenarios) {
        it(`should stay within baseline: ${scenario.id}`, async function () {
            // Every mocked round trip costs a fixed 25ms so that the dependent-request
            // chain is unambiguous, which makes the deepest scenarios take a beat.
            this.timeout(60_000);

            const baseline = TreePerfBaselines[scenario.id];
            // A missing baseline is a wiring mistake rather than a performance
            // signal, so it fails even in report-only mode.
            expect(baseline, `No baseline recorded for scenario '${scenario.id}'. Add one to baselines.ts.`).to.not.be.undefined;

            const metrics = await measureScenario(scenario);
            assertHarnessIsLive(scenario, metrics);

            const comparisons = compare(baseline, metrics);
            report(scenario, metrics, comparisons, { enforce, isCi });

            if (enforce) {
                const regressions = comparisons.filter(c => c.verdict === 'regressed');
                expect(regressions.length, formatFailure(scenario, regressions)).to.equal(0);
            }
        });
    }
});

/**
 * Guard against the harness silently measuring nothing.
 *
 * Without this, a broken fixture route or a provider that stops being consulted
 * would drive every counter to zero, which reads as a spectacular improvement
 * and would quietly disable the gate.
 */
function assertHarnessIsLive(scenario: PerfScenario, metrics: TreeMetrics): void {
    expect(metrics.armCalls, `Scenario '${scenario.id}' made no ARM calls -- the harness is not measuring anything.`).to.be.greaterThan(0);

    if (scenario.fixture.resourceGroups > 0) {
        expect(metrics.diagnostics.groupsRendered, `Scenario '${scenario.id}' rendered no groups -- the render driver is not reaching the tree.`).to.be.greaterThan(0);
    }
}

/** Compare each gated counter against its baseline. */
function compare(baseline: TreePerfBaseline, metrics: TreeMetrics): Comparison[] {
    const metricNames: Array<keyof TreePerfBaseline> = ['armCalls', 'criticalPathDepth', 'fullRefreshFires'];
    return metricNames.map(metric => {
        const actual = metrics[metric];
        const expected = baseline[metric];
        const verdict: Verdict = actual === expected ? 'match' : actual > expected ? 'regressed' : 'improved';
        return { metric, baseline: expected, actual, verdict };
    });
}

/**
 * Three-tier reporting, modelled on the VSIX bundle-size guardrail but with
 * exact-match verdicts: a 10% tolerance on a counter of 4 would mean nothing.
 *
 * - match: nothing but the diagnostics line.
 * - improved: a GitHub Actions `notice`, because a stale-low baseline stops
 *   guarding the improvement it should be locking in.
 * - regressed: a GitHub Actions `warning` today, an outright failure once
 *   {@linkcode EnforceEnvVar} is set.
 */
function report(scenario: PerfScenario, metrics: TreeMetrics, comparisons: Comparison[], mode: { enforce: boolean; isCi: boolean }): void {
    const summary = comparisons.map(c => `${c.metric}=${c.actual}(base ${c.baseline})`).join(' ');
    const diagnostics = metrics.diagnostics;
    console.log(`[tree-perf] ${scenario.id} ${summary}`);
    console.log(
        `[tree-perf]   diagnostics: targetedFires=${diagnostics.targetedFires} dataFires=${diagnostics.dataFires} `
        + `loadAll=${diagnostics.loadAllCalls} maxConcurrency=${diagnostics.maxConcurrency} `
        + `roots=${diagnostics.rootsRendered} groups=${diagnostics.groupsRendered} `
        + `byOperation=${JSON.stringify(diagnostics.armCallsByOperation)}`,
    );

    for (const comparison of comparisons.filter(c => c.verdict !== 'match')) {
        const direction = comparison.verdict === 'regressed' ? 'regressed' : 'improved';
        const message =
            `Tree perf ${direction}: scenario '${scenario.id}' ${comparison.metric} is ${comparison.actual}, `
            + `baseline ${comparison.baseline}. `
            + (comparison.verdict === 'regressed'
                ? `${describeRegression(comparison.metric)} `
                + (mode.enforce ? '' : 'This is report-only for now, but please explain it in your PR. ')
                : 'If this is intended, lower the baseline in baselines.ts in this PR so the win is locked in. ');

        if (comparison.verdict === 'regressed') {
            console.warn(`[tree-perf] ${message}`);
        }

        if (mode.isCi) {
            const level = comparison.verdict === 'regressed' ? 'warning' : 'notice';
            const title = `Tree perf ${direction}: ${scenario.id} / ${comparison.metric}`;
            // GitHub Actions workflow commands require `%`, `\r`, and `\n` in the
            // message to be URL-encoded, otherwise the annotation parses incorrectly.
            // See https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
            const encoded = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
            console.log(`::${level} title=${title}::${encoded}`);
        }
    }
}

/** Plain-language hint about what usually causes a given counter to grow. */
function describeRegression(metric: keyof TreePerfBaseline): string {
    switch (metric) {
        case 'armCalls':
            return 'The tree is doing more total ARM work -- look for an N+1 over resource groups, resources, or pages, or a lost request-coalescing window.';
        case 'criticalPathDepth':
            return 'The tree is waiting on a longer chain of dependent round trips, so it is slower even if it does less work overall.';
        case 'fullRefreshFires':
            return 'The tree is asking VS Code to re-query the entire view more often; each one re-renders every visible node.';
    }
}

/** Failure text used once the gate is enforcing. */
function formatFailure(scenario: PerfScenario, regressions: Comparison[]): string {
    const detail = regressions.map(r => `${r.metric} ${r.baseline} -> ${r.actual}`).join(', ');
    return `Scenario '${scenario.id}' regressed: ${detail}. ${scenario.rationale} `
        + 'If the change is intentional, update baselines.ts -- but read the comment above the baselines first '
        + 'and justify the movement in your PR description.';
}
