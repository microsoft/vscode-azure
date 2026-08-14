/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { appSettingsParentKey } from '../../../../src/tree/resources/functions/appSettingsParentKey';
import { FunctionAppVirtualTypes } from '../../../../src/tree/resources/functions/FunctionApp';
import { makeFunctionApp } from './mockFunctionApp';

describe('appSettingsParentKey (unit)', () => {
    it('builds the canonical App Settings parent key from an app-setting virtual resource', () => {
        const setting = makeVirtualResource({
            virtualType: FunctionAppVirtualTypes.AppSetting,
            virtualPath: 'MY_SETTING',
            azureResource: makeFunctionApp(),
        });

        // The parent key targets the "App Settings" category node (fragment
        // `#/functionApp.appSettings/App%20Settings`) hanging off the owning
        // function app's ARM id -- not the individual setting.
        expect(appSettingsParentKey(setting)).to.equal(
            'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myFunc#/functionApp.appSettings/App%20Settings',
        );
    });

    it('keys only off the owning function app, ignoring the individual setting path', () => {
        const settingA = makeVirtualResource({ virtualType: FunctionAppVirtualTypes.AppSetting, virtualPath: 'A', azureResource: makeFunctionApp() });
        const settingB = makeVirtualResource({ virtualType: FunctionAppVirtualTypes.AppSetting, virtualPath: 'B', azureResource: makeFunctionApp() });

        expect(appSettingsParentKey(settingA)).to.equal(appSettingsParentKey(settingB));
    });
});
