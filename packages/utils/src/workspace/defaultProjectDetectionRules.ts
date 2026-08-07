/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProjectDetectionRule, ProjectPredicate } from './ProjectDetectionRule';

const packageFile = 'package.json';

function dependency(name: string): ProjectPredicate {
    return { type: 'dependency', name };
}

function file(pattern: string): ProjectPredicate {
    return { type: 'file', pattern };
}

/**
 * Product-neutral rules for common project types, frameworks, languages, and
 * build tools. Consumers may append rules through `WorkspaceScanOptions`.
 */
export const defaultProjectDetectionRules: readonly ProjectDetectionRule[] = [
    {
        id: 'project.node',
        candidateFiles: [packageFile],
        all: [file(packageFile)],
        emits: [{ kind: 'project', id: 'node', confidence: 'high' }],
    },
    {
        id: 'framework.nextjs-export',
        candidateFiles: [packageFile],
        priority: 130,
        all: [dependency('next')],
        any: [
            { type: 'json', file: packageFile, path: 'scripts.*', operator: 'matches', pattern: '\\bnext\\s+export\\b' },
            { type: 'text', file: 'next.config.{js,cjs,mjs,ts}', pattern: '\\boutput\\s*:\\s*[\\x27\\x22]export[\\x27\\x22]' },
        ],
        emits: [{
            kind: 'framework',
            id: 'nextjs-export',
            confidence: 'high',
            outputDirectory: 'out',
        }],
    },
    {
        id: 'framework.nextjs',
        candidateFiles: [packageFile],
        priority: 120,
        all: [dependency('next')],
        none: [
            { type: 'json', file: packageFile, path: 'scripts.*', operator: 'matches', pattern: '\\bnext\\s+export\\b' },
            { type: 'text', file: 'next.config.{js,cjs,mjs,ts}', pattern: '\\boutput\\s*:\\s*[\\x27\\x22]export[\\x27\\x22]' },
        ],
        emits: [{ kind: 'framework', id: 'nextjs', confidence: 'high' }],
    },
    {
        id: 'framework.svelte-kit',
        candidateFiles: [packageFile],
        priority: 120,
        all: [dependency('@sveltejs/kit')],
        emits: [{
            kind: 'framework',
            id: 'svelte-kit',
            confidence: 'high',
            outputDirectory: 'build',
        }],
    },
    {
        id: 'framework.nuxt',
        candidateFiles: [packageFile],
        priority: 120,
        all: [dependency('nuxt')],
        emits: [{
            kind: 'framework',
            id: 'nuxt',
            confidence: 'high',
            outputDirectory: '.output/public',
        }],
    },
    {
        id: 'framework.gatsby',
        candidateFiles: [packageFile],
        priority: 120,
        all: [dependency('gatsby')],
        emits: [{
            kind: 'framework',
            id: 'gatsby',
            confidence: 'high',
            outputDirectory: 'public',
        }],
    },
    {
        id: 'framework.vuepress',
        candidateFiles: [packageFile],
        priority: 120,
        all: [dependency('vuepress')],
        emits: [{
            kind: 'framework',
            id: 'vuepress',
            confidence: 'high',
            outputDirectory: '.vuepress/dist',
        }],
    },
    {
        id: 'framework.angular',
        candidateFiles: [packageFile, 'angular.json'],
        priority: 110,
        any: [dependency('@angular/core'), file('angular.json')],
        emits: [{
            kind: 'framework',
            id: 'angular',
            confidence: 'high',
            outputDirectory: {
                file: 'angular.json',
                path: 'projects.*.architect.build.options.outputPath',
                fallback: 'dist',
            },
        }],
    },
    {
        id: 'framework.react',
        candidateFiles: [packageFile],
        priority: 100,
        all: [dependency('react')],
        none: [dependency('next'), dependency('gatsby')],
        emits: [{
            kind: 'framework',
            id: 'react',
            confidence: 'high',
            outputDirectory: 'build',
        }],
    },
    {
        id: 'framework.svelte',
        candidateFiles: [packageFile],
        priority: 100,
        all: [dependency('svelte')],
        none: [dependency('@sveltejs/kit')],
        emits: [{
            kind: 'framework',
            id: 'svelte',
            confidence: 'high',
            outputDirectory: 'public',
        }],
    },
    {
        id: 'framework.vue',
        candidateFiles: [packageFile],
        priority: 100,
        all: [dependency('vue')],
        none: [dependency('nuxt'), dependency('vuepress')],
        emits: [{
            kind: 'framework',
            id: 'vue',
            confidence: 'high',
            outputDirectory: 'dist',
        }],
    },
    {
        id: 'framework.blazor-wasm',
        candidateFiles: ['*.csproj'],
        priority: 110,
        all: [{
            type: 'text',
            file: '*.csproj',
            pattern: 'Microsoft\\.AspNetCore\\.Components\\.WebAssembly|Sdk="Microsoft\\.NET\\.Sdk\\.BlazorWebAssembly"',
            flags: 'i',
        }],
        emits: [{
            kind: 'framework',
            id: 'blazor-wasm',
            confidence: 'high',
            outputDirectory: 'wwwroot',
        }],
    },
    {
        id: 'framework.hugo',
        candidateFiles: ['hugo.{toml,yaml,yml,json}'],
        priority: 90,
        all: [file('hugo.{toml,yaml,yml,json}')],
        emits: [
            { kind: 'project', id: 'hugo', confidence: 'high' },
            { kind: 'framework', id: 'hugo', confidence: 'high', outputDirectory: 'public' },
            { kind: 'buildTool', id: 'hugo', confidence: 'high' },
        ],
    },
    {
        id: 'framework.hugo-config',
        candidateFiles: ['config.{toml,yaml,yml,json}'],
        priority: 90,
        all: [{
            type: 'text',
            file: 'config.{toml,yaml,yml,json}',
            pattern: '^\\s*(?:baseURL|contentDir|publishDir|theme)\\s*[:=]',
            flags: 'im',
        }],
        emits: [
            { kind: 'project', id: 'hugo', confidence: 'high' },
            { kind: 'framework', id: 'hugo', confidence: 'high', outputDirectory: 'public' },
            { kind: 'buildTool', id: 'hugo', confidence: 'high' },
        ],
    },
    {
        id: 'framework.static-html',
        candidateFiles: ['index.html'],
        priority: -100,
        all: [file('index.html')],
        emits: [{
            kind: 'framework',
            id: 'html',
            confidence: 'low',
            outputDirectory: '.',
        }],
    },
    {
        id: 'build.vite',
        candidateFiles: [packageFile],
        all: [dependency('vite')],
        emits: [{ kind: 'buildTool', id: 'vite', confidence: 'high', outputDirectory: 'dist' }],
    },
    {
        id: 'build.npm',
        candidateFiles: ['package-lock.json'],
        all: [file('package-lock.json')],
        emits: [{ kind: 'buildTool', id: 'npm', confidence: 'high' }],
    },
    {
        id: 'build.pnpm',
        candidateFiles: ['pnpm-lock.yaml'],
        all: [file('pnpm-lock.yaml')],
        emits: [{ kind: 'buildTool', id: 'pnpm', confidence: 'high' }],
    },
    {
        id: 'build.yarn',
        candidateFiles: ['yarn.lock'],
        all: [file('yarn.lock')],
        emits: [{ kind: 'buildTool', id: 'yarn', confidence: 'high' }],
    },
    {
        id: 'language.typescript',
        candidateFiles: [packageFile, 'tsconfig.json'],
        any: [file('tsconfig.json'), dependency('typescript')],
        emits: [{ kind: 'language', id: 'typescript', confidence: 'high' }],
    },
    {
        id: 'language.javascript',
        candidateFiles: [packageFile],
        all: [file(packageFile)],
        none: [file('tsconfig.json'), dependency('typescript')],
        emits: [{ kind: 'language', id: 'javascript', confidence: 'medium' }],
    },
    {
        id: 'language.dotnet',
        candidateFiles: ['*.csproj'],
        all: [file('*.csproj')],
        emits: [
            { kind: 'project', id: 'dotnet', confidence: 'high' },
            { kind: 'buildTool', id: 'dotnet', confidence: 'high' },
            { kind: 'language', id: 'csharp', confidence: 'high' },
        ],
    },
];
