/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AcrResourceType, isAcrRegistry } from '../../../../tree/resources/acr/AcrRegistry';

describe('AcrRegistry (unit)', () => {
    describe('isAcrRegistry', () => {
        it('should return true for a GenericResource with ACR logicalType', () => {
            const resource = makeGenericResource({
                type: AcrResourceType,
                logicalType: AcrResourceType,
            });

            expect(isAcrRegistry(resource)).to.be.true;
        });

        it('should be case-insensitive for logicalType', () => {
            const resource = makeGenericResource({
                type: AcrResourceType,
                logicalType: AcrResourceType.toLowerCase(),
            });

            expect(isAcrRegistry(resource)).to.be.true;
        });

        it('should return false for a non-ACR resource', () => {
            const resource = makeGenericResource();

            expect(isAcrRegistry(resource)).to.be.false;
        });

        it('should return false for null', () => {
            expect(isAcrRegistry(null)).to.be.false;
        });

        it('should return false for non-objects', () => {
            expect(isAcrRegistry('string')).to.be.false;
            expect(isAcrRegistry(42)).to.be.false;
        });
    });
});
