/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionClientProvider, type AzureSubscription } from '@microsoft/vscode-azure-azutils';
import { createActionContext, IActionContext, ICodeContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { IAzdService } from '../../src/azd/AzdService';
import { ITempDirManager, TempDirManager } from '../../src/azd/TempDirManager';
import { createGenerateBicepStepFactory, IGenerateBicepStepFactory } from '../../src/azd/wizard/GenerateBicepStep';
import { IAzureViewDataTree, IAzureViewViewItemTree, ISubscriptionResolver } from '../../src/services';
import { IArmDeploymentDataProvider } from '../../src/tree/activity/ArmDeploymentDataProvider';
import { ICodeDeploymentDataProvider } from '../../src/tree/activity/CodeDeploymentDataProvider';
import { IWorkspaceIndexService } from '../../src/utils/workspaceIndex/WorkspaceIndexService';
import { ISwaCliService } from '../../src/staticWebApps/SwaCliService';
import { createMockSwaCliService } from '../staticWebApps/MockSwaCliService';
import { createTestIndexService } from '../utils/workspaceIndex/createTestIndexService';

/** Mocked services a wizard command (and its steps) may resolve in unit tests. */
export interface WizardCommandMocks {
    readonly ctx: ICodeContext;
    readonly output: IOutputChannel;
    readonly azd: IAzdService;
    readonly dataTree: IAzureViewDataTree;
    readonly actionContext?: IActionContext;
    readonly tempManager?: ITempDirManager;
    readonly viewItemTree?: unknown;
    readonly subscriptionClientProvider?: ISubscriptionClientProvider;
    readonly armProvider?: IArmDeploymentDataProvider;
    readonly codeProvider?: ICodeDeploymentDataProvider;
    readonly workspaceIndexService?: IWorkspaceIndexService;
    readonly swaCli?: ISwaCliService;
    /** Defaults to a resolver that finds nothing, which is the behavior of a subscription no account can reach. */
    readonly subscriptionResolver?: (subscriptionId: string) => Promise<AzureSubscription | undefined>;
}

/**
 * Builds an inversify {@linkcode Container} that mirrors the per-command
 * execution container created by `registerManagedCommand`: `autobind` is
 * enabled so commands resolve their wizard steps with `container.get(Step)`,
 * {@linkcode IActionContext} is bound, and the container is bound to itself so
 * a command can `@inject(Container)`.
 *
 * Wire it with mocked services, then resolve the command under test via
 * `container.get(MyCommand)` to exercise the real autobind resolution path.
 */
export function createWizardCommandContainer(mocks: WizardCommandMocks): Container {
    const container = new Container({ autobind: true });

    container.bind(IActionContext).toConstantValue(mocks.actionContext ?? createActionContext('test'));
    container.bind(ICodeContext).toConstantValue(mocks.ctx);
    container.bind(IVsCode).toConstantValue(mocks.ctx.code);
    container.bind(IOutputChannel).toConstantValue(mocks.output);
    container.bind(IAzdService).toConstantValue(mocks.azd);
    container.bind(ITempDirManager).toConstantValue(mocks.tempManager ?? new TempDirManager(mocks.ctx));
    container.bind(IAzureViewDataTree).toConstantValue(mocks.dataTree);
    container.bind(ISubscriptionResolver).toConstantValue(mocks.subscriptionResolver ?? (() => Promise.resolve(undefined)));
    container.bind(IWorkspaceIndexService).toConstantValue(
        mocks.workspaceIndexService ?? createTestIndexService(mocks.ctx.code, []),
    );
    container.bind(ISwaCliService).toConstantValue(mocks.swaCli ?? createMockSwaCliService());

    container.bind(IGenerateBicepStepFactory).toFactory(context => createGenerateBicepStepFactory(context.get(ICodeContext)));

    if (mocks.viewItemTree !== undefined) {
        container.bind(IAzureViewViewItemTree).toConstantValue(mocks.viewItemTree as IAzureViewViewItemTree);
    }
    if (mocks.subscriptionClientProvider !== undefined) {
        container.bind(ISubscriptionClientProvider).toConstantValue(mocks.subscriptionClientProvider);
    }
    if (mocks.armProvider !== undefined) {
        container.bind(IArmDeploymentDataProvider).toConstantValue(mocks.armProvider);
    }
    if (mocks.codeProvider !== undefined) {
        container.bind(ICodeDeploymentDataProvider).toConstantValue(mocks.codeProvider);
    }
    container.bind(Container).toConstantValue(container);
    return container;
}
