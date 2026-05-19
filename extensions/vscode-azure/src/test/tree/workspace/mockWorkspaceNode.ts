/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    AzdProjectNode, AzdServiceNode, EmulatorNode, EmulatorsGroupNode,
    FunctionsProjectNode, WorkspaceNode,
} from '../../../tree/workspace/WorkspaceNode';

type MockUriLike = { path: string; toString(): string };

export function makeAzdProjectNode(overrides?: Partial<AzdProjectNode>): AzdProjectNode {
    const folder = (overrides?.resourceUri as MockUriLike | undefined) ?? makeUri('/repo');
    const yaml = (overrides?.azureYamlUri as MockUriLike | undefined) ?? makeUri('/repo/azure.yaml');
    return {
        id: `azwr://azdProject/${folder.toString()}`,
        type: 'azdProject',
        label: 'repo',
        resourceUri: folder as never,
        azureYamlUri: yaml as never,
        ...overrides,
    };
}

export function makeAzdServiceNode(overrides?: Partial<AzdServiceNode>): AzdServiceNode {
    const folder = (overrides?.projectFolderUri as MockUriLike | undefined) ?? makeUri('/repo');
    return {
        id: `azwr://azdService/${folder.toString()}/api`,
        type: 'azdService',
        label: 'api',
        serviceName: 'api',
        projectFolderUri: folder as never,
        ...overrides,
    };
}

export function makeFunctionsProjectNode(overrides?: Partial<FunctionsProjectNode>): FunctionsProjectNode {
    const folder = (overrides?.resourceUri as MockUriLike | undefined) ?? makeUri('/repo');
    return {
        id: `azwr://functionsProject/${folder.toString()}`,
        type: 'functionsProject',
        label: 'repo',
        resourceUri: folder as never,
        ...overrides,
    };
}

export function makeEmulatorsGroupNode(overrides?: Partial<EmulatorsGroupNode>): EmulatorsGroupNode {
    return {
        id: 'azwr://emulators',
        type: 'emulatorsGroup',
        label: 'Emulators',
        ...overrides,
    };
}

export function makeEmulatorNode(overrides?: Partial<EmulatorNode>): EmulatorNode {
    return {
        id: 'azwr://emulator/azurite',
        type: 'emulator',
        label: 'Azurite',
        ...overrides,
    };
}

export function makeWorkspaceNode(overrides?: Partial<WorkspaceNode>): WorkspaceNode {
    return makeAzdProjectNode(overrides as Partial<AzdProjectNode>);
}

function makeUri(path: string): MockUriLike {
    return { path, toString() { return `file://${path}`; } };
}
