/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getRuntimeVersion, type FunctionAppRuntime } from '../../../commands/functions/CreateFunctionAppContext';

describe('CreateFunctionAppContext (unit)', () => {
    describe('getRuntimeVersion', () => {
        const cases: [FunctionAppRuntime, string][] = [
            ['node', 'Node|20'],
            ['python', 'Python|3.11'],
            ['dotnet-isolated', 'DOTNET-ISOLATED|8.0'],
            ['java', 'Java|17'],
            ['powershell', 'PowerShell|7.4'],
            ['custom', 'custom'],
        ];

        for (const [runtime, expected] of cases) {
            it(`should return '${expected}' for '${runtime}'`, () => {
                expect(getRuntimeVersion(runtime)).to.equal(expected);
            });
        }
    });
});
