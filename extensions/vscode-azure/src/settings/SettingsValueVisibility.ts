/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

export const ISettingsValueVisibility: ServiceIdentifier<ISettingsValueVisibility> = Symbol.for('ISettingsValueVisibility');
export type ISettingsValueVisibility = SettingsValueVisibility;

/** Workspace-state key holding the current preference. */
const StateKey = 'azure.settings.showValues';

/**
 * Tracks whether setting **values** are shown in the tree.
 *
 * Values are hidden by default: the resources tree is often visible during screen shares and
 * recordings, and a connection string or key rendered in a tree item's description is a real
 * disclosure risk. Revealing is therefore a deliberate act, and the preference is remembered per
 * workspace so it does not silently carry over to an unrelated project.
 *
 * The editor is exempt -- it exists to show values, and opening it is already deliberate.
 */
@injectable()
export class SettingsValueVisibility {
    public constructor(
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext,
    ) { }

    /** Whether values are currently shown. Defaults to `false`. */
    public get showValues(): boolean {
        return this.extensionContext.workspaceState.get<boolean>(StateKey, false);
    }

    /** Flip the preference. @returns the new value. */
    public async toggle(): Promise<boolean> {
        const next = !this.showValues;
        await this.extensionContext.workspaceState.update(StateKey, next);
        return next;
    }
}
