/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, parseAzureResourceId, SiteType, type AzureSubscription, type FunctionEnvelope } from '@microsoft/vscode-azure-azutils';
import { CancellationError, ExecuteStep, ExternalError, ICodeContext, IOutputChannel, showMessage, showSmartQuickPick, stringifyError } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import { ISubscriptionResolver } from '../../../services';
import { hasFunctionBindings, isFunctionTriggerBinding } from '../../../functions/functionMetadata';
import { OpenUrl } from '../../OpenUrl';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

interface FunctionEndpoint {
    readonly label: string;
    readonly description: string;
}

/** Contains only diagnostics authored by this step, never upstream error messages. */
class FunctionEndpointError extends ExternalError { }

/** Lists Azure-reported HTTP invocation templates after deployment, without retrieving or exposing keys. */
@injectable()
export class ShowFunctionEndpointsStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
        @inject(ISubscriptionResolver) private readonly subscription: ISubscriptionResolver,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(OpenUrl) private readonly open: OpenUrl,
    ) { super(); }

    public override shouldExecute(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.deploy === true && !!context.iacFolder;
    }

    public async execute(context: Readonly<CreateFunctionAppContext>): Promise<void> {
        if (!context.iacFolder) {
            return;
        }
        const endpoints: FunctionEndpoint[] = [];
        let operation = this.ctx.code.l10n.t('deployment discovery');
        try {
            const show = await this.azd.show(context.iacFolder);
            const services = context.azdServiceName ? [show?.services?.[context.azdServiceName]] : Object.values(show?.services ?? {});
            const resourceIds = services.flatMap(service => service?.target?.resourceIds ?? []);
            for (const id of resourceIds) {
                operation = this.ctx.code.l10n.t('deployment discovery');
                const parsed = parseAzureResourceId(id);
                const type = `${parsed.provider}/${parsed.resourceType}`;
                if (type.toLowerCase() !== SiteType.toLowerCase() || !parsed.resourceGroup || !parsed.resourceName) {
                    continue;
                }
                operation = this.ctx.code.l10n.t('subscription resolution');
                const subscription = context.subscription?.subscriptionId.toLowerCase() === parsed.subscriptionId.toLowerCase()
                    ? context.subscription : await this.subscription(parsed.subscriptionId);
                if (!subscription) {
                    throw new FunctionEndpointError(this.ctx.code.l10n.t('Sign in to the deployed Function App subscription to list its HTTP URLs.'));
                }
                operation = this.ctx.code.l10n.t('function listing');
                for await (const endpoint of this.listEndpoints(subscription, parsed.resourceGroup, parsed.resourceName)) {
                    endpoints.push(endpoint);
                }
            }
        } catch (error) {
            const message = error instanceof FunctionEndpointError
                ? this.ctx.code.l10n.t('Deployment completed, but HTTP invocation URLs could not be retrieved. {0}', stringifyError(error))
                : this.ctx.code.l10n.t('Deployment completed, but HTTP invocation URLs could not be retrieved. Refresh the Function App and use Copy Function URL.');
            this.output.warn(this.ctx.code.l10n.t('[functions] HTTP invocation URL retrieval failed during {0}: {1}', operation, message));
            await showMessage(this.ctx.code, message, { severity: 'warning' });
            return;
        }
        if (!endpoints.length) {
            await showMessage(this.ctx.code, this.ctx.code.l10n.t('Deployment completed. No HTTP invocation URLs are currently reported by Azure.'));
            return;
        }
        void this.offer(endpoints).catch((error: unknown) => {
            if (!CancellationError.test(error)) {
                this.output.warn(this.ctx.code.l10n.t('[functions] Could not open the deployed function endpoint.'));
                void showMessage(this.ctx.code, this.ctx.code.l10n.t('Could not open the deployed function endpoint.'), { severity: 'warning' });
            }
        });
    }

    private async *listEndpoints(subscription: AzureSubscription, resourceGroup: string, appName: string): AsyncIterable<FunctionEndpoint> {
        const client = this.createClient(subscription);
        for await (const page of client.webApps.listFunctions(resourceGroup, appName)) {
            for (const fn of page.items) {
                const endpoint = this.httpEndpoint(fn, appName);
                if (endpoint) {
                    yield endpoint;
                }
            }
        }
    }

    private httpEndpoint(fn: FunctionEnvelope, appName: string): FunctionEndpoint | undefined {
        const config: unknown = fn.config;
        const bindings = hasFunctionBindings(config) ? config.bindings : [];
        if (!bindings.some(binding => isFunctionTriggerBinding(binding) && binding.type.toLowerCase() === 'httptrigger')) {
            return undefined;
        }
        if (!fn.invokeUrlTemplate || !URL.canParse(fn.invokeUrlTemplate)) {
            throw new FunctionEndpointError(this.ctx.code.l10n.t('Azure did not report a valid HTTP invocation template.'));
        }
        const url = new URL(fn.invokeUrlTemplate);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new FunctionEndpointError(this.ctx.code.l10n.t('A remote function invocation template must use HTTPS without embedded credentials.'));
        }
        url.search = '';
        url.hash = '';
        return { label: fn.name?.split('/').at(-1) ?? appName, description: url.toString() };
    }

    private async offer(endpoints: readonly FunctionEndpoint[]): Promise<void> {
        const action = this.ctx.code.l10n.t('View HTTP URLs');
        const selected = await showMessage(this.ctx.code, this.ctx.code.l10n.t('Function App deployed.'), {}, action);
        if (selected === action) {
            const endpoint = await showSmartQuickPick(this.ctx, [...endpoints], {
                title: this.ctx.code.l10n.t('HTTP invocation templates (authentication keys not included)'),
            });
            await this.open.execute(endpoint.description);
        }
    }
}
