/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, isGenericResource, isVirtualResource, nodeExperience, resourceExperience, type ConcreteAzureNode, type GenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';

/** Service identifier for {@linkcode ResourceSelector}. */
export const IResourceSelector: ServiceIdentifier<IResourceSelector> = Symbol.for('IResourceSelector');
export type IResourceSelector = ResourceSelector;

/**
 * Per-failure message overrides, so each command keeps its own wording rather
 * than sharing one generic message.
 */
export interface ResolveMessages {
    /** Used when the command was invoked without a tree-item key. */
    readonly missingKey?: string;
    /** Used when the key is no longer present in the data cache. */
    readonly missingNode?: string;
    /** Used when the key resolves to a node that the command cannot act on. */
    readonly invalidNode?: string;
}

/** Options for {@linkcode ResourceSelector.resolve} and {@linkcode ResourceSelector.tryResolve}. */
export interface ResolveOptions {
    /** Tree-item key supplied by the invocation, or `undefined` when there was none. */
    readonly key: string | undefined;

    /**
     * Rejects nodes the caller cannot act on. Supply a type guard (see
     * {@linkcode NarrowingResolveOptions}) to have the resolved node narrowed
     * to that type as well.
     */
    readonly canHandle?: (node: ConcreteAzureNode) => boolean;

    /** Message overrides used when resolution fails. */
    readonly messages?: ResolveMessages;
}

/**
 * {@linkcode ResolveOptions} whose {@linkcode ResolveOptions.canHandle canHandle}
 * is a type guard, which is what lets the resolver return {@linkcode TNode}.
 *
 * Narrowing is offered only through this shape, so a caller cannot ask for a
 * node type without also supplying the check that proves it.
 */
export interface NarrowingResolveOptions<TNode extends ConcreteAzureNode> extends ResolveOptions {
    readonly canHandle: (node: ConcreteAzureNode) => node is TNode;
}

/** Options for selecting a virtual resource from a key or through the resource tree. */
export interface SelectVirtualOptions<TNode extends VirtualResource> extends Omit<NarrowingResolveOptions<TNode>, 'canHandle'> {
    readonly canHandle: (node: VirtualResource) => node is TNode;
}

/** Outcome of a key lookup: either the node, or why there isn't one. */
type ResolveResult = { readonly node: ConcreteAzureNode } | { readonly failure: ResolveFailure };
type ResolveFailure = keyof ResolveMessages;

/**
 * Resolves an Azure resource either from the data cache (when a tree-item
 * key is provided) or by prompting the user with a resource picker.
 *
 * Replaces the repeated pattern of injecting {@linkcode ICodeContext},
 * {@linkcode IOutputChannel}, {@linkcode IAzureViewDataTree}, and
 * {@linkcode IAzureViewViewItemTree} into every command that needs to
 * resolve a resource.
 *
 * Commands differ in what they do when a key cannot be resolved -- some report
 * an error, some silently do nothing -- so that policy is the caller's choice
 * between {@linkcode resolve} and {@linkcode tryResolve} rather than a flag.
 *
 * Every successful resolution records the node's type in the telemetry of the
 * action that is currently running, so no command has to remember to.
 */
