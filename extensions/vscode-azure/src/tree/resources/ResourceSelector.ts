/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNodeType, isGenericResource, resourceExperience, type ConcreteAzureNode, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { getLastPick, IActionExecutor, ICodeContext, IOutputChannel, RecursivePickStep, Wizard, type PickContext } from '@microsoft/vscode-azure-utils';
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
     * Resolves a matching node from a tree-item key, or prompts the user to
     * navigate to one when invoked without a key.
     */
    public async selectNode<TNode extends ConcreteAzureNode>(options: NarrowingResolveOptions<TNode>): Promise<TNode> {
        if (options.key) {
            return this.resolve(options);
        }

        const result = await new Wizard<PickContext<string>>(
            this.output,
            {},
            [new RecursivePickStep({
                ...this.ctx,
                tree: this.viewTree,
                title: this.ctx.code.l10n.t('Select Resource'),
                classify: key => {
                    const node = this.cache.get(key);
                    return node && options.canHandle(node) ? 'terminal' : 'intermediate';
                },
            })],
        ).run();

        return this.resolve({ ...options, key: getLastPick(result)?.item });
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
    public async select<T extends GenericResource>(logicalType: string, key?: string): Promise<T> {
        if (key) {
            const notFound = this.ctx.code.l10n.t('Resource not found in the resources view. Try refreshing the resources view and running the command again.');
            return this.resolve({
                key,
                canHandle: (node): node is GenericResource => isGenericResource(node) && node.logicalType.toLowerCase() === logicalType.toLowerCase(),
                messages: { missingNode: notFound, invalidNode: notFound },
            }) as T;
        }

        const resource = await resourceExperience<T>({
            ...this.ctx,
            tree: this.viewTree,
            dataItemTree: this.cache,
            logicalType,
            output: this.output,
        });

        this.executor.setTelProp('nodeType', getNodeType(resource));
        return resource;
    }

    /**
     * Waits for background enrichment to complete on a previously
     * resolved resource. Enrichment populates additional properties
     * that require extra API calls (e.g. ACR `loginServer`, `sku`).
     *
     * @param resource - A resource previously returned by
     *   {@linkcode select}, {@linkcode resolve}, or {@linkcode tryResolve}.
     * @returns The same resource object, now with enriched properties
     *   populated.
     */
    public async whenEnriched<T extends GenericResource>(resource: GenericResource): Promise<T> {
        return this.cache.whenEnriched<T>(resource);
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
