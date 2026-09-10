/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureNodeId, IAcrRepositoryClientProvider, IContainerAppsClientProvider, ILogsQueryClientProvider, IResourceClientProvider,
} from '@microsoft/vscode-azure-azutils';
import {
    createMockContainerAppsClient, createMockDataItemTree, createMockSubscriptionClientProvider,
    createMockViewItemTree, makeGenericResource, makeSubscription,
} from '@microsoft/vscode-azure-azutils/testing';
import { IActionExecutor } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { CreateContainerApp } from '../../../src/commands/containerApps/CreateContainerApp';
import { AcrResourceType } from '../../../src/tree/resources/acr/AcrRegistry';
import { ContainerfileTag } from '../../../src/tree/workspace/containerApps/containerAppsDetector';
import { IWorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createMockResourceClient } from '../../tree/resources/mockResourceClient';
import { createMockWorkspaceIndexService } from '../../utils/workspaceIndex/mockWorkspaceIndexService';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('CreateContainerApp (unit)', () => {
    const subscription = makeSubscription({ subscriptionId: 'sub-1' });
    const registry = makeGenericResource({
        id: '/subscriptions/sub-1/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/contoso',
        name: 'contoso', type: AcrResourceType, logicalType: AcrResourceType,
    });

    function createCommand() {
        const { ctx, mock: code } = createMockCodeContext();
        const folder = MockUri.file('/workspace');
        const dockerfile = MockUri.joinPath(folder, 'Dockerfile');
        code.workspaceFolders.push({ uri: folder, name: 'workspace', index: 0 });
        code.fs.addFile(dockerfile, 'FROM node:20\nEXPOSE 3000\n');
        const { executor } = createTestActionExecutor();
        const azd = createMockAzdService();
        azd.findAzureYaml.mock.mockImplementation(cwd => {
            if (!cwd) {
                throw new Error('The wizard must scope azure.yaml discovery to its project.');
            }
            const uri = MockUri.joinPath(cwd, 'azure.yaml');
            return Promise.resolve(code.fs.files.has(uri.path) ? [uri] : []);
        });
        azd.init.mock.mockImplementation(cwd => {
            code.fs.addFile(MockUri.joinPath(cwd, 'azure.yaml'), 'name: app\n');
            return Promise.resolve();
        });
        const container = createWizardCommandContainer({
            ctx, azd, output: executor.output,
            dataTree: createMockDataItemTree([subscription]),
            viewItemTree: createMockViewItemTree({ '': [AzureNodeId.from(subscription).toString()] }),
            subscriptionClientProvider: createMockSubscriptionClientProvider([{ name: 'eastus', displayName: 'East US' }]),
            armProvider: createMockArmProvider(),
            codeProvider: createMockCodeProvider(),
        });
        container.bind(IActionExecutor).toConstantValue(executor);
        container.bind(IWorkspaceIndexService).toConstantValue(createMockWorkspaceIndexService({ [ContainerfileTag]: [dockerfile] }));
        container.bind(IResourceClientProvider).toConstantValue(() => createMockResourceClient([], [registry]));
        container.bind(IAcrRepositoryClientProvider).toConstantValue(() => ({
            listRepositories: mock.fn(() => Promise.resolve(['api'])),
            listRepositoryTags: mock.fn(() => Promise.resolve([{ repository: 'api', tags: ['v1'] }])),
        }));
        container.bind(IContainerAppsClientProvider).toConstantValue(() => createMockContainerAppsClient());
        container.bind(ILogsQueryClientProvider).toConstantValue(() => ({
            queryWorkspace: mock.fn(() => Promise.resolve([])),
        }));
        return { command: container.get(CreateContainerApp), code, azd, folder };
    }

    it('deploys the selected workspace with its detected port and Docker service', async () => {
        const { command, code, azd, folder } = createCommand();
        const prompts = respondToPrompts(code, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);

        await command.execute('deploy');

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        expect(azd.provision.mock.calls[0].arguments[0]).to.equal(folder);
        expect(azd.updateAzureYaml.mock.callCount()).to.equal(1); // eslint-disable-line @typescript-eslint/no-deprecated -- command uses the compatibility editor
        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(3000);
        expect(parameters.parameters.containerAppName.value).to.equal('${AZURE_CONTAINER_APP_NAME}'); // eslint-disable-line no-template-curly-in-string -- persisted azd output
        prompts.assertAllConsumed();
    });

    it('provisions an existing ACR image with its registry identity and chosen port', async () => {
        const { command, code, azd } = createCommand();
        const prompts = respondToPrompts(code, [
            { pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' },
            { pick: 'contoso.azurecr.io/api:v1' }, { input: '8080' },
        ]);

        await command.execute('createNew');

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(0);
        const folder = azd.provision.mock.calls[0].arguments[0];
        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.imageName.value).to.equal('contoso.azurecr.io/api:v1');
        expect(parameters.parameters.imageRegistryId.value).to.equal(registry.id);
        expect(parameters.parameters.targetPort.value).to.equal(8080);
        prompts.assertAllConsumed();
    });

    it('provisions the quickstart on its known port without asking for an image reference', async () => {
        const { command, code, azd } = createCommand();
        const prompts = respondToPrompts(code, [
            { pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }, { pick: 'Use quickstart image' },
        ]);

        await command.execute('createNew');

        expect(azd.provision.mock.callCount()).to.equal(1);
        const folder = azd.provision.mock.calls[0].arguments[0];
        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(80);
        expect(parameters.parameters.imageName).to.be.undefined;
        prompts.assertAllConsumed();
    });
});
