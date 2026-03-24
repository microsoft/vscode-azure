/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { GenericAzureDataProvider } from '../../../tree/resources/GenericAzureDataProvider';

describe('GenericAzureDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('should return true for account nodes', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(makeAccount())).to.be.true;
        });

        it('should return true for tenant nodes', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(makeTenant())).to.be.true;
        });

        it('should return true for subscription nodes', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(makeSubscription())).to.be.true;
        });

        it('should return true for resource group nodes', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(makeResourceGroup())).to.be.true;
        });

        it('should return false for generic resources', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for null/undefined', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle(undefined)).to.be.false;
        });

        it('should return false for non-objects', () => {
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, { signIn: () => Promise.resolve(true) } as never);

            expect(provider.canHandle('string')).to.be.false;
        });
    });

    describe('getChildren (root)', () => {
        it('should sign in and return accounts', async () => {
            const accounts = [makeAccount()];
            const executor = new ActionExecutor(new NullTelemetryReporter());
            const subscriptionProvider = {
                signIn: () => Promise.resolve(true),
                getAccounts: () => Promise.resolve(accounts),
            };

            const provider = new GenericAzureDataProvider(executor, (() => Promise.resolve({})) as never, subscriptionProvider as never);

            const children = await provider.getChildren();
            expect(children).to.deep.equal(accounts);
        });
    });
});
