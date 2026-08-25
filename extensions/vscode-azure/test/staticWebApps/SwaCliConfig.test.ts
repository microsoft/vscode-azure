/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import {
    getFolderContainingDatabaseConfig,
    staticWebAppDatabaseDetector,
} from '../../src/staticWebApps/DatabaseConfigDetector';
import { createTestIndexService } from '../utils/workspaceIndex/createTestIndexService';
import { SwaCliConfigFileName, tryGetStaticWebAppsCliConfig } from '../../src/staticWebApps/SwaCliConfig';

/** Indexes the mock workspace exactly as the extension does, then queries it. */
async function findDatabaseConfigFolder(
    mockResult: ReturnType<typeof createMockVsCode>,
    root: vscode.Uri,
    siblingFolders: readonly vscode.Uri[] = [],
): Promise<vscode.Uri | undefined> {
    for (const [index, uri] of [root, ...siblingFolders].entries()) {
        mockResult.workspaceFolders.push({ uri, name: `workspace${index}`, index });
    }
    const indexService = createTestIndexService(mockResult.vscode, [staticWebAppDatabaseDetector]);
    return getFolderContainingDatabaseConfig(mockResult.vscode, indexService, root);
}

describe('Static Web Apps local config detection (unit)', () => {
    it('should parse the complete SWA CLI option surface', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const options = {
            context: 'http://localhost:3000',
            dataApiLocation: 'data',
            port: 4280,
            host: 'localhost',
            apiPort: 7071,
            ssl: true,
            apiPrefix: 'api',
            sslCert: 'cert.pem',
            sslKey: 'key.pem',
            swaConfigFilename: 'staticwebapp.config.json',
            swaConfigFilenameLegacy: 'routes.json',
            app: 'app',
            apiLocation: 'api',
            build: false,
            verbose: 'silly',
            run: 'npm start',
            swaConfigLocation: '.',
            customUrlScheme: 'custom',
            overridableErrorCode: [404],
            devserverTimeout: 90000,
            funcArgs: '--verbose',
            appBuildCommand: 'npm run build',
            apiBuildCommand: 'npm run api',
            appLocation: 'src',
            outputLocation: 'dist',
            files: ['one.txt'],
        };
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, SwaCliConfigFileName),
            JSON.stringify({ configurations: { app: options } }),
        );

        const result = await tryGetStaticWebAppsCliConfig(mockResult.vscode, root);

        expect(result?.configurations?.app).to.deep.equal(options);
    });

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

    it('should prefer the shallowest database config outside excluded directories', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'node_modules', 'staticwebapp.database.config.json'),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'too', 'deep', 'staticwebapp.database.config.json'),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'data', 'staticwebapp.database.config.json'),
        );

        const result = await findDatabaseConfigFolder(mockResult, root);

        expect(result?.path).to.equal('/workspace/data');
    });

    it('should not treat a root database config as a match', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'staticwebapp.database.config.json'),
        );

        expect(await findDatabaseConfigFolder(mockResult, root)).to.equal(undefined);
    });

    it('should find a nested database config when nothing shallower has one', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'one', 'two', 'staticwebapp.database.config.json'),
        );

        const result = await findDatabaseConfigFolder(mockResult, root);

        expect(result?.path).to.equal('/workspace/one/two');
    });

    it('should ignore a database config in a sibling workspace folder', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        const sibling = mockResult.vscode.Uri.file('/other');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(sibling, 'data', 'staticwebapp.database.config.json'),
        );

        expect(await findDatabaseConfigFolder(mockResult, root, [sibling])).to.equal(undefined);
    });

    it('should ignore a database config inside an excluded directory', async () => {
        const mockResult = createMockVsCode();
        const root = mockResult.vscode.Uri.file('/workspace');
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'node_modules', 'pkg', 'staticwebapp.database.config.json'),
        );
        mockResult.fs.addFile(
            mockResult.vscode.Uri.joinPath(root, 'dist', 'staticwebapp.database.config.json'),
        );

        expect(await findDatabaseConfigFolder(mockResult, root)).to.equal(undefined);
    });
});
