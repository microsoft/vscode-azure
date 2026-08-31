/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { AzdDownStep } from '../../../src/azd/wizard/AzdDownStep';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

describe('AzdDownStep (unit)', () => {
    describe('shouldExecute', () => {
        it('returns true when iacFolder is set', () => {
            const step = new AzdDownStep<AzdWizardContext>(createMockAzdService());
            expect(step.shouldExecute({ iacFolder: MockUri.file('/project') })).to.be.true;
        });

        it('returns false when iacFolder is not set', () => {
            const step = new AzdDownStep<AzdWizardContext>(createMockAzdService());
            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('calls azd.down once with the iacFolder', async () => {
            const azd = createMockAzdService();
            const step = new AzdDownStep<AzdWizardContext>(azd);
            const folder = MockUri.file('/project');

            await step.execute({ iacFolder: folder });

            expect(azd.down.mock.callCount()).to.equal(1);
            expect((azd.down.mock.calls[0].arguments[0]).path).to.equal('/project');
        });
    });
});
