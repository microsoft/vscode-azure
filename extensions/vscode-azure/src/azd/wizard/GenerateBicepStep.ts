/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, fileExists, ICodeContext } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzdWizardContext } from './AzdWizardContext';

export const InfraFolderName = 'infra';
export const MainBicepFileName = 'main.bicep';
const MainParametersFileName = 'main.parameters.json';

/**
 * Name of a bundled template directory under `resources/templates/`.
 *
 * Each directory holds a complete `infra/` payload, so a template that needs a
 * local Bicep module alongside its `main.bicep` ships both and keeps the module
 * boundary in the generated project.
 */
export type BicepTemplateName = 'functionApp' | 'containerApp';

/**
 * Generates infra files: copies the chosen template directory from the
 * extension's bundled templates and writes a `main.parameters.json` with
 * the user's chosen values.
 *
 * Constructed via {@linkcode IGenerateBicepStepFactory} -- the template name
 * and emitted parameter keys are per-command config supplied by the caller,
 * while {@linkcode ICodeContext} is injected.
 */
export class GenerateBicepStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly templateName: BicepTemplateName,
        private readonly parameterKeys: readonly (keyof TContext & string)[],
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<TContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        // Trust the hydration flag when present (set by HydrateAzdInfoStep for
        // the `deploy` job). The `createNew` job skips hydration, so fall
        // through to a live check.
        if (context.hasInfra === true) {
            return false;
        }

        const infraFolder = this.ctx.code.Uri.joinPath(context.iacFolder, InfraFolderName);

        for (const fileName of [MainBicepFileName, MainParametersFileName]) {
            if (await fileExists(this.ctx.code, this.ctx.code.Uri.joinPath(infraFolder, fileName))) {
                // At least one file already exists; skip generation
                return false;
            }
        }

        return true;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        const templateUri = this.ctx.code.Uri.joinPath(this.ctx.extensionContext.extensionUri, 'resources', 'templates', this.templateName);
        const bicepFolder = this.ctx.code.Uri.joinPath(context.iacFolder!, InfraFolderName); // eslint-disable-line @typescript-eslint/no-non-null-assertion

        const parameters = JSON.stringify({
            $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
            contentVersion: '1.0.0.0',
            parameters: {
                environmentName: { value: '${AZURE_ENV_NAME}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                location: { value: '${AZURE_LOCATION}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                ...this.pickParameters(context),
            },
        }, undefined, 4);

        // Copying the directory rather than a single file is what preserves a
        // template's own layout -- a `modules/` subtree arrives in the generated
        // project with its relative paths intact, so the module references in
        // `main.bicep` still resolve.
        await this.ctx.code.workspace.fs.copy(
            templateUri,
            bicepFolder,
            { overwrite: true }, // We shouldn't actually be overwriting, due to `shouldExecute()`'s guard, but just in case...
        );

        // After the copy: it creates the destination directory, and on some file
        // systems copying onto an existing directory is refused.
        await this.ctx.code.workspace.fs.writeFile(
            this.ctx.code.Uri.joinPath(bicepFolder, MainParametersFileName),
            Buffer.from(parameters),
        );
    }

    private pickParameters(context: Readonly<TContext>): Record<string, { value: unknown }> {
        const result: Record<string, { value: unknown }> = {};
        for (const key of this.parameterKeys) {
            const value = context[key];
            if (value !== undefined) {
                result[key] = { value };
            }
        }
        return result;
    }
}

/** Identifier for the {@linkcode GenerateBicepStep} factory. */
export const IGenerateBicepStepFactory: ServiceIdentifier<IGenerateBicepStepFactory> = Symbol.for('IGenerateBicepStepFactory');

/**
 * Factory that creates a {@linkcode GenerateBicepStep} for a wizard context,
 * parameterized with the bicep template to copy and the context keys to emit
 * as bicep parameters (in addition to the always-included `environmentName`
 * and `location` azd placeholders). The step's {@linkcode ICodeContext}
 * dependency is supplied by the factory.
 */
export type IGenerateBicepStepFactory = <TContext extends AzdWizardContext>(
    templateName: BicepTemplateName,
    parameterKeys: readonly (keyof TContext & string)[],
) => GenerateBicepStep<TContext>;

/**
 * Builds an {@linkcode IGenerateBicepStepFactory} that captures the injected
 * {@linkcode ICodeContext}. Bind this with `toFactory` so commands can
 * construct configured steps without taking {@linkcode ICodeContext} as a
 * caller argument.
 */
export function createGenerateBicepStepFactory(ctx: ICodeContext): IGenerateBicepStepFactory {
    return <TContext extends AzdWizardContext>(
        templateName: BicepTemplateName,
        parameterKeys: readonly (keyof TContext & string)[],
    ): GenerateBicepStep<TContext> => new GenerateBicepStep<TContext>(ctx, templateName, parameterKeys);
}
