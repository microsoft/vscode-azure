/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChooseLocationContext, ChooseSubscriptionContext, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockPagedDataItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import type { IOutputChannel } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { HydratableChooseLocationStep, HydratableChooseSubscriptionStep } from '../../../src/azd/wizard/HydratableChooseSteps';
import type { IAzureViewViewItemTree } from '../../../src/services';

type SubContext = AzdWizardContext & ChooseSubscriptionContext;
type LocContext = AzdWizardContext & ChooseLocationContext;

describe('HydratableChooseSteps (unit)', () => {
    describe('HydratableChooseSubscriptionStep.shouldPrompt', () => {
        function createStep() {
            const { ctx } = createMockCodeContext();
            const dataItemTree = createMockPagedDataItemTree([], new Map()).tree;
            // The view-item tree is unused by shouldPrompt; a bare stub is enough.
            const viewTree = {} as unknown as IAzureViewViewItemTree;
            return new HydratableChooseSubscriptionStep<SubContext>(ctx, viewTree, dataItemTree);
        }

        it('prompts when nothing has been hydrated or chosen', () => {
            expect(createStep().shouldPrompt({})).to.be.true;
        });

        it('skips when a subscription id was hydrated from the existing env', () => {
            expect(createStep().shouldPrompt({ hydratedSubscriptionId: 'sub-1' })).to.be.false;
        });

        it('skips when a subscription has already been chosen', () => {
            expect(createStep().shouldPrompt({ subscription: makeSubscription() })).to.be.false;
        });

        it('skips when both a hydrated id and a chosen subscription are present', () => {
            const context: SubContext = { hydratedSubscriptionId: 'sub-1', subscription: makeSubscription() };
            expect(createStep().shouldPrompt(context)).to.be.false;
        });
    });

    describe('HydratableChooseLocationStep.shouldPrompt', () => {
        function createStep() {
            const { ctx } = createMockCodeContext();
            // Neither dependency is exercised by shouldPrompt; bare stubs are enough.
            const clientProvider = (() => { throw new Error('not used by shouldPrompt'); }) as unknown as ISubscriptionClientProvider;
            const output = {} as unknown as IOutputChannel;
            return new HydratableChooseLocationStep<LocContext>(ctx, clientProvider, output);
        }

        it('prompts when nothing has been hydrated or chosen', () => {
            expect(createStep().shouldPrompt({})).to.be.true;
        });

        it('skips when a location name was hydrated from the existing env', () => {
            expect(createStep().shouldPrompt({ hydratedLocationName: 'eastus' })).to.be.false;
        });

        it('skips when a location has already been chosen', () => {
            expect(createStep().shouldPrompt({ location: { name: 'eastus' } })).to.be.false;
        });

        it('skips when both a hydrated name and a chosen location are present', () => {
            const context: LocContext = { hydratedLocationName: 'eastus', location: { name: 'westus' } };
            expect(createStep().shouldPrompt(context)).to.be.false;
        });
    });
});
