/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type { AzdShowResult } from '../../../src/azd/AzdService';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { HydrateAzdInfoStep } from '../../../src/azd/wizard/HydrateAzdInfoStep';
import { createMockAzdService } from '../MockAzdService';

/** Helper: the mock window's `showWarningMessage` is a `mock.fn()` but is typed as `vscode.window.showWarningMessage`. */
function asMockFn(fn: unknown): ReturnType<typeof mock.fn> {
    return fn as ReturnType<typeof mock.fn>;
}

describe('HydrateAzdInfoStep (unit)', () => {
    function makeStep(opts: {
        readonly show?: AzdShowResult | undefined;
        readonly hasInfra?: boolean;
        readonly envs?: { Name: string; IsDefault: boolean }[];
        readonly envListThrows?: boolean;
        readonly envValues?: Record<string, string>;
    } = {}) {
        const folderUri = MockUri.file('/workspace');
        const { vscode: code, fs, window } = createMockVsCode();

        if (opts.hasInfra) {
            fs.addFile(MockUri.file('/workspace/infra/main.bicep'));
        }

        const azd = createMockAzdService(opts.envs ?? []);
        if (opts.show !== undefined) {
            azd.show.mock.mockImplementation(() => Promise.resolve(opts.show));
        }
        if (opts.envListThrows) {
            azd.envList.mock.mockImplementation(() => Promise.reject(new Error('azd not found')));
        }
        if (opts.envValues) {
            azd.envGetValues.mock.mockImplementation(() => Promise.resolve(opts.envValues));
        }

        const step = new HydrateAzdInfoStep<AzdWizardContext>(code, azd);
        const context: Partial<AzdWizardContext> = {
            job: 'deploy',
            iacFolder: folderUri,
        };
        return { step, context, azd, window };
    }

    describe('shouldPrompt', () => {
        it('returns false when job is not deploy', () => {
            const { step } = makeStep();
            expect(step.shouldPrompt({ job: 'createNew', iacFolder: MockUri.file('/x') })).to.be.false;
        });

        it('returns false when iacFolder is missing', () => {
            const { step } = makeStep();
            expect(step.shouldPrompt({ job: 'deploy' })).to.be.false;
        });

        it('returns true when job is deploy and iacFolder is set', () => {
            const { step, context } = makeStep();
            expect(step.shouldPrompt(context)).to.be.true;
        });
    });

    describe('prompt', () => {
        it('classifies fresh state (nothing detected)', async () => {
            const { step, context } = makeStep();
            const result = await step.prompt(context);

            expect(result.hasAzureYaml).to.be.undefined;
            expect(result.hasServices).to.be.undefined;
            expect(result.azdServiceName).to.be.undefined;
            expect(result.hasInfra).to.be.false;
            expect(result.existingDefaultEnvName).to.be.undefined;
            expect(result.environmentName).to.be.undefined;
        });

        it('detects azure.yaml without services entry via azd show', async () => {
            const { step, context, window } = makeStep({ show: { name: 'my-app' } });
            const result = await step.prompt(context);

            expect(result.hasAzureYaml).to.be.true;
            expect(result.hasServices).to.be.false;
            expect(result.azdServiceName).to.be.undefined;

            // Surfaces a non-blocking warning toast.
            const showWarning = asMockFn(window.showWarningMessage);
            expect(showWarning.mock.callCount()).to.equal(1);
            expect(showWarning.mock.calls[0].arguments[0]).to.include('services');
        });

        it('detects azure.yaml with services entry via azd show', async () => {
            const { step, context, window } = makeStep({
                show: { name: 'my-app', services: { myfunc: { project: { path: '.', language: 'node' } } } },
            });
            const result = await step.prompt(context);

            expect(result.hasAzureYaml).to.be.true;
            expect(result.hasServices).to.be.true;
            expect(result.azdServiceName).to.equal('myfunc');

            // No warning when services are present.
            expect(asMockFn(window.showWarningMessage).mock.callCount()).to.equal(0);
        });

        it('does not warn when there is no azure.yaml at all', async () => {
            const { step, context, window } = makeStep();
            await step.prompt(context);

            expect(asMockFn(window.showWarningMessage).mock.callCount()).to.equal(0);
        });

        it('detects existing infra/main.bicep', async () => {
            const { step, context } = makeStep({ hasInfra: true });
            const result = await step.prompt(context);

            expect(result.hasInfra).to.be.true;
        });

        it('seeds environmentName + existingDefaultEnvName when the default env is fully configured', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'staging', IsDefault: false }, { Name: 'production', IsDefault: true }],
                envValues: {
                    /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
                    AZURE_LOCATION: 'eastus',
                    AZURE_SUBSCRIPTION_ID: 'sub-1',
                    /* eslint-enable @typescript-eslint/naming-convention */
                },
            });
            const result = await step.prompt(context);

            expect(result.existingDefaultEnvName).to.equal('production');
            expect(result.environmentName).to.equal('production');
        });

        it('does not set environmentName when there is no default env', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'staging', IsDefault: false }],
            });
            const result = await step.prompt(context);

            expect(result.existingDefaultEnvName).to.be.undefined;
            expect(result.environmentName).to.be.undefined;
        });

        it('swallows envList failures (azd not installed)', async () => {
            const { step, context } = makeStep({ envListThrows: true });
            const result = await step.prompt(context);

            expect(result.existingDefaultEnvName).to.be.undefined;
        });

        it('hydrates subscription/location from env get-values', async () => {
            const { step, context, azd } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                envValues: {
                    /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
                    AZURE_ENV_NAME: 'production',
                    AZURE_LOCATION: 'eastus',
                    AZURE_SUBSCRIPTION_ID: 'sub-1',
                    AZURE_TENANT_ID: 'tenant-1',
                    /* eslint-enable @typescript-eslint/naming-convention */
                },
            });
            const result = await step.prompt(context);

            expect(result.hydratedSubscriptionId).to.equal('sub-1');
            expect(result.hydratedLocationName).to.equal('eastus');
            expect(result.hydratedTenantId).to.equal('tenant-1');

            // env values should be queried for the *default* env name.
            expect(azd.envGetValues.mock.callCount()).to.equal(1);
            expect(azd.envGetValues.mock.calls[0].arguments[0]).to.equal('production');
        });

        it('leaves hydratedTenantId unset when the env has no AZURE_TENANT_ID', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                envValues: {
                    /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
                    AZURE_LOCATION: 'eastus',
                    AZURE_SUBSCRIPTION_ID: 'sub-1',
                    /* eslint-enable @typescript-eslint/naming-convention */
                },
            });
            const result = await step.prompt(context);

            expect(result.hydratedSubscriptionId).to.equal('sub-1');
            expect(result.hydratedTenantId).to.be.undefined;
        });

        it('treats partial env (missing AZURE_LOCATION) as Post-clone with a suffixed env name', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                envValues: {
                    /* eslint-disable @typescript-eslint/naming-convention -- azd env keys */
                    AZURE_SUBSCRIPTION_ID: 'sub-1',
                    AZURE_TENANT_ID: 'tenant-1',
                    /* eslint-enable @typescript-eslint/naming-convention */
                },
            });
            const result = await step.prompt(context);

            // Existing env is left alone; we'll create a new one downstream.
            expect(result.existingDefaultEnvName).to.be.undefined;
            expect(result.environmentName).to.equal('production-2');
            // Partial values are NOT used as hydrated -- the user will be
            // prompted for both sub and location for the new env.
            expect(result.hydratedSubscriptionId).to.be.undefined;
            expect(result.hydratedLocationName).to.be.undefined;
            expect(result.hydratedTenantId).to.be.undefined;
        });

        it('treats fully-empty env values as partial (Post-clone with suffix)', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                envValues: {},
            });
            const result = await step.prompt(context);

            expect(result.existingDefaultEnvName).to.be.undefined;
            expect(result.environmentName).to.equal('production-2');
            expect(result.hydratedSubscriptionId).to.be.undefined;
            expect(result.hydratedLocationName).to.be.undefined;
        });

        it('skips occupied suffixes when generating the new env name', async () => {
            const { step, context } = makeStep({
                envs: [
                    { Name: 'production', IsDefault: true },
                    { Name: 'production-2', IsDefault: false },
                    { Name: 'production-3', IsDefault: false },
                ],
                envValues: {},
            });
            const result = await step.prompt(context);

            expect(result.environmentName).to.equal('production-4');
        });

        it('does not call env get-values when no default env exists', async () => {
            const { step, context, azd } = makeStep({
                envs: [{ Name: 'staging', IsDefault: false }],
            });
            await step.prompt(context);

            expect(azd.envGetValues.mock.callCount()).to.equal(0);
        });
    });
});