@injectable()
export class ResourceSelector {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewTree: IAzureViewViewItemTree,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) { }

    /**
     * Resolves the node a tree key points at, narrowed by
     * {@linkcode NarrowingResolveOptions.canHandle canHandle}.
     *
     * @throws If the key is absent, no longer in the data cache, or resolves to
     *   a node `canHandle` rejects. Use {@linkcode tryResolve} instead when the
     *   command should quietly do nothing in those cases.
     */
    public resolve<TNode extends ConcreteAzureNode>(options: NarrowingResolveOptions<TNode>): TNode;
    public resolve(options: ResolveOptions): ConcreteAzureNode;
    public resolve(options: ResolveOptions): ConcreteAzureNode {
        const result = this.find(options);
        if ('failure' in result) {
            throw new Error(this.describe(result.failure, options.messages));
        }

        return result.node;
    }

    /**
     * Same lookup as {@linkcode resolve}, for commands that treat an
     * unresolvable key as nothing to do.
     *
     * @returns The resolved node, or `undefined` if the key is absent, stale,
     *   or rejected by {@linkcode NarrowingResolveOptions.canHandle canHandle}.
     *   {@linkcode ResolveOptions.messages messages} is unused here, since
     *   nothing is reported.
     */
    public tryResolve<TNode extends ConcreteAzureNode>(options: NarrowingResolveOptions<TNode>): TNode | undefined;
    public tryResolve(options: ResolveOptions): ConcreteAzureNode | undefined;
    public tryResolve(options: ResolveOptions): ConcreteAzureNode | undefined {
        const result = this.find(options);
        return 'failure' in result ? undefined : result.node;
    }

    /**
     * Resolves a resource of type {@linkcode T}.
     *
     * @param logicalType - The logical resource type to filter on
     *   (e.g. {@linkcode AcrResourceType}). Both paths honor it: the picker
     *   offers only resources of this type, and a `key` naming a resource of
     *   any other type is rejected. Compared case-insensitively.
     * @param key - Optional tree-item key. When provided, the resource
     *   is looked up directly from the data cache. When omitted, the
     *   user is prompted to pick a resource via a quick-pick wizard.
     * @returns The resolved resource.
     * @throws If `key` is provided but does not identify a resource of
     *   `logicalType` in the data cache (e.g. stale tree item or invalid
     *   invocation), or if the user cancels the picker when `key` is not
     *   provided.
     */
    public async selectResource<T extends GenericResource>(logicalType: string, key?: string): Promise<T> {
        const notFound = this.ctx.code.l10n.t('Resource not found in the resources view. Try refreshing the resources view and running the command again.');
        return this.selectOrPrompt({
            key,
            canHandle: (node): node is GenericResource => isGenericResource(node) && node.logicalType.toLowerCase() === logicalType.toLowerCase(),
            messages: { missingNode: notFound, invalidNode: notFound },
        }, () => resourceExperience<T>({
            ...this.ctx,
            tree: this.viewTree,
            dataItemTree: this.cache,
            logicalType,
            output: this.output,
        })) as Promise<T>;
    }

    /**
     * Resolves a virtual resource from a tree-item key, or prompts the user to
     * navigate through containers in the resource tree to a matching node.
     */
    public async selectVirtual<TNode extends VirtualResource>(options: SelectVirtualOptions<TNode>): Promise<TNode> {
        const canHandle = (node: ConcreteAzureNode): node is TNode =>
            isVirtualResource(node) && options.canHandle(node);

        return this.selectOrPrompt(
            { ...options, canHandle },
            () => nodeExperience({
                ...this.ctx,
                tree: {
                    getChildren: async key => {
                        const parent = key ? this.cache.get(key) : undefined;
                        if (parent) {
                            await this.cache.loadAll(parent);
                        }

                        return this.viewTree.getChildren(key);
                    },
                    getTreeItem: key => this.viewTree.getTreeItem(key),
                },
                dataItemTree: this.cache,
                output: this.output,
                title: this.ctx.code.l10n.t('Select Resource'),
                canHandle,
                classify: (_key, treeItem, node) => {
                    if (node && canHandle(node)) {
                        return 'terminal';
                    }

                    return treeItem.collapsibleState === this.ctx.code.TreeItemCollapsibleState.Collapsed
                        || treeItem.collapsibleState === this.ctx.code.TreeItemCollapsibleState.Expanded
                        ? 'intermediate'
                        : false;
                },
            }),
        );
    }

    /**
     * Waits for background enrichment to complete on a previously
     * resolved resource. Enrichment populates additional properties
     * that require extra API calls (e.g. ACR `loginServer`, `sku`).
     *
     * @param resource - A resource previously returned by
     *   {@linkcode selectResource}, {@linkcode resolve}, or {@linkcode tryResolve}.
     * @returns The same resource object, now with enriched properties
     *   populated.
     */
    public async whenEnriched<T extends GenericResource>(resource: GenericResource): Promise<T> {
        return this.cache.whenEnriched<T>(resource);
    }

    /** Resolves a supplied key or runs the picker for a command-palette invocation. */
    private async selectOrPrompt<TNode extends ConcreteAzureNode>(
        options: NarrowingResolveOptions<TNode>,
        prompt: () => Promise<TNode>,
    ): Promise<TNode> {
        if (options.key) {
            return this.resolve(options);
        }

        const node = await prompt();
        this.executor.setTelProp('nodeType', getNodeType(node));
        return node;
    }

    /** Look the key up in the data cache and check the caller can act on what it finds. */
    private find(options: ResolveOptions): ResolveResult {
        if (!options.key) {
            return { failure: 'missingKey' };
        }

        const node = this.cache.get(options.key);
        if (!node) {
            return { failure: 'missingNode' };
        }

        if (options.canHandle && !options.canHandle(node)) {
            return { failure: 'invalidNode' };
        }

        this.executor.setTelProp('nodeType', getNodeType(node));
        return { node };
    }

    /** The caller's message for this failure, or a generic one. */
    private describe(failure: ResolveFailure, messages: ResolveMessages | undefined): string {
        const message = messages?.[failure];
        if (message) {
            return message;
        }

        switch (failure) {
            case 'missingKey':
                return this.ctx.code.l10n.t('Select an Azure resource and run the command again.');
            case 'missingNode':
                return this.ctx.code.l10n.t('The selected Azure resource is no longer available. Refresh the view and try again.');
            case 'invalidNode':
                return this.ctx.code.l10n.t('The selected item does not support this command.');
        }
    }

}
