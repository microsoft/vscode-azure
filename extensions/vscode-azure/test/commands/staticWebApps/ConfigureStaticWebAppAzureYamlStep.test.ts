/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { parse } from 'yaml';
import { ConfigureStaticWebAppAzureYamlStep } from '../../../src/commands/staticWebApps/steps/ConfigureStaticWebAppAzureYamlStep';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('ConfigureStaticWebAppAzureYamlStep (unit)', () => {
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
