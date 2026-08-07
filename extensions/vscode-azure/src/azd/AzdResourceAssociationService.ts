/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isResourceGroup, parseAzureResourceId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { AzdEnvNameTag } from '../constants';
import { IAzureViewDataTree, type IAzureViewDataTree as AzureViewDataTree } from '../services';
import { IAzdService } from './AzdService';

export const IAzdResourceAssociationService: ServiceIdentifier<IAzdResourceAssociationService> = Symbol.for('IAzdResourceAssociationService');

/** A local azd project associated with an Azure resource. */
export interface AzdResourceAssociation {
    /** The project's `azure.yaml` or `azure.yml`. */
    readonly azureYamlUri: vscode.Uri;
    /** The azd environment whose values matched the Azure target. */
    readonly environmentName: string;
}

/** Finds the local azd project that owns an Azure resource or resource group. */
export interface IAzdResourceAssociationService {
    /**
     * Returns the matching azd project YAML, or `undefined` when the target
     * cannot be associated unambiguously with a local environment.
     *
     * Discovery is fresh for each call. Errors from azd are allowed to
     * propagate so an unavailable or malformed environment is not mistaken
     * for a clean no-match result.
     */
    find(resource: GenericResource): Promise<AzdResourceAssociation | undefined>;
}

const SubscriptionValue = 'AZURE_SUBSCRIPTION_ID';
const ResourceGroupValue = 'AZURE_RESOURCE_GROUP';

/**
 * Associates ARM targets with local azd environments using the ownership tag
 * emitted by azd and the environment's subscription and resource group.
 */
@injectable()
export class AzdResourceAssociationService implements IAzdResourceAssociationService {
    public constructor(
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IAzureViewDataTree) private readonly dataTree: AzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async find(resource: GenericResource): Promise<AzdResourceAssociation | undefined> {
        const parsed = parseAzureResourceId(resource.id);
        if (!parsed.resourceGroup) {
            return undefined;
        }

        const environmentName = this.getEnvironmentName(resource);
        if (!environmentName) {
            return undefined;
        }

        const projects = await this.findProjects();
        for (const project of projects) {
            const environments = (await this.azd.envList(project.folderUri)).slice().sort((left, right) => compareText(left.Name, right.Name));
            for (const environment of environments) {
                if (!equalsIgnoreCase(environment.Name, environmentName)) {
                    continue;
                }

                const values = await this.azd.envGetValues(environment.Name, project.folderUri);
                if (equalsIgnoreCase(values[SubscriptionValue], parsed.subscriptionId)
                    && equalsIgnoreCase(values[ResourceGroupValue], parsed.resourceGroup)) {
                    return { azureYamlUri: project.azureYamlUri, environmentName: environment.Name };
                }
            }
        }

        return undefined;
    }

    private getEnvironmentName(resource: GenericResource): string | undefined {
        const directTag = getTagValue(resource.tags, AzdEnvNameTag);
        if (directTag !== undefined || isResourceGroup(resource)) {
            return directTag || undefined;
        }

        const parentId = AzureNodeId.from(resource).parentNodeId();
        const parent = parentId ? this.dataTree.get(parentId.toString()) : undefined;
        return parent && isResourceGroup(parent)
            ? getTagValue(parent.tags, AzdEnvNameTag) || undefined
            : undefined;
    }

    private async findProjects(): Promise<AzdProject[]> {
        const yamlFiles = (await this.azd.findAzureYaml(undefined, Number.MAX_SAFE_INTEGER))
            .slice()
            .sort((left, right) => compareText(left.toString(), right.toString()));
        const projects = new Map<string, AzdProject>();

        for (const yamlFile of yamlFiles) {
            const folder = yamlFile.with({ path: yamlFile.path.replace(/\/[^/]*$/, '') || '/' });
            const key = folder.toString().toLowerCase();
            if (!projects.has(key)) {
                projects.set(key, { azureYamlUri: yamlFile, folderUri: folder });
            }
        }

        return [...projects.values()].sort((left, right) => compareText(left.folderUri.toString(), right.folderUri.toString()));
    }
}

interface AzdProject {
    readonly azureYamlUri: vscode.Uri;
    readonly folderUri: vscode.Uri;
}

function getTagValue(tags: Readonly<Record<string, string>> | undefined, name: string): string | undefined {
    if (!tags) {
        return undefined;
    }

    const key = Object.keys(tags).find(tagName => equalsIgnoreCase(tagName, name));
    return key === undefined ? undefined : tags[key];
}

function equalsIgnoreCase(left: string | undefined, right: string | undefined): boolean {
    return left !== undefined && left.toLowerCase() === right?.toLowerCase();
}

function compareText(left: string, right: string): number {
    const normalizedComparison = compareOrdinal(left.toLowerCase(), right.toLowerCase());
    return normalizedComparison || compareOrdinal(left, right);
}

function compareOrdinal(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
