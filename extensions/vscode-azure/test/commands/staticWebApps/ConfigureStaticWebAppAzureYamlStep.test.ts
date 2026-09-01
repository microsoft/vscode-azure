/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-deprecated -- Exercises the step's use of
   IAzdService.updateAzureYaml, which is deprecated but is the sanctioned azure.yaml
   editing path until azd grows first-class support (Azure/azure-dev#9718). */

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { ConfigureStaticWebAppAzureYamlStep } from '../../../src/commands/staticWebApps/steps/ConfigureStaticWebAppAzureYamlStep';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('ConfigureStaticWebAppAzureYamlStep (unit)', () => {
    it('should ask azd to set only the service entry, leaving the rest of azure.yaml alone', async () => {
        const yamlUri = MockUri.file('/workspace/azure.yaml');
        const iacFolder = MockUri.file('/workspace');
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([yamlUri]));
        const step = new ConfigureStaticWebAppAzureYamlStep(azd);
        const context = {
            job: 'deploy',
            iacFolder,
            azdServiceName: 'web',
            appLocation: '/app',
            outputLocation: 'dist',
            detectedLanguage: 'js',
        } as CreateStaticWebAppContext;

        expect(await step.shouldExecute(context)).to.be.true;
        await step.execute(context);

        expect(azd.updateAzureYaml.mock.callCount()).to.equal(1);
        const [cwd, updater] = azd.updateAzureYaml.mock.calls[0].arguments;
        expect(cwd).to.equal(iacFolder);

        const edits: { path: readonly string[]; value: unknown }[] = [];
        await updater({ set: (path, value) => void edits.push({ path, value }) });

        expect(edits).to.deep.equal([{
            path: ['services', 'web'],
            // A leading slash in appLocation is stripped: azd project paths are
            // relative to azure.yaml, so '/app' means the 'app' folder beside it.
            value: { host: 'staticwebapp', project: 'app', dist: 'dist', language: 'js' },
        }]);
    });

    it('should omit the language when none was detected', async () => {
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/workspace/azure.yaml')]));
        const step = new ConfigureStaticWebAppAzureYamlStep(azd);

        await step.execute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            azdServiceName: 'web',
            appLocation: 'app',
            outputLocation: 'dist',
        });

        const edits: { path: readonly string[]; value: unknown }[] = [];
        await azd.updateAzureYaml.mock.calls[0].arguments[1]({ set: (path, value) => void edits.push({ path, value }) });

        expect(edits[0].value).to.not.have.property('language');
    });

    it('should run the service from the configuration root when the SWA CLI owns the build', async () => {
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/workspace/azure.yaml')]));
        const step = new ConfigureStaticWebAppAzureYamlStep(azd);

        await step.execute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            iacFolder: MockUri.file('/workspace'),
            azdServiceName: 'web',
            appLocation: 'app',
            outputLocation: 'dist',
            detectedLanguage: 'python',
            swaCliConfig: {
                configurations: {
                    detected: { appLocation: 'app', outputLocation: 'dist', apiLanguage: 'python' },
                },
            },
        });

        const edits: { path: readonly string[]; value: unknown }[] = [];
        await azd.updateAzureYaml.mock.calls[0].arguments[1]({ set: (path, value) => void edits.push({ path, value }) });

        expect(edits[0].value).to.deep.equal({
            host: 'staticwebapp',
            project: '.',
            language: 'python',
        });
    });

    it('should not add an unsupported root output service', async () => {
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/workspace/azure.yaml')]));
        const step = new ConfigureStaticWebAppAzureYamlStep(azd);

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
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/workspace/azure.yaml')]));
        const step = new ConfigureStaticWebAppAzureYamlStep(azd);

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
