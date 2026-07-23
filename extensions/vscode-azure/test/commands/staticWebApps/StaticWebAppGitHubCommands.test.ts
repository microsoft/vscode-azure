/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import {
    CancelAction,
    pollStaticWebAppAction,
    RerunAction,
} from '../../../src/commands/staticWebApps/ActionCommands';
import { OpenWorkflowConfigFile } from '../../../src/commands/staticWebApps/OpenWorkflowConfigFile';
import { StaticWebAppCommandResolver } from '../../../src/commands/staticWebApps/StaticWebAppCommandResolver';
import type { GitHubWorkflowRun } from '../../../src/services/StaticWebAppsGitHubService';
import {
    StaticWebAppVirtualTypes,
    type StaticWebAppAction,
} from '../../../src/tree/resources/staticWebApps/StaticWebApp';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('Static Web Apps GitHub commands (unit)', () => {
    it('should return completed runs without scheduling a polling wait', async () => {
        const action = makeAction();
        const completed = { ...action.run, status: 'completed', conclusion: 'success' } as GitHubWorkflowRun;
        const getWorkflowRun = mock.fn(() => Promise.resolve(completed));
        const wait = mock.fn(() => Promise.resolve());

        const result = await pollStaticWebAppAction(
            { getWorkflowRun } as never,
            action,
            { wait },
        );

        expect(result.run).to.equal(completed);
        expect(result.timedOut).to.be.false;
        expect(wait.mock.callCount()).to.equal(0);
    });

    it('should call cancel and rerun services, then invalidate the action narrowly', async () => {
        for (const operation of ['cancel', 'rerun'] as const) {
            const action = makeAction();
            const { ctx, mock: mockResult } = createMockCodeContext();
            const invalidate = mock.fn();
            const cache = {
                get: mock.fn((key: string) => key === 'key' ? action : undefined),
                invalidate,
            };
            const resolver = new StaticWebAppCommandResolver(
                ctx,
                cache as never,
                { select: mock.fn() } as never,
            );
            const cancelWorkflowRun = mock.fn(() => Promise.resolve());
            const rerunWorkflowRun = mock.fn(() => Promise.resolve());
            const completed = { ...action.run, status: 'completed', conclusion: 'success' } as GitHubWorkflowRun;
            const github = {
                cancelWorkflowRun,
                rerunWorkflowRun,
                getWorkflowRun: mock.fn(() => Promise.resolve(completed)),
            };
            const context = createActionContext('test');
            const output = new MockOutputChannel('test');
            const command = operation === 'cancel'
                ? new CancelAction(context, mockResult.vscode, output, resolver, github as never)
                : new RerunAction(context, mockResult.vscode, output, resolver, github as never);

            await command.execute('key');
            expect((operation === 'cancel' ? cancelWorkflowRun : rerunWorkflowRun).mock.callCount()).to.equal(1);
            expect(invalidate.mock.callCount()).to.be.greaterThan(0);
            expect(context.telemetry.properties.conclusion).to.equal('success');
        }
    });

    it('should open a workflow with the provided selection and reveal range', async () => {
        const mockResult = createMockVsCode({
            Range: vscode.Range,
            TextEditorRevealType: vscode.TextEditorRevealType,
        });
        const ctx = { code: mockResult.vscode, extensionContext: {} as never };
        const uri = mockResult.vscode.Uri.file('/repo/.github/workflows/swa.yml');
        mockResult.fs.addFile(uri, 'app_location: src');
        const command = new OpenWorkflowConfigFile(
            ctx,
            {} as never,
            {} as never,
        );

        await command.execute({
            key: 'unused',
            uri,
            range: {
                start: { line: 0, character: 14 },
                end: { line: 0, character: 17 },
            },
            buildConfig: 'app_location',
        });

        const options = mockResult.window.showTextDocument.mock.calls[0].arguments[1];
        expect(options?.selection?.start.line).to.equal(0);
        expect(options?.selection?.start.character).to.equal(14);
        expect(options?.selection?.end.character).to.equal(17);
    });

    it('should fall back to the GitHub editor when no local workflow exists', async () => {
        const environment = makeStaticWebAppEnvironment({ branch: 'feature/test', inWorkspace: false });
        const { ctx, mock: mockResult } = createMockCodeContext();
        const cache = {
            get: mock.fn((key: string) => key === 'key' ? environment : undefined),
            getChildren: mock.fn(() => Promise.resolve([])),
            whenEnriched: mock.fn(() => Promise.resolve(environment.azureResource)),
        };
        const resolver = new StaticWebAppCommandResolver(ctx, cache as never, { select: mock.fn() } as never);
        const github = { parseRepositoryUrl: () => ({ owner: 'octo-org', repo: 'octo-repo' }) };
        const command = new OpenWorkflowConfigFile(ctx, resolver, github as never);

        await command.execute('key');

        expect(mockResult.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal(
            'https://github.com/octo-org/octo-repo/edit/feature/test/.github/workflows/azure-static-web-apps-my-swa.yml',
        );
    });
});

function makeAction(): StaticWebAppAction {
    /* eslint-disable @typescript-eslint/naming-convention -- GitHub REST response fixture */
    const run = {
        id: 7,
        status: 'in_progress',
        conclusion: null,
        head_branch: 'main',
        head_sha: 'abc',
        event: 'push',
        head_commit: { message: 'Deploy' },
    } as GitHubWorkflowRun;
    /* eslint-enable @typescript-eslint/naming-convention */
    return {
        virtualType: StaticWebAppVirtualTypes.Action,
        virtualPath: 'environments/default/actions/runs/7',
        azureResource: makeStaticWebApp(),
        repository: { owner: 'octo-org', repo: 'octo-repo' },
        run,
    };
}
