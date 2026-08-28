/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NoWorkspaceLocationError, showSmartInputBox, type IActionContext, type ICodeContext } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { parseDocument } from 'yaml';

/** Telemetry taxonomy retained from the source location prompts. */
export type StaticWebAppLocationClassification = 'empty' | 'default' | 'setting' | 'nonDefault';

/**
 * Adds source-compatible classification and setting-match telemetry without
 * recording the user-entered path itself.
 */
export function addLocationTelemetry(
    context: IActionContext,
    key: 'appLocation' | 'apiLocation' | 'outputLocation',
    value: string | undefined,
    defaultValue: string,
    valueFromSetting?: string,
): void {
    context.telemetry.properties[`${key}HasSetting`] = String(!!valueFromSetting);
    context.telemetry.properties[`${key}MatchesSetting`] = String(defaultValue === valueFromSetting);
    if (value === undefined) {
        return;
    }

    let classification: StaticWebAppLocationClassification;
    if (value.length === 0) {
        classification = 'empty';
    } else if (value === defaultValue) {
        classification = 'default';
    } else if (value === valueFromSetting) {
        classification = 'setting';
    } else {
        classification = 'nonDefault';
    }
    context.telemetry.properties[key] = classification;
}

/**
 * Verifies that a path round-trips when embedded as the quoted scalar used by
 * Static Web Apps workflow YAML.
 */
export function isYamlSafeLocation(value: string, key: 'app_location' | 'api_location' | 'output_location'): boolean {
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 10 || code === 13) {
            return false;
        }
    }
    const document = parseDocument(`${key}: "${value}"`);
    return document.errors.length === 0 && document.get(key) === value;
}

/** Whether current azd can deploy the selected output as a distinct artifact directory. */
export function canAzdDeployStaticWebApp(outputLocation: string): boolean {
    const normalized = outputLocation.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0 && normalized !== '/' && normalized !== '.';
}

/**
 * Returns the folder a location picker measures against, once it is known to sit
 * inside an open workspace folder.
 *
 * @throws {@linkcode NoWorkspaceLocationError} when the project folder is unknown
 *   or lies outside the workspace, so the caller falls back to a typed path
 *   rather than offering a picker that can only produce candidates the workspace
 *   cannot express.
 */
export function requireWorkspaceBase(ctx: ICodeContext, folder: vscode.Uri | undefined): vscode.Uri {
    if (!folder || !ctx.code.workspace.getWorkspaceFolder(folder)) {
        throw new NoWorkspaceLocationError(ctx.code.l10n.t('Open the project folder before selecting a location.'));
    }
    return folder;
}

/** Prompts for a Static Web Apps path that survives the workflow YAML it is written into. */
export async function promptForYamlSafeLocation(
    ctx: ICodeContext,
    options: {
        readonly key: 'app_location' | 'api_location' | 'output_location';
        readonly value: string;
        readonly prompt: string;
        /** Rejects values the key disallows beyond YAML safety. */
        readonly validate?: (input: string) => string | undefined;
    },
): Promise<string> {
    return (await showSmartInputBox(ctx, {
        value: options.value,
        prompt: options.prompt,
        showBack: true,
        validateInput: input => options.validate?.(input)
            ?? (isYamlSafeLocation(input, options.key)
                ? undefined
                : ctx.code.l10n.t('Enter a value that is safe to use in YAML.')),
    })).trim();
}

/**
 * Wraps an async derivation so every option resolver of one prompt shares a
 * single evaluation, keyed on the context the wizard passes in. A later prompt
 * of the same step receives a rebuilt context and so re-derives.
 */
export function derivePerPrompt<TContext extends object, TValue>(
    derive: (context: TContext) => Promise<TValue>,
): (context: TContext) => Promise<TValue> {
    const derived = new WeakMap<TContext, Promise<TValue>>();
    return context => {
        let pending = derived.get(context);
        if (!pending) {
            pending = derive(context);
            derived.set(context, pending);
        }
        return pending;
    };
}
