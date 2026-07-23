/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Mutable parsing state retained to calculate log folding ranges. */
export interface GitHubLogState {
    withinGroup: boolean;
    overlappingEntries: boolean;
    readonly filteredJobsLog: string[];
    readonly startFoldingIndices: number[];
    readonly endFoldingIndices: number[];
    firstIndex: number;
}

/** Editor-independent representation of one region fold. */
export interface GitHubLogFoldingRange {
    readonly start: number;
    readonly end: number;
}

/**
 * Filters a parent GitHub job log to a job/step timestamp window.
 *
 * Group markers may overlap adjacent steps, so group contents are retained as a
 * unit and one leading overlap is discarded. GitHub workflow commands and ANSI
 * terminal decoration are removed from displayed lines.
 */
export function parseGitHubLog(
    rawLogs: string,
    startedAt: Date,
    completedAt: Date,
): GitHubLogState {
    const lines = rawLogs.split(/\r?\n/);
    const state: GitHubLogState = {
        withinGroup: false,
        overlappingEntries: false,
        filteredJobsLog: [],
        startFoldingIndices: [],
        endFoldingIndices: [],
        firstIndex: 0,
    };

    for (let index = 0; index < lines.length; index++) {
        const entry = lines[index];
        const currentTimestamp = getTimestampInRange(entry, startedAt, completedAt);

        if (!currentTimestamp && !state.withinGroup) {
            continue;
        }
        if (isOverlappingStep(entry, state)) {
            continue;
        }

        pushFoldingIndex(entry, index, state);
        updateWithinGroup(entry, state, !!currentTimestamp);
        if (state.withinGroup || currentTimestamp) {
            if (state.filteredJobsLog.length === 0) {
                state.firstIndex = index;
            }
            state.filteredJobsLog.push(cleanLogDecorators(entry));
        }

        if (currentTimestamp
            && currentTimestamp.getTime() > completedAt.getTime()
            && !state.withinGroup) {
            break;
        }
    }

    return state;
}

/** Creates region folds adjusted to the first retained line in a filtered log. */
export function createGitHubLogFoldingRanges(
    state: GitHubLogState,
): GitHubLogFoldingRange[] {
    const foldingRanges: GitHubLogFoldingRange[] = [];
    const count = Math.min(
        state.startFoldingIndices.length,
        state.endFoldingIndices.length,
    );
    for (let index = 0; index < count; index++) {
        foldingRanges.push({
            start: state.startFoldingIndices[index] - state.firstIndex,
            end: state.endFoldingIndices[index] - state.firstIndex,
        });
    }
    return foldingRanges;
}

function getTimestampInRange(
    entry: string,
    startedAt: Date,
    completedAt: Date,
): Date | undefined {
    const timestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z/.exec(entry);
    if (!timestamp) {
        return undefined;
    }

    const currentTimestamp = new Date(timestamp[0]);
    const current = currentTimestamp.getTime();
    const start = startedAt.getTime();
    const end = completedAt.getTime();
    return Number.isFinite(current)
        && Number.isFinite(start)
        && Number.isFinite(end)
        && current >= start
        && current <= end
        ? currentTimestamp
        : undefined;
}

function pushFoldingIndex(
    entry: string,
    index: number,
    state: GitHubLogState,
): void {
    if (isStartGroup(entry)) {
        state.startFoldingIndices.push(index);
    } else if (isEndGroup(entry)) {
        state.endFoldingIndices.push(index);
    }
}

function updateWithinGroup(
    entry: string,
    state: GitHubLogState,
    withinTimestampRange: boolean,
): void {
    if (state.withinGroup) {
        state.withinGroup = !isEndGroup(entry);
    } else if (withinTimestampRange) {
        state.withinGroup = isStartGroup(entry);
    }
}

function isOverlappingStep(entry: string, state: GitHubLogState): boolean {
    if (!state.overlappingEntries && isEndGroup(entry) && !state.withinGroup) {
        state.filteredJobsLog.length = 0;
        state.startFoldingIndices.length = 0;
        state.endFoldingIndices.length = 0;
        state.firstIndex = 0;
        state.overlappingEntries = true;
        return true;
    }
    return false;
}

function cleanLogDecorators(entry: string): string {
    const workflowCommand = /#{0,2}\[.*\]/;
    // eslint-disable-next-line no-control-regex
    const terminalControl = /\u001b\[[0-?]*[ -/]*[@-~]/g;
    return entry.replace(workflowCommand, '').replace(terminalControl, '');
}

function isStartGroup(entry: string): boolean {
    return entry.includes('##[group]');
}

function isEndGroup(entry: string): boolean {
    return entry.includes('##[endgroup]');
}
