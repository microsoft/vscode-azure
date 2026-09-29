/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AIFoundryProjectLogicalType, ContainerAppResourceType, CosmosDBMongoLogicalType, DocumentDbResourceType, FoundryProjectResourceType, FunctionAppLogicalType } from '../../src/rest/clients/ResourceClient';
import { getResourceTypePresentation } from '../../src/tree/ResourceTypePresentation';

describe('ResourceTypePresentation (unit)', () => {
    const { ctx } = createMockCodeContext();

    it('returns localized names and canonical icons for logical types regardless of casing', () => {
        const containerApps = getResourceTypePresentation(ctx.code, ContainerAppResourceType.toUpperCase());
        expect(containerApps).to.deep.equal({
            name: 'Container Apps',
            iconName: ContainerAppResourceType,
        });

        const functionApps = getResourceTypePresentation(ctx.code, FunctionAppLogicalType.toLowerCase());
        expect(functionApps).to.deep.equal({
            name: 'Function Apps',
            iconName: FunctionAppLogicalType,
        });
    });

    it('returns undefined when a resource type has no presentation metadata', () => {
        expect(getResourceTypePresentation(ctx.code, 'Microsoft.Example/unknown')).to.be.undefined;
    });

    it('uses the Foundry project icon for Cognitive Services projects and brands DocumentDB', () => {
        expect(getResourceTypePresentation(ctx.code, FoundryProjectResourceType.toUpperCase())).to.deep.equal({
            name: 'Microsoft Foundry Projects',
            iconName: AIFoundryProjectLogicalType,
        });
        expect(getResourceTypePresentation(ctx.code, DocumentDbResourceType)?.name).to.equal('Azure DocumentDB');
        expect(getResourceTypePresentation(ctx.code, CosmosDBMongoLogicalType)?.name).to.equal('Azure Cosmos DB for MongoDB (RU)');
        expect(getResourceTypePresentation(ctx.code, 'Microsoft.Cdn/profiles')?.name).to.equal('Front Door and CDN Profiles');
    });

    it('provides presentation metadata for every bundled resource icon', () => {
        const iconRoot = join(import.meta.dirname, '..', '..', 'resources', 'azureIcons');
        const resourceIcons = readdirSync(iconRoot, { recursive: true, encoding: 'utf8' })
            .map(path => path.replaceAll('\\', '/'))
            .filter(path => path.endsWith('.svg') && path.startsWith('microsoft.')
                && !path.startsWith('microsoft.resources/'));

        for (const icon of resourceIcons) {
            const logicalType = icon.slice(0, -'.svg'.length);
            const presentation = getResourceTypePresentation(ctx.code, logicalType);
            expect(presentation?.name, icon).to.be.a('string').and.not.be.empty;
            expect(presentation?.iconName.toLowerCase(), icon).to.equal(logicalType);
        }
    });
});
