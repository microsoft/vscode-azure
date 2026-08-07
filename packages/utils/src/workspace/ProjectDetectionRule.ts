/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProjectDetectionConfidence, ProjectDetectionKind } from './WorkspaceProject';

/** A JSON value comparison used by a declarative project detection rule. */
export interface JsonProjectPredicate {
    readonly type: 'json';
    readonly file: string;
    /** Dot-separated property path. `*` selects values from every property at that segment. */
    readonly path: string;
    readonly operator: 'exists' | 'equals' | 'matches';
    readonly value?: string | number | boolean;
    readonly pattern?: string;
    readonly flags?: string;
}

/** A dependency lookup in a package-style JSON manifest. */
export interface DependencyProjectPredicate {
    readonly type: 'dependency';
    readonly file?: string;
    readonly name: string;
}

/** A file-presence lookup relative to a candidate project root. */
export interface FileProjectPredicate {
    readonly type: 'file';
    readonly pattern: string;
}

/** A bounded text-file regular-expression lookup. */
export interface TextProjectPredicate {
    readonly type: 'text';
    readonly file: string;
    readonly pattern: string;
    readonly flags?: string;
}

/** A serializable fact that can be evaluated against a candidate project root. */
export type ProjectPredicate =
    | DependencyProjectPredicate
    | FileProjectPredicate
    | JsonProjectPredicate
    | TextProjectPredicate;

/** A literal or JSON-sourced build output directory emitted by a rule. */
export type ProjectOutputRule =
    | string
    | {
        readonly file: string;
        readonly path: string;
        readonly fallback?: string;
    };

/** Metadata emitted when a {@linkcode ProjectDetectionRule} matches. */
export interface ProjectRuleEmission {
    readonly kind: ProjectDetectionKind;
    readonly id: string;
    readonly confidence: ProjectDetectionConfidence;
    readonly outputDirectory?: ProjectOutputRule;
}

/**
 * Declarative description of a candidate root and the evidence required to
 * classify it. Rules are evaluated by priority, specificity, and ID.
 */
export interface ProjectDetectionRule {
    readonly id: string;
    /** File patterns whose containing directories become candidate project roots. */
    readonly candidateFiles: readonly string[];
    readonly priority?: number;
    readonly all?: readonly ProjectPredicate[];
    readonly any?: readonly ProjectPredicate[];
    readonly none?: readonly ProjectPredicate[];
    readonly emits: readonly ProjectRuleEmission[];
}
