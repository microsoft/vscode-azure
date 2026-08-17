/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { OpenGitHubLog } from '../../src/commands/staticWebApps/OpenGitHubLog';
import { GitHubActionLogContentProvider } from '../../src/staticWebApps/GitHubActionLogContentProvider';
import { createGitHubLogFoldingRanges, parseGitHubLog } from '../../src/staticWebApps/GitHubActionLogParser';
import { StaticWebAppVirtualTypes, type StaticWebAppJob } from '../../src/tree/resources/staticWebApps/StaticWebApp';
import { makeStaticWebApp } from '../tree/resources/staticWebApps/mockStaticWebApp';

describe('GitHub Action log tooling (unit)', () => {
    it('should filter timestamps, retain groups, and clean commands and ANSI', () => {
        const raw = [
            '2026-01-01T00:00:00.0000000Z before',
            '2026-01-01T00:00:01.0000000Z ##[group]\u001b[31mBuild\u001b[0m',
            'line without timestamp',
            '2026-01-01T00:00:02.0000000Z ##[endgroup]',
            '2026-01-01T00:00:03.0000000Z after',
        ].join('\r\n');

        const state = parseGitHubLog(
            raw,
            new Date('2026-01-01T00:00:01Z'),
            new Date('2026-01-01T00:00:02Z'),
        );

        expect(state.filteredJobsLog).to.deep.equal([
            '2026-01-01T00:00:01.0000000Z Build',
            'line without timestamp',
            '2026-01-01T00:00:02.0000000Z ',
        ]);
        expect(createGitHubLogFoldingRanges(state)).to.deep.equal([{ start: 0, end: 2 }]);
    });

    it('should discard one overlapping end group before retaining the current step', () => {
        const raw = [
            '2026-01-01T00:00:00.9000000Z stale',
            '2026-01-01T00:00:01.0000000Z ##[endgroup]',
            '2026-01-01T00:00:01.1000000Z current',
        ].join('\n');

        const state = parseGitHubLog(
            raw,
            new Date('2026-01-01T00:00:00.900Z'),
            new Date('2026-01-01T00:00:02Z'),
        );

        expect(state.overlappingEntries).to.equal(true);
        expect(state.filteredJobsLog).to.deep.equal([
            '2026-01-01T00:00:01.1000000Z current',
        ]);
    });

    it('should open a stable sanitized URI and fold parsed job logs', async () => {
        const mockResult = createMockVsCode();
        const contentProvider = new GitHubActionLogContentProvider(mockResult.vscode);
        const job = makeJob();
        const raw = [
            '2026-01-01T00:00:00.0000000Z ##[group]Build',
            '2026-01-01T00:00:01.0000000Z Complete',
            '2026-01-01T00:00:02.0000000Z ##[endgroup]',
        ].join('\r\n');
        const downloadJobLogs = mock.fn(() =>
            Promise.resolve(new TextEncoder().encode(raw).buffer));
        const command = new OpenGitHubLog(
            mockResult.vscode,
            { get: (key: string) => key === 'job-key' ? job : undefined } as never,
            { downloadJobLogs } as never,
            contentProvider,
        );

        await command.execute('job-key');

        const uri = mockResult.window.showTextDocument.mock.calls[0].arguments[0];
        expect(uri.toString()).to.equal('github-action-log:/job-42/Build_Job.log');
        expect(contentProvider.provideTextDocumentContent(uri)).to.contain('Complete');
        expect(contentProvider.getFoldingRanges(uri)).to.have.lengthOf(1);
        expect(mockResult.commands.executeCommand.mock.calls[0].arguments[0]).to.equal('editor.foldAll');
        contentProvider.dispose();
    });

    it('should show the retained expired-log message for GitHub 410 responses', async () => {
        const mockResult = createMockVsCode();
        const contentProvider = new GitHubActionLogContentProvider(mockResult.vscode);
        const command = new OpenGitHubLog(
            mockResult.vscode,
            { get: () => makeJob() } as never,
            { downloadJobLogs: () => Promise.reject(Object.assign(new Error('Gone'), { status: 410 })) } as never,
            contentProvider,
        );

        await command.execute('job-key');

        const uri = mockResult.window.showTextDocument.mock.calls[0].arguments[0];
        expect(contentProvider.provideTextDocumentContent(uri)).to.equal(
            'The logs for this run have expired and are no longer available.',
        );
        contentProvider.dispose();
    });
});

function makeJob(): StaticWebAppJob {
    /* eslint-disable @typescript-eslint/naming-convention -- GitHub REST response fixture */
    const job = {
        id: 42,
        name: 'Build Job',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:00:02Z',
        status: 'completed',
        conclusion: 'success',
    } as StaticWebAppJob['job'];
    /* eslint-enable @typescript-eslint/naming-convention */
    return {
        virtualType: StaticWebAppVirtualTypes.Job,
        virtualPath: 'actions/1/jobs/42',
        azureResource: makeStaticWebApp(),
        repository: { owner: 'octo', repo: 'repo' },
        runId: 1,
        job,
    };
}
