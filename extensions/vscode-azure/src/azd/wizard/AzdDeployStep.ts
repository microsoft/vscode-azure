/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, ExecuteStep, IActionContext, IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ActivityTreeViewId } from '../../constants';
import { ICodeDeploymentDataProvider, type CodeDeploymentHandle } from '../../tree/activity/CodeDeploymentDataProvider';
import { IAzdService } from '../AzdService';
import { ITempDirManager } from '../TempDirManager';
import { withAzdJsonlOutput } from '../withAzdJsonlOutput';
import type { AzdWizardContext } from './AzdWizardContext';

const pollIntervalMs = 1000;

/**
 * Runs `azd deploy` after provisioning.
 *
 * Mirrors azd's JSONL console messages and per-service results into the
 * activity view while the foreground task retains its interactive terminal.
 */
@injectable()
export class AzdDeployStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
        @inject(ITempDirManager) private readonly tempDirManager: ITempDirManager,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.deploy === true && !!context.iacFolder;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        const handle = this.codeProvider.trackDeployment({ title: 'azd deploy' });
        void this.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);

        try {
            const outputDir = await this.tempDirManager.createTempDir();
            const outputFile = this.code.Uri.joinPath(outputDir, 'deploy.jsonl');
            await withAzdJsonlOutput({
                code: this.code,
                file: outputFile,
                intervalMs: pollIntervalMs,
                cancellation: context.cancellation,
                onEntry: event => { this.recordEvent(event, handle); },
                onError: kind => { this.output.warn(this.code.l10n.t('[deploy] Unable to process azd activity output ({0}).', kind)); },
            }, signal => this.azd.deploy(context.iacFolder!, { // eslint-disable-line @typescript-eslint/no-non-null-assertion
                AZD_OUTPUT_JSONL: outputFile.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
            }, signal));
            handle.complete('Completed');
        } catch (e) {
            if (CancellationError.test(e)) {
                handle.complete('Canceled');
                throw e;
            }
            handle.complete('Failed', e);
            this.actionContext.errorHandling.suppress = 'display';
            throw e;
        }
    }

    private recordEvent(event: unknown, handle: CodeDeploymentHandle): void {
        if (!isRecord(event)) {
            this.output.warn(this.code.l10n.t('[deploy] Invalid azd activity event.'));
            return;
        }

        if (event.type === 'consoleMessage' && isRecord(event.data)
            && typeof event.data.message === 'string' && !event.data.stream) {
            for (const message of event.data.message.split(/\r?\n/)) {
                if (message.trim()) {
                    handle.addChild({ title: message.trim(), status: 'Info', isLeaf: true });
                }
            }
        } else if (event.type === 'deploymentResult' && isRecord(event.data) && isRecord(event.data.services)) {
            for (const [name, result] of Object.entries(event.data.services)) {
                if (!isRecord(result)) {
                    this.output.warn(this.code.l10n.t('[deploy] Invalid service deployment result.'));
                    continue;
                }
                const service = handle.addChild({ title: this.code.l10n.t('Service: {0}', name) });
                if (Array.isArray(result.warnings)) {
                    for (const warning of result.warnings) {
                        if (typeof warning === 'string' && warning.trim()) {
                            service.addChild({ title: warning.trim(), status: 'Warn', isLeaf: true });
                        }
                    }
                }
                if (Array.isArray(result.artifacts)) {
                    for (const artifact of result.artifacts) {
                        if (isRecord(artifact) && artifact.kind === 'endpoint' && typeof artifact.location === 'string') {
                            service.addChild({
                                title: this.code.l10n.t('Endpoint: {0}', artifact.location),
                                status: 'Info',
                                isLeaf: true,
                            });
                        }
                    }
                }
            }
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
