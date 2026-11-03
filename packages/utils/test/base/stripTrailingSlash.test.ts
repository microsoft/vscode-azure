/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripTrailingSlash } from '../../src/base/stripTrailingSlash';

describe('stripTrailingSlash (unit)', () => {
    it('returns an empty string for empty input', () => {
        expect(stripTrailingSlash('')).to.equal('');
    });

    it('preserves strings without trailing forward slashes', () => {
        for (const value of ['path', '/path/to/file', 'https://example.test/path', 'path\\', 'path/ ', 'path/\n']) {
            expect(stripTrailingSlash(value)).to.equal(value);
        }
    });

    it('removes one or more trailing forward slashes', () => {
        for (const suffix of ['/', '///']) {
            expect(stripTrailingSlash(`https://example.test/path${suffix}`)).to.equal('https://example.test/path');
        }
    });

    it('returns an empty string for slash-only input', () => {
        for (const value of ['/', '///']) {
            expect(stripTrailingSlash(value)).to.equal('');
        }
    });

    it('preserves leading and internal slashes when stripping trailing slashes', () => {
        expect(stripTrailingSlash('/path//to/file///')).to.equal('/path//to/file');
    });

    it('handles long internal and trailing slash sequences', () => {
        const slashes = '/'.repeat(100_000);
        const value = `https://example.test${slashes}path`;
        expect(stripTrailingSlash(value)).to.equal(value);
        expect(stripTrailingSlash(`${value}${slashes}`)).to.equal(value);
        expect(stripTrailingSlash(slashes)).to.equal('');
    });
});
