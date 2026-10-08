/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { FunctionAppLogStream } from '../../tree/resources/webApp/FunctionAppLogStream';
import type { ManagedCommand } from '../ManagedCommand';

/** Opens or focuses the selected Function App's Application Insights log terminal. */
@injectable()
export class StreamFunctionLogs implements ManagedCommand {
    /** Capability for readable Function Apps. */
    public static readonly ContextValue = 'streamFunctionLogs';

    public constructor(
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(FunctionAppLogStream) private readonly streams: FunctionAppLogStream,
    ) { }

    /** Uses shared selection; the service owns cancellation, discovery, and terminal lifetime. */
    public async execute(key?: string): Promise<void> {
        const app = await this.selector.selectResource({ key, logicalType: FunctionAppLogicalType });
        await this.streams.start(app);
    }
}
