/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getConfiguredAzureEnv, IDeploymentClientProvider, KnownProvisioningState, parseAzureResourceId,
    type AzureSubscriptionTarget, type DeploymentOperation, type IDeploymentClient, type ProvisioningOperation, type ProvisioningState
} from '@microsoft/vscode-azure-azutils';
import {
    CaselessMap, CaselessSet, delay, Disposable, EventEmitter, flattenPages, IActionExecutor, IVsCode, Roots, selfOnly, stringifyError,
    type DataProvider, type DataProviderChangeEvent
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { ICredentialOptionsScope } from '../../utils/CredentialOptionsScope';
import { IAzureAccountDataProvider } from '../resources/AzureAccountDataProvider';
import { isActivity, isTerminalActivityStatus, type Activity } from './Activity';

/** Identifier for the ARM deployment data provider */
export const IArmDeploymentDataProvider: ServiceIdentifier<ArmDeploymentDataProvider> = Symbol.for('IArmDeploymentDataProvider');
export type IArmDeploymentDataProvider = ArmDeploymentDataProvider;

const DeploymentResourceType = 'Microsoft.Resources/deployments';

/**
 * An {@linkcode Activity} representing a single ARM deployment (root or nested).
 *
 * Deployments form a tree via the {@linkcode operations} list: nested deployment
 * operations yield child {@linkcode ArmDeploymentActivity} nodes, while non-deployment
 * operations become leaf {@linkcode ArmDeploymentOperationActivity} items.
 */
export interface ArmDeploymentActivity extends Activity {
    readonly type: 'armDeployment';
    readonly deploymentId: string;
    /**
     * What ARM requests about this deployment are issued against: the
     * subscription parsed from {@linkcode deploymentId}, the cloud it lives in,
     * and whatever tenant/account the tracker knew.
     */
    readonly subscription: AzureSubscriptionTarget;
    /** The ARM scope prefix (everything before `/providers/Microsoft.Resources/deployments/`). */
    readonly scope: string;
    readonly deploymentName: string;
    /** The ID of the user-initiated root deployment this belongs to. Equal to {@linkcode id} for root deployments. */
    readonly rootDeploymentId: string;
    /** Operations discovered by enrichment. Populated asynchronously after the deployment is loaded. */
    operations?: ArmDeploymentOperationActivity[];
    /** Controller that is aborted when this deployment tree is cleared. Shared by all nested deployments. */
    readonly abortController: AbortController;
}

/**
 * A leaf operation within an {@linkcode ArmDeploymentActivity}. Represents a
 * single resource-level action (Create/Delete/Action/Read) performed during
 * the deployment.
 */
export interface ArmDeploymentOperationActivity extends Activity {
    readonly type: 'armDeploymentOperation';
    readonly operationId: string;
    /** The full ARM resource ID of the target resource. */
    readonly targetResourceId: string;
    readonly targetResourceType?: string;
    readonly targetResourceName?: string;
    /** The raw ARM provisioning state string (e.g. 'Succeeded', 'Running'). */
    readonly provisioningState?: string;
}

/**
 * Data-layer provider for ARM deployment activities in the activity tree.
 *
 * Tracks user-initiated root deployments (via {@linkcode trackDeployment}),
 * enriches each deployment with its operations list, and polls non-terminal
 * deployments until they reach a terminal state. Nested deployments are
 * discovered from the operations list and reused across re-fetches to
 * preserve object identity.
 */
@injectable()
export class ArmDeploymentDataProvider implements DataProvider<Activity>, Disposable {
    public readonly isRoot = true;

    /** Top-level tracked deployments (user-initiated), keyed by their case-insensitive ARM deployment ID. */
    private readonly trackedRoots = new CaselessMap<ArmDeploymentActivity>();
    /** All known deployment activities by ARM deployment ID, preserving object identity across re-fetches. */
    private readonly knownDeployments = new CaselessMap<ArmDeploymentActivity>();
    /** Deployment IDs currently being polled, to prevent duplicate poll loops. */
    private readonly activePolls = new CaselessSet();
    private readonly onDidChangeEmitter = new EventEmitter<DataProviderChangeEvent<Activity>>();
    private readonly disposables: Disposable[] = [this.onDidChangeEmitter];
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IDeploymentClientProvider) private readonly createClient: IDeploymentClientProvider,
        @inject(ICredentialOptionsScope) private readonly credentialOptions: ICredentialOptionsScope,
        @inject(IAzureAccountDataProvider) accountProvider: IAzureAccountDataProvider,
    ) {
        this.disposables.push(accountProvider.onDidRemoveAccounts(accountIds => {
            const removedIds = new CaselessSet(accountIds);
            this.clearActivities(activity => {
                const accountId = activity.subscription.accountId;
                return !!accountId && removedIds.has(accountId);
            });
        }));
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ArmDeploymentActivity {
        return isActivity(resource) && resource.type === 'armDeployment';
    }

    /**
     * Returns child **deployments** only. Leaf operations are stored on
     * the deployment via {@linkcode enrich} and injected by the view provider.
     */
    public getChildren(resource?: ArmDeploymentActivity): ArmDeploymentActivity[] {
        if (!resource) {
            return [...this.trackedRoots.values()];
        }

        // Child deployments are extracted from the operations list.
        // If enrichment hasn't run yet, operations will be undefined.
        return this.extractChildDeployments(resource);
    }

    /**
     * Fetch all operations for the deployment and store them in-place.
     * Starts polling for non-terminal deployments. Called automatically
     * by {@linkcode DataItemTree} after a resource is loaded.
     */
    public async enrich(resource: ArmDeploymentActivity): Promise<boolean> {
        if (resource.abortController.signal.aborted) {
            return false;
        }

        const client = this.getClient(resource);
        resource.operations = await this.fetchOperations(client, resource, resource.abortController.signal);

        // Start polling if not terminal and not already polling
        if (!isTerminalActivityStatus(resource.status) && !this.activePolls.has(resource.id)) {
            void this.poll(resource, client);
        }

        // Children depend on operations, so signal that children changed
        // now that operations are populated.
        return true;
    }

    /**
     * Begin tracking a user-initiated root deployment. Creates a new
     * {@linkcode ArmDeploymentActivity}, registers it as a root, and fires
     * an `onDidChange` so the tree picks it up. Enrichment (and polling)
     * will start on first access by the tree.
     *
     * The target subscription is parsed from {@linkcode deploymentId} and paired
     * with the configured cloud, so a client can always be built. The optional
     * {@linkcode tenantId} and {@linkcode accountId} (from the subscription the
     * caller provisioned into, or from an azd environment) scope the token: the
     * tenant pins its authority, and the account breaks the tie when more than
     * one signed-in account can reach that tenant.
     *
     * @throws if {@linkcode deploymentId} is not a valid ARM deployment id.
     */
    public trackDeployment(deploymentId: string, tenantId?: string, accountId?: string): void {
        const { scope, deploymentName } = parseDeploymentId(deploymentId);
        const { subscriptionId } = parseAzureResourceId(deploymentId);

        const activity: ArmDeploymentActivity = {
            id: deploymentId,
            type: 'armDeployment',
            status: 'InProgress',
            title: deploymentName,
            startTime: new Date(),
            deploymentId,
            subscription: {
                subscriptionId,
                tenantId,
                accountId,
                environment: getConfiguredAzureEnv(this.code),
            },
            scope,
            deploymentName,
            rootDeploymentId: deploymentId,
            abortController: new AbortController(),
        };

        this.trackedRoots.set(activity.id, activity);
        this.knownDeployments.set(activity.id, activity);
        this.onDidChangeEmitter.fire({ target: Roots });
    }

    /**
     * Poll a deployment's status and refresh its operations. Fires targeted
     * change events based on whether the operation count changed. The client
     * resolved by {@linkcode enrich} is reused for this poll loop's lifetime.
     */
    private async poll(activity: ArmDeploymentActivity, client: IDeploymentClient): Promise<void> {
        try {
            const abortSignal = activity.abortController.signal;
            abortSignal.throwIfAborted();

            this.activePolls.add(activity.id);

            while (!abortSignal.aborted) {
                let nextPollMs = 10 * 1000; // Default to 10s if server doesn't provide guidance
                this.executor.output.debug(`[activity] poll cycle start deployment=${activity.id}`);

                try {
                    await this.executor.callWithTelemetryAndErrorHandling('tree.pollArmDeployments', async (context) => {
                        context.telemetry.suppress = 'onSuccess';
                        context.telemetry.isUserEvent = false;
                        context.errorHandling.rethrow = true;

                        const [deployment, operations] = await Promise.all([
                            client.deployments.getAtScope(
                                activity.scope,
                                activity.deploymentName,
                                {
                                    abortSignal,
                                    onResponse: (response) => {
                                        const retryAfter = response.headers.get('retry-after');
                                        if (retryAfter) {
                                            const seconds = parseInt(retryAfter, 10);
                                            if (!isNaN(seconds) && seconds > 0) {
                                                nextPollMs = seconds * 1000;
                                            }
                                        }
                                    },
                                },
                            ),
                            this.fetchOperations(client, activity, abortSignal),
                        ]);

                        abortSignal.throwIfAborted();

                        const provisioningState = deployment.properties?.provisioningState;
                        if (provisioningState) {
                            const previousStatus = activity.status;
                            activity.status = toActivityStatus(provisioningState);
                            activity.description = provisioningState;
                            if (activity.status !== previousStatus) {
                                this.executor.output.debug(`[activity] deployment status transition deployment=${activity.id} status=${activity.status}`);
                            }
                        }

                        // Detect structural changes in operations
                        const prevCount = activity.operations?.length ?? 0;
                        activity.operations = operations;
                        const includeChildren = operations.length !== prevCount;

                        if (isTerminalState(provisioningState)) {
                            activity.endTime = new Date();
                            this.executor.output.debug(`[activity] deployment reached terminal status deployment=${activity.id} status=${activity.status}`);
                            this.onDidChangeEmitter.fire({ target: includeChildren ? activity : selfOnly(activity) });
                            return;
                        }

                        this.onDidChangeEmitter.fire({ target: includeChildren ? activity : selfOnly(activity) });
                    });

                    // Exit the loop if the deployment reached a terminal state
                    if (isTerminalActivityStatus(activity.status)) {
                        return;
                    }
                } catch (error) {
                    abortSignal.throwIfAborted();
                    // Swallow other probably-transient errors and retry on next poll
                    const message = stringifyError(error);
                    this.executor.output.warn(this.code.l10n.t('[activity] polling error deployment={0} message={1}', activity.id, message));
                }

                // Wait for the next poll interval (rejects with CancellationError on abort)
                await delay(nextPollMs, abortSignal);
            }
        } catch {
            // CancellationError, AbortError, or signal.throwIfAborted -- exit cleanly
        } finally {
            this.activePolls.delete(activity.id);
        }
    }

    /**
     * Extract child deployments from a deployment's operations.
     * Reuses existing objects from {@linkcode knownDeployments} to preserve
     * reference stability across re-fetches (so polling mutates the same
     * instance the tree holds).
     */
    private extractChildDeployments(activity: ArmDeploymentActivity): ArmDeploymentActivity[] {
        if (!activity.operations) {
            return [];
        }

        const results: ArmDeploymentActivity[] = [];
        for (const op of activity.operations) {
            if (!isNestedDeploymentOp(op)
                || !op.targetResourceId
                || !isVisibleOperation(op)) {
                continue;
            }

            try {
                const existing = this.knownDeployments.get(op.targetResourceId);
                if (existing) {
                    // Update mutable fields on the existing object
                    existing.status = op.status;
                    existing.description = op.provisioningState;
                    results.push(existing);
                    continue;
                }

                const { scope, deploymentName } = parseDeploymentId(op.targetResourceId);
                const child: ArmDeploymentActivity = {
                    id: op.targetResourceId,
                    type: 'armDeployment',
                    status: op.status,
                    title: op.targetResourceName ?? deploymentName,
                    description: op.provisioningState,
                    startTime: activity.startTime,
                    deploymentId: op.targetResourceId,
                    subscription: activity.subscription,
                    scope,
                    deploymentName,
                    rootDeploymentId: activity.rootDeploymentId,
                    abortController: activity.abortController,
                };
                this.knownDeployments.set(child.id, child);
                results.push(child);
            } catch {
                // Skip if we can't parse the deployment ID
            }
        }
        return results;
    }

    /**
     * Fetch all operations for a deployment from the ARM API.
     * Deduplicates by target resource ID, keeping the most meaningful
     * operation per resource (Create/Delete over read-only ops).
     */
    private async fetchOperations(client: IDeploymentClient, activity: ArmDeploymentActivity, abortSignal: AbortSignal): Promise<ArmDeploymentOperationActivity[]> {
        const byTargetId = new CaselessMap<{ op: DeploymentOperation; rank: number }>();

        for await (const op of flattenPages(client.deploymentOperations.listAtScope(activity.scope, activity.deploymentName, { abortSignal }))) {
            const targetResource = op.properties?.targetResource;
            if (!op.operationId || !targetResource?.id) {
                continue;
            }

            const rank = operationRank(op.properties?.provisioningOperation);
            const existing = byTargetId.get(targetResource.id);
            if (!existing || rank > existing.rank) {
                byTargetId.set(targetResource.id, { op, rank });
            }
        }

        const results: ArmDeploymentOperationActivity[] = [];
        for (const { op } of byTargetId.values()) {
            const targetResource = op.properties?.targetResource;
            const provisioningState = op.properties?.provisioningState;
            const operationId = op.operationId ?? targetResource?.id ?? '';

            results.push({
                id: `${activity.id}/operations/${operationId}`,
                type: 'armDeploymentOperation',
                status: toActivityStatus(provisioningState),
                title: targetResource?.resourceName ?? operationId,
                description: targetResource?.resourceType,
                startTime: activity.startTime,
                operationId,
                targetResourceId: targetResource?.id ?? '',
                targetResourceType: targetResource?.resourceType,
                targetResourceName: targetResource?.resourceName,
                provisioningState: provisioningState ?? undefined,
            });
        }

        return results;
    }

    /**
     * Returns a deployment client for the deployment's target subscription.
     *
     * Built under a silent credential scope: polling runs in the background,
     * possibly for a tenant the user never opened, so a missing session must end
     * in an unenriched deployment rather than an unprompted-for sign-in dialog.
     * The credential captures that scope when it is built, so it holds for the
     * whole poll loop.
     *
     * This provider retains the resulting client only for the operation that
     * requested it (including the lifetime of a poll loop).
     */
    private getClient(activity: ArmDeploymentActivity): IDeploymentClient {
        return this.credentialOptions.run(
            { sessionOptions: { silent: true } },
            () => this.createClient(activity.subscription),
        );
    }

    /**
     * Remove all tracked root deployments matching `filter` and abort any
     * in-flight polling for them (and their descendants).
     */
    public clearActivities(filter: (activity: ArmDeploymentActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.trackedRoots) {
            if (filter(activity)) {
                this.trackedRoots.delete(id);
                activity.abortController.abort();
                this.cleanupDeploymentTree(id);
                changed = true;
            }
        }
        if (changed) {
            this.onDidChangeEmitter.fire({ target: Roots });
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        for (const activity of this.trackedRoots.values()) {
            activity.abortController.abort();
        }
        this.knownDeployments.clear();
        this.activePolls.clear();
        Disposable.disposeAll(this.disposables);
    }

    /**
     * Remove a deployment and all its descendants from tracking maps.
     * Uses {@linkcode ArmDeploymentActivity.rootDeploymentId} to find descendants.
     */
    private cleanupDeploymentTree(rootId: string): void {
        for (const [id, deployment] of this.knownDeployments) {
            if (deployment.rootDeploymentId === rootId) {
                this.knownDeployments.delete(id);
                this.activePolls.delete(id);
            }
        }
    }
}

function toActivityStatus(provisioningState: ProvisioningState | undefined): Activity['status'] {
    switch (provisioningState) {
        case KnownProvisioningState.Succeeded:
        case KnownProvisioningState.Ready:
        case KnownProvisioningState.Deleted:
            return 'Completed';
        case KnownProvisioningState.Failed:
            return 'Failed';
        case KnownProvisioningState.Canceled:
            return 'Canceled';
        case KnownProvisioningState.Running:
        case KnownProvisioningState.Accepted:
        case KnownProvisioningState.Creating:
        case KnownProvisioningState.Created:
        case KnownProvisioningState.Deleting:
        case KnownProvisioningState.Updating:
            return 'InProgress';
        case KnownProvisioningState.NotSpecified:
        default:
            return 'NotStarted';
    }
}

function isTerminalState(provisioningState: ProvisioningState | undefined): boolean {
    return provisioningState === KnownProvisioningState.Succeeded
        || provisioningState === KnownProvisioningState.Ready
        || provisioningState === KnownProvisioningState.Deleted
        || provisioningState === KnownProvisioningState.Failed
        || provisioningState === KnownProvisioningState.Canceled;
}

/**
 * Assigns a priority rank to a provisioning operation type.
 * Higher rank = more meaningful operation when deduplicating by target resource.
 * `Create` and `Delete` are the most interesting; read-only and internal
 * operations (e.g. `EvaluateDeploymentOutput`, `Waiting`) rank lowest.
 */
function operationRank(provisioningOperation: ProvisioningOperation | undefined): number {
    switch (provisioningOperation) {
        case 'Create':
        case 'Delete':
            return 3;
        case 'Action':
            return 2;
        case 'Read':
            return 1;
        default:
            return 0;
    }
}

const deploymentsSegment = `/providers/${DeploymentResourceType.toLowerCase()}/`;

/**
 * Parses an ARM deployment resource ID into its scope and deployment name.
 *
 * Works for any deployment scope:
 * - Resource group: `/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/{name}`
 * - Subscription: `/subscriptions/{sub}/providers/Microsoft.Resources/deployments/{name}`
 * - Management group: `/providers/Microsoft.Management/managementGroups/{mg}/providers/Microsoft.Resources/deployments/{name}`
 * - Tenant: `/providers/Microsoft.Resources/deployments/{name}`
 *
 * @returns The ARM scope prefix and the deployment name.
 * @throws if the ID does not contain a `Microsoft.Resources/deployments` segment.
 */
export function parseDeploymentId(deploymentId: string): { scope: string; deploymentName: string } {
    const idx = deploymentId.toLowerCase().indexOf(deploymentsSegment);
    if (idx === -1) {
        throw new Error(`Not an ARM deployment resource ID: ${deploymentId}`);
    }

    const scope = deploymentId.substring(0, idx);
    const deploymentName = deploymentId.substring(idx + deploymentsSegment.length);

    if (!deploymentName) {
        throw new Error(`ARM deployment resource ID is missing a deployment name: ${deploymentId}`);
    }

    return { scope, deploymentName };
}

/**
 * AVM (Azure Verified Modules) telemetry deployments use this name prefix.
 * These are empty deployments with no resources, used only for module usage
 * tracking. See https://aka.ms/avm/TelemetryInfo
 *
 * Verified from AVM owner that this prefix should be stable.
 */
const AvmTelemetryPrefix = '46d3x';

/**
 * Determines whether an operation should be shown in the activity tree.
 * Used by both the data provider (to decide whether to poll a nested
 * deployment) and the view provider (to filter visible leaf operations).
 */
export function isVisibleOperation(op: ArmDeploymentOperationActivity): boolean {
    // Hide AVM telemetry deployments
    if (isNestedDeploymentOp(op)
        && op.targetResourceName?.toLowerCase().startsWith(AvmTelemetryPrefix)) {
        return false;
    }
    return true;
}

/**
 * Returns `true` if the operation targets a nested `Microsoft.Resources/deployments`
 * resource (as opposed to a real Azure resource like a storage account).
 */
export function isNestedDeploymentOp(op: ArmDeploymentOperationActivity): boolean {
    return op.targetResourceType?.toLowerCase() === DeploymentResourceType.toLowerCase();
}
