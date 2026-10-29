/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { WriteStaticWebAppCliConfigStep } from '../../../src/commands/staticWebApps/steps/WriteStaticWebAppCliConfigStep';
import type { CreateStaticWebAppContext } from '../../../src/commands/staticWebApps/CreateStaticWebAppContext';
import { SwaCliConfigFileName } from '../../../src/staticWebApps/SwaCliConfig';

describe('WriteStaticWebAppCliConfigStep (unit)', () => {
    it('should write the complete generated configuration for deployment', async () => {
        const { vscode, fs } = createMockVsCode();
        const step = new WriteStaticWebAppCliConfigStep(vscode);
        const config = {
            configurations: {
                detected: {
                    appLocation: 'app',
                    apiLocation: 'api',
                    outputLocation: 'dist',
                    apiLanguage: 'python',
                    apiVersion: '3.11',
                },
            },
        };
        const context = {
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            deploy: true,
            iacFolder: MockUri.file('/workspace'),
            swaCliConfig: config,
            swaCliConfigNeedsWrite: true,
        } as CreateStaticWebAppContext;

        expect(step.shouldExecute(context)).to.equal(true);
        await step.execute(context);

        const uri = vscode.Uri.joinPath(context.iacFolder!, SwaCliConfigFileName);
        const written = JSON.parse(new TextDecoder().decode(fs.files.get(uri.path)));
        expect(written).to.deep.equal(config);
    });

    it('should leave an existing configuration untouched', () => {
        const { vscode } = createMockVsCode();
        const step = new WriteStaticWebAppCliConfigStep(vscode);

        expect(step.shouldExecute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            deploy: true,
            iacFolder: MockUri.file('/workspace'),
            swaCliConfig: { configurations: { mine: { appLocation: 'app' } } },
            swaCliConfigNeedsWrite: false,
        })).to.equal(false);
    });

    it('should refuse an untrusted workspace before reading or writing the project', async () => {
        const { vscode, fs, workspace } = createMockVsCode();
        mock.property(workspace, 'isTrusted', false);
        const step = new WriteStaticWebAppCliConfigStep(vscode);

        await expect(step.execute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            deploy: true,
            iacFolder: MockUri.file('/workspace'),
            swaCliConfig: { configurations: { detected: { appLocation: 'app' } } },
            swaCliConfigNeedsWrite: true,
        })).to.be.rejectedWith(/untrusted workspace/);

        expect(fs.stat.mock.callCount()).to.equal(0);
        expect(fs.writeFile.mock.callCount()).to.equal(0);
    });

    it('should refuse to replace a configuration created after detection', async () => {
        const { vscode, fs } = createMockVsCode();
        const step = new WriteStaticWebAppCliConfigStep(vscode);
        const iacFolder = MockUri.file('/workspace');
        const uri = vscode.Uri.joinPath(iacFolder, SwaCliConfigFileName);
        fs.addFile(uri, '{"configurations":{"mine":{}}}');

        await expect(step.execute({
            resourceDisplayName: 'Static Web App',
            job: 'deploy',
            deploy: true,
            iacFolder,
            swaCliConfig: { configurations: { detected: { appLocation: 'app' } } },
            swaCliConfigNeedsWrite: true,
        })).to.be.rejectedWith(/created while this command was running/i);
    });
});
