/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { detectStaticWebAppProject } from '../../../src/commands/staticWebApps/steps/frameworkDetection';

describe('Static Web Apps framework detection (unit)', () => {
    it('should distinguish Next.js static export and preserve a nested app root', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/frontend/package.json'), JSON.stringify({
            dependencies: { next: '15.0.0', react: '19.0.0' },
            devDependencies: { typescript: '5.0.0' },
        }));
        mock.fs.addFile(MockUri.file('/workspace/frontend/next.config.mjs'), 'export default { output: \'export\' };');
        mock.fs.addFile(MockUri.file('/workspace/frontend/tsconfig.json'), '{}');

        const result = await detectStaticWebAppProject(ctx.code, MockUri.file('/workspace'));

        expect(result.primaryPresetId).to.equal('nextjs-export');
        expect(result.frameworks).to.deep.equal(['nextjs-export']);
        expect(result.appLocation).to.equal('frontend');
        expect(result.language).to.equal('ts');
    });

    it('should resolve Angular output project data from angular.json', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/package.json'), JSON.stringify({
            dependencies: { '@angular/core': '18.0.0' },
        }));
        mock.fs.addFile(MockUri.file('/workspace/angular.json'), JSON.stringify({
            defaultProject: 'portal',
            projects: { portal: {} },
        }));

        const result = await detectStaticWebAppProject(ctx.code, MockUri.file('/workspace'));

        expect(result.primaryPresetId).to.equal('angular');
        expect(result.angularProjectName).to.equal('portal');
    });

    it('should stop at one exactly detected shallow API and exclude generated folders', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/api/host.json'), '{}');
        mock.fs.addFile(MockUri.file('/workspace/src/deep/host.json'), '{}');
        mock.fs.addFile(MockUri.file('/workspace/node_modules/ignored/host.json'), '{}');
        mock.fs.addFile(MockUri.file('/workspace/dist/ignored/host.json'), '{}');

        const result = await detectStaticWebAppProject(ctx.code, MockUri.file('/workspace'));

        expect(result.apiLocations).to.deep.equal(['api']);
    });

    it('should prefer a workspace-root API', async () => {
        const { ctx, mock } = createMockCodeContext();
        mock.fs.addFile(MockUri.file('/workspace/host.json'), '{}');
        mock.fs.addFile(MockUri.file('/workspace/api/host.json'), '{}');

        const result = await detectStaticWebAppProject(ctx.code, MockUri.file('/workspace'));

        expect(result.apiLocations).to.deep.equal(['/']);
    });
});
