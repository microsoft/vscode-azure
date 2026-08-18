/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { AzdEnvNameTag } from '../constants';
import { IWorkspaceIndexService } from '../utils/workspaceIndex/WorkspaceIndexService';
import { IAzdService } from './AzdService';
import { AzdProjectFileTag } from './azdWorkspaceDetector';

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
     * Targets without an {@linkcode AzdEnvNameTag} tag are rejected outright,
     * so the common case costs nothing: only tagged targets are worth probing
     * the local azd projects for.
     *
     * Project discovery uses the shared workspace index, which is kept current
     * by file watching. Errors from azd are allowed to propagate so an
     * unavailable or malformed environment is not mistaken for a clean
     * no-match result.
     */
    find(resource: GenericResource): Promise<AzdResourceAssociation | undefined>;
}

const SubscriptionValue = 'AZURE_SUBSCRIPTION_ID';
const ResourceGroupValue = 'AZURE_RESOURCE_GROUP';

/**
 * Associates ARM targets with local azd environments using the ownership tag
 * emitted by azd and the environment's subscription and resource group.
 *
 * Only targets carrying the tag can be associated, so an untagged resource is
 * rejected before any `azd` process is spawned.
 */
@injectable()
export class AzdResourceAssociationService implements IAzdResourceAssociationService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
    ) { }

    /** @inheritdoc */
    public async find(resource: GenericResource): Promise<AzdResourceAssociation | undefined> {
        const environmentName = getTagValue(resource.tags, AzdEnvNameTag);
        if (!environmentName) {
            return undefined;
        }

        const parsed = parseAzureResourceId(resource.id);
        if (!parsed.resourceGroup) {
            return undefined;
        }

        const projects = await this.findProjects();
        const matches = new Map<string, AzdResourceAssociation>();
        for (const project of projects) {
            const environments = (await this.azd.envList(project.folderUri)).slice().sort((left, right) => compareText(left.Name, right.Name));
            for (const environment of environments) {
                if (!equalsIgnoreCase(environment.Name, environmentName)) {
                    continue;
                }

                const values = await this.azd.envGetValues(environment.Name, project.folderUri);
                if (equalsIgnoreCase(values[SubscriptionValue], parsed.subscriptionId)
                    && equalsIgnoreCase(values[ResourceGroupValue], parsed.resourceGroup)) {
                    const key = `${project.folderUri.toString().toLowerCase()}\0${environment.Name.toLowerCase()}`;
                    matches.set(key, { azureYamlUri: project.azureYamlUri, environmentName: environment.Name });
                }
            }
        }

        return matches.size === 1 ? matches.values().next().value : undefined;
    }

    private async findProjects(): Promise<AzdProject[]> {
        const index = await this.indexService.getIndex();
        const yamlFiles = index.withTag(AzdProjectFileTag);
        const projects = new Map<string, AzdProject>();

        for (const yamlFile of yamlFiles) {
            const folder = this.code.Uri.joinPath(yamlFile, '..');
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
