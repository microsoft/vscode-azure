/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IVsCode, PromptStep, readText } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { ContainerfileTag } from '../../../tree/workspace/containerApps/containerAppsDetector';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/** Port used when the project declares none, matching the Container Apps default. */
const DefaultTargetPort = 80;

/**
 * Derives the container's ingress port from the project's Containerfile.
 *
 * Project deployments use `EXPOSE` or the editable Bicep default.
 * App creation uses the quickstart image's known port.
 */
@injectable()
export class DetectTargetPortStep extends PromptStep<CreateContainerAppContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateContainerAppContext>): boolean {
        // `hasInfra` means the user already owns the Bicep, so the port is
        // whatever their template says and must not be second-guessed.
        return context.targetPort === undefined && !context.hasInfra;
    }

    public async prompt(context: Readonly<CreateContainerAppContext>): Promise<Partial<CreateContainerAppContext>> {
        const targetPort = context.job === 'createNew'
            ? DefaultTargetPort
            : await this.detectPort(context.iacFolder) ?? DefaultTargetPort;
        this.executor.setTelProp('detectedTargetPort', String(targetPort));
        return { targetPort };
    }

    /** Returns the first port exposed by the most relevant Containerfile, if any. */
    private async detectPort(iacFolder: vscode.Uri | undefined): Promise<number | undefined> {
        const index = await this.indexService.getIndex();
        const containerfiles = index.withTag(ContainerfileTag);

        const scoped = iacFolder
            ? containerfiles.filter(uri => uri.scheme === iacFolder.scheme
                && uri.authority === iacFolder.authority
                && uri.path.startsWith(`${iacFolder.path.replace(/\/$/, '')}/`))
            : [];

        for (const uri of scoped) {
            const content = await readText(this.code, uri);
            const port = content === undefined ? undefined : parseExposedPort(content);
            if (port !== undefined) {
                return port;
            }
        }

        return undefined;
    }
}

/**
 * Reads the first usable port from a Containerfile's `EXPOSE` instructions.
 *
 * `EXPOSE` accepts several ports on one line, an optional `/tcp` or `/udp`
 * protocol, and port ranges. Ingress targets exactly one TCP port, so the first
 * TCP port wins and a range contributes its start.
 */
export function parseExposedPort(containerfile: string): number | undefined {
    for (const line of containerfile.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!/^EXPOSE\s/i.test(trimmed)) {
            continue;
        }

        for (const token of trimmed.slice('EXPOSE'.length).trim().split(/\s+/)) {
            // A UDP port cannot serve HTTP ingress, so it is not a candidate.
            const [portPart, protocol] = token.split('/');
            if (protocol && protocol.toLowerCase() !== 'tcp') {
                continue;
            }

            const port = Number.parseInt(portPart.split('-')[0], 10);
            if (Number.isInteger(port) && port > 0 && port <= 65535) {
                return port;
            }
        }
    }

    return undefined;
}
