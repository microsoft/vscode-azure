/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable, type ServiceIdentifier } from 'inversify';
import type { ManagedCommand } from './ManagedCommand';

/** Resolves a URL from the arguments supplied by VS Code when a command is invoked. */
export type OpenUrlResolver = (...args: unknown[]) => string | undefined | Promise<string | undefined>;

/**
 * Resolves a URL using services from the command's execution container.
 *
 * Use this instead of {@linkcode OpenUrlResolver} when the URL cannot be derived
 * from the command arguments alone (for example, when it requires an Azure client).
 */
export interface UrlProvider {
    getUrl(...args: unknown[]): string | undefined | Promise<string | undefined>;
}

/**
 * Identifier for a {@linkcode UrlProvider} binding.
 *
 * Constrained to a symbol so {@linkcode OpenUrl} can tell it apart from an
 * {@linkcode OpenUrlResolver} function at runtime.
 */
export type UrlProviderIdentifier = ServiceIdentifier<UrlProvider> & symbol;

/**
 * A fixed URL, a resolver for a URL derived from the selected item, or the
 * identifier of a {@linkcode UrlProvider} resolved from the execution container.
 */
export type OpenUrlSource = string | OpenUrlResolver | UrlProviderIdentifier;

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
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(source: OpenUrlSource, ...args: unknown[]): Promise<void> {
        const url = await this.resolveUrl(source, args);
        if (!url) {
            throw new Error(this.code.l10n.t('No URL is available for the selected item.'));
        }

        await this.code.env.openExternal(this.code.Uri.parse(url));
    }

    private async resolveUrl(source: OpenUrlSource, args: unknown[]): Promise<string | undefined> {
        if (typeof source === 'string') {
            return source;
        }

        if (typeof source === 'symbol') {
            return await this.container.get(source).getUrl(...args);
        }

        return await source(...args);
    }
}
