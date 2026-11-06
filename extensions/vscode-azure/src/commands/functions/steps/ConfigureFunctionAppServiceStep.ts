/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, ExternalError, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import type { CreateFunctionAppContext, FunctionWorkerRuntime } from '../CreateFunctionAppContext';

const languages: Record<FunctionWorkerRuntime, string> = {
    node: 'js',
    python: 'python',
    ['dotnet-isolated']: 'dotnet',
    java: 'java',
    powershell: 'ps',
};

/** Declares the Functions service targeted by azd without replacing existing service configuration. */
@injectable()
export class ConfigureFunctionAppServiceStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IVsCode) private readonly code: IVsCode,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.job === 'deploy' && !context.hasServices;
    }

    public async execute(context: Readonly<CreateFunctionAppContext>): Promise<void> {
        const { iacFolder, functionWorkerRuntime } = context;
        const azdServiceName = context.azdServiceName ?? context.environmentName;
        if (!iacFolder || !azdServiceName || !functionWorkerRuntime) {
            throw new ExternalError(this.code.l10n.t('Select a Functions runtime and project name before configuring deployment.'));
        }
        await this.azd.updateAzureYaml(iacFolder, editor => { // eslint-disable-line @typescript-eslint/no-deprecated -- temporary azd compatibility API
            editor.set(['services', azdServiceName], {
                host: 'function',
                project: '.',
                language: languages[functionWorkerRuntime],
            });
        });
    }
}
