/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { TempDirManager } from '../../src/azd/TempDirManager';

describe('TempDirManager (unit)', () => {
    function createManager() {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const manager = new TempDirManager(ctx);
        return { manager, fs: mockResult.fs };
    }

    it('should create temp directories under storageUri/tmp/', async () => {
        const { manager, fs } = createManager();

        const dir = await manager.createTempDir();

        expect(fs.createDirectory.mock.callCount()).to.equal(1);
        const createdUri = fs.createDirectory.mock.calls[0].arguments[0];
        expect(createdUri.path).to.include('/mock/storage/tmp/d-');
        expect(dir.path).to.equal(createdUri.path);
    });

    it('should create unique directories on each call', async () => {
        const { manager } = createManager();

        const dir1 = await manager.createTempDir();
        const dir2 = await manager.createTempDir();

        expect(dir1.path).to.not.equal(dir2.path);
    });

    it('should delete tracked directories on dispose', async () => {
        const { manager, fs } = createManager();

        await manager.createTempDir();
        await manager.createTempDir();

        manager.dispose();

        expect(fs.delete.mock.callCount()).to.equal(2);
    });

    it('should clear tracked directories after dispose', async () => {
        const { manager, fs } = createManager();

        await manager.createTempDir();
        manager.dispose();

        const countAfterFirst = fs.delete.mock.callCount();

        manager.dispose();
        expect(fs.delete.mock.callCount()).to.equal(countAfterFirst);
    });
});
