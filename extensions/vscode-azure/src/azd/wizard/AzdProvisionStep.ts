/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CaselessMap, CaselessSet, delay, ExecuteStep, stringifyError, ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { ISubscriptionResolver } from '../../services';
import { IAzdService } from '../AzdService';
import { ITempDirManager } from '../TempDirManager';
import type { AzdWizardContext } from './AzdWizardContext';

/** A single line from the JSONL deployment ID file written by azd. */
interface DeploymentIdEntry {
    readonly deploymentId: string;
}

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

        const abortCtl = new AbortController();
        const trackedIds = new CaselessSet();

        // Scope each deployment to the tenant that owns its subscription, so its
        // ARM requests do not authenticate to the home tenant -- a token ARM
        // rejects outright for a subscription owned by another tenant.
        const scopes = this.createScopeResolver(context);

        // Start polling in the background (fire-and-forget)
        void this.pollLoop(deployIdFileUri, trackedIds, abortCtl.signal, scopes);

        try {
            await this.azd.provision(context.iacFolder!, { // eslint-disable-line @typescript-eslint/no-non-null-assertion
                AZD_DEPLOYMENT_ID_FILE: deployIdFileUri.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
            });
        } finally {
            abortCtl.abort();
            // Final read to catch any entries written just before exit
            await this.readAndTrack(deployIdFileUri, trackedIds, scopes);
        }
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
                pending = this.lookupScope(subscriptionId).then(scope => {
                    if (!scope.tenantId && memo.get(subscriptionId) === pending) {
                        memo.delete(subscriptionId);
                    }
                    return scope;
                });
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

    /**
     * Polls the deployment ID file every {@linkcode pollIntervalMs} until
     * the abort signal fires. Each poll reads the entire file, parses
     * JSONL entries, and starts tracking any new deployment IDs.
     *
     * Polling lifetime is tied to the `azd provision` task, **not** to the
     * visibility of the resulting activities. Clearing a tracked deployment
     * does not stop discovery of additional deployments produced by the
     * still-running provision -- a brand new deployment is a brand new event
     * and should appear in the tree.
     */
    private async pollLoop(fileUri: vscode.Uri, trackedIds: CaselessSet, signal: AbortSignal, scopes: (deploymentId: string) => Promise<TokenScope>): Promise<void> {
        try {
            while (!signal.aborted) {
                await this.readAndTrack(fileUri, trackedIds, scopes);
                await delay(pollIntervalMs, signal);
            }
        } catch (e) {
            if (!CancellationError.test(e)) {
                this.output.debug(`[provision] deployment ID polling failed: ${stringifyError(e)}`);
            }
        }
    }

    /**
     * Reads the deployment ID file and starts tracking any entries
     * not already in {@linkcode trackedIds}. Best-effort: silently
     * ignores missing files and parse errors.
     */
    private async readAndTrack(fileUri: vscode.Uri, trackedIds: CaselessSet, scopes: (deploymentId: string) => Promise<TokenScope>): Promise<void> {
        const entries = await this.readDeploymentIdFile(fileUri);
        for (const entry of entries) {
            if (trackedIds.has(entry.deploymentId)) {
                continue;
            }
            trackedIds.add(entry.deploymentId);
            this.output.debug(`[provision] found deployment ID: ${entry.deploymentId}`);

            try {
                const scope = await scopes(entry.deploymentId);
                this.armProvider.trackDeployment(entry.deploymentId, scope.tenantId, scope.accountId);
            } catch (e) {
                this.output.debug(`[provision] failed to track deployment ${entry.deploymentId}: ${stringifyError(e)}`);
            }
        }
    }

    /**
     * Reads and parses the JSONL deployment ID file. Returns an empty
     * array when the file doesn't exist or can't be read.
     */
    private async readDeploymentIdFile(fileUri: vscode.Uri): Promise<DeploymentIdEntry[]> {
        try {
            const content = await this.ctx.code.workspace.fs.readFile(fileUri);
            const text = new TextDecoder().decode(content);
            const entries: DeploymentIdEntry[] = [];
            for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(trimmed) as DeploymentIdEntry;
                    if (parsed.deploymentId) {
                        entries.push(parsed);
                    }
                } catch {
                    // Skip malformed lines
                }
            }
            return entries;
        } catch {
            return [];
        }
    }
}
