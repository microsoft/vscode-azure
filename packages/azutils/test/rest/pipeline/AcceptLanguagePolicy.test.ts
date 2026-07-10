/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { AcceptLanguagePolicy } from '../../../src/rest/pipeline/AcceptLanguagePolicy';
import { makeRequest, makeResponse } from '../../mockPipeline';

describe('AcceptLanguagePolicy (unit)', () => {
    it('should have the name "AcceptLanguagePolicy"', () => {
        const policy = new AcceptLanguagePolicy('en');
        expect(policy.name).to.equal('AcceptLanguagePolicy');
    });

    it('should set the accept-language header on the request', async () => {
        const policy = new AcceptLanguagePolicy('fr-FR');
        const request = makeRequest();

        await policy.sendRequest(request, (req) => Promise.resolve(makeResponse(req)));

        expect(request.headers.get('accept-language')).to.equal('fr-FR');
    });

    it('should overwrite any existing accept-language header', async () => {
        const policy = new AcceptLanguagePolicy('de-DE');
        const request = makeRequest();
        request.headers.set('accept-language', 'en-US');

        await policy.sendRequest(request, (req) => Promise.resolve(makeResponse(req)));

        expect(request.headers.get('accept-language')).to.equal('de-DE');
    });

    it('should pass through to the next policy and return its response', async () => {
        const policy = new AcceptLanguagePolicy('en');
        const request = makeRequest();
        const expectedResponse = makeResponse(request);

        const result = await policy.sendRequest(request, () => Promise.resolve(expectedResponse));

        expect(result).to.equal(expectedResponse);
    });
});
