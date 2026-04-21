/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type * as vscode from 'vscode';
import { findAzureYaml } from '../../utils/azdUtils';

describe('findAzureYaml (unit)', () => {
    it('should return azure.yaml URI when it exists', async () => {
        const { vscode: code, fs } = createMockVsCode();
        fs.addFile(MockUri.file('/project/azure.yaml'));

        const result = await findAzureYaml(code, MockUri.file('/project') as unknown as vscode.Uri);

        expect(result).to.not.be.undefined;
        expect(result!.path).to.equal('/project/azure.yaml');
    });

    it('should return azure.yml URI when azure.yaml does not exist', async () => {
        const { vscode: code, fs } = createMockVsCode();
        fs.addFile(MockUri.file('/project/azure.yml'));

        const result = await findAzureYaml(code, MockUri.file('/project') as unknown as vscode.Uri);

        expect(result).to.not.be.undefined;
        expect(result!.path).to.equal('/project/azure.yml');
    });

    it('should prefer azure.yaml over azure.yml when both exist', async () => {
        const { vscode: code, fs } = createMockVsCode();
        fs.addFile(MockUri.file('/project/azure.yaml'));
        fs.addFile(MockUri.file('/project/azure.yml'));

        const result = await findAzureYaml(code, MockUri.file('/project') as unknown as vscode.Uri);

        expect(result!.path).to.equal('/project/azure.yaml');
    });

    it('should return undefined when neither file exists', async () => {
        const { vscode: code } = createMockVsCode();

        const result = await findAzureYaml(code, MockUri.file('/project') as unknown as vscode.Uri);

        expect(result).to.be.undefined;
    });
});
