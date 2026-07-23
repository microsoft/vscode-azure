/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { delay, IActionContext, IOutputChannel, IVsCode, selfOnly } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import {
    IStaticWebAppsGitHubService,
    type GitHubWorkflowRun,
} from '../../services/StaticWebAppsGitHubService';
import { StaticWebAppVirtualTypes, type StaticWebAppAction } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

const actionPollIntervalMs = 15 * 1000;
const actionPollTimeoutMs = 20 * 60 * 1000;

/** Injectable timing hooks for deterministic action polling tests and consumers. */
export interface StaticWebAppActionPollOptions {
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly now?: () => number;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly onUpdate?: (run: GitHubWorkflowRun) => void;
}

/** Result returned when workflow polling reaches a terminal state or times out. */
export interface StaticWebAppActionPollResult {
    readonly run: GitHubWorkflowRun;
    readonly elapsedMs: number;
    readonly timedOut: boolean;
}

/**
 * Polls one GitHub workflow run at the source-compatible 15-second cadence.
 *
 * The default timeout is 20 minutes. Tests can inject timing hooks, and already
 * completed runs return before any wait is scheduled.
 */
export async function pollStaticWebAppAction(
    github: IStaticWebAppsGitHubService,
    action: StaticWebAppAction,
    options: StaticWebAppActionPollOptions = {},
): Promise<StaticWebAppActionPollResult> {
    const intervalMs = options.intervalMs ?? actionPollIntervalMs;
    const timeoutMs = options.timeoutMs ?? actionPollTimeoutMs;
    const now = options.now ?? Date.now;
    const wait = options.wait ?? delay;
    const startedAt = now();
    let run = action.run;
    let elapsedMs = 0;

    while (elapsedMs <= timeoutMs) {
        run = await github.getWorkflowRun(action.repository, action.run.id);
        options.onUpdate?.(run);
        elapsedMs = now() - startedAt;
        if (run.status === 'completed') {
            return { run, elapsedMs, timedOut: false };
        } else if (elapsedMs >= timeoutMs) {
            return { run, elapsedMs, timedOut: true };
        }
        await wait(Math.min(intervalMs, timeoutMs - elapsedMs));
    }
    return { run, elapsedMs, timedOut: true };
}

abstract class ActionCommand {
    protected constructor(
        protected readonly context: IActionContext,
        protected readonly code: IVsCode,
        protected readonly output: IOutputChannel,
        protected readonly resolver: StaticWebAppCommandResolver,
        protected readonly github: IStaticWebAppsGitHubService,
    ) { }

    protected async run(key: string | undefined, operation: (action: StaticWebAppAction) => Promise<void>): Promise<void> {
        const action = this.resolver.resolveVirtual<StaticWebAppAction>(
            key,
            resource => resource.virtualType === StaticWebAppVirtualTypes.Action,
        );

        await operation(action);
        this.resolver.dataTree.invalidate(action);
        const result = await pollStaticWebAppAction(this.github, action, {
            onUpdate: run => {
                Object.assign(action.run, run);
                this.resolver.dataTree.invalidate(selfOnly(action));
            },
        });

        this.context.telemetry.properties.conclusion = result.run.conclusion ?? '';
        this.context.telemetry.properties.pollTimedOut = String(result.timedOut);
        this.context.telemetry.measurements.pollDurationMs = result.elapsedMs;

        if (result.timedOut) {
            this.output.info('GitHub Actions polling timed out before the run completed.');
            void this.code.window.showInformationMessage(
                this.code.l10n.t('The GitHub Action is still running. Check GitHub for its current status.'),
            );
        } else {
            this.output.info('GitHub Action reached a terminal state.');
            void this.code.window.showInformationMessage(
                this.code.l10n.t('The GitHub Action completed with conclusion \'{0}\'.', result.run.conclusion ?? ''),
            );
        }
    }
}

/** Cancels an in-progress Static Web Apps GitHub Action and tracks completion. */
@injectable()
export class CancelAction extends ActionCommand implements ManagedCommand {
    /** Context value for in-progress action nodes. */
    public static readonly ContextValue = 'cancelStaticWebAppAction';

    public constructor(
        @inject(IActionContext) context: IActionContext,
        @inject(IVsCode) code: IVsCode,
        @inject(IOutputChannel) output: IOutputChannel,
        @inject(StaticWebAppCommandResolver) resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppsGitHubService) github: IStaticWebAppsGitHubService,
    ) {
        super(context, code, output, resolver, github);
    }

    /** @inheritdoc */
    public execute(key?: string): Promise<void> {
        return this.run(key, action => this.github.cancelWorkflowRun(action.repository, action.run.id));
    }
}

/** Reruns a completed Static Web Apps GitHub Action and tracks completion. */
@injectable()
export class RerunAction extends ActionCommand implements ManagedCommand {
    /** Context value for completed action nodes. */
    public static readonly ContextValue = 'rerunStaticWebAppAction';

    public constructor(
        @inject(IActionContext) context: IActionContext,
        @inject(IVsCode) code: IVsCode,
        @inject(IOutputChannel) output: IOutputChannel,
        @inject(StaticWebAppCommandResolver) resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppsGitHubService) github: IStaticWebAppsGitHubService,
    ) {
        super(context, code, output, resolver, github);
    }

    /** @inheritdoc */
    public execute(key?: string): Promise<void> {
        return this.run(key, action => this.github.rerunWorkflowRun(action.repository, action.run.id));
    }
}
