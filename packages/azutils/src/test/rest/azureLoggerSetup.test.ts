/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Test needs direct access to the global AzureLogger / getLogLevel helpers.
import { AzureLogger, createClientLogger, getLogLevel, setLogLevel } from '@azure/logger';
import { DebugOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { setUpAzureSdkLogging } from '../../rest/azureLoggerSetup';

describe('setUpAzureSdkLogging (unit)', () => {
    const originalLog = AzureLogger.log;

    afterEach(() => {
        AzureLogger.log = originalLog;
        setLogLevel(undefined);
    });

    it('forwards AzureLogger.log to output.debug with [azure-sdk] prefix', () => {
        const output = new DebugOutputChannel('test');
        output.logLevel = 2 as vscode.LogLevel; // Debug
        const debugSpy = mock.method(output, 'debug');

        const disposable = setUpAzureSdkLogging(output);
        try {
            AzureLogger.log('hello %s', 'world');

            expect(debugSpy.mock.callCount()).to.equal(1);
            expect(debugSpy.mock.calls[0].arguments).to.deep.equal(['[azure-sdk] hello %s', 'world']);
        } finally {
            disposable.dispose();
        }
    });

    it('routes per-severity client logger messages to the matching output method', () => {
        const output = new DebugOutputChannel('test');
        output.logLevel = 1 as vscode.LogLevel; // Trace -> 'verbose' so all levels fire

        const errorSpy = mock.method(output, 'error');
        const warnSpy = mock.method(output, 'warn');
        const infoSpy = mock.method(output, 'info');
        const debugSpy = mock.method(output, 'debug');

        const disposable = setUpAzureSdkLogging(output);
        try {
            const client = createClientLogger('test-routing');
            client.error('boom %s', 'x');
            client.warning('careful %s', 'y');
            client.info('fyi %s', 'z');
            client.verbose('noise %s', 'w');

            expect(errorSpy.mock.callCount()).to.equal(1);
            expect(errorSpy.mock.calls[0].arguments).to.deep.equal(['[azure:test-routing] boom %s', 'x']);

            expect(warnSpy.mock.callCount()).to.equal(1);
            expect(warnSpy.mock.calls[0].arguments).to.deep.equal(['[azure:test-routing] careful %s', 'y']);

            expect(infoSpy.mock.callCount()).to.equal(1);
            expect(infoSpy.mock.calls[0].arguments).to.deep.equal(['[azure:test-routing] fyi %s', 'z']);

            // Only the verbose client call should reach the debug sink; the
            // plain `AzureLogger.log` fallback path is exercised separately.
            expect(debugSpy.mock.callCount()).to.equal(1);
            expect(debugSpy.mock.calls[0].arguments).to.deep.equal(['[azure:test-routing] noise %s', 'w']);
        } finally {
            disposable.dispose();
        }
    });

    it('applies the initial log level based on the output channel logLevel', () => {
        const output = new DebugOutputChannel('test');
        output.logLevel = 3 as vscode.LogLevel; // Info

        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(getLogLevel()).to.equal('info');
        } finally {
            disposable.dispose();
        }
    });

    it('re-applies the log level when onDidChangeLogLevel fires', () => {
        const output = new DebugOutputChannel('test');
        output.logLevel = 3 as vscode.LogLevel; // Info

        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(getLogLevel()).to.equal('info');

            output.logLevel = 1 as vscode.LogLevel; // Trace -> 'verbose'
            expect(getLogLevel()).to.equal('verbose');

            output.logLevel = 4 as vscode.LogLevel; // Warning
            expect(getLogLevel()).to.equal('warning');
        } finally {
            disposable.dispose();
        }
    });

    it('maps LogLevel.Off to undefined (disables Azure SDK logging)', () => {
        const output = new DebugOutputChannel('test');
        output.logLevel = 0 as vscode.LogLevel; // Off

        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(getLogLevel()).to.equal(undefined);
        } finally {
            disposable.dispose();
        }
    });

    it('falls back to the least-verbose level for an unknown LogLevel', () => {
        const output = new DebugOutputChannel('test');
        // Use a value outside the known vscode.LogLevel range (Off..Error = 0..5)
        // to exercise the fallback branch in `toAzureLogLevel`.
        output.logLevel = 99 as vscode.LogLevel;

        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(getLogLevel()).to.equal('error');
        } finally {
            disposable.dispose();
        }
    });

    it('restores the previous AzureLogger.log on dispose', () => {
        const sentinel = () => { /* previous sink */ };
        AzureLogger.log = sentinel;

        const output = new DebugOutputChannel('test');
        output.logLevel = 3 as vscode.LogLevel;
        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(AzureLogger.log).to.not.equal(sentinel);

            disposable.dispose();
            expect(AzureLogger.log).to.equal(sentinel);
        } finally {
            // Safe to call twice; the second dispose is a no-op for the
            // AzureLogger.log restore path but still clears internal state
            // if the earlier dispose was skipped due to an assertion failure.
            disposable.dispose();
        }
    });

    it('restores the previous @azure/logger level on dispose', () => {
        setLogLevel('warning');

        const output = new DebugOutputChannel('test');
        output.logLevel = 1 as vscode.LogLevel; // Trace -> 'verbose'
        const disposable = setUpAzureSdkLogging(output);
        try {
            expect(getLogLevel()).to.equal('verbose');

            disposable.dispose();
            expect(getLogLevel()).to.equal('warning');
        } finally {
            disposable.dispose();
        }
    });

    it('is a no-op when a previous setup is still active', () => {
        const output1 = new DebugOutputChannel('first');
        output1.logLevel = 2 as vscode.LogLevel; // Debug
        const debug1 = mock.method(output1, 'debug');

        const first = setUpAzureSdkLogging(output1);
        try {
            const output2 = new DebugOutputChannel('second');
            output2.logLevel = 2 as vscode.LogLevel;
            const debug2 = mock.method(output2, 'debug');

            const second = setUpAzureSdkLogging(output2);
            try {
                // Second call should not have replaced the first sink.
                AzureLogger.log('hello');
                expect(debug1.mock.callCount()).to.equal(1);
                expect(debug2.mock.callCount()).to.equal(0);
            } finally {
                // Disposing the no-op should not break the first setup.
                second.dispose();
            }

            AzureLogger.log('again');
            expect(debug1.mock.callCount()).to.equal(2);
            expect(debug2.mock.callCount()).to.equal(0);
        } finally {
            first.dispose();
        }
    });
});
