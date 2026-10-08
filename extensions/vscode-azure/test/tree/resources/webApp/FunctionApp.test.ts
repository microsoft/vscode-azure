/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, SiteType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { isFunctionApp, isFunctionAppFunction, type FunctionAppFunction } from '../../../../src/tree/resources/webApp/FunctionApp';

describe('FunctionApp model (unit)', () => {
    it('should distinguish Function Apps from other Web Apps case-insensitively', () => {
        const app = makeGenericResource({ type: SiteType, logicalType: FunctionAppLogicalType.toUpperCase() });
        expect(isFunctionApp(app)).to.be.true;
        for (const logicalType of [AppServiceLogicalType, LogicAppLogicalType]) {
            expect(isFunctionApp(makeGenericResource({ type: SiteType, logicalType }))).to.be.false;
        }
        expect(isFunctionApp(undefined)).to.be.false;
        expect(isFunctionApp({ logicalType: FunctionAppLogicalType })).to.be.false;
    });

    it('should identify remote function leaves and reject leaves owned by another product', () => {
        const fn: FunctionAppFunction = {
            ...makeVirtualResource({
                azureResource: makeGenericResource({ type: SiteType, logicalType: FunctionAppLogicalType }),
                virtualPath: 'functions/hello',
            }),
            virtualType: 'functionApp.function',
            functionName: 'hello',
            triggerKind: 'httpTrigger',
            isDisabled: false,
            authLevel: 'function',
            data: { name: 'app/hello' },
        };
        expect(isFunctionAppFunction(fn)).to.be.true;
        expect(isFunctionAppFunction({ ...fn, azureResource: makeGenericResource() })).to.be.false;
        expect(isFunctionAppFunction({ ...fn, virtualType: 'functionApp.functions' })).to.be.false;
        expect(isFunctionAppFunction({ ...fn, functionName: undefined })).to.be.false;
        expect(isFunctionAppFunction({ ...fn, isDisabled: 'false' })).to.be.false;
        expect(isFunctionAppFunction(null)).to.be.false;
    });
});
