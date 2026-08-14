/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { Container } from 'inversify';
import { mock } from 'node:test';
import { registerSettings } from '../../src/products/registerSettings';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import { IAzureViewDataTree } from '../../src/services';
import { ISettingsFileSystem, registerSettingsFileSystem } from '../../src/settings/registerSettings';
import { SettingsScheme } from '../../src/settings/SettingsUri';

function setup() {
    const { vscode } = createMockVsCode();
    const subscriptions: Disposable[] = [];
    const container = new Container();

    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue({ subscriptions } as never);
    container.bind(IAzureViewDataTree).toConstantValue({ get: () => undefined } as never);

    // The real product bindings, so this exercises what ships rather than a hand-wired container.
    const registrar = new ProductRegistrar();
    registerSettings(registrar);
    registrar.applyBindings(container);

    const registerFileSystemProvider = vscode.workspace.registerFileSystemProvider as unknown as
        ReturnType<typeof mock.fn<(scheme: string, provider: unknown, options: unknown) => Disposable>>;

    return { container, subscriptions, registerFileSystemProvider };
}

describe('registerSettingsFileSystem (unit)', () => {
    it('disposes the provider with the extension, via the binding rather than by hand', () => {
        const { container, subscriptions } = setup();

        const provider = container.get(ISettingsFileSystem);

        // `onActivation(pushDisposable)` owns this; registerSettingsFileSystem must not push it again.
        expect(subscriptions.filter(disposable => disposable === provider)).to.have.lengthOf(1);
    });

    it('registers the provider for the azure-settings scheme, case-sensitively', () => {
        const { container, registerFileSystemProvider } = setup();

        registerSettingsFileSystem(container);

        expect(registerFileSystemProvider.mock.callCount()).to.equal(1);
        const [scheme, provider, options] = registerFileSystemProvider.mock.calls[0].arguments;
        expect(scheme).to.equal(SettingsScheme);
        expect(provider).to.equal(container.get(ISettingsFileSystem));
        // ARM ids are packed into the URI path and setting names are case-sensitive in Azure.
        expect(options).to.deep.equal({ isCaseSensitive: true });
    });

    it('disposes both the provider and its registration exactly once each', () => {
        const { container, subscriptions } = setup();

        registerSettingsFileSystem(container);

        const provider = container.get(ISettingsFileSystem);
        expect(subscriptions).to.have.lengthOf(2);
        expect(subscriptions.filter(disposable => disposable === provider)).to.have.lengthOf(1);
    });
});
