/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isStaticWebAppEnvironment, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';

type PropertyNode = StaticWebAppEnvironment;

/** Opens current, sanitized environment properties as JSON. */
@injectable()
export class ViewStaticWebAppProperties implements ManagedCommand {
    /** Context value for environment, action, job, and step nodes. */
    public static readonly ContextValue = 'viewStaticWebAppProperties';

    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const node = this.selector.resolve(key, isStaticWebAppEnvironment);
        const properties = await this.getCurrentProperties(node);
        this.context.telemetry.properties.propertyType = node.virtualType;

        const document = await this.ctx.code.workspace.openTextDocument({
            content: JSON.stringify(sanitizeProperties(properties), null, 4),
            language: 'json',
        });
        await this.ctx.code.window.showTextDocument(document, { preview: true });
    }

    private getCurrentProperties(node: PropertyNode): Promise<unknown> {
        const { resourceGroup } = parseAzureResourceId(node.azureResource.id);
        if (!resourceGroup) {
            throw new Error(this.ctx.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }
        return this.createClient(node.azureResource.subscription).staticSites.getStaticSiteBuild(
            resourceGroup,
            node.azureResource.name,
            node.buildId,
        );
    }
}

function sanitizeProperties(value: unknown, seen = new WeakSet<object>()): unknown {
    if (!value || typeof value !== 'object') {
        return value;
    } else if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => sanitizeProperties(item, seen));
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !/(?:authorization|password|secret|token)/i.test(key))
            .map(([key, child]) => [key, sanitizeProperties(child, seen)]),
    );
}
