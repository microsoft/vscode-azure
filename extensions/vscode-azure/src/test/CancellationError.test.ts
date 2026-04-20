/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';

describe('CancellationError (integration)', () => {
    it('should detect vscode.CancellationError via CancellationError.test()', () => {
        const vsCodeError = new vscode.CancellationError();
        expect(CancellationError.test(vsCodeError)).to.be.true;
    });

    it('vscode.CancellationError should use the expected error name', () => {
        const vsCodeError = new vscode.CancellationError();
        expect(vsCodeError.name).to.be.oneOf(['Canceled', 'Cancelled']);
    });
});
