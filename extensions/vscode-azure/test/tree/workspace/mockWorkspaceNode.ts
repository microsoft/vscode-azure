/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import type {
    AzdProjectNode, AzdServiceNode, EmulatorNode, EmulatorsGroupNode,
    FunctionsProjectNode
} from '../../../src/tree/workspace/WorkspaceNode';
import {
    AzdProjectKeyPrefix, AzdServiceKeyPrefix, EmulatorKeyPrefix,
    EmulatorsGroupId, FunctionsProjectKeyPrefix,
} from '../../../src/tree/workspace/WorkspaceNode';

export function makeAzdProjectNode(overrides?: Partial<AzdProjectNode>): AzdProjectNode {
    const yaml = overrides?.resourceUri ?? MockUri.file('/repo/azure.yaml');
    return {
        id: `${AzdProjectKeyPrefix}${yaml.toString()}`,
        type: 'azdProject',
        label: 'repo',
        resourceUri: yaml,
        ...overrides,
    };
}

export function makeAzdServiceNode(overrides?: Partial<AzdServiceNode>): AzdServiceNode {
    const yaml = overrides?.resourceUri ?? MockUri.file('/repo/azure.yaml');
    return {
        id: `${AzdServiceKeyPrefix}${yaml.toString()}/api`,
        type: 'azdService',
        label: 'api',
        serviceName: 'api',
        resourceUri: yaml,
        ...overrides,
    };
}

export function makeFunctionsProjectNode(overrides?: Partial<FunctionsProjectNode>): FunctionsProjectNode {
    const hostJson = overrides?.resourceUri ?? MockUri.file('/repo/host.json');
    return {
        id: `${FunctionsProjectKeyPrefix}${hostJson.toString()}`,
        type: 'functionsProject',
        resourceUri: hostJson,
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
