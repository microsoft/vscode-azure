/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject } from 'inversify';
import { IPropertiesContentProvider } from '../../properties/PropertiesContentProvider';
import { IPropertiesAdapter, type PropertiesAdapter } from '../../properties/PropertiesAdapter';
import { applyRedaction } from '../../properties/redactSecrets';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens the live properties of the selected tree node as a JSON document.
 *
 * What a node's properties *are* is the only product-specific part, and it lives in a
 * {@linkcode PropertiesAdapter}. This command owns everything else: resolving the selection,
 * choosing the adapter, honoring the adapter's redaction declaration, and presenting the result.
 * Adding a product therefore means binding one adapter, not writing another command.
 *
 * Dispatch is first-match-wins over the bound adapters in product registration order, so a product
 * that claims a node takes precedence over the generic ARM adapter registered last.
 *
 * The document is readonly and unsaved: this is a read of the current state, not a thing to
 * edit. Anything that should be editable belongs in the settings editor instead.
 */
@injectable()
export class ViewProperties implements ManagedCommand {
    /** Context value gating this command's visibility in the resource tree. */
    public static readonly ContextValue = 'viewProperties';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IPropertiesContentProvider) private readonly contentProvider: IPropertiesContentProvider,
        @multiInject(IPropertiesAdapter) private readonly adapters: readonly PropertiesAdapter[],
    ) { }

    /**
     * @inheritdoc
     * @throws if the key is missing, stale, or identifies a node no adapter serves.
     * @throws if the adapter's read fails.
     */
    public async execute(key?: string): Promise<void> {
        const node = this.resolve(key);
        this.context.telemetry.properties.nodeType = getNodeType(node);

        const adapter = this.adapters.find(candidate => candidate.canHandle(node));
        if (!adapter) {
            throw new Error(this.ctx.code.l10n.t('The selected item does not have properties to view.'));
        }

        const properties = applyRedaction(adapter.redact, await adapter.read(node));

        // `preview: true` keeps quick inspections to one tab while the content provider keeps the
        // JSON readonly.
        const document = await this.contentProvider.openTextDocument(JSON.stringify(properties, undefined, 4));
        await this.ctx.code.window.showTextDocument(document, { preview: true });
    }

    /** Look up the selected node, which any adapter may then claim. */
    private resolve(key: string | undefined): ConcreteAzureNode {
        if (!key) {
            throw new Error(this.ctx.code.l10n.t('Select an Azure resource to view its properties.'));
        }

        const node = this.dataTree.get(key);
        if (!node) {
            throw new Error(this.ctx.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.'));
        }

        return node;
    }
}
