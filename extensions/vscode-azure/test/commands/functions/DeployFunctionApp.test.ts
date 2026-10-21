/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { CreateFunctionApp } from '../../../src/commands/functions/CreateFunctionApp';
import { DeployFunctionApp } from '../../../src/commands/functions/DeployFunctionApp';
import type { ShowFunctionEndpointsStep } from '../../../src/commands/functions/steps/ShowFunctionEndpointsStep';
import { AzdProjectFileTag } from '../../../src/tree/workspace/azd/AzdWorkspaceDataProvider';
import type { IAzureViewDataTree } from '../../../src/services';
import { createMockAzdService } from '../../azd/MockAzdService';
import { AzdDeployStep } from '../../../src/azd/wizard/AzdDeployStep';
import { CodeDeploymentDataProvider } from '../../../src/tree/activity/CodeDeploymentDataProvider';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';
import { makeFunctionsProjectNode } from '../../tree/workspace/mockWorkspaceNode';
import { createMockWorkspaceIndexService } from '../../utils/workspaceIndex/mockWorkspaceIndexService';

describe('DeployFunctionApp (unit)', () => {
    afterEach(() => { mock.restoreAll(); });
    function setup(tags: Record<string, string> = {}) {
        const app = makeGenericResource({ logicalType: FunctionAppLogicalType, tags });
        const { ctx, selector, codeContext } = createTestResourceSelector({ nodes: [app] });
        const azd = createMockAzdService();
        const create = { execute: mock.fn<CreateFunctionApp['execute']>(() => Promise.resolve()) };
        const project = makeFunctionsProjectNode({ resourceUri: MockUri.file('/workspace/nested/host.json') });
        const activities = new CodeDeploymentDataProvider();
        const endpoints = { execute: mock.fn<ShowFunctionEndpointsStep['execute']>(() => Promise.resolve()) };
        const dataTree = { invalidate: mock.fn<IAzureViewDataTree['invalidate']>() };
        const cmd = new DeployFunctionApp(ctx, create, selector, { get: key => key === project.id ? project : undefined },
            createMockWorkspaceIndexService({ [AzdProjectFileTag]: [MockUri.file('/workspace/azure.yaml')] }), azd,
            new AzdDeployStep(createActionContext('test'), ctx.code, azd, activities), endpoints, dataTree);
        return { cmd, create, azd, app, project, activities, codeContext, endpoints, dataTree };
    }

    it('targets the nested local project folder', async () => {
        const { cmd, create, project } = setup();
        await cmd.execute(project.id);
        expect(create.execute.mock.calls[0].arguments[0]).to.equal('deploy');
        expect(create.execute.mock.calls[0].arguments[1]?.path).to.equal('/workspace/nested');
    });

    it('deploys only the matching tagged service and completes the activity', async () => {
        const { cmd, app, azd, activities, create, endpoints, dataTree } = setup({ 'azd-service-name': 'api' });
        azd.show.mock.mockImplementation(() => Promise.resolve({ services: { api: { target: { resourceIds: [app.id.toUpperCase()] } }, other: {} } }));
        await cmd.execute(AzureNodeId.from(app).toString());
        expect(dataTree.invalidate.mock.calls.map(call => call.arguments[0])).to.deep.equal([app]);
        expect(endpoints.execute.mock.callCount()).to.equal(1);
        expect(endpoints.execute.mock.calls[0].arguments[0].iacFolder?.path).to.equal('/workspace');
        expect(endpoints.execute.mock.calls[0].arguments[1]).to.equal('api');
        expect(azd.deploy.mock.calls[0].arguments[0].path).to.equal('/workspace');
        expect(azd.deploy.mock.calls[0].arguments[1]).to.equal('api');
        expect(create.execute.mock.callCount()).to.equal(0);
        expect((await activities.getChildren())[0].status).to.equal('Completed');
    });

    it('does not launch workspace deployment when its offer is dismissed', async () => {
        const { cmd, app, create, azd } = setup();
        await cmd.execute(AzureNodeId.from(app).toString());
        expect(create.execute.mock.callCount()).to.equal(0);
        expect(azd.deploy.mock.callCount()).to.equal(0);
    });

    it('records deployment failure and propagates the error', async () => {
        const { cmd, app, azd, activities, endpoints, dataTree } = setup({ 'azd-service-name': 'api' });
        azd.show.mock.mockImplementation(() => Promise.resolve({ services: { api: { target: { resourceIds: [app.id] } } } }));
        azd.deploy.mock.mockImplementation(() => Promise.reject(new Error('Deployment failed')));
        await expect(cmd.execute(AzureNodeId.from(app).toString())).to.be.rejectedWith('Deployment failed');
        expect((await activities.getChildren())[0].status).to.equal('Failed');
        expect(endpoints.execute.mock.callCount()).to.equal(0);
        expect(dataTree.invalidate.mock.callCount()).to.equal(0);
    });

    it('does not deploy to another environment with the same service name', async () => {
        const { cmd, app, azd } = setup({ 'azd-service-name': 'api' });
        azd.show.mock.mockImplementation(() => Promise.resolve({ services: { api: { target: { resourceIds: [`${app.id}-other`] } } } }));
        await cmd.execute(AzureNodeId.from(app).toString());
        expect(azd.deploy.mock.callCount()).to.equal(0);
    });

    it('rejects deployment from an untrusted workspace', async () => {
        const { cmd, create, codeContext } = setup();
        mock.property(codeContext.mock.workspace, 'isTrusted', false);
        await expect(cmd.execute()).to.be.rejectedWith('trusted, non-virtual workspace');
        expect(create.execute.mock.callCount()).to.equal(0);
    });
});
