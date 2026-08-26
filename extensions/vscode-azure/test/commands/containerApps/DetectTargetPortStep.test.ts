/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor, MockUri } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { DetectTargetPortStep, parseExposedPort } from '../../../src/commands/containerApps/steps/DetectTargetPortStep';
import { ContainerfileTag } from '../../../src/tree/workspace/containerApps/containerAppsDetector';

/** An index service serving the supplied Containerfile URIs. */
function createIndexService(containerfiles: vscode.Uri[]) {
    return {
        getIndex: () => Promise.resolve({
            withTag: (tag: string) => tag === ContainerfileTag ? containerfiles : [],
            has: () => false,
            valuesOf: () => [],
        }),
    };
}

/** Builds a step over a workspace containing exactly the supplied Containerfiles. */
function createStep(files: Record<string, string>) {
    const mockResult = createMockVsCode();
    const uris: vscode.Uri[] = [];
    for (const [path, content] of Object.entries(files)) {
        const uri = MockUri.file(path);
        uris.push(uri);
        mockResult.fs.addFile(uri, content);
    }
    const { executor } = createTestActionExecutor();
    return new DetectTargetPortStep(mockResult.vscode, executor, createIndexService(uris) as never);
}

describe('DetectTargetPortStep (unit)', () => {
    it('takes the port from the project Dockerfile', async () => {
        const step = createStep({ '/project/Dockerfile': 'FROM node:20\nEXPOSE 3000\n' });

        const result = await step.prompt({ iacFolder: MockUri.file('/project') });

        expect(result.targetPort).to.equal(3000);
    });

    it('falls back to 80 when no Dockerfile declares a port', async () => {
        const step = createStep({ '/project/Dockerfile': 'FROM node:20\nCMD ["node", "."]\n' });

        const result = await step.prompt({ iacFolder: MockUri.file('/project') });

        expect(result.targetPort).to.equal(80);
    });

    it('prefers a Dockerfile inside the folder being generated into', async () => {
        // A monorepo holds Dockerfiles that have nothing to do with this app;
        // picking the wrong one would silently expose the wrong port.
        const step = createStep({
            '/repo/other/Dockerfile': 'EXPOSE 9999\n',
            '/repo/api/Dockerfile': 'EXPOSE 8080\n',
        });

        const result = await step.prompt({ iacFolder: MockUri.file('/repo/api') });

        expect(result.targetPort).to.equal(8080);
    });

    it('does not overwrite a port the user already has infrastructure for', () => {
        const step = createStep({ '/project/Dockerfile': 'EXPOSE 3000\n' });

        expect(step.shouldPrompt({ hasInfra: true })).to.be.false;
        expect(step.shouldPrompt({ targetPort: 1234 })).to.be.false;
        expect(step.shouldPrompt({})).to.be.true;
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
