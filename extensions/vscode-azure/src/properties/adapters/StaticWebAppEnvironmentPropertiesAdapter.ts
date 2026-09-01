/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { injectable } from 'inversify';
import { isStaticWebAppEnvironment, type StaticWebAppEnvironment } from '../../tree/resources/staticWebApps/StaticWebApp';
import type { PropertiesAdapter } from '../PropertiesAdapter';

/**
 * Exposes a Static Web Apps environment's retained build properties.
 *
 * An environment is a virtual node rather than a resource of its own, so
 * {@linkcode GenericArmPropertiesAdapter} does not claim it and its by-id ARM GET would not reach
 * the build anyway. What the user means by "this environment" -- its status, source branch,
 * hostname, and build configuration -- is the static site build already retained by the data
 * provider, so that is what this reads.
 */
@injectable()
export class StaticWebAppEnvironmentPropertiesAdapter implements PropertiesAdapter<StaticWebAppEnvironment> {
    /**
     * @inheritdoc
     *
     * A build's own payload carries no credentials, so in practice this changes nothing today. It
     * is on as defense in depth, because the build response grows with the service and is the kind
     * of payload -- deployment and app configuration -- that a credential could appear in later.
     */
    public readonly redact = true;

    /** @inheritdoc */
    public canHandle(node: ConcreteAzureNode): node is StaticWebAppEnvironment {
        return isStaticWebAppEnvironment(node);
    }

    /** @inheritdoc */
    public read(node: StaticWebAppEnvironment): Promise<unknown> {
        return Promise.resolve(node.data);
    }
}
