/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { getWebsiteUrl, setWebsiteUrl } from '../../../src/tree/resources/websiteUrl';

describe('websiteUrl (unit)', () => {
    it('should build an https url from the hostname reported by ARM', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.azurewebsites.net');

        expect(getWebsiteUrl(resource)).to.equal('https://contoso.azurewebsites.net');
    });

    it('should keep a port and path supplied with the host', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.example.com:8080/app');

        expect(getWebsiteUrl(resource)).to.equal('https://contoso.example.com:8080/app');
    });

    it('should attach nothing when there is no hostname', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, undefined);
        expect(getWebsiteUrl(resource)).to.be.undefined;

        setWebsiteUrl(resource, '   ');
        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should clear a stale url when the resource no longer exposes one', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.azurewebsites.net');
        setWebsiteUrl(resource, undefined);

        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should return undefined for resources without a website', () => {
        expect(getWebsiteUrl(makeGenericResource())).to.be.undefined;
        expect(getWebsiteUrl(undefined)).to.be.undefined;
        expect(getWebsiteUrl('not a resource')).to.be.undefined;
    });
});
