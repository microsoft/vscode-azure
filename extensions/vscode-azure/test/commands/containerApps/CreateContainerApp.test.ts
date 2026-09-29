/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import {
    createMockDataItemTree, createMockSubscriptionClientProvider,
    createMockViewItemTree, makeSubscription,
} from '@microsoft/vscode-azure-azutils/testing';
import { IActionExecutor } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { CreateContainerApp } from '../../../src/commands/containerApps/CreateContainerApp';
import { VerifyContainerAppStart } from '../../../src/commands/containerApps/VerifyContainerAppStart';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('CreateContainerApp (unit)', () => {
    const subscription = makeSubscription({ subscriptionId: 'sub-1' });

    afterEach(() => { mock.restoreAll(); });

    function createCommand() {
        const { ctx, mock: code } = createMockCodeContext();
        const folder = MockUri.file('/workspace');
        const dockerfile = MockUri.joinPath(folder, 'Dockerfile');
        code.workspaceFolders.push({ uri: folder, name: 'workspace', index: 0 });
        code.fs.addFile(dockerfile, 'FROM node:20\nEXPOSE 3000\n');
        const { executor } = createTestActionExecutor();
        const azd = createMockAzdService();
        azd.envGetValues.mock.mockImplementation(() => Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_CONTAINER_APP_NAME: 'app',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_RESOURCE_GROUP: 'rg',
        }));
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
            subscriptionResolver: () => Promise.resolve(subscription),
            armProvider: createMockArmProvider(),
            codeProvider: createMockCodeProvider(),
        });
        container.bind(IActionExecutor).toConstantValue(executor);
        const dispatch = mock.method(ctx.code.commands, 'executeCommand', () => Promise.resolve());
        return { command: container.get(CreateContainerApp), code, azd, folder, dispatch };
    }

    it('deploys the selected workspace with its detected port and Docker service', async () => {
        const { command, code, azd, folder, dispatch } = createCommand();
        const prompts = respondToPrompts(code, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);

        await command.execute('deploy');

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        expect(dispatch.mock.calls.some(call => call.arguments[0] === VerifyContainerAppStart.CommandId)).to.be.true;
        expect(azd.show.mock.callCount()).to.equal(2);
        expect(azd.provision.mock.calls[0].arguments[0]).to.equal(folder);
        expect(azd.updateAzureYaml.mock.callCount()).to.equal(1); // eslint-disable-line @typescript-eslint/no-deprecated -- command uses the compatibility editor
        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(3000);
        expect(parameters.parameters.containerAppName.value).to.equal('${AZURE_CONTAINER_APP_NAME}'); // eslint-disable-line no-template-curly-in-string -- persisted azd output
        prompts.assertAllConsumed();
    });

    it('provisions the quickstart in a temporary project on its known port', async () => {
        const { command, code, azd, folder: workspaceFolder, dispatch } = createCommand();
        const prompts = respondToPrompts(code, [
            { pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' },
        ]);

        await command.execute('createNew');

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(0);
        expect(dispatch.mock.calls.filter(call => call.arguments[0] === VerifyContainerAppStart.CommandId)).to.have.length(0);
        expect(azd.show.mock.callCount()).to.equal(0);
        const folder = azd.provision.mock.calls[0].arguments[0];
        expect(folder.toString()).not.to.equal(workspaceFolder.toString());
        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(80);
        prompts.assertAllConsumed();
    });

    it('uses the hydrated service directory to generate the ingress parameter', async () => {
        const { command, code, azd, folder } = createCommand();
        const source = MockUri.joinPath(folder, 'src', 'api');
        code.fs.addFile(MockUri.joinPath(source, 'Dockerfile'), 'EXPOSE 8080\n');
        code.fs.addFile(MockUri.joinPath(folder, 'azure.yaml'), 'name: my-app\n');
        azd.show.mock.mockImplementation(() => Promise.resolve({
            name: 'my-app', services: { api: { project: { path: source.fsPath, language: 'docker' } } },
        }));
        const prompts = respondToPrompts(code, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);

        await command.execute('deploy');

        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(8080);
        prompts.assertAllConsumed();
    });

    it('generates the default ingress parameter for a multi-service project without a prompt', async () => {
        const { command, code, azd, folder } = createCommand();
        code.fs.addFile(MockUri.joinPath(folder, 'azure.yaml'), 'name: my-app\n');
        azd.show.mock.mockImplementation(() => Promise.resolve({
            name: 'my-app', services: {
                api: { project: { path: folder.fsPath, language: 'docker' } },
                web: { project: { path: folder.fsPath, language: 'docker' } },
            },
        }));
        const prompts = respondToPrompts(code, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);

        await command.execute('deploy');

        const parameters = JSON.parse(Buffer.from(await code.fs.readFile(MockUri.joinPath(folder, 'infra', 'main.parameters.json'))).toString());
        expect(parameters.parameters.targetPort.value).to.equal(80);
        prompts.assertAllConsumed();
    });

    it('launches startup verification for deployment when the user skips provisioning', async () => {
        const { command, code, azd, folder, dispatch } = createCommand();
        code.fs.addFile(MockUri.joinPath(folder, 'azure.yaml'), 'name: my-app\nservices:\n  api:\n    project: ./\n');
        code.fs.addFile(MockUri.joinPath(folder, 'infra', 'main.bicep'), '// bicep');
        azd.show.mock.mockImplementation(() => Promise.resolve({
            name: 'my-app', services: { api: { project: { path: './', language: 'docker' } } },
        }));
        azd.envList.mock.mockImplementation(() => Promise.resolve([{ Name: 'my-app', IsDefault: true }]));
        azd.envExists.mock.mockImplementation(() => Promise.resolve(true));
        azd.envGetValues.mock.mockImplementation(() => Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_LOCATION: 'eastus',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_SUBSCRIPTION_ID: 'sub-1',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_CONTAINER_APP_NAME: 'app',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output keys
            AZURE_RESOURCE_GROUP: 'rg',
        }));
        const prompts = respondToPrompts(code, [{ pick: 'No' }]);

        await command.execute('deploy');

        expect(azd.provision.mock.callCount()).to.equal(0);
        expect(azd.deploy.mock.callCount()).to.equal(1);
        expect(dispatch.mock.calls.find(call => call.arguments[0] === VerifyContainerAppStart.CommandId)?.arguments[1]).to.deep.equal({
            subscription, resourceGroupName: 'rg', appName: 'app',
        });
        prompts.assertAllConsumed();
    });

    it('fails the deployment before launching verification if azd deploy fails', async () => {
        const { command, code, azd, dispatch } = createCommand();
        const prompts = respondToPrompts(code, [{ pick: 'sub-1' }, { pick: 'East US' }, { input: 'my-app' }]);
        azd.deploy.mock.mockImplementation(() => Promise.reject(new Error('deployment failed')));

        await expect(command.execute('deploy')).to.be.rejectedWith('deployment failed');

        expect(dispatch.mock.calls.filter(call => call.arguments[0] === VerifyContainerAppStart.CommandId)).to.have.length(0);
        prompts.assertAllConsumed();
    });
});
