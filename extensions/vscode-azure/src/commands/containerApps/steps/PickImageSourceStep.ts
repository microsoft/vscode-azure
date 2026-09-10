/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IAcrRepositoryClientProvider, IResourceClientProvider,
    type AzureSubscription, type GenericResource,
} from '@microsoft/vscode-azure-azutils';
import {
    ICodeContext, IOutputChannel, IVsCode, PromptStep, showSmartQuickPick, stringifyError, withDelayedProgress,
    type QuickPickItemWithData,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AcrResourceType } from '../../../tree/resources/acr/AcrRegistry';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/** Image reference and the optional ACR that needs managed-identity pull access. */
type ImageItem = QuickPickItemWithData<Pick<CreateContainerAppContext, 'imageName' | 'imageRegistryId'>>;

/**
 * Picks the container image to deploy.
 *
 * Presented as a combo box rather than the source extension's registry-kind ->
 * registry -> repository -> tag chain: the images in the user's own registries
 * are offered as suggestions, and anything else -- an image on Docker Hub, a
 * third-party registry, a tag that does not exist yet -- is typed directly.
 * That collapses four prompts into one and removes the need for a separate
 * "other registry" surface.
 */
@injectable()
export class PickImageSourceStep extends PromptStep<CreateContainerAppContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IResourceClientProvider) private readonly createResourceClient: IResourceClientProvider,
        @inject(IAcrRepositoryClientProvider) private readonly createRepositoryClient: IAcrRepositoryClientProvider,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateContainerAppContext>): boolean {
        // Only the `createNew` job deploys a pre-existing image. On `deploy`,
        // azd builds and pushes from the workspace, so asking which image to run
        // would be asking about something that does not exist yet.
        return context.job === 'createNew'
            && context.imageName === undefined
            && !context.hasInfra;
    }

    public async prompt(context: Readonly<CreateContainerAppContext>): Promise<Partial<CreateContainerAppContext>> {
        const registries = context.subscription ? await this.listRegistries(context.subscription) : [];
        const suggestions = context.subscription
            ? await this.loadSuggestions(context.subscription, registries)
            : [];

        const quickstart: ImageItem = {
            label: this.code.l10n.t('Use quickstart image'),
            description: this.code.l10n.t('Create an app with the default sample image'),
            data: { imageName: undefined, imageRegistryId: undefined },
        };
        const picked = await showSmartQuickPick<ImageItem>(this.ctx, [quickstart, ...suggestions], {
            placeHolder: this.code.l10n.t('Select or enter a container image'),
            // Any registry reference is accepted, so the user is never blocked
            // by a registry this extension cannot enumerate.
            createItemFromValue: (value: string) => value ? {
                label: value,
                description: this.code.l10n.t('Use the image you typed'),
                data: {
                    imageName: value,
                    imageRegistryId: registries.find(registry => context.subscription?.environment
                        .containerRegistryEndpoint(registry.name)
                        .replace(/^https:\/\//, '').toLowerCase() === value.split('/')[0].toLowerCase())?.id,
                },
            } : undefined,
            showBack: true,
        });

        return picked.data;
    }

    /** Lists the images in the subscription's container registries. */
    private async loadSuggestions(subscription: AzureSubscription, registries: GenericResource[]): Promise<ImageItem[]> {
        return withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Loading container images...'),
            },
            this.listImages(subscription, registries),
        );
    }

    private async listImages(subscription: AzureSubscription, registries: GenericResource[]): Promise<ImageItem[]> {
        // One registry failing (no pull permission, a firewall rule) must not
        // hide the images in every other registry, so each is settled
        // independently and failures degrade to no suggestions.
        const perRegistry = await Promise.all(registries.map(async registry => {
            const loginServer = subscription.environment
                .containerRegistryEndpoint(registry.name)
                .replace(/^https:\/\//, '');

            try {
                const client = this.createRepositoryClient(subscription, loginServer);
                const repositories = await client.listRepositoryTags();

                return repositories.flatMap(({ repository, tags }) => tags.map(tag => ({
                    label: `${loginServer}/${repository}:${tag}`,
                    description: registry.name,
                    data: { imageName: `${loginServer}/${repository}:${tag}`, imageRegistryId: registry.id },
                } satisfies ImageItem)));
            } catch (error) {
                this.output.debug(`[containerApps] could not list images in ${registry.name}: ${stringifyError(error)}`);
                return [];
            }
        }));

        return perRegistry.flat();
    }

    private async listRegistries(subscription: AzureSubscription): Promise<GenericResource[]> {
        try {
            const client = this.createResourceClient(subscription);
            const registries: GenericResource[] = [];

            // Filtered server-side so a subscription with thousands of resources
            // does not have to be paged through to find a handful of registries.
            const pages = client.resources.list({ filter: `resourceType eq '${AcrResourceType}'` });

            for await (const page of pages) {
                registries.push(...page.items);
            }

            return registries;
        } catch (error) {
            this.output.debug(`[containerApps] could not list container registries: ${stringifyError(error)}`);
            return [];
        }
    }
}
