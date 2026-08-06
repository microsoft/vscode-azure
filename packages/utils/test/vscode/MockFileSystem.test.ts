/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as assert from 'node:assert';
import { MockFileSystem } from './MockFileSystem';
import { MockUri } from './MockUri';

describe('MockFileSystem (unit)', () => {
    const missingUri = MockUri.file('/project/missing.json');

    it('creates standard filesystem errors', () => {
        const error = MockFileSystem.createError('NoPermissions', missingUri);

        expect(error).to.be.instanceOf(Error);
        expect(error.code).to.equal('NoPermissions');
        expect(error.message).to.equal('No permissions: /project/missing.json');
    });

    it('rejects stat with FileNotFound when a path is missing', async () => {
        const fs = new MockFileSystem();

        await assert.rejects(fs.stat(missingUri), { code: 'FileNotFound' });
    });

    it('rejects readFile with FileNotFound when a path is missing', async () => {
        const fs = new MockFileSystem();

        await assert.rejects(fs.readFile(missingUri), { code: 'FileNotFound' });
    });
});
