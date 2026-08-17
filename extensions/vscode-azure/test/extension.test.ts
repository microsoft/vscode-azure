/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExtensionId } from '../src/constants';

const swaCommandPrefix = 'vscode-azure/staticWebApps/';
const retainedSwaCommands = [
    `${swaCommandPrefix}browse`,
    `${swaCommandPrefix}createNew`,
    `${swaCommandPrefix}createAdvanced`,
    `${swaCommandPrefix}cloneRepo`,
    `${swaCommandPrefix}openGitHubRepo`,
    `${swaCommandPrefix}openGitHubLog`,
    `${swaCommandPrefix}showActions`,
    `${swaCommandPrefix}action/cancel`,
    `${swaCommandPrefix}action/rerun`,
    `${swaCommandPrefix}deleteEnvironment`,
    `${swaCommandPrefix}createSwaConfigFile`,
    `${swaCommandPrefix}openWorkflowConfigFile`,
    `${swaCommandPrefix}showDocumentation`,
    `${swaCommandPrefix}showFunctionsDocumentation`,
    `${swaCommandPrefix}viewProperties`,
    `${swaCommandPrefix}installOrUpdateCli`,
    `${swaCommandPrefix}uninstallCli`,
] as const;

interface CommandContribution {
    readonly command: string;
    readonly title: string;
    readonly category?: string;
    readonly icon?: unknown;
}

interface MenuContribution {
    readonly command?: string;
    readonly submenu?: string;
    readonly when?: string;
    readonly group?: string;
}

interface ExtensionManifest {
    readonly activationEvents?: readonly string[];
    readonly capabilities?: {
        readonly virtualWorkspaces?: {
            readonly supported?: string;
            readonly description?: string;
        };
    };
    readonly extensionDependencies?: readonly string[];
    readonly contributes: {
        readonly commands: readonly CommandContribution[];
        readonly menus: Readonly<Record<string, readonly MenuContribution[]>>;
        readonly submenus?: readonly {
            readonly id: string;
            readonly label: string;
            readonly icon?: { readonly light: string; readonly dark: string };
        }[];
        readonly configuration?: {
            readonly properties?: Readonly<Record<string, unknown>>;
        };
        readonly debuggers?: readonly unknown[];
        readonly problemMatchers?: readonly unknown[];
        readonly jsonValidation?: readonly unknown[];
        readonly taskDefinitions?: readonly unknown[];
        readonly [key: string]: unknown;
    };
}

describe('extension', () => {
    it('should activate', async () => {
        const extension = vscode.extensions.getExtension(ExtensionId);
        if (!extension) {
            expect.fail('Extension not found');
        }

        await extension.activate();
    });

    it('should contribute and register every retained Static Web Apps command', async () => {
        const extension = vscode.extensions.getExtension(ExtensionId);
        await extension?.activate();
        if (!extension) {
            expect.fail('Extension not found');
        }

        const manifest = readManifest(extension);
        const contributions = manifest.contributes.commands.filter(command => command.command.startsWith(swaCommandPrefix));
        const registered = (await vscode.commands.getCommands(true)).filter(command => command.startsWith(swaCommandPrefix));

        expect(contributions.map(command => command.command)).to.have.members(retainedSwaCommands);
        expect(contributions).to.have.length(retainedSwaCommands.length);
        expect(registered).to.have.members(retainedSwaCommands);
        expect(registered).to.have.length(retainedSwaCommands.length);
        for (const command of contributions) {
            expect(command.category).to.equal('%commands.category.azureStaticWebApps%');
            expect(command.title).to.match(/^%commands\.vscode-azure\/staticWebApps\/.+%$/);
            expect(command.icon).not.to.be.undefined;
        }
    });
});

