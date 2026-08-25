/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IProcessExecutor } from '@microsoft/vscode-azure-utils';
import { MockUri, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { ToolInstallOptions, ToolInstaller } from '../../src/tools/ToolInstaller';
import { ToolService, userToolRequest, validateAcquireToolRequest, type AcquireToolRequest } from '../../src/tools/ToolService';

/**
 * A stand-in installer whose versions are keyed by path, so a test can make an
 * install "succeed" by adding a path to {@linkcode versions}.
 */
function createInstaller(versions: Map<string, string>, overrides: Partial<ToolInstaller> = {}) {
    const install = mock.fn((_options: ToolInstallOptions) => Promise.resolve());
    const installer: ToolInstaller = {
        id: 'azd',
        displayName: 'Azure Developer CLI',
        executableName: 'azd',
        defaultVersionRange: '>=1.25.0',
        getKnownPaths: () => [],
        getVersion: (executablePath: string) => Promise.resolve(versions.get(executablePath)),
        install,
        ...overrides,
    };

    return { installer, install };
}

function createService(installer: ToolInstaller, pathResult?: string, existingFiles: string[] = []) {
    const mockResult = createMockVsCode();
    for (const file of existingFiles) {
        mockResult.fs.addFile(MockUri.file(file));
    }

    const processExecutor = {
        resolveExecutable: mock.fn(() => pathResult),
    } as unknown as IProcessExecutor;

    return new ToolService(mockResult.vscode, processExecutor, [installer]);
}

/** The plain request another extension would make: resolve, install only if needed. */
function request(overrides: Partial<AcquireToolRequest> = {}): AcquireToolRequest {
    return { toolId: 'azd', requestingExtensionId: 'publisher.name', ...overrides };
}

describe('ToolService (unit)', () => {
    it('should return an executable already on the PATH without installing', async () => {
        const { installer, install } = createInstaller(new Map([['/tools/azd', '1.25.1']]));
        const service = createService(installer, '/tools/azd', ['/tools/azd']);

        const result = await service.acquire(request());

        expect(result.executablePath).to.equal('/tools/azd');
        expect(service.getResolvedPath('azd')).to.equal('/tools/azd');
        expect(install.mock.callCount()).to.equal(0);
    });

    it('should find a tool installed outside the PATH', async () => {
        const { installer } = createInstaller(
            new Map([['/opt/azd', '1.25.0']]),
            { getKnownPaths: () => ['/opt/azd'] },
        );
        const service = createService(installer, undefined, ['/opt/azd']);

        const result = await service.acquire(request());

        expect(result.executablePath).to.equal('/opt/azd');
    });

    it('should install when the version found is too old, offering it for self-update', async () => {
        const versions = new Map([['/tools/azd', '1.24.0']]);
        const install = mock.fn((_options: ToolInstallOptions) => {
            versions.set('/tools/azd', '1.26.0');
            return Promise.resolve();
        });
        const { installer } = createInstaller(versions, { install });
        const service = createService(installer, '/tools/azd', ['/tools/azd']);

        const result = await service.acquire(request());

        expect(result.executablePath).to.equal('/tools/azd');
        expect(install.mock.calls[0].arguments[0].current).to.deep.equal({
            executablePath: '/tools/azd',
            version: '1.24.0',
        });
    });

    it('should install over an acceptable version when forced, offering it for self-update', async () => {
        const { installer, install } = createInstaller(new Map([['/tools/azd', '1.25.1']]));
        const service = createService(installer, '/tools/azd', ['/tools/azd']);

        const result = await service.acquire(request({ force: true }));

        expect(result.executablePath).to.equal('/tools/azd');
        expect(install.mock.callCount()).to.equal(1);
        expect(install.mock.calls[0].arguments[0].current).to.deep.equal({
            executablePath: '/tools/azd',
            version: '1.25.1',
        });
    });

    it('should not install over a caller-supplied path even when forced', async () => {
        const { installer, install } = createInstaller(new Map([['/caller/azd', '1.25.1']]));
        const service = createService(installer);

        const result = await service.acquire(request({ existingPath: '/caller/azd', force: true }));

        expect(result.executablePath).to.equal('/caller/azd');
        expect(install.mock.callCount()).to.equal(0);
    });

    it('should use the version range supplied by the caller over the tool default', async () => {
        const { installer, install } = createInstaller(new Map([['/tools/azd', '1.0.0']]));
        const service = createService(installer, '/tools/azd', ['/tools/azd']);

        const result = await service.acquire(request({ versionRange: '>=1.0.0' }));

        expect(result.executablePath).to.equal('/tools/azd');
        expect(install.mock.callCount()).to.equal(0);
    });

    it('should throw rather than install when the caller supplied its own path', async () => {
        const { installer, install } = createInstaller(new Map());
        const service = createService(installer);

        await expect(service.acquire(request({ existingPath: '/caller/azd' })))
            .to.be.rejectedWith(/missing, or does not satisfy/);
        expect(install.mock.callCount()).to.equal(0);
    });

    it('should throw when the tool is still unusable after installing', async () => {
        const { installer } = createInstaller(new Map());
        const service = createService(installer);

        await expect(service.acquire(request())).to.be.rejectedWith(/Reload the window/);
    });

    it('should report progress for each phase', async () => {
        const versions = new Map<string, string>();
        const { installer } = createInstaller(versions, {
            getKnownPaths: () => ['/tools/azd'],
            install: mock.fn(() => {
                versions.set('/tools/azd', '1.25.0');
                return Promise.resolve();
            }),
        });
        const service = createService(installer, undefined, ['/tools/azd']);
        const progress = mock.fn();

        await service.acquire(request({ progress }));

        expect(progress.mock.callCount()).to.equal(3);
    });

    it('should share a single install between concurrent requests', async () => {
        const versions = new Map<string, string>();
        let finishInstall: (() => void) | undefined;
        const install = mock.fn(() => new Promise<void>(resolve => {
            finishInstall = () => {
                versions.set('/tools/azd', '1.25.0');
                resolve();
            };
        }));
        const { installer } = createInstaller(versions, { getKnownPaths: () => ['/tools/azd'], install });
        const service = createService(installer, undefined, ['/tools/azd']);

        const first = service.acquire(request());
        const second = service.acquire(request());
        await waitFor(() => finishInstall !== undefined);
        finishInstall?.();

        expect(await first).to.deep.equal(await second);
        expect(install.mock.callCount()).to.equal(1);
    });

    it('should not let a forced request share an unforced one', async () => {
        const versions = new Map([['/tools/azd', '1.25.1']]);
        const { installer, install } = createInstaller(versions);
        const service = createService(installer, '/tools/azd', ['/tools/azd']);

        const [unforced, forced] = await Promise.all([
            service.acquire(request()),
            service.acquire(request({ force: true })),
        ]);

        expect(unforced.executablePath).to.equal('/tools/azd');
        expect(forced.executablePath).to.equal('/tools/azd');
        expect(install.mock.callCount()).to.equal(1);
    });
});

describe('userToolRequest (unit)', () => {
    it('should force an install so a user-invoked command updates an existing tool', () => {
        expect(userToolRequest('azd').force).to.be.true;
    });
});

describe('validateAcquireToolRequest (unit)', () => {
    const installers = [createInstaller(new Map()).installer];

    it('should accept a well-formed request', () => {
        const { request } = validateAcquireToolRequest({
            toolId: 'azd',
            requestingExtensionId: 'publisher.name',
            versionRange: '>=1.25.0-0',
        }, installers);

        expect(request.toolId).to.equal('azd');
    });

    it('should accept the request used by the extension\'s own install commands', () => {
        expect(() => validateAcquireToolRequest(userToolRequest('azd'), installers)).to.not.throw();
    });

    it('should reject an unsupported tool', () => {
        expect(() => validateAcquireToolRequest({
            toolId: 'nope',
            requestingExtensionId: 'publisher.name',
        }, installers)).to.throw(/Unsupported tool/);
    });

    it('should reject a missing requesting extension', () => {
        expect(() => validateAcquireToolRequest({ toolId: 'azd' }, installers)).to.throw(/requestingExtensionId/);
    });

    it('should reject an invalid semver range', () => {
        expect(() => validateAcquireToolRequest({
            toolId: 'azd',
            requestingExtensionId: 'publisher.name',
            versionRange: 'not a range',
        }, installers)).to.throw(/versionRange/);
    });

    it('should reject a relative existing path', () => {
        expect(() => validateAcquireToolRequest({
            toolId: 'azd',
            requestingExtensionId: 'publisher.name',
            existingPath: 'azd',
        }, installers)).to.throw(/existingPath/);
    });
});

async function waitFor(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
