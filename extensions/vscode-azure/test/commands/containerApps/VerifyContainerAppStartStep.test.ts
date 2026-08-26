/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockContainerAppsClient, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, DebugOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { CreateContainerAppContext } from '../../../src/commands/containerApps/CreateContainerAppContext';
import { VerifyContainerAppStartStep } from '../../../src/commands/containerApps/steps/VerifyContainerAppStartStep';

interface StepOptions {
    /** Running states returned by successive `getRevision` calls. */
    readonly runningStates?: string[];
    /** Values reported by `azd env get-values`. */
    readonly envValues?: Record<string, string>;
    /** Lines the Log Analytics query returns. */
    readonly logLines?: string[];
}

function createStep(options: StepOptions = {}) {
    const mockResult = createMockVsCode();
    const output = new DebugOutputChannel('test');

    const client = createMockContainerAppsClient({
        environmentId: '/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv',
        latestRevisionName: 'myapp--abc123',
    });

    const states = [...(options.runningStates ?? ['running'])];
    client.containerAppsRevisions.getRevision.mock.mockImplementation(() => Promise.resolve({
        id: '/revisions/myapp--abc123',
        name: 'myapp--abc123',
        type: 'Microsoft.App/containerApps/revisions',
        // Repeat the final state once the script is exhausted, so a test that
        // never settles keeps returning a transient state.
        runningState: states.length > 1 ? states.shift() : states[0],
    }));

    client.managedEnvironments.get.mock.mockImplementation(() => Promise.resolve({
        id: '/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv',
        name: 'MyEnv',
        type: 'Microsoft.App/managedEnvironments',
        location: 'eastus',
        appLogsConfiguration: { logAnalyticsConfiguration: { customerId: 'workspace-guid' } },
    }));

    const queryWorkspace = mock.fn((_workspaceId: string, _query: string, _minutes: number) =>
        Promise.resolve(options.logLines ?? []));

    const azd = {
        envGetValues: mock.fn(() => Promise.resolve(options.envValues ?? {
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output names
            AZURE_CONTAINER_APP_NAME: 'MyApp',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd output names
            AZURE_RESOURCE_GROUP: 'MyRG',
        })),
    };

    const step = new VerifyContainerAppStartStep(
        mockResult.vscode,
        output,
        azd as never,
        () => client,
        () => ({ queryWorkspace }),
        () => Promise.resolve(undefined),
    );

    return { step, client, queryWorkspace, azd, mockResult };
}

const baseContext = {
    provision: true,
    subscription: makeSubscription(),
    iacFolder: MockUri.file('/project'),
    environmentName: 'dev',
} as CreateContainerAppContext;

describe('VerifyContainerAppStartStep (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('only runs when the wizard provisioned something', () => {
        const { step } = createStep();

        expect(step.shouldExecute(baseContext)).to.be.true;
        expect(step.shouldExecute({ ...baseContext, provision: false })).to.be.false;
    });

    it('does not warn when the app is running', async () => {
        const { step, queryWorkspace, mockResult } = createStep({ runningStates: ['running'] });

        await step.execute(baseContext);

        expect(queryWorkspace.mock.callCount()).to.equal(0);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
    });

    it('treats a scaled-to-zero app as healthy', async () => {
        // An app with no traffic legitimately has no running replicas; warning
        // about it would cry wolf on every idle deployment.
        const { step, mockResult } = createStep({ runningStates: ['scaledtozero'] });

        await step.execute(baseContext);

        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
    });

    it('reads the console logs when the app failed to start', async () => {
        const { step, queryWorkspace, mockResult } = createStep({
            runningStates: ['failed'],
            logLines: ['exec format error'],
        });

        await step.execute(baseContext);

        expect(queryWorkspace.mock.callCount()).to.equal(1);
        expect(queryWorkspace.mock.calls[0].arguments[1]).to.contain('ContainerAppConsoleLogs_CL');
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
    });

    it('does nothing when provisioning published no app name', async () => {
        const { step, client } = createStep({ envValues: {} });

        await step.execute(baseContext);

        expect(client.containerApps.get.mock.callCount()).to.equal(0);
    });

    it('does not throw when the app cannot be read', async () => {
        // The resources exist whether or not this diagnostic runs, so throwing
        // here would report a failed deployment that actually succeeded.
        const { step, client } = createStep();
        client.containerAppsRevisions.getRevision.mock.mockImplementation(() => Promise.reject(new Error('403')));

        await step.execute(baseContext);
    });

    it('does not throw when the log query fails', async () => {
        const { step, queryWorkspace } = createStep({ runningStates: ['failed'] });
        queryWorkspace.mock.mockImplementation(() => Promise.reject(new Error('no access')));

        await step.execute(baseContext);
    });
});
