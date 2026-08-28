/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, parseAzureResourceId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isStaticWebAppEnvironment, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { PropertiesAdapter } from '../PropertiesAdapter';

/**
 * Reads a Static Web Apps environment's properties from the build behind it.
 *
 * An environment is a virtual node rather than a resource of its own, so
 * {@linkcode GenericArmPropertiesAdapter} does not claim it and its by-id ARM GET would not reach
 * the build anyway. What the user means by "this environment" -- its status, source branch,
 * hostname, and build configuration -- is the static site build, so that is what this reads.
 */
@injectable()
export class StaticWebAppEnvironmentPropertiesAdapter implements PropertiesAdapter<StaticWebAppEnvironment> {
    /**
     * @inheritdoc
     *
     * A build's own payload carries no credentials, so in practice this changes nothing today. It
     * is on as defense in depth, because the build response grows with the service and is the kind
     * of payload -- deployment and app configuration -- that a credential could appear in later.
     */
    public readonly redact = true;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(node: ConcreteAzureNode): node is StaticWebAppEnvironment {
        return isStaticWebAppEnvironment(node);
    }

    /**
     * @inheritdoc
     * @throws if the owning Static Web App's resource group cannot be determined, or if the build
     *   read fails.
     */
    public async read(node: StaticWebAppEnvironment): Promise<unknown> {
        const { resourceGroup } = parseAzureResourceId(node.azureResource.id);
        if (!resourceGroup) {
            throw new Error(this.ctx.code.l10n.t('Could not determine the resource group for the selected Static Web App.'));
        }

        return await this.createClient(node.azureResource.subscription).staticSites.getStaticSiteBuild(
            resourceGroup,
            node.azureResource.name,
            node.buildId,
        );
    }
}
