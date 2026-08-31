/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import type { RedactionPolicy } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';

/**
 * Collection identifier every product binds its properties adapters to.
 *
 * Bindings are gathered by the View Properties command, which dispatches to the first adapter whose
 * {@linkcode PropertiesAdapter.canHandle canHandle} accepts the selected node. Order is therefore
 * significant and follows product registration order, so the generic ARM adapter is bound from the
 * last-registered product and only ever runs when no product claimed the node.
 */
export const IPropertiesAdapter: ServiceIdentifier<PropertiesAdapter> = Symbol.for('IPropertiesAdapter');

/**
 * Per-product access to the live properties of a tree node.
 *
 * A node's properties are served by at most one adapter. Implementations own everything
 * product-specific: which nodes they serve, and how to fetch the payload. The command that opens
 * the document never branches on node type itself.
 *
 * @remarks
 * Redaction is **declared**, not performed. An adapter states what its source may leak through
 * {@linkcode PropertiesAdapter.redact redact} and the command applies it; an adapter that redacted
 * by hand could get it subtly wrong. It is on by default, so an adapter written without a thought
 * for secrets is safe -- opting out is the part you have to mean.
 */
export interface PropertiesAdapter<TNode extends ConcreteAzureNode = ConcreteAzureNode> {
    /**
     * Whether this adapter serves the given node.
     *
     * A type guard so {@linkcode PropertiesAdapter.read read} can take the narrowed node without
     * re-checking or casting.
     */
    canHandle(node: ConcreteAzureNode): node is TNode;

    /**
     * Fetch the node's current properties, as the object to be serialized.
     *
     * Return the payload verbatim. Trimming it to what looks interesting hides exactly the field
     * the user opened this to find, and withholding secrets is
     * {@linkcode PropertiesAdapter.redact redact}'s job.
     */
    read(node: TNode): Promise<unknown>;

    /**
     * What this adapter's source may return that must not be shown.
     *
     * Omit it to get the default screen over property names and values. Set `{ alsoRedact }` to add
     * names specific to this payload, or `false` to open the payload unchanged -- which is a claim
     * that the source cannot return a credential, not a statement that none was noticed.
     */
    readonly redact?: RedactionPolicy;
}
