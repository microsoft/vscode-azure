/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createActionContext, IActionContext, ICodeContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import { ITempDirManager, TempDirManager } from '../../azd/TempDirManager';
import { createGenerateBicepStepFactory, IGenerateBicepStepFactory } from '../../azd/wizard/GenerateBicepStep';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';
import { IArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';

/** Mocked services a wizard command (and its steps) may resolve in unit tests. */
export interface WizardCommandMocks {
    readonly ctx: ICodeContext;
    readonly output: IOutputChannel;
    readonly azd: IAzdService;
    readonly dataTree: unknown;
    readonly actionContext?: IActionContext;
    readonly tempManager?: ITempDirManager;
    readonly viewItemTree?: unknown;
    readonly subscriptionClientProvider?: ISubscriptionClientProvider;
    readonly armProvider?: unknown;
    readonly codeProvider?: unknown;
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
    container.bind(IAzureViewDataTree).toConstantValue(mocks.dataTree as never);

    container.bind(IGenerateBicepStepFactory).toFactory(context => createGenerateBicepStepFactory(context.get(ICodeContext)));

    if (mocks.viewItemTree !== undefined) {
        container.bind(IAzureViewViewItemTree).toConstantValue(mocks.viewItemTree as never);
    }
    if (mocks.subscriptionClientProvider !== undefined) {
        container.bind(ISubscriptionClientProvider).toConstantValue(mocks.subscriptionClientProvider);
    }
    if (mocks.armProvider !== undefined) {
        container.bind(IArmDeploymentDataProvider).toConstantValue(mocks.armProvider as never);
    }
    if (mocks.codeProvider !== undefined) {
        container.bind(ICodeDeploymentDataProvider).toConstantValue(mocks.codeProvider as never);
    }

    container.bind(Container).toConstantValue(container);
    return container;
}
