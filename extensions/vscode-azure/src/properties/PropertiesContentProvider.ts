/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/** URI scheme for readonly resource-property documents. */
export const PropertiesScheme = 'vscode-azure-resource-properties';

/** Service identifier for the resource-property document provider. */
export const IPropertiesContentProvider: ServiceIdentifier<IPropertiesContentProvider> = Symbol.for('IPropertiesContentProvider');

/** Opens resource properties as readonly JSON documents. */
export interface IPropertiesContentProvider extends vscode.TextDocumentContentProvider {
    /**
     * Open a readonly JSON document containing {@linkcode content}.
     *
     * The returned document is backed by a {@linkcode vscode.TextDocumentContentProvider},
     * so edits are not accepted by the editor.
     */
    openTextDocument(content: string): Promise<vscode.TextDocument>;
}

/**
 * In-memory readonly document provider for resource properties.
 *
 * Each URI identifies one snapshot captured when the command ran.
 *
 * @remarks
 * Registering this with the editor for {@linkcode PropertiesScheme} is the caller's job, so that
 * constructing it -- in a test, say -- does not claim a global scheme. See `registerGenericAzure`.
 */
@injectable()
export class PropertiesContentProvider implements IPropertiesContentProvider {
    private readonly contents = new Map<string, string>();
    private nextId = 1;

    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** @inheritdoc */
    public async openTextDocument(content: string): Promise<vscode.TextDocument> {
        const uri = this.code.Uri.from({
            scheme: PropertiesScheme,
            path: `/properties-${this.nextId++}.json`,
        });
        this.contents.set(uri.toString(), content);
        return await this.code.workspace.openTextDocument(uri);
    }

    /** @inheritdoc */
    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

}
