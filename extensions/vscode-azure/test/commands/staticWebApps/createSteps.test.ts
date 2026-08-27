/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { parse } from 'yaml';
import { createMockAzdService } from '../../azd/MockAzdService';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { getStaticWebAppBuildPreset } from '../../../src/commands/staticWebApps/buildPresets';
import { ApiLocationStep } from '../../../src/commands/staticWebApps/steps/ApiLocationStep';
import { AppLocationStep } from '../../../src/commands/staticWebApps/steps/AppLocationStep';
import { ConfigureStaticWebAppAzureYamlStep } from '../../../src/commands/staticWebApps/steps/ConfigureStaticWebAppAzureYamlStep';
import { OutputLocationStep, resolveDefaultOutputLocation } from '../../../src/commands/staticWebApps/steps/OutputLocationStep';
import { addLocationTelemetry, canAzdDeployStaticWebApp, isYamlSafeLocation } from '../../../src/commands/staticWebApps/steps/locationUtils';

describe('Static Web Apps creation steps (unit)', () => {
    it('should preserve the location telemetry taxonomy without recording paths', () => {
        const context = createActionContext('test');
        addLocationTelemetry(context, 'appLocation', 'src', '/', 'src');
        addLocationTelemetry(context, 'apiLocation', '', 'api', undefined);
        addLocationTelemetry(context, 'outputLocation', 'other', 'build', 'configured');

        expect(context.telemetry.properties.appLocation).to.equal('setting');
        expect(context.telemetry.properties.appLocationHasSetting).to.equal('true');
        expect(context.telemetry.properties.appLocationMatchesSetting).to.equal('false');
        expect(context.telemetry.properties.apiLocation).to.equal('empty');
        expect(context.telemetry.properties.outputLocation).to.equal('nonDefault');
    });

    it('should validate YAML scalars and direct azd output support', () => {
        expect(isYamlSafeLocation('src/app', 'app_location')).to.be.true;
        expect(isYamlSafeLocation('src\napp', 'app_location')).to.be.false;
        expect(isYamlSafeLocation('src"app', 'app_location')).to.be.false;
        expect(canAzdDeployStaticWebApp('build')).to.be.true;
        expect(canAzdDeployStaticWebApp('')).to.be.false;
        expect(canAzdDeployStaticWebApp('/')).to.be.false;
    });

    it('should resolve Angular output using its detected project', () => {
        const context = {
            buildPreset: getStaticWebAppBuildPreset('angular'),
            angularProjectName: 'my portal',
        } as CreateStaticWebAppContext;
        expect(resolveDefaultOutputLocation(context)).to.equal('dist/my-portal');
    });

    it('should prefer the output the project configures over the preset convention', () => {
        const context = {
            buildPreset: getStaticWebAppBuildPreset('react'),
            detectedOutputLocation: 'dist',
        } as CreateStaticWebAppContext;
        expect(resolveDefaultOutputLocation(context)).to.equal('dist');
    });

    it('should offer the path already declared to the SWA CLI as the editable default', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const actionContext = createActionContext('test');
        const step = new AppLocationStep(actionContext, ctx);
        respondToPrompts(mock, ['acceptDefault']);
        mock.fs.addFile(
            MockUri.file('/workspace/swa-cli.config.json'),
            JSON.stringify({ configurations: { app: { appLocation: 'frontend' } } }),
        );

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        // The preset would otherwise win, so this also pins that a declared
        // path outranks the framework guess.
        expect(result.appLocation).to.equal('frontend');
        expect(actionContext.telemetry.properties.appLocation).to.equal('setting');
        expect(mock.quickPicks).to.have.length(1);
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should resolve the first configuration when the SWA CLI config names several', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new AppLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, ['acceptDefault']);
        // No caller passes --config-name, so the CLI resolves the first entry.
        // Prefilling anything else would show a path the build would not use.
        mock.fs.addFile(
            MockUri.file('/workspace/swa-cli.config.json'),
            JSON.stringify({
                configurations: { app: { appLocation: 'frontend' }, docs: { appLocation: 'website' } },
            }),
        );

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.appLocation).to.equal('frontend');
    });

    it('should fall back to the detected path when the SWA CLI config is unreadable', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        const step = new AppLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, ['acceptDefault']);
        mock.fs.addFile(MockUri.file('/workspace/swa-cli.config.json'), '{ not json');

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            iacFolder: MockUri.file('/workspace'),
            detectedAppLocation: 'src',
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.appLocation).to.equal('src');
    });

    it('should pick build output relative to the application location', async () => {
        const { ctx, mock } = createMockCodeContext();
        addWorkspaceFolder(mock, '/workspace');
        mock.fs.addFile(MockUri.file('/workspace/frontend/dist/index.html'), '<html></html>');
        const step = new OutputLocationStep(createActionContext('test'), ctx);
        respondToPrompts(mock, [{ pick: 'dist' }]);

        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            appLocation: 'frontend',
            buildPreset: getStaticWebAppBuildPreset('vuejs'),
        });

        expect(result.outputLocation).to.equal('dist');
        expect(result.deploy).to.be.true;
        expect(mock.quickPicks).to.have.length(1);
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should auto-select exactly one detected Functions API', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: ['services/api'],
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.apiLocation).to.equal('services/api');
        expect(mock.inputBoxes).to.have.length(0);
        expect(mock.quickPicks).to.have.length(0);
    });

    it('should leave the API empty when the project has no Functions app', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: [],
            buildPreset: getStaticWebAppBuildPreset('react'),
        });

        expect(result.apiLocation).to.equal('');
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should keep the preset API when the framework build emits one', async () => {
        const { ctx, mock } = createMockCodeContext();
        const step = new ApiLocationStep(createActionContext('test'), ctx);
        const result = await step.prompt({
            resourceDisplayName: 'Static Web App',
            detectedApiLocations: [],
            buildPreset: getStaticWebAppBuildPreset('svelte-kit'),
        });

        expect(result.apiLocation).to.equal('build/server');
        expect(mock.inputBoxes).to.have.length(0);
    });

    it('should merge supported Static Web Apps metadata into azure.yaml', async () => {
        const { ctx, mock } = createMockCodeContext();
        const yamlUri = MockUri.file('/workspace/azure.yaml');
        mock.fs.addFile(yamlUri, 'name: test\nmetadata:\n  owner: existing\n');
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([yamlUri]));
        const step = new ConfigureStaticWebAppAzureYamlStep(ctx, azd);
        const context = {
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            azdServiceName: 'web',
            appLocation: '/app',
            outputLocation: 'dist',
            detectedLanguage: 'ts',
        } as CreateStaticWebAppContext;

        expect(await step.shouldExecute(context)).to.be.true;
        await step.execute(context);

        const document = parse(Buffer.from(mock.fs.files.get(yamlUri.path) ?? []).toString());
        expect(document.metadata.owner).to.equal('existing');
        expect(document.services.web).to.deep.equal({
            host: 'staticwebapp',
            project: 'app',
            dist: 'dist',
            language: 'ts',
        });
    });

    it('should not add an unsupported root output service', async () => {
        const { ctx, mock } = createMockCodeContext();
        const yamlUri = MockUri.file('/workspace/azure.yaml');
        mock.fs.addFile(yamlUri, 'name: test\n');
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([yamlUri]));
        const step = new ConfigureStaticWebAppAzureYamlStep(ctx, azd);

        expect(await step.shouldExecute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            azdServiceName: 'web',
            appLocation: '/',
            outputLocation: '/',
        })).to.be.false;
    });

    it('should not touch azure.yaml for a createNew job', async () => {
        const { ctx, mock } = createMockCodeContext();
        const yamlUri = MockUri.file('/workspace/azure.yaml');
        mock.fs.addFile(yamlUri, 'name: test\n');
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([yamlUri]));
        const step = new ConfigureStaticWebAppAzureYamlStep(ctx, azd);

        // The createNew iacFolder is a temp dir that is provisioned from and
        // then deleted; nothing ever deploys from its azure.yaml.
        expect(await step.shouldExecute({
            resourceDisplayName: 'Static Web App',
            job: 'createNew',
            iacFolder: MockUri.file('/workspace'),
            azdServiceName: 'web',
            appLocation: 'app',
            outputLocation: 'dist',
        })).to.be.false;
    });
});
