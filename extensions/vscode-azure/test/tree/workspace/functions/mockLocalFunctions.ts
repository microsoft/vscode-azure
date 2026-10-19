/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockFunctionsHostClient } from '@microsoft/vscode-azure-azutils/testing';
import { DataItemTree } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockCodeContext, createTestActionExecutor, ManualDebounceScheduler } from '@microsoft/vscode-azure-utils/testing';
import { FunctionsProjectReader } from '../../../../src/functions/FunctionsProjectReader';
import { FunctionsProjectSelector } from '../../../../src/functions/FunctionsProjectSelector';
import { LocalFunctionSettings } from '../../../../src/functions/LocalFunctionSettings';
import { LocalFunctionTarget } from '../../../../src/functions/LocalFunctionTarget';
import { LocalFunctionsHostTracker } from '../../../../src/functions/host/LocalFunctionsHostTracker';
import { FunctionsWorkspaceDataProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { functionsDetector } from '../../../../src/functions/functionsDetector';
import { FunctionsWorkspaceViewProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { WorkspaceIndexService } from '../../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { createTestResourceSelector } from '../../resources/testResourceSelector';
import { mock } from 'node:test';
import type { FunctionsHostTarget } from '@microsoft/vscode-azure-azutils';
import { makeFunctionsProjectNode } from '../mockWorkspaceNode';

/** Real workspace index, tree, local settings, and host tracking with a deterministic host client. */
export function createLocalFunctions() {
    const context = createMockCodeContext();
    const m = context.mock;
    const code = m.vscode;
    const folder = addWorkspaceFolder(m, '/repo').uri;
    const { executor } = createTestActionExecutor();
    const scheduler = new ManualDebounceScheduler();
    const index = new WorkspaceIndexService(code, [functionsDetector], scheduler);
    const hosts = new LocalFunctionsHostTracker();
    const host = createMockFunctionsHostClient();
    const createHost = mock.fn((_target: FunctionsHostTarget) => host);
    const settings = new LocalFunctionSettings(code);
    const reader = new FunctionsProjectReader(code, executor, settings, hosts, createHost);
    const outputScheduler = new ManualDebounceScheduler();
    const provider = new FunctionsWorkspaceDataProvider(code, index, executor, reader, hosts, outputScheduler);
    const tree = new DataItemTree<WorkspaceNode>(code, 'local-functions-test', executor, node => node.id, Infinity);
    tree.registerProvider(provider);
    const view = new FunctionsWorkspaceViewProvider(context.ctx, executor, tree, hosts);
    const projects = new FunctionsProjectSelector(context.ctx, index, tree);
    const target = new LocalFunctionTarget(code, tree, hosts, createHost, settings, projects);
    const remoteSelection = createTestResourceSelector({ codeContext: context });
    const addProject = (runtime = 'node', hostConfig: unknown = { version: '2.0' }) => {
        const hostUri = code.Uri.joinPath(folder, 'host.json');
        m.fs.addFile(hostUri, JSON.stringify(hostConfig));
        m.fs.addFile(code.Uri.joinPath(folder, 'local.settings.json'), JSON.stringify({
            Values: { ['FUNCTIONS_WORKER_RUNTIME']: runtime }, IsEncrypted: false,
        }));
        return makeFunctionsProjectNode({ resourceUri: hostUri, runtime, initialized: !!runtime });
    };
    const addFunction = (name: string, config: unknown = { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] }, relative = name) => {
        const uri = code.Uri.joinPath(folder, relative, 'function.json');
        m.fs.addFile(uri, JSON.stringify(config));
        return uri;
    };
    return {
        m, code, context, folder, executor, scheduler, outputScheduler, index, hosts, host, createHost,
        settings, reader, provider, tree, view, projects, target, addProject, addFunction, selector: remoteSelection.selector,
        resourceCache: remoteSelection.cache,
        dispose: () => {
            tree.dispose();
            provider.dispose();
            index.dispose();
            hosts.dispose();
        },
    };
}
