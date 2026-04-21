/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Placeholder imports so these files appear in the coverage report.
// TODO: Replace with real tests as coverage grows.

import { describe, it } from 'mocha';
import { findAzureYaml } from '../../utils/azdUtils';
import { AzdProvisionStep } from '../../wizard/azd/AzdProvisionStep';
import { CreateAzdEnvStep } from '../../wizard/azd/CreateAzdEnvStep';
import { EnvironmentNameStep } from '../../wizard/azd/EnvironmentNameStep';
import { GenerateAzureYamlStep } from '../../wizard/azd/GenerateAzureYamlStep';
import { GenerateBicepStep } from '../../wizard/azd/GenerateBicepStep';
import { HydrateAzdInfoStep } from '../../wizard/azd/HydrateAzdInfoStep';
import { OfferSaveStep } from '../../wizard/azd/OfferSaveStep';
import { TempProjectManager } from '../../wizard/azd/TempProjectManager';

describe('azd coverage placeholders (unit)', () => {
    it('should load AzdProvisionStep', () => { void AzdProvisionStep; });
    it('should load CreateAzdEnvStep', () => { void CreateAzdEnvStep; });
    it('should load EnvironmentNameStep', () => { void EnvironmentNameStep; });
    it('should load GenerateAzureYamlStep', () => { void GenerateAzureYamlStep; });
    it('should load GenerateBicepStep', () => { void GenerateBicepStep; });
    it('should load HydrateAzdInfoStep', () => { void HydrateAzdInfoStep; });
    it('should load OfferSaveStep', () => { void OfferSaveStep; });
    it('should load TempProjectManager', () => { void TempProjectManager; });
    it('should load findAzureYaml', () => { void findAzureYaml; });
});
