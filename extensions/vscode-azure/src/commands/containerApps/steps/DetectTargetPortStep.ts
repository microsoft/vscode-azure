/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, IActionExecutor, isFileNotFoundError, IVsCode, PromptStep, readText, relativePath } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/** Port used when the project declares none, matching the Container Apps default. */
const DefaultTargetPort = 80;

/**
 * Derives the container's ingress port from the nearest ancestor Dockerfile,
 * starting at the service directory and stopping at the azd project root.
 *
 * Project deployments use `EXPOSE` or the editable Bicep default.
 * App creation uses the quickstart image's known port.
 */
@injectable()
export class DetectTargetPortStep extends PromptStep<CreateContainerAppContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
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
            : await this.detectPort(context) ?? DefaultTargetPort;
        this.executor.setTelProp('detectedTargetPort', String(targetPort));
        return { targetPort };
    }

    private async detectPort(context: Readonly<CreateContainerAppContext>): Promise<number | undefined> {
        if (!context.iacFolder) {
            return undefined;
        }
        const root = this.code.Uri.joinPath(context.iacFolder, '.');
        let directory = context.hasServices ? await this.serviceDirectory(context, root) : root;

        while (directory && relativePath(root, directory) !== undefined) {
            const content = await readText(this.code, this.code.Uri.joinPath(directory, 'Dockerfile'));
            if (content !== undefined) {
                return parseExposedPort(content);
            }
            if (relativePath(root, directory) === '') {
                break;
            }
            directory = dirname(directory);
        }

        return undefined;
    }

    private async serviceDirectory(context: Readonly<CreateContainerAppContext>, root: vscode.Uri): Promise<vscode.Uri | undefined> {
        if (!context.hydratedServiceProjectPath) {
            return undefined;
        }
        const project = root.with({ path: this.code.Uri.file(context.hydratedServiceProjectPath).path });
        if (relativePath(root, project) === undefined) {
            return undefined;
        }
        try {
            const stat = await this.code.workspace.fs.stat(project);
            return stat.type & this.code.FileType.Directory ? project : dirname(project);
        } catch (error) {
            if (isFileNotFoundError(error)) {
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
