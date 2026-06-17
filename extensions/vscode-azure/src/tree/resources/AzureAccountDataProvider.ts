/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getAuthProviderId, getConfiguredAzureEnv,
    ICredentialFactory,
    isAccount, isTenant,
    PublicAuthProviderId, SovereignAuthProviderId, SovereignCloudConfigurationSection,
    SubscriptionClient,
    type AzureAccount, type AzureSubscription, type AzureTenant,
    type ConcreteAzureNode,
} from '@microsoft/vscode-azure-azutils';
import {
    EventEmitter, IActionExecutor, ICodeContext,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Page, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

/**
 * Identifier for the root account/tenant/subscription data provider. Bound as a
 * singleton and aliased into the resource tree's data-provider collection so the
 * "Run (Mock Data)" debug entry point can rebind it with mock data.
 */
export const IAzureAccountDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureAccountDataProvider');

/**
 * Root data-layer provider for the account / tenant / subscription levels of the
 * Azure resources tree.
 *
 * Talks directly to the VS Code `authentication` API and
 * `@azure/arm-resources-subscriptions` (via {@linkcode SubscriptionClient}),
 * producing account roots, tenant children for each account, and subscription
 * children for each tenant. Resource groups and below are handled by other
 * providers.
 *
 * Credentials are obtained from an {@linkcode ICredentialFactory}; the data layer
 * never stores credentials on subscriptions.
 *
 * Children never expire on their own ({@linkcode getTtl} returns `Infinity`);
 * the provider instead fires {@linkcode onDidChange} when the user signs in/out
 * (`authentication.onDidChangeSessions`) or changes the configured sovereign
 * cloud (`microsoft-sovereign-cloud`). Subscription filtering is applied by the
 * view layer, not here.
 */
@injectable()
export class AzureAccountDataProvider implements DataProvider<ConcreteAzureNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
    ) {
        // TODO: This fires a lot, need to filter and/or debounce
        this.disposables.push(this.ctx.code.authentication.onDidChangeSessions(e => {
            if (e.provider.id === PublicAuthProviderId || e.provider.id === SovereignAuthProviderId) {
                this.executor.output.debug(`[auth] sessions changed provider=${e.provider.id}; invalidating accounts`);
                this.invalidateAll();
            }
        }));

        this.disposables.push(this.ctx.code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(SovereignCloudConfigurationSection)) {
                this.executor.output.debug('[auth] sovereign cloud configuration changed; invalidating accounts');
                this.invalidateAll();
            }
        }));
    }

    /** @inheritdoc */
    public getTtl(): number {
        return Infinity;
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        return isAccount(node) || isTenant(node);
    }

    /**
     * @inheritdoc
     * @throws if `resource` is neither an account nor a tenant.
     */
    public getChildren(resource?: ConcreteAzureNode): ProviderResult<ChildResult<ConcreteAzureNode>> {
        if (!resource) {
            // Lists already-signed-in accounts without prompting. The user is
            // prompted to sign in lazily when an operation actually needs a
            // credential (the default credential uses `createIfNone`).
            return this.listAccounts();
        }

        if (isAccount(resource)) {
            return this.listTenantsForAccount(resource);
        }

        if (isTenant(resource)) {
            return this.listSubscriptionsForTenant(resource);
        }

        throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
    }

    /**
     * List the Azure accounts the user is signed in to for the currently
     * configured environment.
     *
     * Reads the configured environment via {@linkcode getConfiguredAzureEnv} and
     * attaches it to each account.
     *
     * @returns The signed-in accounts, sorted by label.
     */
    private async listAccounts(): Promise<AzureAccount[]> {
        const environment = getConfiguredAzureEnv(this.ctx.code);
        const accounts = await this.ctx.code.authentication.getAccounts(getAuthProviderId(environment));
        return accounts
            .map(account => ({
                ...account,
                environment,
            } satisfies AzureAccount))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * List the tenants belonging to the given account, yielded one page at a
     * time. Accounts can belong to a very large number of tenants, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * @param account - The account whose tenants are listed.
     */
    private async *listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        const credential = this.credentialFactory({ sessionOptions: { account } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, account.environment);
        for await (const page of client.tenants.list()) {
            const items = page.items
                .filter((tenant): tenant is typeof tenant & { tenantId: string; displayName: string } => !!tenant.tenantId && !!tenant.displayName)
                .map(tenant => ({
                    ...tenant,
                    environment: account.environment,
                    account,
                } satisfies AzureTenant));
            yield { items, hasMore: page.hasMore };
        }
    }

    /**
     * List the subscriptions belonging to the given tenant, yielded one page at
     * a time. A tenant can contain a very large number of subscriptions, so
     * pages are streamed lazily rather than buffered; ordering follows the
     * service response (no cross-page sort).
     *
     * @param tenant - The tenant whose subscriptions are listed.
     */
    private async *listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>> {
        const credential = this.credentialFactory({ tenantId: tenant.tenantId, sessionOptions: { account: tenant.account } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, tenant.account.environment);
        for await (const page of client.subscriptions.list()) {
            const items = page.items
                .filter((sub): sub is typeof sub & { subscriptionId: string; tenantId: string; displayName: string } => !!sub.subscriptionId && !!sub.tenantId && !!sub.displayName)
                .map(sub => ({
                    ...sub,
                    environment: tenant.environment,
                    tenant,
                    account: tenant.account,
                } satisfies AzureSubscription));
            yield { items, hasMore: page.hasMore };
        }
    }

    private invalidateAll(): void {
        this.changeEmitter.fire({ resource: undefined, includeChildren: true });
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
