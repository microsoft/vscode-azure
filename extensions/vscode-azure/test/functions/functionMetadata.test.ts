/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { parseFunctionMetadata } from '../../src/functions/functionMetadata';

describe('Function metadata (unit)', () => {
    const { vscode: code } = createMockVsCode();

    it('finds the trigger among output and malformed bindings and normalizes HTTP access', () => {
        const metadata = parseFunctionMetadata(code, {
            bindings: [null, { type: 1 }, { type: 'http', direction: 'out' }, { type: 'HTTPTrigger', authLevel: 'Anonymous' }],
            disabled: true,
        });
        expect(metadata.triggerKind).to.equal('HTTPTrigger');
        expect(metadata.authLevel).to.equal('anonymous');
        expect(metadata.isDisabled).to.be.true;
    });

    it('omits HTTP access for other triggers and requires a boolean metadata disable flag', () => {
        const metadata = parseFunctionMetadata(code, {
            bindings: [{ type: 'queueTrigger', authLevel: 'admin' }], disabled: 'true',
        });
        expect(metadata.triggerKind).to.equal('queueTrigger');
        expect(metadata.authLevel).to.be.undefined;
        expect(metadata.isDisabled).to.be.false;
        expect(parseFunctionMetadata(code, { bindings: [{ type: 'httpTrigger', authLevel: 1 }] }).authLevel).to.be.undefined;
    });

    it('rejects missing bindings and absent or ambiguous triggers', () => {
        for (const config of [undefined, null, {}, { bindings: 'invalid' }]) {
            expect(() => parseFunctionMetadata(code, config)).to.throw(ExternalError, 'bindings array');
        }
        for (const bindings of [[], [{ type: 'http' }], [{ type: 'httpTrigger' }, { type: 'queueTrigger' }]]) {
            expect(() => parseFunctionMetadata(code, { bindings })).to.throw(ExternalError, 'exactly one trigger');
        }
    });
});
