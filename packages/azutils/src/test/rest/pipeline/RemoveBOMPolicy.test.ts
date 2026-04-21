/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { RemoveBOMPolicy } from '../../../rest/pipeline/RemoveBOMPolicy';
import { makeRequest, makeResponse } from '../../mockPipeline';

describe('RemoveBOMPolicy (unit)', () => {
    it('should have the name "RemoveBOMPolicy"', () => {
        const policy = new RemoveBOMPolicy();
        expect(policy.name).to.equal('RemoveBOMPolicy');
    });

    it('should remove a leading UTF-8 BOM from bodyAsText', async () => {
        const policy = new RemoveBOMPolicy();
        const request = makeRequest();
        const response = makeResponse(request, 200, '\uFEFF{"key":"value"}');

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result.bodyAsText).to.equal('{"key":"value"}');
    });

    it('should not modify bodyAsText without a BOM', async () => {
        const policy = new RemoveBOMPolicy();
        const request = makeRequest();
        const response = makeResponse(request, 200, '{"key":"value"}');

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result.bodyAsText).to.equal('{"key":"value"}');
    });

    it('should handle null bodyAsText gracefully', async () => {
        const policy = new RemoveBOMPolicy();
        const request = makeRequest();
        const response = makeResponse(request, 200, null);

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result.bodyAsText).to.be.null;
    });

    it('should handle undefined bodyAsText gracefully', async () => {
        const policy = new RemoveBOMPolicy();
        const request = makeRequest();
        const response = makeResponse(request);
        response.bodyAsText = undefined;

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result.bodyAsText).to.be.undefined;
    });

    it('should only remove BOM from the very beginning', async () => {
        const policy = new RemoveBOMPolicy();
        const request = makeRequest();
        const response = makeResponse(request, 200, 'prefix\uFEFFsuffix');

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result.bodyAsText).to.equal('prefix\uFEFFsuffix');
    });
});
