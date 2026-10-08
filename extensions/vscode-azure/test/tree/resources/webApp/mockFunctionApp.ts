/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeFunctionEnvelope, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { FunctionAppVirtualTypes, type FunctionApp, type FunctionAppFunction, type FunctionAppFunctions } from '../../../../src/tree/resources/webApp/FunctionApp';
import { makeSettingsResource } from '../../../settings/mockSettings';

/** Builds the remote Functions group beneath the supplied app. */
export function makeFunctionAppFunctions(azureResource: FunctionApp = makeSettingsResource()): FunctionAppFunctions {
    return { virtualType: FunctionAppVirtualTypes.Functions, virtualPath: 'functions', azureResource };
}

/** Builds a remote function leaf for tests of presentation and command capabilities. */
export function makeFunctionAppFunction(overrides?: Partial<FunctionAppFunction>): FunctionAppFunction {
    return {
        ...makeVirtualResource({
            azureResource: makeSettingsResource(),
            virtualType: FunctionAppVirtualTypes.Function,
            virtualPath: 'functions/HttpTrigger',
        }),
        virtualType: FunctionAppVirtualTypes.Function,
        data: makeFunctionEnvelope(),
        functionName: 'HttpTrigger',
        triggerKind: 'httpTrigger',
        isDisabled: false,
        authLevel: 'function',
        ...overrides,
    };
}
