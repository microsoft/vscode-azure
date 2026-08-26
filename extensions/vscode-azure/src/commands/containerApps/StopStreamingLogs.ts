/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IVsCode, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { isContainerApp } from '../../tree/resources/containerApps/ContainerApp';
import { type ActiveLogStream, IContainerAppLogStreamService } from '../../tree/resources/containerApps/ContainerAppLogStream';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Stops a live log stream.
 *
 * Invoked from a container app node, this offers only that app's streams;
 * invoked from the palette, it offers every open stream. Either way, a
 * "stop all" entry appears once more than one stream is open, so the user
 * never has to run the command repeatedly.
 */
@injectable()
export class StopStreamingLogs implements ManagedCommand {
    /**
     * Context value gating this command's visibility in the tree view. It is
     * only added to a node while that app has a stream open.
     */
    public static ContextValue = 'stopContainerAppLogStream';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(IContainerAppLogStreamService) private readonly streams: IContainerAppLogStreamService,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const candidates = this.candidatesFor(key);

        if (candidates.length === 0) {
            throw new Error(this.code.l10n.t('There are no log streams to stop.'));
        }

        if (candidates.length === 1) {
            this.streams.stop(candidates[0].id);
            return;
        }

        const stopAll = { label: this.code.l10n.t('Stop All'), data: undefined as ActiveLogStream | undefined };
        const picked = await showSmartQuickPick(
            this.ctx,
            [
                stopAll,
                ...candidates.map(stream => ({ label: stream.label, data: stream })),
            ],
            { placeHolder: this.code.l10n.t('Select a log stream to stop'), showBack: true },
        );

        if (!picked.data) {
            for (const stream of candidates) {
                this.streams.stop(stream.id);
            }
            return;
        }

        this.streams.stop(picked.data.id);
    }

    /**
     * Narrows the open streams to the invoking app when the command came from a
     * tree node, and to all of them otherwise.
     */
    private candidatesFor(key?: string): readonly ActiveLogStream[] {
        const all = this.streams.getActiveStreams();
        if (!key || !AzureNodeId.test(key)) {
            return all;
        }

        const resource = this.tree.get(key);
        if (!isContainerApp(resource)) {
            return all;
        }

        const appId = resource.id.toLowerCase();
        return all.filter(stream => stream.appId.toLowerCase() === appId);
    }
}
