/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource, resourceExperience } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';

/** Service identifier for {@linkcode ResourceSelector}. */
export const IResourceSelector: ServiceIdentifier<IResourceSelector> = Symbol.for('IResourceSelector');
export type IResourceSelector = ResourceSelector;

/**
 * Resolves an Azure resource either from the data cache (when a tree-item
 * key is provided) or by prompting the user with a resource picker.
 *
 * Replaces the repeated pattern of injecting {@linkcode ICodeContext},
 * {@linkcode IOutputChannel}, {@linkcode IAzureViewDataTree}, and
 * {@linkcode IAzureViewViewItemTree} into every command that needs to
 * resolve a resource.
 */
@injectable()
export class ResourceSelector {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewTree: IAzureViewViewItemTree,
    ) { }

    /**
     * Resolves and validates a tree item by its data-cache key.
     *
     * @throws If no key is supplied, the key is stale, or the item does not
     * satisfy {@linkcode guard}.
     */
    public resolve<T>(key: string | undefined, guard: (resource: unknown) => resource is T): T {
        if (!key) {
            throw new Error(this.ctx.code.l10n.t('Run this command from a supported item in the Resources view.'));
        }

        const resource = this.cache.get(key);
        if (!resource) {
            throw new Error(this.ctx.code.l10n.t('Resource not found in the resources view. Try refreshing the resources view and running the command again.'));
        } else if (!guard(resource)) {
            throw new Error(this.ctx.code.l10n.t('The selected item does not support this command.'));
        }
        return resource;
    }

    /**
     * Resolves a resource of type {@linkcode T}.
     *
     * @param logicalType - The logical resource type to filter on
     *   (e.g. {@linkcode AcrResourceType}).
     * @param key - Optional tree-item key. When provided, the resource
     *   is looked up directly from the data cache. When omitted, the
     *   user is prompted to pick a resource via a quick-pick wizard.
     * @returns The resolved resource.
     * @throws If `key` is provided but the resource is not found in the
     *   data cache (e.g. stale tree item or invalid invocation), or if
     *   the user cancels the picker when `key` is not provided.
     */
    public async select<T extends GenericResource>(logicalType: string, key?: string): Promise<T> {
        if (key) {
            const resource = this.cache.get(key);
            if (!resource) {
                throw new Error(this.ctx.code.l10n.t('Resource not found in the resources view. Try refreshing the resources view and running the command again.'));
            }
            return resource as T;
        }

        return resourceExperience<T>({
            ...this.ctx,
            tree: this.viewTree,
            dataItemTree: this.cache,
            logicalType,
            output: this.output,
        });
    }

    /**
     * Waits for background enrichment to complete on a previously
     * resolved resource. Enrichment populates additional properties
     * that require extra API calls (e.g. ACR `loginServer`, `sku`).
     *
     * @param resource - A resource previously returned by
     *   {@linkcode select}.
     * @returns The same resource object, now with enriched properties
     *   populated.
     */
    public async whenEnriched<T extends GenericResource>(resource: GenericResource): Promise<T> {
        return this.cache.whenEnriched<T>(resource);
    }
}
