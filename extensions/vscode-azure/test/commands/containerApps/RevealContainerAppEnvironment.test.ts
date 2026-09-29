/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { makeContainerApp } from '@microsoft/vscode-azure-azutils/testing';
import { mock } from 'node:test';
import { RevealContainerAppEnvironment } from '../../../src/commands/containerApps/RevealContainerAppEnvironment';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

const EnvironmentId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/OtherRG/providers/Microsoft.App/managedEnvironments/MyEnv';

function createCommand(environmentId: string | undefined, revealImpl?: () => Promise<void>) {
    const app = makeContainerApp({ environmentId });
    const { selector, codeContext } = createTestResourceSelector({ nodes: [app] });
    const mockResult = codeContext.mock;
    const reveal = mock.fn((_key: string, _options?: { select?: boolean; focus?: boolean }) =>
        revealImpl ? revealImpl() : Promise.resolve());

    const command = new RevealContainerAppEnvironment(
        mockResult.vscode,
        selector,
        { reveal } as never,
    );

    return { command, reveal, key: AzureNodeId.from(app).toString() };
}

describe('RevealContainerAppEnvironment (unit)', () => {
    it('reveals the environment named by the app\'s environmentId', async () => {
        const { command, reveal, key } = createCommand(EnvironmentId);

        await command.execute(key);

        expect(reveal.mock.callCount()).to.equal(1);
        const revealed = reveal.mock.calls[0].arguments[0];
        // The environment sits in a different resource group than the app, so
        // the id has to come from `environmentId`, not from the app's own id.
        expect(revealed).to.contain(EnvironmentId);
    });

    it('reveals with selection and focus so the jump is visible', async () => {
        const { command, reveal, key } = createCommand(EnvironmentId);

        await command.execute(key);

        expect(reveal.mock.calls[0].arguments[1]).to.deep.equal({ select: true, focus: true });
    });

    it('explains when the hosting environment is not known', async () => {
        const { command, reveal, key } = createCommand(undefined);

        await expect(command.execute(key)).to.be.rejectedWith(/Could not determine the environment/i);
        expect(reveal.mock.callCount()).to.equal(0);
    });

    it('explains a failed reveal instead of surfacing the raw tree error', async () => {
        // Reveal fails when the environment's subscription is filtered out of
        // the view, which is a situation the user can actually act on.
        const { command, key } = createCommand(EnvironmentId, () => Promise.reject(new Error('element not found')));

        await expect(command.execute(key)).to.be.rejectedWith(/Could not reveal the environment/i);
    });
});
