/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, CaselessSet, ExecuteStep, stringifyError, ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import { IArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { ISubscriptionResolver } from '../../services';
import { IAzdService } from '../AzdService';
import { ITempDirManager } from '../TempDirManager';
import { withAzdJsonlOutput } from '../withAzdJsonlOutput';
import type { AzdWizardContext } from './AzdWizardContext';

/** Interval in milliseconds between polls for the deployment ID file. */
const pollIntervalMs = 3000;

/**
 * Scopes the token a tracked deployment's ARM requests are made with. The
 * tenant pins the token's authority; the account breaks the tie when more than
 * one signed-in account reaches that tenant.
 */
interface TokenScope {
    readonly tenantId?: string;
    readonly accountId?: string;
}

/**
 * Runs `azd provision` as a visible VS Code task.
 *
 * Sets `AZD_DEPLOYMENT_ID_FILE` so azd writes ARM deployment IDs
 * as JSONL. Polls for that file to start tracking each deployment
 * in the activity view via {@linkcode IArmDeploymentDataProvider}.
 */
@injectable()
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IArmDeploymentDataProvider) private readonly armProvider: IArmDeploymentDataProvider,
        @inject(ISubscriptionResolver) private readonly resolveSubscription: ISubscriptionResolver,
        @inject(ITempDirManager) private readonly tempDirManager: ITempDirManager,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        const deployIdDir = await this.tempDirManager.createTempDir();
        const deployIdFileUri = this.ctx.code.Uri.joinPath(deployIdDir, 'deployment-id.jsonl');

        const trackedIds = new CaselessSet();

        // Scope each deployment to the tenant that owns its subscription, so its
        // ARM requests do not authenticate to the home tenant -- a token ARM
        // rejects outright for a subscription owned by another tenant.
        const scopes = this.createScopeResolver(context);

        await withAzdJsonlOutput({
            code: this.ctx.code,
            file: deployIdFileUri,
            intervalMs: pollIntervalMs,
            cancellation: context.cancellation,
            onEntry: entry => this.trackEntry(entry, trackedIds, scopes),
            onError: kind => { this.output.warn(this.ctx.code.l10n.t('[provision] Unable to process azd deployment IDs ({0}).', kind)); },
        }, signal => this.azd.provision(context.iacFolder!, { // eslint-disable-line @typescript-eslint/no-non-null-assertion
            AZD_DEPLOYMENT_ID_FILE: deployIdFileUri.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
        }, signal));
    }

    /**
     * Builds the function that names the tenant to authenticate a deployment to.
     *
     * A picked subscription names its tenant, and a fully-configured azd env may
     * name it too. Neither is guaranteed: `azd up` on an existing project runs no
     * pick step, and `AZURE_TENANT_ID` is optional in an env. So the fallback
     * looks the tenant up from the subscription id embedded in the deployment id,
     * which is the one identifier always in hand.
     *
     * Lookups are memoized per subscription: a provision emits many deployments,
     * and they share a subscription.
     */
    private createScopeResolver(context: Readonly<TContext>): (deploymentId: string) => Promise<TokenScope> {
        const known: TokenScope | undefined = context.subscription
            ? { tenantId: context.subscription.tenantId, accountId: context.subscription.accountId }
            : context.hydratedTenantId ? { tenantId: context.hydratedTenantId } : undefined;

        if (known) {
            return () => Promise.resolve(known);
        }

        const memo = new CaselessMap<Promise<TokenScope>>();
        return (deploymentId: string) => {
            const { subscriptionId } = parseAzureResourceId(deploymentId);
            let pending = memo.get(subscriptionId);
            if (!pending) {
                pending = this.lookupScope(subscriptionId);
                memo.set(subscriptionId, pending);
            }
            return pending;
        };
    }

    /**
     * Look up the tenant that owns `subscriptionId`. Best-effort: an id no
     * signed-in account reaches (a stale env, another account's subscription)
     * leaves the deployment tracked but unenriched.
     */
    private async lookupScope(subscriptionId: string): Promise<TokenScope> {
        try {
            const subscription = await this.resolveSubscription(subscriptionId);
            if (!subscription) {
                this.output.debug(`[provision] no signed-in account reaches subscription ${subscriptionId}`);
                return {};
            }
            return { tenantId: subscription.tenantId, accountId: subscription.accountId };
        } catch (e) {
            this.output.debug(`[provision] failed to resolve subscription ${subscriptionId}: ${stringifyError(e)}`);
            return {};
        }
    }

    private async trackEntry(entry: unknown, trackedIds: CaselessSet, scopes: (deploymentId: string) => Promise<TokenScope>): Promise<void> {
        if (!entry || typeof entry !== 'object' || !('deploymentId' in entry)
            || typeof entry.deploymentId !== 'string' || !entry.deploymentId) {
            this.output.warn(this.ctx.code.l10n.t('[provision] Invalid azd deployment ID entry.'));
            return;
        }
        if (trackedIds.has(entry.deploymentId)) {
            return;
        }
        trackedIds.add(entry.deploymentId);
        this.output.debug(`[provision] found deployment ID: ${entry.deploymentId}`);
        const scope = await scopes(entry.deploymentId);
        this.armProvider.trackDeployment(entry.deploymentId, scope.tenantId, scope.accountId);
    }
}
