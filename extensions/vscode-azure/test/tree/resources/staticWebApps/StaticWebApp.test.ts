/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StaticWebAppResourceType } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    normalizeStaticWebAppBranch,
    StaticWebAppVirtualTypes,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { makeStaticWebApp } from './mockStaticWebApp';

describe('StaticWebApp model (unit)', () => {
    it('should match ARM type and logical type case-insensitively', () => {
        expect(isStaticWebApp(makeStaticWebApp({
            type: StaticWebAppResourceType.toUpperCase(),
            logicalType: 'different',
        }))).to.be.true;
        expect(isStaticWebApp(makeStaticWebApp({
            type: 'different',
            logicalType: StaticWebAppResourceType.toLowerCase(),
        }))).to.be.true;
    });

    it('should reject unrelated generic resources', () => {
        expect(isStaticWebApp(makeGenericResource())).to.be.false;
        expect(isStaticWebApp(undefined)).to.be.false;
    });

    it('should match only known virtual nodes owned by a Static Web App', () => {
        expect(isStaticWebAppVirtualNode(makeVirtualResource({
            azureResource: makeStaticWebApp(),
            virtualType: StaticWebAppVirtualTypes.Actions,
            virtualPath: 'environments/default/actions',
        }))).to.be.true;
        expect(isStaticWebAppVirtualNode(makeVirtualResource({
            azureResource: makeStaticWebApp(),
            virtualType: 'staticWebApp.unknown',
        }))).to.be.false;
    });

    it('should normalize preview branch prefixes without truncating plain branches', () => {
        expect(normalizeStaticWebAppBranch('GitHubAccount:feature/test')).to.equal('feature/test');
        expect(normalizeStaticWebAppBranch('main')).to.equal('main');
    });
});
