/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import { containerAppsDetector, ContainerfileTag } from '../../../../src/tree/workspace/containerApps/containerAppsDetector';

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
    it('tags the Dockerfile spellings a container build recognises', () => {
        expect(inspect('Dockerfile')).to.deep.equal([ContainerfileTag]);
        expect(inspect('dockerfile')).to.deep.equal([ContainerfileTag]);
        expect(inspect('Dockerfile.dev')).to.deep.equal([ContainerfileTag]);
        expect(inspect('api.Dockerfile')).to.deep.equal([ContainerfileTag]);
    });

    it('tags the Containerfile spellings too', () => {
        // Podman and Buildah default to this name, and Docker's own BuildKit
        // accepts it, so a project using it is still a container app.
        expect(inspect('Containerfile')).to.deep.equal([ContainerfileTag]);
        expect(inspect('containerfile')).to.deep.equal([ContainerfileTag]);
        expect(inspect('Containerfile.dev')).to.deep.equal([ContainerfileTag]);
        expect(inspect('api.Containerfile')).to.deep.equal([ContainerfileTag]);
    });

    it('does not tag files that merely mention docker', () => {
        // Tagging these would feed the port detector a file with no EXPOSE,
        // silently defaulting the app to port 80.
        expect(inspect('docker-compose.yml')).to.be.empty;
        expect(inspect('Dockerfilex')).to.be.empty;
        expect(inspect('containerfilex')).to.be.empty;
        expect(inspect('README.md')).to.be.empty;
    });

    it('does not tag a directory named like a Containerfile', () => {
        expect(inspect('Dockerfile', true)).to.be.empty;
        expect(inspect('Containerfile', true)).to.be.empty;
    });
});
