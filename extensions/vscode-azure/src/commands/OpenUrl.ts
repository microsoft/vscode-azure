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

/** The only schemes that may be handed to the system's external opener. */
const AllowedSchemes: readonly string[] = ['http', 'https'];

/**
 * Opens a fixed or dynamically resolved URL in the system's external browser.
 *
 * Register the URL source as a prefix argument so every URL-only command shares
 * managed-command telemetry, error handling, and unavailable-URL behavior.
 *
 * This is the extension's single choke point for external navigation: every URL
 * is checked against {@linkcode AllowedSchemes} immediately before it is opened,
 * independently of any validation a caller may already perform. VS Code does not
 * make that check for us -- `env.openExternal` rejects only the `command:` scheme
 * and an empty one, and its trusted-domain confirmation applies to `http(s)`
 * only, so schemes like `javascript:` or `file:` would otherwise be passed
 * straight to the OS.
 */
@injectable()
export class OpenUrl implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /**
     * @inheritdoc
     * @throws if no URL is available, or if it is not an `http(s)` URL.
     */
    public async execute(source: OpenUrlSource, ...args: unknown[]): Promise<void> {
        const url = typeof source === 'string' ? source : await source(...args);
        if (!url) {
            throw new Error(this.code.l10n.t('No URL is available for the selected item.'));
        }

        // Parse before checking: a scheme-less value such as a bare hostname is
        // not rejected by Uri.parse, it is silently reinterpreted as a file path.
        const uri = this.code.Uri.parse(url);
        if (!AllowedSchemes.includes(uri.scheme.toLowerCase())) {
            throw new Error(this.code.l10n.t('Only http and https links can be opened.'));
        }

        await this.code.env.openExternal(uri);
    }
}
