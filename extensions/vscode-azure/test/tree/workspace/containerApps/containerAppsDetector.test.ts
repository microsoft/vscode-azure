/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { containerAppsDetector, DockerfileTag } from '../../../../src/tree/workspace/containerApps/containerAppsDetector';

/** Runs the detector over one node and reports the tags it applied. */
function inspect(name: string, isDirectory = false): string[] {
    const tags: string[] = [];
    // The interface allows an async detector; this one is synchronous, so the
    // tags are already recorded when `inspect` returns.
    void containerAppsDetector.inspect({
        name,
        isDirectory,
        uri: MockUri.file(`/project/${name}`),
        has: () => false,
        tag: (tag: string) => tags.push(tag),
    } as never);
    return tags;
}

describe('containerAppsDetector (unit)', () => {
    it('tags the spellings Docker itself recognises', () => {
        expect(inspect('Dockerfile')).to.deep.equal([DockerfileTag]);
        expect(inspect('dockerfile')).to.deep.equal([DockerfileTag]);
        expect(inspect('Dockerfile.dev')).to.deep.equal([DockerfileTag]);
        expect(inspect('api.Dockerfile')).to.deep.equal([DockerfileTag]);
    });

    it('does not tag files that merely mention docker', () => {
        // Tagging these would feed the port detector a file with no EXPOSE,
        // silently defaulting the app to port 80.
        expect(inspect('docker-compose.yml')).to.be.empty;
        expect(inspect('Dockerfilex')).to.be.empty;
        expect(inspect('README.md')).to.be.empty;
    });

    it('does not tag a directory named like a Dockerfile', () => {
        expect(inspect('Dockerfile', true)).to.be.empty;
    });
});
