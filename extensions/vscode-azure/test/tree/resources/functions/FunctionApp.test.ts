/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { FunctionAppVirtualTypes, isFunctionApp, isFunctionAppVirtual } from '../../../../src/tree/resources/functions/FunctionApp';
import { makeFunctionApp } from './mockFunctionApp';

describe('FunctionApp (unit)', () => {
    describe('isFunctionApp', () => {
        it('returns true for a generic resource whose logicalType is the function app type', () => {
            expect(isFunctionApp(makeFunctionApp())).to.be.true;
        });

        it('matches the logicalType case-insensitively', () => {
            expect(isFunctionApp(makeFunctionApp({ logicalType: FunctionAppLogicalType.toUpperCase() }))).to.be.true;
        });

        it('returns false for a plain Microsoft.Web/sites resource (web app, not a function app)', () => {
            expect(isFunctionApp(makeGenericResource({ logicalType: 'Microsoft.Web/sites' }))).to.be.false;
        });

        it('returns false for nullish and non-object values', () => {
            expect(isFunctionApp(undefined)).to.be.false;
            expect(isFunctionApp(null)).to.be.false;
            expect(isFunctionApp('functionapp')).to.be.false;
        });

        it('returns false for a virtual resource (not a generic resource)', () => {
            expect(isFunctionApp(makeVirtualResource())).to.be.false;
        });
    });

    describe('isFunctionAppVirtual', () => {
        it('returns true for the App Settings category node owned by a function app', () => {
            const node = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                azureResource: makeFunctionApp(),
            });
            expect(isFunctionAppVirtual(node)).to.be.true;
        });

        it('returns true for an individual app-setting leaf node owned by a function app', () => {
            const node = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSetting,
                azureResource: makeFunctionApp(),
            });
            expect(isFunctionAppVirtual(node)).to.be.true;
        });

        it('returns false when the virtual type is not a known function app type', () => {
            const node = makeVirtualResource({
                virtualType: 'repository',
                azureResource: makeFunctionApp(),
            });
            expect(isFunctionAppVirtual(node)).to.be.false;
        });

        it('returns false when the owning azureResource is not a function app', () => {
            const node = makeVirtualResource({
                virtualType: FunctionAppVirtualTypes.AppSettings,
                azureResource: makeGenericResource({ logicalType: 'Microsoft.Web/sites' }),
            });
            expect(isFunctionAppVirtual(node)).to.be.false;
        });

        it('returns false for nullish values', () => {
            expect(isFunctionAppVirtual(undefined)).to.be.false;
            expect(isFunctionAppVirtual(null)).to.be.false;
        });

        it('returns false for a plain generic function app resource (not virtual)', () => {
            expect(isFunctionAppVirtual(makeFunctionApp())).to.be.false;
        });
    });
});
