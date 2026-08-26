/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import type { Page } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, DebugOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { PickImageSourceStep } from '../../../src/commands/containerApps/steps/PickImageSourceStep';
import { AcrResourceType } from '../../../src/tree/resources/acr/AcrRegistry';

function makeRegistry(name: string): GenericResource {
    return makeGenericResource({
        id: `/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/${name}`,
        name,
        type: AcrResourceType,
        logicalType: AcrResourceType,
    });
}

describe('PickImageSourceStep (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    function createStep(
        registries: GenericResource[],
        tagsByRegistry: Record<string, { repository: string; tags: string[] }[]>,
    ) {
        const { ctx, mock: mockResult } = createMockCodeContext();

        const list = mock.fn((_options?: { filter?: string }): AsyncIterable<Page<GenericResource>> => ({
            async *[Symbol.asyncIterator]() {
                yield await Promise.resolve({ items: registries, hasMore: false });
            },
        }));

        const createRepositoryClient = mock.fn((_subscription: AzureSubscription, loginServer: string) => ({
            listRepositories: () => Promise.resolve([]),
            listRepositoryTags: () => {
                const entry = tagsByRegistry[loginServer] as { repository: string; tags: string[] }[] | undefined;
                return entry ? Promise.resolve(entry) : Promise.reject(new Error('no pull access'));
            },
        }));

        const step = new PickImageSourceStep(
            mockResult.vscode,
            ctx,
            new DebugOutputChannel('test'),
            (() => ({ resources: { list } })) as never,
            createRepositoryClient,
        );

        return { step, mockResult, list };
    }

    it('only asks on the createNew job', () => {
        const { step } = createStep([], {});

        expect(step.shouldPrompt({ job: 'createNew' })).to.be.true;
        // On `deploy`, azd builds and pushes the image, so there is no existing
        // image to choose between.
        expect(step.shouldPrompt({ job: 'deploy' })).to.be.false;
        expect(step.shouldPrompt({ job: 'createNew', hasInfra: true })).to.be.false;
        expect(step.shouldPrompt({ job: 'createNew', imageName: 'x:1' })).to.be.false;
    });

    it('offers each tag as a fully qualified image reference', async () => {
        const subscription = makeSubscription();
        const { step, mockResult } = createStep(
            [makeRegistry('contoso')],
            { 'contoso.azurecr.io': [{ repository: 'store/api', tags: ['v2', 'v1'] }] },
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'contoso.azurecr.io/store/api:v2' }]);

        const result = await step.prompt({ job: 'createNew', subscription });

        expect(result.imageName).to.equal('contoso.azurecr.io/store/api:v2');
        expect(mockResult.quickPicks[0].items.map(item => item.label)).to.deep.equal([
            'contoso.azurecr.io/store/api:v2',
            'contoso.azurecr.io/store/api:v1',
        ]);
        tracker.assertAllConsumed();
    });

    it('filters the registry list server-side', async () => {
        const subscription = makeSubscription();
        const { step, mockResult, list } = createStep([], {});
        respondToPrompts(mockResult, [{ value: 'nginx:latest' }]);

        await step.prompt({ job: 'createNew', subscription });

        const options = list.mock.calls[0].arguments[0];
        expect(options?.filter).to.contain(AcrResourceType);
    });

    it('accepts an image from a registry it cannot enumerate', async () => {
        const subscription = makeSubscription();
        const { step, mockResult } = createStep([], {});
        respondToPrompts(mockResult, [{ value: 'docker.io/library/nginx:latest' }]);

        const result = await step.prompt({ job: 'createNew', subscription });

        expect(result.imageName).to.equal('docker.io/library/nginx:latest');
    });

    it('still offers the readable registries when one cannot be read', async () => {
        // Losing every suggestion because one registry denies pull access would
        // make the pick useless for users with a mix of permissions.
        const subscription = makeSubscription();
        const { step, mockResult } = createStep(
            [makeRegistry('denied'), makeRegistry('allowed')],
            { 'allowed.azurecr.io': [{ repository: 'api', tags: ['v1'] }] },
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'allowed.azurecr.io/api:v1' }]);

        const result = await step.prompt({ job: 'createNew', subscription });

        expect(result.imageName).to.equal('allowed.azurecr.io/api:v1');
        tracker.assertAllConsumed();
    });
});
