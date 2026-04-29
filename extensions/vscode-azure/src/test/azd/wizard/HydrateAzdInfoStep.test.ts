/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdShowResult } from '../../../azd/AzdService';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { HydrateAzdInfoStep } from '../../../azd/wizard/HydrateAzdInfoStep';
import { createMockAzdService } from '../MockAzdService';

describe('HydrateAzdInfoStep (unit)', () => {
    function makeStep(opts: {
        readonly show?: AzdShowResult | undefined;
        readonly hasInfra?: boolean;
        readonly envs?: { Name: string; IsDefault: boolean }[];
        readonly envListThrows?: boolean;
        readonly envValues?: Record<string, string>;
    } = {}) {
        const folderUri = MockUri.file('/workspace');
        const { vscode: code, fs } = createMockVsCode();

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
            iacFolder: folderUri as never,
        };
        return { step, context, azd };
    }

    describe('shouldPrompt', () => {
        it('returns false when job is not deploy', () => {
            const { step } = makeStep();
            expect(step.shouldPrompt({ job: 'createNew', iacFolder: MockUri.file('/x') as never })).to.be.false;
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
            expect(result.hasInfra).to.be.false;
            expect(result.existingDefaultEnvName).to.be.undefined;
            expect(result.environmentName).to.be.undefined;
        });

        it('detects azure.yaml without services entry via azd show', async () => {
            const { step, context } = makeStep({ show: { name: 'my-app' } });
            const result = await step.prompt(context);

            expect(result.hasAzureYaml).to.be.true;
            expect(result.hasServices).to.be.false;
        });

        it('detects azure.yaml with services entry via azd show', async () => {
            const { step, context } = makeStep({
                show: { name: 'my-app', services: { myfunc: { project: { path: '.', language: 'node' } } } },
            });
            const result = await step.prompt(context);

            expect(result.hasAzureYaml).to.be.true;
            expect(result.hasServices).to.be.true;
        });

        it('detects existing infra/main.bicep', async () => {
            const { step, context } = makeStep({ hasInfra: true });
            const result = await step.prompt(context);

            expect(result.hasInfra).to.be.true;
        });

        it('seeds environmentName from default azd environment', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'staging', IsDefault: false }, { Name: 'production', IsDefault: true }],
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
                    /* eslint-enable @typescript-eslint/naming-convention */
                },
            });
            const result = await step.prompt(context);

            expect(result.hydratedSubscriptionId).to.equal('sub-1');
            expect(result.hydratedLocationName).to.equal('eastus');

            // env values should be queried for the *default* env name.
            expect(azd.envGetValues.mock.callCount()).to.equal(1);
            expect(azd.envGetValues.mock.calls[0].arguments[0]).to.equal('production');
        });

        it('partially hydrates when only one of sub/location is present', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                // eslint-disable-next-line @typescript-eslint/naming-convention -- azd env key
                envValues: { AZURE_SUBSCRIPTION_ID: 'sub-1' },
            });
            const result = await step.prompt(context);

            expect(result.hydratedSubscriptionId).to.equal('sub-1');
            expect(result.hydratedLocationName).to.be.undefined;
        });

        it('leaves hydrated fields unset when env get-values returns nothing', async () => {
            const { step, context } = makeStep({
                envs: [{ Name: 'production', IsDefault: true }],
                envValues: {},
            });
            const result = await step.prompt(context);

            expect(result.hydratedSubscriptionId).to.be.undefined;
            expect(result.hydratedLocationName).to.be.undefined;
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
