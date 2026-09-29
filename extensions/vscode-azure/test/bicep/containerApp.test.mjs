/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

void describe('Container App environment (integration)', () => {
    /** @type {unknown} */
    const compiled = JSON.parse(execFileSync('bicep', [
        'build-params', fileURLToPath(new URL('containerApp.bicepparam', import.meta.url)), '--stdout',
    ], { encoding: 'utf8' }));
    assert(compiled && typeof compiled === 'object' && 'parametersJson' in compiled && typeof compiled.parametersJson === 'string');
    /** @type {unknown} */
    const result = JSON.parse(compiled.parametersJson);
    assert(result && typeof result === 'object' && 'parameters' in result);
    const parameters = result.parameters;
    assert(parameters && typeof parameters === 'object');

    /** @param {string} name */
    function value(name) {
        assert(name in parameters);
        /** @type {unknown} */
        const parameter = Reflect.get(parameters, name);
        assert(parameter && typeof parameter === 'object' && 'value' in parameter);
        return parameter.value;
    }

    const connection = { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: 'test-connection' };

    void it('configures telemetry on first creation', () => {
        assert.deepEqual(value('firstCreation'), [connection]);
    });

    void it('preserves unrelated values and secret references while replacing duplicate telemetry entries', () => {
        assert.deepEqual(value('reprovision'), [
            { name: 'APP_MODE', value: 'production' },
            { name: 'API_KEY', secretRef: 'api-key' },
            connection,
        ]);
    });

    void it('keeps the environment stable across repeated provisioning', () => {
        assert.deepEqual(value('repeatedProvision'), value('reprovision'));
    });
});
