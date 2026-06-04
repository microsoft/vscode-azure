/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as os from 'os';
import { getUsernameReplacementOptions } from '../../base/ITelemetryReporter';

describe('getUsernameReplacementOptions (unit)', () => {
    it('should return a replacement option with the current username', () => {
        const options = getUsernameReplacementOptions();
        const username = os.userInfo().username;

        if (username.length < 4) {
            // Short username — should return empty
            expect(options).to.have.length(0);
            return;
        }

        expect(options).to.have.length(1);
        expect(options[0].replacementString).to.equal('<REDACTED: username>');
        expect(options[0].lookup).to.be.instanceOf(RegExp);
    });

    it('should produce a regex that matches the username', () => {
        const options = getUsernameReplacementOptions();
        const username = os.userInfo().username;

        if (username.length < 4) {
            return; // skip for short usernames
        }

        const result = `path/to/${username}/file.txt`.replace(options[0].lookup, options[0].replacementString ?? '');
        expect(result).to.include('<REDACTED: username>');
        expect(result).to.not.include(username);
    });

    it('should be case-insensitive', () => {
        const options = getUsernameReplacementOptions();
        const username = os.userInfo().username;

        if (username.length < 4) {
            return;
        }

        const upper = `path/${username.toUpperCase()}/file`;
        const result = upper.replace(options[0].lookup, options[0].replacementString ?? '');
        expect(result).to.include('<REDACTED: username>');
    });
});
