/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IWebAppClient } from '@microsoft/vscode-azure-azutils';
import { CaselessSet } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { selectFunctionKey, validateLocalFunctionUrl, validateRemoteFunctionUrl } from '../../src/functions/FunctionUrlResolver';

describe('FunctionUrlResolver (unit)', () => {
    const { vscode: code } = createMockVsCode();

    describe('validateLocalFunctionUrl', () => {
        it('accepts a loopback http URL on the registered port', () => {
            expect(validateLocalFunctionUrl(code, 'http://localhost:7071/api/a?x=1', 7071).toString()).to.equal('http://localhost:7071/api/a?x=1');
        });

        it('serves a loopback https-reported URL over http because the owned host has no TLS', () => {
            expect(validateLocalFunctionUrl(code, 'https://localhost:7071/api/a?x=1', 7071).toString()).to.equal('http://localhost:7071/api/a?x=1');
        });

        for (const rawUrl of ['https://localhost:7072/api/a', 'ftp://localhost:7071/api/a', 'http://example.com:7071/api/a', 'http://localhost:7072/api/a', 'http://user:pw@localhost:7071/api/a', undefined, 'not a url']) {
            it(`rejects ${String(rawUrl)}`, () => {
                expect(() => validateLocalFunctionUrl(code, rawUrl, 7071)).to.throw();
            });
        }
    });

    describe('validateRemoteFunctionUrl', () => {
        const hosts = new CaselessSet(['app.azurewebsites.net']);

        it('strips any code parameter regardless of case and keeps the rest', () => {
            const url = validateRemoteFunctionUrl(code, 'https://APP.azurewebsites.net/api/a?code=x&Code=y&k=v', hosts);
            expect(url.search).to.equal('?k=v');
        });

        for (const rawUrl of ['http://app.azurewebsites.net/api/a', 'https://other.example.com/api/a', 'https://u:p@app.azurewebsites.net/api/a', undefined]) {
            it(`rejects ${String(rawUrl)}`, () => {
                expect(() => validateRemoteFunctionUrl(code, rawUrl, hosts)).to.throw();
            });
        }
    });

    describe('selectFunctionKey', () => {
        function webApps() {
            return {
                listFunctionKeys: mock.fn(() => Promise.resolve<{ properties: Record<string, string> }>({ properties: { default: 'fn-key' } })),
                listHostKeys: mock.fn(() => Promise.resolve({ masterKey: 'master', functionKeys: { default: 'host-fn-key' } })),
            };
        }
        const asClient = (value: ReturnType<typeof webApps>) => value as unknown as IWebAppClient['webApps'];

        it('reads no keys for anonymous access', async () => {
            const w = webApps();
            expect(await selectFunctionKey(asClient(w), 'g', 'a', 'f', 'anonymous', () => Promise.resolve())).to.equal(undefined);
            expect(w.listFunctionKeys.mock.callCount() + w.listHostKeys.mock.callCount()).to.equal(0);
        });

        it('uses the function key rather than a broader key for function access', async () => {
            const w = webApps();
            expect(await selectFunctionKey(asClient(w), 'g', 'a', 'f', 'function', () => Promise.resolve())).to.equal('fn-key');
            expect(w.listHostKeys.mock.callCount()).to.equal(0);
        });

        it('falls back to a host function key when the function has none', async () => {
            const w = webApps();
            w.listFunctionKeys.mock.mockImplementation(() => Promise.resolve({ properties: {} }));
            expect(await selectFunctionKey(asClient(w), 'g', 'a', 'f', 'function', () => Promise.resolve())).to.equal('host-fn-key');
        });

        it('reads the master key only after consent, and not when consent is refused', async () => {
            const w = webApps();
            expect(await selectFunctionKey(asClient(w), 'g', 'a', 'f', 'admin', () => Promise.resolve())).to.equal('master');
            const refused = webApps();
            await selectFunctionKey(asClient(refused), 'g', 'a', 'f', 'admin', () => Promise.reject(new Error('declined'))).catch(() => undefined);
            expect(refused.listHostKeys.mock.callCount()).to.equal(0);
        });
    });
});
