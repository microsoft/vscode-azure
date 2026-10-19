/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, type IVsCode } from '@microsoft/vscode-azure-utils';

/** Binding metadata shared by local and remote functions; callers apply settings and service state overrides. */
export interface FunctionMetadata {
    readonly triggerKind: string;
    readonly authLevel?: string;
    readonly isDisabled: boolean;
}

interface FunctionTriggerBinding {
    readonly type: string;
    readonly authLevel?: unknown;
}

/** Recognizes the bindings container without trusting its individual entries or optional properties. */
export function hasFunctionBindings(config: unknown): config is { readonly bindings: readonly unknown[] } {
    return !!config && typeof config === 'object'
        && 'bindings' in config && Array.isArray(config.bindings);
}

/** Recognizes trigger bindings in untrusted function configuration. */
export function isFunctionTriggerBinding(binding: unknown): binding is FunctionTriggerBinding {
    return !!binding && typeof binding === 'object'
        && 'type' in binding && typeof binding.type === 'string'
        && binding.type.toLowerCase().endsWith('trigger');
}

/** Requires exactly one trigger and normalizes HTTP authentication and the metadata disable flag. */
export function parseFunctionMetadata(code: IVsCode, config: unknown): FunctionMetadata {
    if (!hasFunctionBindings(config)) {
        throw new ExternalError(code.l10n.t('Function metadata must include a bindings array.'));
    }
    const triggers = config.bindings.filter(isFunctionTriggerBinding);
    const trigger = triggers.at(0);
    if (triggers.length !== 1 || !trigger) {
        throw new ExternalError(code.l10n.t('Function metadata must include exactly one trigger binding.'));
    }
    return {
        triggerKind: trigger.type,
        authLevel: trigger.type.toLowerCase() === 'httptrigger' && typeof trigger.authLevel === 'string'
            ? trigger.authLevel.toLowerCase() : undefined,
        isDisabled: 'disabled' in config && config.disabled === true,
    };
}
