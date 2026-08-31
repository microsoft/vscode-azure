/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { SwaCliConfigFileName, tryGetStaticWebAppsCliConfig } from '../../src/staticWebApps/SwaCliConfig';

describe('SwaCliConfig (unit)', () => {
    it('should return undefined when the SWA CLI config is absent', async () => {
        const mockResult = createMockVsCode();
        expect(await tryGetStaticWebAppsCliConfig(
            mockResult.vscode,
            mockResult.vscode.Uri.file('/workspace'),
        )).to.equal(undefined);
    });

    it('should surface a useful localized JSON parse error', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, SwaCliConfigFileName),
            '{ not-json',
        );

        let error: unknown;
        try {
            await tryGetStaticWebAppsCliConfig(mockResult.vscode, root);
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain(SwaCliConfigFileName);
        expect((error as Error).message).to.contain('parse');
    });

});
