/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { getWebsiteUrl, setWebsiteUrl } from '../../../src/tree/resources/websiteUrl';

describe('websiteUrl (unit)', () => {
    it('should assume https for a bare hostname reported by ARM', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.azurewebsites.net');

        expect(getWebsiteUrl(resource)).to.equal('https://contoso.azurewebsites.net/');
    });

    it('should preserve an absolute url', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'http://contoso.example.com/app');

        expect(getWebsiteUrl(resource)).to.equal('http://contoso.example.com/app');
    });

    it('should attach nothing when there is no endpoint', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, undefined);
        setWebsiteUrl(resource, '   ');

        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should reject endpoints a browser should not be sent to', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'javascript://example.com/%0aalert(1)');
        expect(getWebsiteUrl(resource)).to.be.undefined;

        setWebsiteUrl(resource, 'javascript:alert(1)');
        expect(getWebsiteUrl(resource)).to.be.undefined;

        setWebsiteUrl(resource, 'ftp://contoso.example.com');
        expect(getWebsiteUrl(resource)).to.be.undefined;

        setWebsiteUrl(resource, 'file:///etc/passwd');
        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should preserve a host that carries a port', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.example.com:8080');

        expect(getWebsiteUrl(resource)).to.equal('https://contoso.example.com:8080/');
    });

    it('should clear a stale url when the resource no longer exposes one', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.azurewebsites.net');
        setWebsiteUrl(resource, undefined);

        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should clear a stale url when the new endpoint is unusable', () => {
        const resource = makeGenericResource();

        setWebsiteUrl(resource, 'contoso.azurewebsites.net');
        setWebsiteUrl(resource, 'ftp://contoso.example.com');

        expect(getWebsiteUrl(resource)).to.be.undefined;
    });

    it('should return undefined for resources without a website', () => {
        expect(getWebsiteUrl(makeGenericResource())).to.be.undefined;
        expect(getWebsiteUrl(undefined)).to.be.undefined;
        expect(getWebsiteUrl('not a resource')).to.be.undefined;
    });
});
