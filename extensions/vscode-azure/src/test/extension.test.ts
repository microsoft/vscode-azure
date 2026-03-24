/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { before, it } from 'mocha';
import * as vscode from 'vscode';

before('extension', () => {
    it('should activate', async () => {
        const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azure');
        if (!extension) {
            expect.fail('Extension not found');
        }

        await extension.activate();
    });
});
