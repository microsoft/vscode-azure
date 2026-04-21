/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, DebugOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { CreateFunctionApp } from '../../../commands/functions/CreateFunctionApp';
import type { TempProjectManager } from '../../../wizard/azd/TempProjectManager';

describe('CreateFunctionApp (unit)', () => {
    function createCommand() {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new DebugOutputChannel('test');

        // Provide workspace folder for HydrateAzdInfoStep + OfferSaveStep
        mockResult.workspaceFolders.push({
            uri: MockUri.file('/workspace'),
            name: 'workspace',
            index: 0,
        } as never);

        const dataTree = {
            get: mock.fn(),
            invalidate: mock.fn(),
        };

        const viewItemTree = {};

        const subscriptionClientProvider: ISubscriptionClientProvider = {
            getClient: mock.fn(() => Promise.resolve({
                subscriptions: { listLocations: mock.fn(() => []) },
            })),
        } as unknown as ISubscriptionClientProvider;

        const tempManager: TempProjectManager = {
            createProjectDir: () => Promise.resolve(MockUri.file('/tmp/project')),
            dispose: () => { /* noop */ },
        } as unknown as TempProjectManager;

        const cmd = new CreateFunctionApp(
            ctx,
            output,
            dataTree as never,
            viewItemTree as never,
            subscriptionClientProvider,
            tempManager,
        );

        return { cmd, ctx, mockResult };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(CreateFunctionApp);
    });

    it('should have an execute method', () => {
        const { cmd } = createCommand();
        expect(typeof cmd.execute).to.equal('function');
    });
});
