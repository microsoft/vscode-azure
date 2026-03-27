/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { generateFunctionAppParameters } from '../../../bicep/BicepGenerator';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Generates a `main.parameters.json` file with the user's chosen
 * values. The `main.bicep` template is copied as-is from the
 * extension resources by a later step.
 */
export class GenerateBicepStep extends ExecuteStep<CreateFunctionAppContext> {
    public execute(context: CreateFunctionAppContext): void {
        const parameters = generateFunctionAppParameters({
            functionAppName: context.functionAppName,
            runtime: context.runtime,
            hostingPlan: context.hostingPlan,
        });

        context.parametersContent = parameters;
    }
}
