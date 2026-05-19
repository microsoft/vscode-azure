/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import type {
    AzdProjectNode, AzdServiceNode, EmulatorNode, EmulatorsGroupNode,
    FunctionsProjectNode, WorkspaceNode,
} from '../../../tree/workspace/WorkspaceNode';
import {
    AzdProjectKeyPrefix, AzdServiceKeyPrefix, EmulatorKeyPrefix,
    EmulatorsGroupId, FunctionsProjectKeyPrefix,
} from '../../../tree/workspace/WorkspaceNode';

export function makeAzdProjectNode(overrides?: Partial<AzdProjectNode>): AzdProjectNode {
    const folder = overrides?.resourceUri ?? MockUri.file('/repo');
    const yaml = overrides?.azureYamlUri ?? MockUri.file('/repo/azure.yaml');
    return {
        id: `${AzdProjectKeyPrefix}${folder.toString()}`,
        type: 'azdProject',
        label: 'repo',
        resourceUri: folder as never,
        azureYamlUri: yaml as never,
        ...overrides,
    };
}

export function makeAzdServiceNode(overrides?: Partial<AzdServiceNode>): AzdServiceNode {
    const folder = overrides?.projectFolderUri ?? MockUri.file('/repo');
    return {
        id: `${AzdServiceKeyPrefix}${folder.toString()}/api`,
        type: 'azdService',
        label: 'api',
        serviceName: 'api',
        projectFolderUri: folder as never,
        ...overrides,
    };
}

export function makeFunctionsProjectNode(overrides?: Partial<FunctionsProjectNode>): FunctionsProjectNode {
    const folder = overrides?.resourceUri ?? MockUri.file('/repo');
    return {
        id: `${FunctionsProjectKeyPrefix}${folder.toString()}`,
        type: 'functionsProject',
        label: 'repo',
        resourceUri: folder as never,
        ...overrides,
    };
}

export function makeEmulatorsGroupNode(overrides?: Partial<EmulatorsGroupNode>): EmulatorsGroupNode {
    return {
        id: EmulatorsGroupId,
        type: 'emulatorsGroup',
        label: 'Emulators',
        ...overrides,
    };
}

export function makeEmulatorNode(overrides?: Partial<EmulatorNode>): EmulatorNode {
    return {
        id: `${EmulatorKeyPrefix}azurite`,
        type: 'emulator',
        label: 'Azurite',
        ...overrides,
    };
}

export function makeWorkspaceNode(overrides?: Partial<WorkspaceNode>): WorkspaceNode {
    return makeAzdProjectNode(overrides as Partial<AzdProjectNode>);
}
