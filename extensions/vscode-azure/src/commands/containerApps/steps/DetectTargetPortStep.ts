/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
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
 * Custom images have no associated source project, so their listening port is
 * prompted for. Project deployments use `EXPOSE` or the editable Bicep default.
 */
@injectable()
export class DetectTargetPortStep extends PromptStep<CreateContainerAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
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
        if (context.job === 'createNew' && context.imageName) {
            const port = await showSmartInputBox(this.ctx, {
                prompt: this.ctx.code.l10n.t('Enter the TCP port your container listens on'),
                value: String(DefaultTargetPort),
                showBack: true,
                validateInput: value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535
                    ? undefined
                    : this.ctx.code.l10n.t('Enter a port number between 1 and 65535.'),
            });
            return { targetPort: Number(port) };
        }

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
            const port = await this.readExposedPort(uri);
            if (port !== undefined) {
                return port;
            }
        }

        return undefined;
    }

    private async readExposedPort(uri: vscode.Uri): Promise<number | undefined> {
        try {
            const content = Buffer.from(await this.ctx.code.workspace.fs.readFile(uri)).toString();
            return parseExposedPort(content);
        } catch (error) {
            // A Containerfile that vanished between indexing and reading is not
            // worth failing the wizard over -- fall back to the default port.
            if (error instanceof this.ctx.code.FileSystemError && error.code === 'FileNotFound') {
                return undefined;
            }
            throw error;
        }
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
