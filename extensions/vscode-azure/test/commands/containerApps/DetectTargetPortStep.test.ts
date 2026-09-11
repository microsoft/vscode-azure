/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor, MockUri } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { DetectTargetPortStep, parseExposedPort } from '../../../src/commands/containerApps/steps/DetectTargetPortStep';
import { ContainerfileTag } from '../../../src/tree/workspace/containerApps/containerAppsDetector';
import { createMockWorkspaceIndexService } from '../../utils/workspaceIndex/mockWorkspaceIndexService';

/** Builds a step over a workspace containing exactly the supplied Containerfiles. */
function createStep(files: Record<string, string>) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const uris: vscode.Uri[] = [];
    for (const [path, content] of Object.entries(files)) {
        const uri = MockUri.file(path);
        uris.push(uri);
        mockResult.fs.addFile(uri, content);
    }
    const { executor } = createTestActionExecutor();
    return { step: new DetectTargetPortStep(ctx.code, executor, createMockWorkspaceIndexService({ [ContainerfileTag]: uris })), mockResult };
}

describe('DetectTargetPortStep (unit)', () => {
    const baseContext = { resourceDisplayName: 'Container App' };

    it('takes the port from the project Dockerfile', async () => {
        const { step } = createStep({ '/project/Dockerfile': 'FROM node:20\nEXPOSE 3000\n' });

        const result = await step.prompt({ ...baseContext, iacFolder: MockUri.file('/project') });

        expect(result.targetPort).to.equal(3000);
    });

    it('falls back to 80 when no Dockerfile declares a port', async () => {
        const { step } = createStep({ '/project/Dockerfile': 'FROM node:20\nCMD ["node", "."]\n' });

        const result = await step.prompt({ ...baseContext, iacFolder: MockUri.file('/project') });

        expect(result.targetPort).to.equal(80);
    });

    it('prefers a Dockerfile inside the folder being generated into', async () => {
        // A monorepo holds Dockerfiles that have nothing to do with this app;
        // picking the wrong one would silently expose the wrong port.
        const { step } = createStep({
            '/repo/other/Dockerfile': 'EXPOSE 9999\n',
            '/repo/api/Dockerfile': 'EXPOSE 8080\n',
        });

        const result = await step.prompt({ ...baseContext, iacFolder: MockUri.file('/repo/api') });

        expect(result.targetPort).to.equal(8080);
    });

    it('does not overwrite a port the user already has infrastructure for', () => {
        const { step } = createStep({ '/project/Dockerfile': 'EXPOSE 3000\n' });

        expect(step.shouldPrompt({ ...baseContext, hasInfra: true })).to.be.false;
        expect(step.shouldPrompt({ ...baseContext, targetPort: 1234 })).to.be.false;
        expect(step.shouldPrompt(baseContext)).to.be.true;
    });

    it('uses the default when the selected project has no Containerfile', async () => {
        const { step } = createStep({ '/repo/other/Dockerfile': 'EXPOSE 9999\n' });

        const result = await step.prompt({ ...baseContext, job: 'deploy', iacFolder: MockUri.file('/repo/api') });

        expect(result.targetPort).to.equal(80);
    });

    it('uses the default without a project scope', async () => {
        const { step } = createStep({ '/project/Dockerfile': 'EXPOSE 9999\n' });

        expect((await step.prompt(baseContext)).targetPort).to.equal(80);
    });

    it('keeps similarly named sibling projects outside the scope', async () => {
        const { step } = createStep({ '/repo/api-other/Dockerfile': 'EXPOSE 9999\n' });

        expect((await step.prompt({ ...baseContext, iacFolder: MockUri.file('/repo/api') })).targetPort).to.equal(80);
    });

    it('scopes files to the same URI scheme and authority', async () => {
        const { step } = createStep({ '/repo/api/Dockerfile': 'EXPOSE 9999\n' });

        const iacFolder = MockUri.parse('vscode-remote://ssh-remote+host/repo/api');
        expect((await step.prompt({ ...baseContext, iacFolder })).targetPort).to.equal(80);
    });

    it('accepts a project URI with a trailing slash', async () => {
        const { step } = createStep({ '/repo/api/Dockerfile': 'EXPOSE 3000\n' });

        expect((await step.prompt({ ...baseContext, iacFolder: MockUri.file('/repo/api/') })).targetPort).to.equal(3000);
    });

    it('uses the default if an indexed Containerfile has vanished', async () => {
        const { step, mockResult } = createStep({ '/project/Dockerfile': 'EXPOSE 3000\n' });
        mockResult.fs.readFile.mock.mockImplementation(() => Promise.reject(mockResult.vscode.FileSystemError.FileNotFound()));

        expect((await step.prompt({ ...baseContext, iacFolder: MockUri.file('/project') })).targetPort).to.equal(80);
    });

    it('uses the known quickstart port without a prompt', async () => {
        const { step, mockResult } = createStep({ '/workspace/Dockerfile': 'EXPOSE 9999\n' });

        const result = await step.prompt({ ...baseContext, job: 'createNew', iacFolder: MockUri.file('/temp') });

        expect(result.targetPort).to.equal(80);
        expect(mockResult.inputBoxes).to.have.length(0);
    });

    it('propagates Containerfile read failures other than a vanished file', async () => {
        const { step, mockResult } = createStep({ '/project/Dockerfile': 'EXPOSE 3000\n' });
        mockResult.fs.readFile.mock.mockImplementation(() => Promise.reject(new Error('permission denied')));

        await expect(step.prompt({ ...baseContext, iacFolder: MockUri.file('/project') }))
            .to.be.rejectedWith('permission denied');
    });
});

describe('parseExposedPort (unit)', () => {
    it('reads a bare port', () => {
        expect(parseExposedPort('FROM x\nEXPOSE 8080\n')).to.equal(8080);
    });

    it('is case-insensitive', () => {
        expect(parseExposedPort('expose 8080')).to.equal(8080);
    });

    it('takes the first of several ports on one line', () => {
        expect(parseExposedPort('EXPOSE 8080 9090')).to.equal(8080);
    });

    it('accepts an explicit tcp protocol', () => {
        expect(parseExposedPort('EXPOSE 8080/tcp')).to.equal(8080);
    });

    it('skips a udp port in favor of a tcp one', () => {
        // UDP cannot serve HTTP ingress, so targeting it would produce an app
        // that provisions cleanly and never answers a request.
        expect(parseExposedPort('EXPOSE 5353/udp 8080/tcp')).to.equal(8080);
    });

    it('takes the start of a port range', () => {
        expect(parseExposedPort('EXPOSE 8000-8010')).to.equal(8000);
    });

    it('ignores a port outside the valid range', () => {
        expect(parseExposedPort('EXPOSE 99999')).to.be.undefined;
    });

    it('ignores EXPOSE inside another instruction', () => {
        expect(parseExposedPort('RUN echo EXPOSE 8080')).to.be.undefined;
    });

    it('returns undefined when there is no EXPOSE', () => {
        expect(parseExposedPort('FROM node:20\nCMD ["node", "."]')).to.be.undefined;
    });
});
