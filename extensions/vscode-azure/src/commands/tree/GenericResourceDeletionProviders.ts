/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IResourceClientProvider,
    isGenericResource,
    isResourceGroup,
    type ConcreteAzureNode,
} from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ResourceDeletionPlan, ResourceDeletionProvider } from '../../registration/ResourceDeletionProvider';

/** Generic ARM deletion fallback for concrete resources. */
@injectable()
export class GenericResourceDeletionProvider implements ResourceDeletionProvider {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: ConcreteAzureNode): boolean {
        return isGenericResource(resource);
    }

    /** @inheritdoc */
    public getPlan(resource: ConcreteAzureNode): ResourceDeletionPlan {
        if (!isGenericResource(resource)) {
            throw new Error('GenericResourceDeletionProvider requires an ARM resource.');
        }

        return {
            resourceName: resource.name,
            confirmation: {
                kind: 'modal',
                message: this.code.l10n.t('Are you sure you want to delete resource \'{0}\'? This cannot be undone.', resource.name),
            },
            delete: () => this.createClient(resource.subscription).resources.deleteById(resource.id),
            cacheTarget: resource,
            successMessage: this.code.l10n.t('Deleted resource \'{0}\'.', resource.name),
            azdTarget: resource,
            telemetryType: 'genericArmResource',
        };
    }
}

/** Generic ARM deletion fallback for resource groups. */
@injectable()
export class GenericResourceGroupDeletionProvider implements ResourceDeletionProvider {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: ConcreteAzureNode): boolean {
        return isResourceGroup(resource);
    }

    /** @inheritdoc */
    public getPlan(resource: ConcreteAzureNode): ResourceDeletionPlan {
        if (!isResourceGroup(resource)) {
            throw new Error('GenericResourceGroupDeletionProvider requires a resource group.');
        }

        return {
            resourceName: resource.name,
            confirmation: {
                kind: 'typed',
                prompt: this.code.l10n.t('Type \'{0}\' to confirm deletion of this resource group and everything in it.', resource.name),
                expectedValue: resource.name,
            },
            delete: () => this.createClient(resource.subscription).resourceGroups.delete(resource.name),
            cacheTarget: resource,
            successMessage: this.code.l10n.t('Deleted resource group \'{0}\'.', resource.name),
            azdTarget: resource,
            telemetryType: 'genericResourceGroup',
        };
    }
}
