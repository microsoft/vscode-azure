/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { FunctionUrlResolver } from '../../functions/FunctionUrlResolver';
import { LocalFunctionTarget } from '../../functions/LocalFunctionTarget';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isFunctionAppFunction } from '../../tree/resources/webApp/FunctionApp';
import type { ManagedCommand } from '../ManagedCommand';

/** Copies a live HTTP invocation URL with the least-privileged key its access level requires. */
@injectable()
export class CopyFunctionUrl implements ManagedCommand {
    /** Capability for HTTP-triggered functions with an available invocation URL. */
    public static readonly ContextValue = 'copyFunctionUrl';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(FunctionUrlResolver) private readonly resolver: FunctionUrlResolver,
        @inject(LocalFunctionTarget) private readonly local: LocalFunctionTarget,
    ) { }

    /** Keeps keys out of notifications and output; admin URLs require explicit confirmation. */
    public async execute(key?: string): Promise<void> {
        const local = this.local.resolve(key);
        const { url, functionName } = local
            ? await this.resolver.resolveLocal(local)
            : await this.resolver.resolveRemote(await this.selector.selectVirtual({ key, canHandle: isFunctionAppFunction }));
        await this.code.env.clipboard.writeText(url.toString());
        void showMessage(this.code, this.code.l10n.t('Copied the URL for \'{0}\'.', functionName));
    }
}
