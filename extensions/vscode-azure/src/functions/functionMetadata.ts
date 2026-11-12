/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, type IVsCode } from '@microsoft/vscode-azure-utils';
import * as z from 'zod/mini';

/** Binding metadata shared by local and remote functions; callers apply settings and service state overrides. */
export interface FunctionMetadata {
    readonly triggerKind: string;
    readonly authLevel?: string;
    readonly isDisabled: boolean;
}

const FunctionConfigSchema = z.looseObject({
    bindings: z.array(z.unknown()),
    disabled: z.optional(z.unknown()),
});

const TriggerBindingSchema = z.looseObject({
    type: z.string().check(z.refine(type => type.toLowerCase().endsWith('trigger'))),
    authLevel: z.optional(z.unknown()),
});

/** Requires exactly one trigger and normalizes HTTP authentication and the metadata disable flag. */
export function parseFunctionMetadata(code: IVsCode, config: unknown): FunctionMetadata {
    const parsed = FunctionConfigSchema.safeParse(config);
    if (!parsed.success) {
        throw new ExternalError(code.l10n.t('Function metadata must include a bindings array.'));
    }
    const triggers = parsed.data.bindings.flatMap(binding => {
        const trigger = TriggerBindingSchema.safeParse(binding);
        return trigger.success ? [trigger.data] : [];
    });
    const trigger = triggers.at(0);
    if (triggers.length !== 1 || !trigger) {
        throw new ExternalError(code.l10n.t('Function metadata must include exactly one trigger binding.'));
    }
    return {
        triggerKind: trigger.type,
        authLevel: trigger.type.toLowerCase() === 'httptrigger' && typeof trigger.authLevel === 'string'
            ? trigger.authLevel.toLowerCase() : undefined,
        isDisabled: parsed.data.disabled === true,
    };
}
