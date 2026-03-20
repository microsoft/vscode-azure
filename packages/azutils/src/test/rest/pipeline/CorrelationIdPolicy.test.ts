/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { CorrelationIdPolicy } from '../../../rest/pipeline/CorrelationIdPolicy';
import { makeRequest, makeResponse } from '../../mockPipeline';

describe('CorrelationIdPolicy (unit)', () => {
    it('should have the name "CorrelationIdPolicy"', () => {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const policy = new CorrelationIdPolicy(executor);
        expect(policy.name).to.equal('CorrelationIdPolicy');
    });

    it('should set x-ms-correlation-request-id header when a context is active', async () => {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const policy = new CorrelationIdPolicy(executor);

        await executor.callWithTelemetryAndErrorHandling('test', async (context) => {
            const request = makeRequest();
            await policy.sendRequest(request, (req) => Promise.resolve(makeResponse(req)));
            expect(request.headers.get('x-ms-correlation-request-id')).to.equal(context.telemetry.properties.correlationId);
        });
    });

    it('should not set the header when no context is active', async () => {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const policy = new CorrelationIdPolicy(executor);
        const request = makeRequest();

        await policy.sendRequest(request, (req) => Promise.resolve(makeResponse(req)));

        expect(request.headers.has('x-ms-correlation-request-id')).to.be.false;
    });

    it('should pass through to next and return the response', async () => {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const policy = new CorrelationIdPolicy(executor);
        const request = makeRequest();
        const expectedResponse = makeResponse(request);

        const result = await policy.sendRequest(request, () => Promise.resolve(expectedResponse));

        expect(result).to.equal(expectedResponse);
    });
});
