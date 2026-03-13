/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ITreeItem, IVsCode, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IActivityViewDataTree } from '../../services';
import type { ArmDeploymentActivity, ArmDeploymentOperationActivity } from './Activity';
import { toActivityTreeItem } from './ActivityViewProvider';
import { DeploymentResourceType, isVisibleOperation } from './ArmDeploymentDataProvider';

/**
 * View provider for ARM deployment activities. Handles both deployment
 * nodes (from the data tree) and leaf operation nodes (injected from
 * the deployment's enriched {@link ArmDeploymentActivity.operations}).
 */
@injectable()
export class ArmDeploymentViewProvider implements ViewProvider<string> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActivityViewDataTree) private readonly dataTree: IActivityViewDataTree,
    ) { }

    public canHandle(activityId: unknown): activityId is string {
        if (typeof activityId !== 'string') {
            return false;
        }

        // Match ARM deployment nodes in the data tree
        const activity = this.dataTree.get(activityId);
        if (activity?.type === 'armDeployment') {
            return true;
        }

        // Match operation IDs that belong to an ARM deployment
        return !!this.findOperation(activityId);
    }

    public async getChildren(activityId?: string): Promise<string[]> {
        if (!activityId) {
            return [];
        }

        const activity = this.dataTree.get(activityId);
        if (activity?.type !== 'armDeployment') {
            return [];
        }

        const deployment = activity as ArmDeploymentActivity;

        // Child deployments from the data tree
        const dataChildren = await this.dataTree.getChildren(deployment);
        const childIds = dataChildren.map(child => child.id);

        // Inject visible leaf operations from enrichment
        if (deployment.operations) {
            for (const op of deployment.operations) {
                if (isVisibleOperation(op) && !isNestedDeploymentOp(op)) {
                    childIds.push(op.id);
                }
            }
        }

        return childIds;
    }

    public getTreeItem(activityId: string): ITreeItem {
        const activity = this.dataTree.get(activityId)
            ?? this.findOperation(activityId);

        if (!activity) {
            throw new Error(`Activity with ID ${activityId} not found`);
        }

        return toActivityTreeItem(this.code, activity, activityId);
    }

    public getParent(activityId: string): string | undefined {
        const activity = this.dataTree.get(activityId) ?? this.findOperation(activityId);
        return activity?.parentId;
    }

    /**
     * Find an operation by ID on its parent ARM deployment.
     * Operation IDs are formatted as `{deploymentId}/operations/{operationId}`.
     */
    private findOperation(operationId: string): ArmDeploymentOperationActivity | undefined {
        const opsSegment = '/operations/';
        const idx = operationId.lastIndexOf(opsSegment);
        if (idx === -1) {
            return undefined;
        }

        const parentId = operationId.substring(0, idx);
        const parent = this.dataTree.get(parentId) as ArmDeploymentActivity | undefined;
        return parent?.operations?.find(op => op.id === operationId);
    }
}

function isNestedDeploymentOp(op: ArmDeploymentOperationActivity): boolean {
    return op.targetResourceType?.toLowerCase() === DeploymentResourceType.toLowerCase();
}
