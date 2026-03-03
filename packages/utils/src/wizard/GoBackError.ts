/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thrown by a {@link PromptStep} to signal that the user wants to
 * navigate back to the previous prompt step in the wizard.
 *
 * The wizard catches this internally and re-runs the previous step.
 * If there is no previous step, the wizard treats it as cancellation.
 */
export class GoBackError extends Error {
    public constructor() {
        super('Go back');
        this.name = GoBackErrorName;
    }

    public static test(error: unknown): error is GoBackError {
        return error instanceof GoBackError || (error instanceof Error && error.name === GoBackErrorName);
    }
}

const GoBackErrorName = 'GoBackError'; // separate constant
