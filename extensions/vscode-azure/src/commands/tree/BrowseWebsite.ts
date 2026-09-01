/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { getWebsiteUrl } from '../../tree/resources/websiteUrl';
import type { ManagedCommand } from '../ManagedCommand';
import { OpenUrl } from '../OpenUrl';

/**
 * Opens the website of the selected Azure resource tree node.
 *
 * The URL itself is attached to the resource by its data provider during
 * enrichment, so this only has to read it back; any resource type can become
 * browsable simply by having its provider attach one.
 *
 * Unlike {@linkcode OpenInPortal}, this cannot be a bare {@linkcode OpenUrl}
 * resolver: the URL is not derivable from the node key alone, so the resource
 * has to be looked up in the data tree. Opening is still delegated to
 * {@linkcode OpenUrl} so browsing shares the standard URL-command behavior.
 */
@injectable()
export class BrowseWebsite implements ManagedCommand {
    /** Context value gating this command's visibility in the resource tree. */
    public static readonly ContextValue = 'browseWebsite';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(OpenUrl) private readonly openUrl: OpenUrl,
    ) { }

    /**
     * @inheritdoc
     * @throws if the selection is not an Azure resource, or if it has no
     *   website (either because its type has none, or because it has not been
     *   deployed yet).
     */
    public async execute(...args: unknown[]): Promise<void> {
        const [key] = args;
        const selectResource = this.code.l10n.t('Select an Azure resource with a website.');
        const resource = await this.selector.selectResource({
            key: typeof key === 'string' ? key : undefined,
            title: selectResource,
            messages: {
                missingKey: selectResource,
                missingNode: selectResource,
                invalidNode: selectResource,
            },
        });

        // Enrichment attaches the URL in the background, so a node can be acted
        // on before it lands. Awaiting the in-flight enrichment (a no-op when
        // none is pending) closes the common race.
        const url = getWebsiteUrl(await this.selector.whenEnriched(resource));
        if (!url) {
            throw new Error(this.code.l10n.t('The selected resource does not have a website.'));
        }

        await this.openUrl.execute(url);
    }
}
