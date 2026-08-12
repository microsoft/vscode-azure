/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import { Wizard } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { AzureSubscription } from '../../src/auth/AzureSubscription';
import type { Location } from '../../src/rest/clients/SubscriptionClient';
import { ChooseLocationStep } from '../../src/wizard/ChooseLocationStep';
import { createMockSubscriptionClientProvider, makeSubscription } from '../mockAzure';

const subscription = makeSubscription();

const eastus: Location = { name: 'eastus', displayName: 'East US' };
const westus: Location = { name: 'westus', displayName: 'West US' };
const northeurope: Location = { name: 'northeurope', displayName: 'North Europe' };

interface TestContext extends PickContext<string> {
    readonly subscription: AzureSubscription;
    readonly location?: Location;
}

describe('ChooseLocationStep (unit)', () => {
    const output = new MockOutputChannel('test');
    it('should pick a location from the list', async () => {
        const { ctx, mock } = createMockCodeContext();
        const provider = createMockSubscriptionClientProvider([eastus, westus, northeurope]);

        const tracker = respondToPrompts(mock, [
            { pick: 'East US' },
        ]);

        const wizard = new Wizard<TestContext>(
            output,
            { picks: [], subscription },
            [new ChooseLocationStep(ctx, provider, output)],
        );
        const result = await wizard.run();

        expect(result.location?.name).to.equal('eastus');
        expect(result.location?.displayName).to.equal('East US');
        tracker.assertAllConsumed();
    });

    it('should sort locations alphabetically by display name', async () => {
        const { ctx, mock } = createMockCodeContext();
        // Provide in non-alphabetical order
        const provider = createMockSubscriptionClientProvider([westus, eastus, northeurope]);

        // The first item alphabetically is "East US"
        const tracker = respondToPrompts(mock, [
            { pick: 'North Europe' },
        ]);

        const wizard = new Wizard<TestContext>(
            output,
            { picks: [], subscription },
            [new ChooseLocationStep(ctx, provider, output)],
        );
        const result = await wizard.run();

        expect(result.location?.name).to.equal('northeurope');
        tracker.assertAllConsumed();
    });

    it('should filter out locations without name or displayName', async () => {
        const { ctx, mock } = createMockCodeContext();
        const incomplete: Location = { name: undefined, displayName: undefined };
        const provider = createMockSubscriptionClientProvider([incomplete, eastus]);

        const tracker = respondToPrompts(mock, [
            { pick: 'East US' },
        ]);

        const wizard = new Wizard<TestContext>(
            output,
            { picks: [], subscription },
            [new ChooseLocationStep(ctx, provider, output)],
        );
        const result = await wizard.run();

        expect(result.location?.name).to.equal('eastus');
        tracker.assertAllConsumed();
    });

    it('should throw when subscription is missing', async () => {
        const { ctx } = createMockCodeContext();
        const provider = createMockSubscriptionClientProvider([eastus]);

        const wizard = new Wizard<TestContext>(
            output,
            { picks: [] } as unknown as TestContext,
            [new ChooseLocationStep(ctx, provider, output)],
        );

        await expect(wizard.run()).to.be.rejectedWith('Subscription is required to choose location');
    });
});
