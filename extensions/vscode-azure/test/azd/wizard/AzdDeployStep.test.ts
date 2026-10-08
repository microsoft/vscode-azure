/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import { AzdDeployStep } from '../../../src/azd/wizard/AzdDeployStep';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const azd = createMockAzdService();
    const actionContext = createActionContext('test');
    const { ctx, mock: mockCode } = createMockCodeContext();
    const completeFn = mock.fn();
    const addDetailFn = mock.fn((_options: object) => undefined);
    const addChildFn = mock.fn((_options: object) => ({ addChild: addDetailFn }));
    const codeProvider = {
        trackDeployment: mock.fn(() => ({
            id: 'test-id',
            complete: completeFn,
            addChild: addChildFn,
        })),
    } as never;
    const output = new MockOutputChannel('test');
    const step = new AzdDeployStep(actionContext, ctx.code, azd, codeProvider, new TempDirManager(ctx), output);
    return { azd, codeProvider, actionContext, step, completeFn, addChildFn, addDetailFn, mockCode, output };
}

function makeJsonl(...events: object[]): string {
    return events.map(event => JSON.stringify(event)).join('\n') + '\n';
}

describe('AzdDeployStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when deploy is true and iacFolder is set', () => {
            const { step } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when deploy is false', () => {
            const { step } = createStep();

            const context = {
                deploy: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { step } = createStep();

            const context = {
                deploy: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { step } = createStep();

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should focus the activity view', async () => {
            const { step, mockCode } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            const executeCmd = mockCode.commands.executeCommand as unknown as ReturnType<typeof mock.fn>;
            expect(executeCmd.mock.callCount()).to.be.greaterThanOrEqual(1);
            expect(executeCmd.mock.calls[0].arguments[0]).to.equal('vscode-azure/activity.focus');
        });

        it('should call azd.deploy with the iac folder and a unique JSONL output path', async () => {
            const { azd, step } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await step.execute(context);

            expect(azd.deploy.mock.callCount()).to.equal(2);
            expect((azd.deploy.mock.calls[0].arguments[0]).path).to.equal('/project');
            expect(azd.deploy.mock.calls[0].arguments[1]?.AZD_OUTPUT_JSONL).to.match(/deploy\.jsonl$/);
            expect(azd.deploy.mock.calls[1].arguments[1]?.AZD_OUTPUT_JSONL)
                .to.not.equal(azd.deploy.mock.calls[0].arguments[1]?.AZD_OUTPUT_JSONL);
        });

        it('should add semantic messages and per-service result details to the activity', async () => {
            const { azd, step, addChildFn, addDetailFn, mockCode } = createStep();
            azd.deploy.mock.mockImplementation((_cwd, env) => {
                mockCode.fs.addFile(MockUri.file(env!.AZD_OUTPUT_JSONL), makeJsonl(
                    { type: 'commandStart', data: { command: 'azd deploy' } },
                    { type: 'consoleMessage', data: { message: 'Deploying services\n' } },
                    { type: 'consoleMessage', data: { message: 'raw output\n', stream: 'stdout' } },
                    { type: 'deploymentResult', data: { services: {
                        api: {
                            warnings: ['Check the API settings'],
                            artifacts: [{ kind: 'endpoint', location: 'https://api.example.com' }, { kind: 'archive', location: '/tmp/api.zip' }],
                        },
                        web: { artifacts: [] },
                    } } },
                    { type: 'commandEnd', data: { exitCode: 0 } },
                ));
                return Promise.resolve();
            });

            await step.execute({ deploy: true, iacFolder: MockUri.file('/project') });

            expect(addChildFn.mock.calls.map(call => call.arguments[0])).to.deep.equal([
                { title: 'Deploying services', status: 'Info', isLeaf: true },
                { title: 'Service: api' },
                { title: 'Service: web' },
            ]);
            expect(addDetailFn.mock.calls.map(call => call.arguments[0])).to.deep.equal([
                { title: 'Check the API settings', status: 'Warn', isLeaf: true },
                { title: 'Endpoint: https://api.example.com', status: 'Info', isLeaf: true },
            ]);
        });

        it('should drain activity messages after task failure', async () => {
            const { azd, step, addChildFn, completeFn, mockCode } = createStep();
            azd.deploy.mock.mockImplementation((_cwd, env) => {
                const file = MockUri.file(env!.AZD_OUTPUT_JSONL);
                mockCode.fs.addFile(file, makeJsonl(
                    { type: 'consoleMessage', data: { message: 'Starting\n' } },
                    { type: 'consoleMessage', data: { message: 'Finishing\n' } },
                ));
                return Promise.reject(new Error('deploy failed'));
            });
            const execution = step.execute({ deploy: true, iacFolder: MockUri.file('/project') });

            await expect(execution).to.be.rejectedWith('deploy failed');
            expect(addChildFn.mock.calls.map(call => call.arguments[0])).to.deep.equal([
                { title: 'Starting', status: 'Info', isLeaf: true },
                { title: 'Finishing', status: 'Info', isLeaf: true },
            ]);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Failed');
        });

        it('should preserve task success when an older azd writes no JSONL file', async () => {
            const { step, addChildFn, completeFn } = createStep();
            await step.execute({ deploy: true, iacFolder: MockUri.file('/project') });
            expect(addChildFn.mock.callCount()).to.equal(0);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Completed');
        });

        it('should report malformed events without hiding valid deployment results', async () => {
            const { azd, step, addChildFn, mockCode, output } = createStep();
            azd.deploy.mock.mockImplementation((_cwd, env) => {
                mockCode.fs.addFile(MockUri.file(env!.AZD_OUTPUT_JSONL),
                    'not json\n' + makeJsonl({ type: 'deploymentResult', data: { services: { api: { artifacts: [] } } } }));
                return Promise.resolve();
            });

            await step.execute({ deploy: true, iacFolder: MockUri.file('/project') });

            expect(output.warn.mock.callCount()).to.equal(1);
            expect(addChildFn.mock.calls[0].arguments[0]).to.deep.equal({ title: 'Service: api' });
        });

        it('should track a code deployment activity', async () => {
            const { step, completeFn } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(completeFn.mock.callCount()).to.equal(1);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Completed');
        });

        it('should mark activity as Failed and rethrow with suppress display when deploy rejects', async () => {
            const { azd, actionContext, step, completeFn } = createStep();

            azd.deploy.mock.mockImplementation(() => Promise.reject(new Error('deploy failed')));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await expect(step.execute(context)).to.be.rejectedWith('deploy failed');

            expect(completeFn.mock.callCount()).to.equal(1);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Failed');
            expect(completeFn.mock.calls[0].arguments[1]).to.be.instanceOf(Error);
            expect(actionContext.errorHandling.suppress).to.equal('display');
        });

        it('should forward cancellation and mark the activity as Canceled', async () => {
            const { azd, step, completeFn } = createStep();
            const controller = new AbortController();
            azd.deploy.mock.mockImplementation((_cwd, _env, signal) => {
                expect(signal).to.equal(controller.signal);
                controller.abort();
                return Promise.reject(new CancellationError());
            });

            await expect(step.execute({
                deploy: true,
                iacFolder: MockUri.file('/project'),
                cancellation: controller.signal,
            })).to.be.rejectedWith(CancellationError);

            expect(completeFn.mock.calls[0].arguments).to.deep.equal(['Canceled']);
        });
    });
});
