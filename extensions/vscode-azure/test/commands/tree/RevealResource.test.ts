/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { mock } from 'node:test';
import { RevealResource } from '../../../src/commands/tree/RevealResource';

describe('RevealResource (unit)', () => {
    it('reveals a related resource across subscriptions with focus and selection', async () => {
        const reference = makeGenericResource();
        const resourceId = '/subscriptions/other-sub/resourceGroups/OtherRG/providers/Microsoft.ManagedIdentity/userAssignedIdentities/identity';
        const reveal = mock.fn((_key: string, _options: { select?: boolean; focus?: boolean }) => Promise.resolve());

        await new RevealResource({ reveal } as never).execute(reference, resourceId);

        expect(reveal.mock.calls[0].arguments).to.deep.equal([
            AzureNodeId.from(reference).forRelatedResource(resourceId).toString(),
            { select: true, focus: true },
        ]);
    });

    it('propagates tree reveal failures to the caller', async () => {
        const reference = makeGenericResource();
        const reveal = mock.fn(() => Promise.reject(new Error('Target is filtered')));

        await expect(new RevealResource({ reveal } as never).execute(reference, reference.id))
            .to.be.rejectedWith('Target is filtered');
    });
});
