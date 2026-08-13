/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMarkerFileDetector, type MarkerFileMetadata } from './createMarkerFileDetector';
import type { WorkspaceDetector } from './WorkspaceDetector';
import { defineWorkspaceTag, type WorkspaceTag } from './WorkspaceTag';
/**
 * Namespace for language/runtime project tags that no single product owns.
 * @see {@linkcode createStandardDetector}
 */
export const ProjectNamespace = 'project';

/** Namespace for container tooling tags. */
export const ContainerNamespace = 'container';

/** A folder containing a `package.json`. */
export const NodeProjectTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ProjectNamespace, 'node');

/** A folder containing a .NET project or solution file. */
export const DotnetProjectTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ProjectNamespace, 'dotnet');

/** A folder containing a Python project marker (`pyproject.toml`, `requirements.txt`, ...). */
export const PythonProjectTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ProjectNamespace, 'python');

/** A folder containing a Maven or Gradle build file. */
export const JavaProjectTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ProjectNamespace, 'java');

/** A folder containing a `go.mod`. */
export const GoProjectTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ProjectNamespace, 'go');

/** A folder containing a `Dockerfile`. */
export const DockerfileTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ContainerNamespace, 'dockerfile');

/** A folder containing a Docker Compose file. */
export const ComposeTag: WorkspaceTag<MarkerFileMetadata> = defineWorkspaceTag<MarkerFileMetadata>(ContainerNamespace, 'compose');

/**
 * Detector for the language/runtime project types shared across products.
 *
 * Register this alongside product detectors so any consumer can ask "which
 * folders are Node projects" without every product re-deriving it. Product
 * detectors layer their own tags onto the same entries -- an azd project that is
 * also a Node project ends up as one entry carrying both tags.
 */
export function createStandardProjectDetector(): WorkspaceDetector {
    return createMarkerFileDetector(ProjectNamespace, [
        { tag: NodeProjectTag, patterns: ['**/package.json'] },
        { tag: DotnetProjectTag, patterns: ['**/*.csproj', '**/*.fsproj', '**/*.vbproj', '**/*.sln'] },
        { tag: PythonProjectTag, patterns: ['**/pyproject.toml', '**/requirements.txt', '**/setup.py'] },
        { tag: JavaProjectTag, patterns: ['**/pom.xml', '**/build.gradle', '**/build.gradle.kts'] },
        { tag: GoProjectTag, patterns: ['**/go.mod'] },
    ]);
}

/** Detector for container tooling files shared across products. */
export function createStandardContainerDetector(): WorkspaceDetector {
    return createMarkerFileDetector(ContainerNamespace, [
        { tag: DockerfileTag, patterns: ['**/Dockerfile'] },
        { tag: ComposeTag, patterns: ['**/docker-compose.yml', '**/docker-compose.yaml', '**/compose.yml', '**/compose.yaml'] },
    ]);
}

/**
 * The standard detectors, in the order they should be registered.
 *
 * Register these before product detectors so that the shared, product-agnostic
 * tags appear first in each entry's tag list.
 */
export function createStandardDetectors(): WorkspaceDetector[] {
    return [createStandardProjectDetector(), createStandardContainerDetector()];
}
