/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { DetectStaticWebAppConfigStep } from '../../../src/commands/staticWebApps/steps/DetectStaticWebAppConfigStep';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { SwaCliConfigFileName, type SWACLIOptions } from '../../../src/staticWebApps/SwaCliConfig';
import { createMockSwaCliService } from '../../staticWebApps/MockSwaCliService';

const ProjectDir = '/project';

function createStep(detected: SWACLIOptions = {}) {
    const { ctx, mock: codeMock } = createMockCodeContext();
    const actionContext = createActionContext('test');
    const swa = createMockSwaCliService(detected);
    const step = new DetectStaticWebAppConfigStep(actionContext, ctx, swa);
    return { step, swa, ctx, codeMock, actionContext };
}

function createContext(overrides: Partial<CreateStaticWebAppContext> = {}): CreateStaticWebAppContext {
    return {
        resourceDisplayName: 'Static Web App',
        job: 'deploy',
        iacFolder: MockUri.file(ProjectDir),
        ...overrides,
    };
}

describe('DetectStaticWebAppConfigStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should skip when infrastructure already exists', () => {
            const { step } = createStep();
            expect(step.shouldPrompt(createContext({ hasInfra: true }))).to.equal(false);
        });

        it('should skip when there is no project folder to detect', () => {
            const { step } = createStep();
            expect(step.shouldPrompt(createContext({ iacFolder: undefined }))).to.equal(false);
        });

        it('should skip once every location is known', () => {
            const { step } = createStep();
            const context = createContext({ appLocation: '/', apiLocation: '', outputLocation: 'dist' });
            expect(step.shouldPrompt(context)).to.equal(false);
        });

        it('should run when a location is still missing', () => {
            const { step } = createStep();
            expect(step.shouldPrompt(createContext())).to.equal(true);
        });
    });

    describe('prompt', () => {
        it('should take the layout the user already declared without running the CLI', async () => {
            const { step, swa, ctx } = createStep({ appLocation: 'detected' });
            ctx.code.workspace.fs.writeFile(
                ctx.code.Uri.joinPath(MockUri.file(ProjectDir), SwaCliConfigFileName),
                new TextEncoder().encode(JSON.stringify({
                    configurations: { mine: { appLocation: 'app', apiLocation: 'api', outputLocation: 'dist' } },
                })),
            );

            const result = await step.prompt(createContext());

            expect(swa.detect.mock.callCount()).to.equal(0);
            expect(result.appLocation).to.equal('app');
            expect(result.apiLocation).to.equal('api');
            expect(result.outputLocation).to.equal('dist');
        });

        it('should fall back to the CLI when no configuration exists', async () => {
            const { step, swa } = createStep({ appLocation: 'src', apiLocation: 'api', outputLocation: 'build' });

            const result = await step.prompt(createContext());

            expect(swa.detect.mock.callCount()).to.equal(1);
            expect(result.appLocation).to.equal('src');
            expect(result.outputLocation).to.equal('build');
        });

        it('should apply Static Web Apps defaults for paths the CLI omits', async () => {
            const { step } = createStep({});

            const result = await step.prompt(createContext());

            expect(result.appLocation).to.equal('/');
            expect(result.apiLocation).to.equal('');
            expect(result.outputLocation).to.equal('');
        });

        it('should enable deployment for a distinct build output', async () => {
            const { step } = createStep({ appLocation: '/', outputLocation: 'dist' });

            expect((await step.prompt(createContext())).deploy).to.equal(true);
        });

        it('should skip deployment for a server build the CLI cannot distinguish', async () => {
            const { step } = createStep({ appLocation: '/', outputLocation: '.next' });

            const result = await step.prompt(createContext());

            expect(result.deploy).to.equal(false);
        });

        it('should skip deployment when the project has no build output', async () => {
            const { step } = createStep({ appLocation: '/', outputLocation: '' });

            expect((await step.prompt(createContext())).deploy).to.equal(false);
        });

        it('should never deploy for a job that only creates', async () => {
            const { step } = createStep({ appLocation: '/', outputLocation: 'dist' });

            const result = await step.prompt(createContext({ job: 'createNew' }));

            expect(result.deploy).to.equal(false);
        });

        it('should classify locations without recording the paths themselves', async () => {
            const { step, actionContext } = createStep({ appLocation: '/', apiLocation: '', outputLocation: 'other' });

            await step.prompt(createContext());

            expect(actionContext.telemetry.properties.appLocation).to.equal('default');
            expect(actionContext.telemetry.properties.apiLocation).to.equal('empty');
            expect(actionContext.telemetry.properties.outputLocation).to.equal('nonDefault');
        });

        it('should record dotnet when the detected build uses the dotnet CLI', async () => {
            const { step } = createStep({ outputLocation: 'bin/wwwroot', appBuildCommand: 'dotnet publish -c Release -o bin' });

            expect((await step.prompt(createContext())).detectedLanguage).to.equal('dotnet');
        });

        it('should record js for a node build', async () => {
            const { step } = createStep({ outputLocation: 'dist', appBuildCommand: 'npm run build' });

            expect((await step.prompt(createContext())).detectedLanguage).to.equal('js');
        });

        it('should normalize windows separators the CLI may emit', async () => {
            const { step } = createStep({ appLocation: 'src\\app', outputLocation: 'src\\app\\dist' });

            const result = await step.prompt(createContext());

            expect(result.appLocation).to.equal('src/app');
            expect(result.outputLocation).to.equal('src/app/dist');
        });
    });
});
