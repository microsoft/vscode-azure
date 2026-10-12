/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, parseAzureResourceId, SiteType } from '@microsoft/vscode-azure-azutils';
import { CancellationError, ExecuteStep, ExternalError, ICodeContext, IOutputChannel, showMessage, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import { ISubscriptionResolver } from '../../../services';
import { isFunctionTriggerBinding } from '../../../tree/resources/webApp/FunctionApp';
import { OpenUrl } from '../../OpenUrl';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

interface FunctionEndpoint {
    readonly label: string;
    readonly description: string;
}

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
        try {
            const show = await this.azd.show(context.iacFolder);
            const services = context.azdServiceName ? [show?.services?.[context.azdServiceName]] : Object.values(show?.services ?? {});
            for (const service of services) {
                for (const id of service?.target?.resourceIds ?? []) {
                    const parsed = parseAzureResourceId(id);
                    const type = `${parsed.provider}/${parsed.resourceType}`;
                    if (type.toLowerCase() !== SiteType.toLowerCase() || !parsed.resourceGroup || !parsed.resourceName) {
                        continue;
                    }
                    const subscription = context.subscription?.subscriptionId.toLowerCase() === parsed.subscriptionId.toLowerCase()
                        ? context.subscription : await this.subscription(parsed.subscriptionId);
                    if (!subscription) {
                        throw new ExternalError(this.ctx.code.l10n.t('Sign in to the deployed Function App subscription to list its HTTP URLs.'));
                    }
                    const client = this.createClient(subscription);
                    for await (const page of client.webApps.listFunctions(parsed.resourceGroup, parsed.resourceName)) {
                        for (const fn of page.items) {
                            const config: unknown = fn.config;
                            const bindings: unknown[] = config && typeof config === 'object' && 'bindings' in config && Array.isArray(config.bindings)
                                ? config.bindings : [];
                            if (!bindings.some(binding => isFunctionTriggerBinding(binding) && binding.type.toLowerCase() === 'httptrigger')) {
                                continue;
                            }
                            if (!fn.invokeUrlTemplate || !URL.canParse(fn.invokeUrlTemplate)) {
                                throw new ExternalError(this.ctx.code.l10n.t('Azure did not report a valid HTTP invocation template.'));
                            }
                            const url = new URL(fn.invokeUrlTemplate);
                            if (url.protocol !== 'https:' || url.username || url.password) {
                                throw new ExternalError(this.ctx.code.l10n.t('A remote function invocation template must use HTTPS without embedded credentials.'));
                            }
                            url.search = '';
                            url.hash = '';
                            endpoints.push({ label: fn.name?.split('/').at(-1) ?? parsed.resourceName, description: url.toString() });
                        }
                    }
                }
            }
        } catch {
            this.output.warn(this.ctx.code.l10n.t('[functions] Deployment completed, but HTTP invocation URLs could not be retrieved.'));
            await showMessage(this.ctx.code, this.ctx.code.l10n.t(
                'Deployment completed, but HTTP invocation URLs could not be retrieved. Refresh the Function App and use Copy Function URL.',
            ), { severity: 'warning' });
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
