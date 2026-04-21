/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { createActionContext } from '../../base/IActionContext';

describe('createActionContext (unit)', () => {
    it('should create a context with the given telemetry ID', () => {
        const ctx = createActionContext('myCommand');
        expect(ctx.telemetry.id).to.equal('myCommand');
    });

    it('should generate a correlationId if none is provided', () => {
        const ctx = createActionContext('test');
        expect(ctx.telemetry.properties['x-ms-correlation-request-id']).to.be.a('string');
        expect(ctx.telemetry.properties['x-ms-correlation-request-id'].length).to.be.greaterThan(0);
    });

    it('should use the provided correlationId', () => {
        const ctx = createActionContext('test', 'my-corr-id');
        expect(ctx.telemetry.properties['x-ms-correlation-request-id']).to.equal('my-corr-id');
    });

    it('should initialize with empty measurements', () => {
        const ctx = createActionContext('test');
        expect(ctx.telemetry.measurements).to.deep.equal({});
    });

    it('should initialize with empty errorHandling', () => {
        const ctx = createActionContext('test');
        expect(ctx.errorHandling).to.deep.equal({});
    });
});
