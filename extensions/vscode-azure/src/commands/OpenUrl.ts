/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ManagedCommand } from './ManagedCommand';

/** Resolves a URL from the arguments supplied by VS Code when a command is invoked. */
export type OpenUrlResolver = (...args: unknown[]) => string | undefined | Promise<string | undefined>;

/** A fixed URL or a resolver for a URL derived from the selected item. */
export type OpenUrlSource = string | OpenUrlResolver;

/**
 * Opens a fixed or dynamically resolved URL in the system's external browser.
 *
 * Register the URL source as a prefix argument so every URL-only command shares
 * managed-command telemetry, error handling, and unavailable-URL behavior.
 */
@injectable()
export class OpenUrl implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /** @inheritdoc */
    public async execute(source: OpenUrlSource, ...args: unknown[]): Promise<void> {
        const url = typeof source === 'string' ? source : await source(...args);
        if (!url) {
            throw new Error(this.code.l10n.t('No URL is available for the selected item.'));
        }

        await this.code.env.openExternal(this.code.Uri.parse(url));
    }
}
