/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProjectDetector, ProjectMarkers } from './ProjectDetector';

const packageJson = 'package.json';
const angularJson = 'angular.json';
const hugoConfigNames = ['hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json'];
const genericConfigNames = ['config.toml', 'config.yaml', 'config.yml', 'config.json'];

/** Hugo-specific keys, used to tell a Hugo site from any unrelated `config.*`. */
const hugoConfigKeys = /^\s*(?:baseURL|contentDir|publishDir|theme)\s*[:=]/im;

/** Files whose presence makes a directory worth evaluating. */
export const defaultProjectMarkers: ProjectMarkers = {
    names: new Set([
        packageJson,
        angularJson,
        'tsconfig.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'index.html',
        ...hugoConfigNames,
        ...genericConfigNames,
    ]),
    suffixes: ['.csproj'],
};

/** The first Hugo config in this directory that actually looks like Hugo. */
async function findHugoConfig(directory: Parameters<ProjectDetector>[0]): Promise<string | undefined> {
    for (const name of hugoConfigNames) {
        if (directory.has(name)) {
            return name;
        }
    }
    // `config.*` is far too common to accept on filename alone, so require a
    // Hugo-specific key before claiming the directory.
    for (const name of genericConfigNames) {
        if (directory.has(name) && hugoConfigKeys.test(await directory.text(name) ?? '')) {
            return name;
        }
    }
    return undefined;
}

/** Reads a string at a dotted path, treating `*` as "any property at this level". */
function readStringAt(value: unknown, path: readonly string[]): string | undefined {
    let current: readonly unknown[] = [value];
    for (const segment of path) {
        current = current.flatMap(candidate => {
            if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
                return [];
            }
            const record = candidate as Record<string, unknown>;
            return segment === '*' ? Object.values(record) : [record[segment]];
        });
    }
    return current.find((candidate): candidate is string => typeof candidate === 'string');
}

/**
 * Product-neutral detectors for common project types, frameworks, languages, and
 * build tools. Consumers may pass extra detectors to the scan.
 */
export const defaultProjectDetectors: readonly ProjectDetector[] = [
    // --- JavaScript / TypeScript frameworks -------------------------------
    async directory => {
        if (!await directory.hasDependency('next')) {
            return undefined;
        }
        // A static export produces `out/`; an SSR app has no single output dir.
        const scripts = readStringAt(await directory.json(packageJson), ['scripts', '*']);
        const staticExport = /\bnext\s+export\b/.test(scripts ?? '')
            || /\boutput\s*:\s*['"]export['"]/.test(await readNextConfig(directory) ?? '');
        return staticExport
            ? { frameworks: ['nextjs-export'], outputDirectory: 'out' }
            : { frameworks: ['nextjs'] };
    },
    async directory => await directory.hasDependency('@sveltejs/kit')
        ? { frameworks: ['svelte-kit'], outputDirectory: 'build' }
        : undefined,
    async directory => await directory.hasDependency('nuxt')
        ? { frameworks: ['nuxt'], outputDirectory: '.output/public' }
        : undefined,
    async directory => await directory.hasDependency('gatsby')
        ? { frameworks: ['gatsby'], outputDirectory: 'public' }
        : undefined,
    async directory => await directory.hasDependency('vuepress')
        ? { frameworks: ['vuepress'], outputDirectory: '.vuepress/dist' }
        : undefined,
    async directory => {
        if (!directory.has(angularJson) && !await directory.hasDependency('@angular/core')) {
            return undefined;
        }
        const configured = readStringAt(
            await directory.json(angularJson),
            ['projects', '*', 'architect', 'build', 'options', 'outputPath'],
        );
        return { frameworks: ['angular'], outputDirectory: configured ?? 'dist' };
    },
    async directory => await directory.hasDependency('react')
        && !await directory.hasDependency('next')
        && !await directory.hasDependency('gatsby')
        ? { frameworks: ['react'], outputDirectory: 'build' }
        : undefined,
    async directory => await directory.hasDependency('svelte')
        && !await directory.hasDependency('@sveltejs/kit')
        ? { frameworks: ['svelte'], outputDirectory: 'public' }
        : undefined,
    async directory => await directory.hasDependency('vue')
        && !await directory.hasDependency('nuxt')
        && !await directory.hasDependency('vuepress')
        ? { frameworks: ['vue'], outputDirectory: 'dist' }
        : undefined,

    // --- Other stacks -----------------------------------------------------
    async directory => {
        const project = directory.findBySuffix('.csproj');
        if (!project) {
            return undefined;
        }
        const source = await directory.text(project) ?? '';
        const blazor = /Microsoft\.AspNetCore\.Components\.WebAssembly|Sdk="Microsoft\.NET\.Sdk\.BlazorWebAssembly"/i.test(source);
        return {
            frameworks: blazor ? ['blazor-wasm'] : [],
            buildTools: ['dotnet'],
            languages: ['csharp'],
            outputDirectory: blazor ? 'wwwroot' : undefined,
        };
    },
    async directory => await findHugoConfig(directory)
        ? { frameworks: ['hugo'], buildTools: ['hugo'], outputDirectory: 'public' }
        : undefined,

    // --- Build tooling and languages --------------------------------------
    async directory => await directory.hasDependency('vite')
        ? { buildTools: ['vite'] }
        : undefined,
    directory => directory.has('package-lock.json') ? { buildTools: ['npm'] } : undefined,
    directory => directory.has('pnpm-lock.yaml') ? { buildTools: ['pnpm'] } : undefined,
    directory => directory.has('yarn.lock') ? { buildTools: ['yarn'] } : undefined,
    async directory => {
        if (!directory.has(packageJson)) {
            return undefined;
        }
        const typescript = directory.has('tsconfig.json') || await directory.hasDependency('typescript');
        return { languages: [typescript ? 'typescript' : 'javascript'] };
    },
];

/** Next.js config files, in the order Next itself resolves them. */
async function readNextConfig(directory: Parameters<ProjectDetector>[0]): Promise<string | undefined> {
    for (const name of ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts']) {
        if (directory.has(name)) {
            return directory.text(name);
        }
    }
    return undefined;
}
