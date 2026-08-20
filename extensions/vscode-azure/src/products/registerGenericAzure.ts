/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureListingCache,
    AzureListingFetcher,
    createDefaultCredentialFactory,
    DeploymentClient,
    IAzureListingCache,
    IAzureListingFetcher,
    ICredentialFactory,
    IDeploymentClientProvider,
    IResourceClientProvider,
    ISubscriptionClientProvider,
    ResourceClient,
    SubscriptionClient,
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { SelectSubscriptions } from '../commands/auth/SelectSubscriptions';
import { SignIn } from '../commands/auth/SignIn';
import { OpenUrl } from '../commands/OpenUrl';
import { DeleteAzureResource } from '../commands/tree/DeleteAzureResource';
import { GroupBy } from '../commands/tree/GroupBy';
import { BrowseWebsite } from '../commands/tree/BrowseWebsite';
import { OpenInPortal } from '../commands/tree/OpenInPortal';
import { RefreshResourcesView } from '../commands/tree/RefreshResourcesView';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import {
    AzureAccountDataProvider,
    IAzureAccountDataProvider,
} from '../tree/resources/AzureAccountDataProvider';
import { AzureResourceDataProvider } from '../tree/resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from '../tree/resources/GenericAzureViewProvider';
import { IResourceSelector, ResourceSelector } from '../tree/resources/ResourceSelector';
import { azdDetector } from '../tree/workspace/azd/AzdWorkspaceDataProvider';
import { CredentialOptionsScope, ICredentialOptionsScope } from '../utils/CredentialOptionsScope';
import { signedInTenantIdsFor } from '../utils/signedInTenants';
import { IWorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';

/**
 * Contribute the generic Azure clients and fallback resource presentation
 * shared by every product.
 */
export function registerGenericAzure(registrar: ProductRegistrar): void {
    registrar.registerBinding(container => {
        container.bind(IWorkspaceDetector).toConstantValue(azdDetector);
        container.bind(ICredentialOptionsScope).to(CredentialOptionsScope).inSingletonScope();
        container.bind(ICredentialFactory).toDynamicValue(context => {
            const scope = context.get(ICredentialOptionsScope);
            return createDefaultCredentialFactory(
                context.get(IVsCode),
                context.get(IOutputChannel),
                () => scope.current,
            );
        }).inSingletonScope();

        container.bind(IAzureListingFetcher).toDynamicValue(context => {
            return new AzureListingFetcher(
                context.get(ICodeContext),
                context.get(IActionExecutor),
                context.get(ICredentialFactory),
            );
        }).inSingletonScope();

        container.bind(IAzureListingCache).toDynamicValue(context => {
            const code = context.get(IVsCode);
            // Read on every listing rather than captured, so adding or removing a
            // manually-entered tenant takes effect with nothing re-fetched.
            return new AzureListingCache(
                context.get(IAzureListingFetcher),
                context.get(IActionExecutor),
                { additionalTenantIds: account => signedInTenantIdsFor(code, account.id) },
            );
        }).inSingletonScope();

        container.bind(ISubscriptionClientProvider).toFactory(context => {
            const codeContext = context.get(ICodeContext);
            const executor = context.get(IActionExecutor);
            const credentialFactory = context.get(ICredentialFactory);
            return (subscription) => {
                return SubscriptionClient.create(
                    codeContext,
                    executor,
                    credentialFactory(subscription),
                    subscription.environment,
                    undefined,
                    subscription,
                );
            };
        });

        container.bind(IResourceSelector).to(ResourceSelector).inSingletonScope();
    });

    registrar.registerAzureClientProvider(IResourceClientProvider, (context, executor, credential, subscription) => {
        return ResourceClient.create(context, executor, credential, subscription);
    });
    registrar.registerAzureClientProvider(IDeploymentClientProvider, (context, executor, credential, subscription) => {
        return DeploymentClient.create(context, executor, credential, subscription);
    });

    registrar.registerCommand('vscode-azure/resources/refresh', RefreshResourcesView);
    registrar.registerCommand('vscode-azure/resources/groupBy', GroupBy);
    registrar.registerCommand('vscode-azure/resources/browseWebsite', BrowseWebsite);
    registrar.registerCommand('vscode-azure/resources/openInPortal', OpenUrl, OpenInPortal.getUrl);
    registrar.registerCommand('vscode-azure/resources/delete', DeleteAzureResource);
    registrar.registerCommand('vscode-azure/resourceGroups/delete', DeleteAzureResource);
    registrar.registerCommand('vscode-azure/signIn', SignIn);
    registrar.registerCommand('vscode-azure/selectSubscriptions', SelectSubscriptions);

    registrar.registerResourceDataProvider([IAzureAccountDataProvider, AzureAccountDataProvider]);
    registrar.registerResourceDataProvider(AzureResourceDataProvider);
    registrar.registerResourceViewProvider(GenericAzureViewProvider);
}
