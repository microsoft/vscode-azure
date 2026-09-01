/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/**
 * Ensures a deploy project declares the Docker service that azd builds and
 * targets at the provisioned Container App.
 */
@injectable()
export class ConfigureContainerAppServiceStep extends ExecuteStep<CreateContainerAppContext> {
    public constructor(
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<CreateContainerAppContext>): boolean {
        return context.job === 'deploy'
            && context.hasServices !== true
            && !!context.iacFolder
            && !!context.azdServiceName;
    }

    public async execute(context: Readonly<CreateContainerAppContext>): Promise<void> {
        const serviceName = context.azdServiceName!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- required by shouldExecute
        await this.azd.updateAzureYaml(context.iacFolder!, editor => { // eslint-disable-line @typescript-eslint/no-deprecated, @typescript-eslint/no-non-null-assertion -- temporary azd compatibility API; required by shouldExecute
            editor.set(['services', serviceName], {
                host: 'containerapp',
                project: '.',
                language: 'docker',
            });
        });
    }
}