describe('Static Web Apps manifest (integration)', () => {
    let extension: vscode.Extension<unknown>;
    let manifest: ExtensionManifest;
    let nls: Readonly<Record<string, string>>;

    before(() => {
        const found = vscode.extensions.getExtension(ExtensionId);
        if (!found) {
            expect.fail('Extension not found');
        }
        extension = found;
        manifest = readManifest(extension);
        nls = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'package.nls.json'), 'utf8')) as Record<string, string>;
    });

    it('should wire complete SWA menus with bounded context checks', () => {
        const contributedCommandIds = new Set(manifest.contributes.commands.map(command => command.command));
        const menuEntries = Object.values(manifest.contributes.menus).flat();
        for (const entry of menuEntries) {
            if (entry.command) {
                expect(contributedCommandIds.has(entry.command), `Missing contribution for menu command ${entry.command}`).to.be.true;
            }
        }

        const viewContext = manifest.contributes.menus['view/item/context'];
        const swaEntries = viewContext.filter(entry => entry.command?.startsWith(swaCommandPrefix));
        expect(swaEntries).to.have.length(12);
        expect(viewContext.some(entry => entry.command === 'vscode-azure/resources/openInPortal')).to.be.true;
        expect(viewContext.some(entry => entry.command === 'vscode-azure/resources/refresh' && entry.when?.includes('azureStatic'))).to.be.true;

        for (const entry of viewContext) {
            const contextRegexes = [...(entry.when ?? '').matchAll(/viewItem =~ \/(.*?)\/i/g)];
            for (const [, pattern] of contextRegexes) {
                expect(pattern.startsWith('\\b'), entry.when).to.be.true;
                expect(pattern.endsWith('\\b'), entry.when).to.be.true;
            }
        }

        const swaWhenClauses = swaEntries.map(entry => entry.when).join(' ');
        for (const context of [
            'StaticWebApps',
            'azureResourceTypeGroup',
            'azureStaticWebApp',
            'azureStaticEnvironment',
            'azureStaticActions',
            'azureStaticActionCompleted',
            'azureStaticActionInProgress',
            'azureStaticJob',
            'azureStaticStep',
        ]) {
            expect(swaWhenClauses, `Missing legacy context ${context}`).to.include(context);
        }

        for (const command of [
            `${swaCommandPrefix}openGitHubLog`,
            `${swaCommandPrefix}openWorkflowConfigFile`,
            `${swaCommandPrefix}showFunctionsDocumentation`,
        ]) {
            expect(contributedCommandIds.has(command), `Missing tree command ${command}`).to.be.true;
        }
    });

    it('should expose the workspace submenu and hide only node-dependent palette commands', () => {
        const submenu = manifest.contributes.submenus?.find(entry => entry.id === `${swaCommandPrefix}workspaceActions`);
        expect(submenu).to.deep.equal({
            id: `${swaCommandPrefix}workspaceActions`,
            label: '%submenus.vscode-azure/staticWebApps/workspaceActions%',
            icon: {
                light: 'resources/staticWebApps/azure-staticwebapps.svg',
                dark: 'resources/staticWebApps/azure-staticwebapps.svg',
            },
        });
        expect(fs.existsSync(path.join(extension.extensionPath, submenu?.icon?.light ?? 'missing'))).to.be.true;

        expect(manifest.contributes.menus[`${swaCommandPrefix}workspaceActions`]).to.deep.equal([
            { command: `${swaCommandPrefix}createSwaConfigFile`, group: '1_project@1' },
            { command: `${swaCommandPrefix}createNew`, group: '2_create@1' },
            { command: `${swaCommandPrefix}createAdvanced`, group: '2_create@2' },
        ]);
        expect(manifest.contributes.menus['view/title']).to.deep.include({
            submenu: `${swaCommandPrefix}workspaceActions`,
            when: 'view == vscode-azure/workspace',
            group: 'navigation@3',
        });

        const hidden = manifest.contributes.menus.commandPalette
            .filter(entry => entry.command?.startsWith(swaCommandPrefix) && entry.when === 'false')
            .map(entry => entry.command);
        expect(hidden).to.have.members([
            `${swaCommandPrefix}action/cancel`,
            `${swaCommandPrefix}action/rerun`,
            `${swaCommandPrefix}deleteEnvironment`,
            `${swaCommandPrefix}openGitHubLog`,
            `${swaCommandPrefix}showFunctionsDocumentation`,
            `${swaCommandPrefix}viewProperties`,
        ]);
        for (const publicCommand of [
            `${swaCommandPrefix}createNew`,
            `${swaCommandPrefix}createAdvanced`,
            `${swaCommandPrefix}createSwaConfigFile`,
            `${swaCommandPrefix}showDocumentation`,
            `${swaCommandPrefix}installOrUpdateCli`,
            `${swaCommandPrefix}uninstallCli`,
        ]) {
            expect(hidden).not.to.include(publicCommand);
        }
    });

    it('should resolve every manifest localization placeholder without source orphans', () => {
        const placeholders = collectLocalizationPlaceholders(manifest);
        for (const key of placeholders) {
            expect(nls, `Missing package.nls.json key ${key}`).to.have.property(key);
        }

        for (const orphan of [
            'staticWebApps.deleteConfirmation',
            'staticWebApps.deleteConfirmation.ClickButton',
            'staticWebApps.deleteConfirmation.EnterName',
            'staticWebApps.revealResource',
            'commands.vscode-azure/staticWebApps/reportIssue',
            'settings.vscode-azure.staticWebApps.appArtifactSubpath',
            'settings.vscode-azure.staticWebApps.enableOutputTimestamps',
        ]) {
            expect(nls).not.to.have.property(orphan);
        }
    });

    it('should contribute retained activation, capability, debug, schema, and settings surfaces', () => {
        expect(manifest.activationEvents).to.have.members([
            'onDebugDynamicConfigurations',
            'onDebugInitialConfigurations',
            'onDebugResolve:pwa-chrome',
            'workspaceContains:**/staticwebapp.config.json',
            'workspaceContains:**/swa-cli.config.json',
        ]);
        expect(manifest.capabilities?.virtualWorkspaces).to.deep.equal({
            supported: 'limited',
            description: '%capabilities.virtualWorkspaces.description%',
        });
        expect(manifest.contributes.debuggers).to.deep.equal([
            { type: 'swa', label: 'Azure Static Web Apps' },
        ]);
        expect(manifest.contributes.problemMatchers).to.deep.equal([
            {
                name: 'swa-watch',
                label: '%problemMatchers.vscode-azure/staticWebApps/swaWatch%',
                owner: 'Azure Static Web Apps',
                source: 'swa',
                pattern: { regexp: '.', file: 1, location: 2, message: 3 },
                background: {
                    activeOnStart: true,
                    beginsPattern: '.',
                    endsPattern: 'Azure Static Web Apps emulator started',
                },
            },
        ]);
        expect(manifest.contributes.jsonValidation).to.have.deep.members([
            {
                fileMatch: 'staticwebapp.config.json',
                url: 'https://json.schemastore.org/staticwebapp.config.json',
            },
            {
                fileMatch: 'swa-cli.config.json',
                url: 'https://raw.githubusercontent.com/Azure/static-web-apps-cli/main/schema/swa-cli.config.schema.json',
            },
        ]);

        const settings = manifest.contributes.configuration?.properties ?? {};
        expect(Object.keys(settings).filter(key => key.includes('staticWebApps'))).to.have.members([
            'vscode-azure.staticWebApps.appSubpath',
            'vscode-azure.staticWebApps.apiSubpath',
            'vscode-azure.staticWebApps.outputSubpath',
            'vscode-azure.staticWebApps.showStaticWebAppsCliWarning',
        ]);
        for (const key of [
            'vscode-azure.staticWebApps.appSubpath',
            'vscode-azure.staticWebApps.apiSubpath',
            'vscode-azure.staticWebApps.outputSubpath',
        ]) {
            expect(settings[key]).to.deep.include({ type: 'string', scope: 'resource' });
        }
        expect(settings['vscode-azure.staticWebApps.showStaticWebAppsCliWarning']).to.deep.include({
            type: 'boolean',
            default: true,
        });

        expect(manifest.extensionDependencies).to.be.undefined;
        expect(manifest.contributes['x-azResources']).to.be.undefined;
        expect(manifest.contributes.taskDefinitions).to.be.undefined;
    });
});

