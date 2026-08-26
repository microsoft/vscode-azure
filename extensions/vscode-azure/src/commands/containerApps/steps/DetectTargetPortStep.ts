/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IVsCode, PromptStep, type AsWritable } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { DockerfileTag } from '../../../tree/workspace/containerApps/containerAppsDetector';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/** Port used when the project declares none, matching the Container Apps default. */
const DefaultTargetPort = 80;

/**
 * Derives the container's ingress port from the project's Dockerfile.
 *
 * This never prompts. The port is already declared by `EXPOSE`, so asking for it
 * would be asking the user to repeat themselves, and the generated Bicep remains
 * editable when the guess is wrong.
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
        const result = {} as AsWritable<Partial<CreateContainerAppContext>>;
        result.targetPort = await this.detectPort(context.iacFolder) ?? DefaultTargetPort;
        this.executor.setTelProp('detectedTargetPort', String(result.targetPort));
        return result;
    }

    /** Returns the first port exposed by the most relevant Dockerfile, if any. */
    private async detectPort(iacFolder: vscode.Uri | undefined): Promise<number | undefined> {
        const index = await this.indexService.getIndex();
        const dockerfiles = index.withTag(DockerfileTag);

        // Prefer a Dockerfile inside the folder being generated into; a monorepo
        // may hold several that have nothing to do with this app.
        const scoped = iacFolder
            ? dockerfiles.filter(uri => uri.path.startsWith(`${iacFolder.path}/`))
            : [];

        for (const uri of (scoped.length > 0 ? scoped : dockerfiles)) {
            const port = await this.readExposedPort(uri);
            if (port !== undefined) {
                return port;
            }
        }

        return undefined;
    }

    private async readExposedPort(uri: vscode.Uri): Promise<number | undefined> {
        try {
            const content = Buffer.from(await this.code.workspace.fs.readFile(uri)).toString();
            return parseExposedPort(content);
        } catch {
            // A Dockerfile that vanished between indexing and reading is not
            // worth failing the wizard over -- fall back to the default port.
            return undefined;
        }
    }
}

/**
 * Reads the first usable port from a Dockerfile's `EXPOSE` instructions.
 *
 * `EXPOSE` accepts several ports on one line, an optional `/tcp` or `/udp`
 * protocol, and port ranges. Ingress targets exactly one TCP port, so the first
 * TCP port wins and a range contributes its start.
 */
export function parseExposedPort(dockerfile: string): number | undefined {
    for (const line of dockerfile.split(/\r?\n/)) {
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
