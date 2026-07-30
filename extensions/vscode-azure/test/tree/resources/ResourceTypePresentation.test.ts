/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { ResourceTypePresentationRegistry, type ResourceTypePresentation } from '../../../src/tree/resources/ResourceTypePresentation';

describe('ResourceTypePresentationRegistry (unit)', () => {
    const presentation: ResourceTypePresentation = {
        logicalType: 'Microsoft.Web/sites~functionapp',
        getDisplayName: code => code.l10n.t('Function Apps'),
    };

    it('should resolve logical types case-insensitively', () => {
        const registry = new ResourceTypePresentationRegistry([presentation]);

        expect(registry.getPresentation('MICROSOFT.WEB/SITES~FUNCTIONAPP')).to.equal(presentation);
    });

    it('should return undefined for unknown logical types', () => {
        const registry = new ResourceTypePresentationRegistry([presentation]);

        expect(registry.getPresentation('Microsoft.Storage/storageAccounts')).to.be.undefined;
    });

    it('should reject duplicate logical types case-insensitively', () => {
        const duplicate: ResourceTypePresentation = {
            ...presentation,
            logicalType: presentation.logicalType.toUpperCase(),
        };

        expect(() => new ResourceTypePresentationRegistry([presentation, duplicate]))
            .to.throw('Duplicate resource type presentation');
    });
});
