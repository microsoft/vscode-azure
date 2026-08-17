/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import {
    parseStaticWebAppWorkflow,
    scanStaticWebAppWorkflows,
} from '../../../../src/tree/resources/staticWebApps/workflowParser';

const validWorkflow = `name: Deploy
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          app_location: app
          api_location: api
          output_location: dist
          app_artifact_location: legacy
`;

describe('Static Web Apps workflow parser (unit)', () => {
    it('should extract builddeploy settings and source ranges in stable order', async () => {
        const mockResult = createMockVsCode();
        const uri = mockResult.vscode.Uri.file('/repo/.github/workflows/swa.yml');
        mockResult.fs.addFile(uri, validWorkflow);

        const workflow = await parseStaticWebAppWorkflow(mockResult.vscode, uri);

        expect(workflow?.settings.map(setting => setting.name)).to.deep.equal([
            'app_location',
            'api_location',
            'output_location',
            'app_artifact_location',
        ]);
        expect(workflow?.settings.map(setting => setting.value)).to.deep.equal(['app', 'api', 'dist', 'legacy']);
        expect(workflow?.settings[0].range.start.line).to.equal(8);
        expect(workflow?.settings[0].range.end.character).to.be.greaterThan(workflow?.settings[0].range.start.character ?? 0);
    });

    it('should ignore unrelated actions and builddeploy steps without app_location', async () => {
        const mockResult = createMockVsCode();
        const unrelated = mockResult.vscode.Uri.file('/repo/.github/workflows/unrelated.yml');
        const incomplete = mockResult.vscode.Uri.file('/repo/.github/workflows/incomplete.yml');
        mockResult.fs.addFile(unrelated, 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n');
        mockResult.fs.addFile(incomplete, `jobs:
  build:
    steps:
      - id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          output_location: dist
`);

        expect(await parseStaticWebAppWorkflow(mockResult.vscode, unrelated)).to.be.undefined;
        expect(await parseStaticWebAppWorkflow(mockResult.vscode, incomplete)).to.be.undefined;
    });

    it('should preserve parse-error range metadata', async () => {
        const mockResult = createMockVsCode();
        const uri = mockResult.vscode.Uri.file('/repo/.github/workflows/broken.yml');
        mockResult.fs.addFile(uri, 'jobs:\n  build:\n    steps:\n      - id: builddeploy\n        with: [\n');

        const workflow = await parseStaticWebAppWorkflow(mockResult.vscode, uri);

        expect(workflow?.settings).to.deep.equal([]);
        expect(workflow?.errorRange).to.exist;
        expect(workflow?.errorRange?.start.line).to.be.greaterThan(0);
    });

    it('should scan both YAML extensions through workspace.fs and omit unrelated files', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/repo');
        mockResult.fs.addFile(mockResult.vscode.Uri.file('/repo/.github/workflows/first.yml'), validWorkflow);
        mockResult.fs.addFile(mockResult.vscode.Uri.file('/repo/.github/workflows/second.yaml'), validWorkflow);
        mockResult.fs.addFile(mockResult.vscode.Uri.file('/repo/.github/workflows/notes.txt'), validWorkflow);
        mockResult.fs.addFile(mockResult.vscode.Uri.file('/repo/.github/workflows/unrelated.yml'), 'name: Other\n');

        const workflows = await scanStaticWebAppWorkflows(mockResult.vscode, root);

        expect(workflows.map(workflow => workflow.uri.path)).to.deep.equal([
            '/repo/.github/workflows/first.yml',
            '/repo/.github/workflows/second.yaml',
        ]);
        expect(mockResult.fs.readDirectory.mock.callCount()).to.equal(1);
    });

    it('should return no workflows when the directory does not exist', async () => {
        const mockResult = createMockVsCode();
        const workflows = await scanStaticWebAppWorkflows(mockResult.vscode, mockResult.vscode.Uri.file('/repo'));
        expect(workflows).to.deep.equal([]);
    });
});
