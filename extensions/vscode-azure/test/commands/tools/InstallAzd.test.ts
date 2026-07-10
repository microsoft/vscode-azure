/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { InstallAzd } from '../../../src/commands/tools/InstallAzd';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('InstallAzd (unit)', () => {
    it('should delegate to IAzdService.install', async () => {
        const azd = createMockAzdService();
        const command = new InstallAzd(azd);

        await command.execute();

        expect(azd.install.mock.callCount()).to.equal(1);
    });
});
