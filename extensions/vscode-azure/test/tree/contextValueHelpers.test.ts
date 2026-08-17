/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { BrowseWebsite } from '../../src/commands/tree/BrowseWebsite';
import { OpenInPortal } from '../../src/commands/tree/OpenInPortal';
import { combineContextValues, resourceContextValue } from '../../src/tree/contextValueHelpers';
import { setWebsiteUrl } from '../../src/tree/resources/websiteUrl';

describe('combineContextValues (unit)', () => {
    it('should sort and join context values with semicolons', () => {
        expect(combineContextValues('b', 'a', 'c')).to.equal('a;b;c');
    });

    it('should return a single value unchanged', () => {
        expect(combineContextValues('only')).to.equal('only');
    });

    it('should return empty string for no values', () => {
        expect(combineContextValues()).to.equal('');
    });
});

describe('resourceContextValue (unit)', () => {
    it('should always allow opening in the portal', () => {
        expect(resourceContextValue(makeGenericResource())).to.equal(OpenInPortal.ContextValue);
    });

    it('should include product-specific additions', () => {
        const contextValue = resourceContextValue(makeGenericResource(), 'functionApp');

        expect(contextValue.split(';')).to.have.members([OpenInPortal.ContextValue, 'functionApp']);
    });

    it('should offer browsing once enrichment attaches a website url', () => {
        const resource = makeGenericResource();
        setWebsiteUrl(resource, 'site1.azurewebsites.net');

        expect(resourceContextValue(resource).split(';')).to.include(BrowseWebsite.ContextValue);
    });

    it('should not offer browsing before enrichment attaches a website url', () => {
        expect(resourceContextValue(makeGenericResource())).to.not.include(BrowseWebsite.ContextValue);
    });
});