function collectLocalizationPlaceholders(value: unknown): string[] {
    if (typeof value === 'string') {
        const match = /^%(.+)%$/.exec(value);
        return match ? [match[1]] : [];
    } else if (Array.isArray(value)) {
        return value.flatMap(collectLocalizationPlaceholders);
    } else if (value && typeof value === 'object') {
        return Object.values(value).flatMap(collectLocalizationPlaceholders);
    }
    return [];
}

function readManifest(extension: vscode.Extension<unknown>): ExtensionManifest {
    return JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8')) as ExtensionManifest;
}

describe('bundle size guardrail (integration)', () => {
    // Baseline size (in bytes) of the packaged VSIX.
    //
    // This is a guardrail, NOT a target. The intent is to notice when the extension
    // bundle grows or shrinks unexpectedly -- for example, a stray namespace import
    // that drags in a whole SDK, or a dependency that inadvertently ships its source
    // maps. The +/-10% tolerance below is deliberately generous to avoid noisy failures
    // on normal churn, so a failure here almost always means something real.
    //
    // DO NOT bump this baseline casually. Before changing it, confirm that the size
    // delta is expected and justified (e.g. a new Azure service, a deliberate SDK
    // upgrade). A PR that touches this number should explain, in its description,
    // *why* the bundle legitimately grew or shrank. If you cannot explain it,
    // investigate before updating the baseline.
    const VSIX_BASELINE_BYTES = 367942;
    const VSIX_TOLERANCE = 0.1;
    const VSIX_WARN_THRESHOLD = 0.05;

    it('should be within 10% of the baseline size', function () {
        const extension = vscode.extensions.getExtension(ExtensionId);
        if (!extension) {
            expect.fail('Extension not found');
        }

        // `vsce package` emits the VSIX next to package.json (e.g. `vscode-azure-1.0.0.vsix`).
        // In local dev runs the VSIX typically isn't built, so we skip rather than fail.
        // Under GitHub Actions, however, a missing VSIX means this guardrail would never
        // run, so fail fast instead of silently skipping.
        // If multiple VSIXs are present (e.g. stale artifacts from prior versions), pick the
        // highest semver to measure the current build. `localeCompare` with `numeric: true`
        // orders embedded version numbers correctly (e.g. `1.10.0` > `1.2.0`).
        const extensionPath = extension.extensionPath;
        const vsixFiles = fs.readdirSync(extensionPath).filter((name) => name.endsWith('.vsix'));
        if (vsixFiles.length === 0) {
            if (process.env.GITHUB_ACTIONS === 'true') {
                expect.fail(
                    `No .vsix file found under ${extensionPath}. Build/package the extension ` +
                    `before running the bundle size guardrail in CI.`,
                );
            }
            this.skip();
        }

        const latestVsix = vsixFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

        const vsixPath = path.join(extensionPath, latestVsix);
        const actualBytes = fs.statSync(vsixPath).size;

        const lower = VSIX_BASELINE_BYTES * (1 - VSIX_TOLERANCE);
        const upper = VSIX_BASELINE_BYTES * (1 + VSIX_TOLERANCE);
        const deltaPercent = ((actualBytes - VSIX_BASELINE_BYTES) / VSIX_BASELINE_BYTES) * 100;

        // Mocha has no native "warn" state. When drift is past the warn threshold but
        // still within the hard tolerance, log to the console (might get buried in Mocha
        // output, but worth a shot) and emit a GitHub Actions `::warning::` annotation
        // under CI so it surfaces in the PR checks UI without failing the run.
        if (
            Math.abs(deltaPercent) >= VSIX_WARN_THRESHOLD * 100 &&
            Math.abs(deltaPercent) < VSIX_TOLERANCE * 100
        ) {
            const message =
                `VSIX size ${actualBytes} bytes is ${deltaPercent.toFixed(1)}% off baseline ` +
                `${VSIX_BASELINE_BYTES} bytes (warn threshold ${VSIX_WARN_THRESHOLD * 100}%, ` +
                `fail threshold ${VSIX_TOLERANCE * 100}%).`;
            console.warn(`[bundle-size] ${message}`);
            if (process.env.GITHUB_ACTIONS === 'true') {
                // GitHub Actions workflow commands require `%`, `\r`, and `\n` in the message
                // to be URL-encoded, otherwise the annotation parses incorrectly.
                // See https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#example-setting-a-warning-message
                const encoded = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
                console.log(`::warning title=Bundle size drift::${encoded}`);
            }
        }

        expect(
            actualBytes,
            `VSIX size ${actualBytes} bytes is ${deltaPercent.toFixed(1)}% off baseline ` +
            `${VSIX_BASELINE_BYTES} bytes (allowed range ${lower.toFixed(0)}-${upper.toFixed(0)}). ` +
            `If this change is intentional, update VSIX_BASELINE_BYTES -- but please read the ` +
            `comment above it first and justify the change in your PR description.`,
        )
            .to.be.at.least(lower)
            .and.at.most(upper);
    });
});
