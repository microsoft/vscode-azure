/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { ISwaCliService } from '../../staticWebApps/SwaCliService';
import type { ManagedCommand } from '../ManagedCommand';

/** Installs or updates the Azure Static Web Apps CLI through npm. */
@injectable()
export class InstallOrUpdateSwaCli implements ManagedCommand {
    public constructor(
        @inject(ISwaCliService) private readonly swaCli: ISwaCliService,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        await this.swaCli.installOrUpdate();
    }
}
