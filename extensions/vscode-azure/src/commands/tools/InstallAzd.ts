/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Installs the Azure Developer CLI (`azd`) using the platform's
 * preferred package manager, falling back to the official install
 * script. Delegates to {@linkcode IAzdService.install}.
 */
@injectable()
export class InstallAzd implements ManagedCommand {
    public constructor(
        @inject(IAzdService) private readonly azdService: IAzdService,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        await this.azdService.install();
    }
}
