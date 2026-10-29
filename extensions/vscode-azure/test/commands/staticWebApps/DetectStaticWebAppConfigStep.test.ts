/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
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

    describe('workspace trust', () => {
        it('should refuse an untrusted workspace before reading the project or running the CLI', async () => {
            const { step, swa, ctx, codeMock } = createStep();
            mock.property(ctx.code.workspace, 'isTrusted', false);

            await expect(step.prompt(createContext({ job: 'deploy' }))).to.be.rejectedWith(/untrusted workspace/);

            expect(codeMock.fs.readFile.mock.callCount()).to.equal(0);
            expect(codeMock.fs.stat.mock.callCount()).to.equal(0);
            expect(swa.detect.mock.callCount()).to.equal(0);
        });

        it('should detect in the scratch directory of a createNew job even when untrusted', async () => {
            const { step, swa, ctx } = createStep({ appLocation: 'src' });
            mock.property(ctx.code.workspace, 'isTrusted', false);

            const result = await step.prompt(createContext({ job: 'createNew' }));

            expect(swa.detect.mock.callCount()).to.equal(1);
            expect(swa.detect.mock.calls[0].arguments[1]).to.deep.equal({ scratch: true });
            expect(result.appLocation).to.equal('src');
        });

        it('should not mark a deploy detection as scratch', async () => {
            const { step, swa } = createStep({ appLocation: 'src' });

            await step.prompt(createContext({ job: 'deploy' }));

            expect(swa.detect.mock.calls[0].arguments[1]).to.deep.equal({ scratch: false });
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
            expect(result.swaCliConfigNeedsWrite).to.equal(false);
            expect(result.swaCliConfig).to.deep.equal({
                configurations: { mine: { appLocation: 'app', apiLocation: 'api', outputLocation: 'dist' } },
            });
        });

        it('should fall back to the CLI when no configuration exists', async () => {
            const { step, swa } = createStep({ appLocation: 'src', apiLocation: 'api', outputLocation: 'build' });

            const result = await step.prompt(createContext());

            expect(swa.detect.mock.callCount()).to.equal(1);
            expect(result.appLocation).to.equal('src');
            expect(result.outputLocation).to.equal('build');
            expect(result.swaCliConfigNeedsWrite).to.equal(true);
            expect(result.swaCliConfig).to.deep.equal({
                configurations: { detected: { appLocation: 'src', apiLocation: 'api', outputLocation: 'build' } },
            });
        });

        it('should apply Static Web Apps defaults for paths the CLI omits', async () => {
            const { step } = createStep({});

            const result = await step.prompt(createContext());

            expect(result.appLocation).to.equal('/');
            expect(result.apiLocation).to.equal('');
            expect(result.outputLocation).to.equal('');
        });

        it('should surface malformed existing configuration rather than replace it', async () => {
            const { step, swa, ctx } = createStep({ appLocation: 'detected' });
            ctx.code.workspace.fs.writeFile(
                ctx.code.Uri.joinPath(MockUri.file(ProjectDir), SwaCliConfigFileName),
                new TextEncoder().encode('{'),
            );

            await expect(step.prompt(createContext())).to.be.rejectedWith(/Unable to parse/i);
            expect(swa.detect.mock.callCount()).to.equal(0);
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

            const result = await step.prompt(createContext());

            expect(result.deploy).to.equal(false);
            expect(result.swaCliConfigNeedsWrite).to.equal(false);
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

        it('should record python for an API-only Python project', async () => {
            const { step } = createStep({ outputLocation: 'dist', apiLanguage: 'python' });

            expect((await step.prompt(createContext())).detectedLanguage).to.equal('python');
        });

        it('should prefer the app build language for a JavaScript app with a Python API', async () => {
            const { step } = createStep({
                outputLocation: 'dist',
                appBuildCommand: 'npm run build',
                apiLanguage: 'python',
            });

            expect((await step.prompt(createContext())).detectedLanguage).to.equal('js');
        });

        it('should not retain generated configuration for a provision-only job', async () => {
            const { step } = createStep({ outputLocation: 'dist', apiLanguage: 'python' });

            const result = await step.prompt(createContext({ job: 'createNew' }));

            expect(result.swaCliConfig).to.equal(undefined);
            expect(result.swaCliConfigNeedsWrite).to.equal(false);
        });

        it('should normalize windows separators the CLI may emit', async () => {
            const { step } = createStep({ appLocation: 'src\\app', outputLocation: 'src\\app\\dist' });

            const result = await step.prompt(createContext());

            expect(result.appLocation).to.equal('src/app');
            expect(result.outputLocation).to.equal('src/app/dist');
        });
    });
});
