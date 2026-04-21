/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Placeholder imports so these files appear in the coverage report.
// TODO: Replace with real tests as coverage grows.

import { describe, it } from 'mocha';
import { TrackArmDeployment } from '../../commands/TrackArmDeployment';
import { CreateFunctionApp } from '../../commands/functions/CreateFunctionApp';
import { getRuntimeVersion } from '../../commands/functions/CreateFunctionAppContext';
import { PickHostingPlanStep } from '../../commands/functions/steps/PickHostingPlanStep';
import { PickRuntimeStep } from '../../commands/functions/steps/PickRuntimeStep';

describe('commands coverage placeholders (unit)', () => {
    it('should load TrackArmDeployment', () => { void TrackArmDeployment; });
    it('should load CreateFunctionApp', () => { void CreateFunctionApp; });
    it('should load getRuntimeVersion', () => { void getRuntimeVersion; });
    it('should load PickHostingPlanStep', () => { void PickHostingPlanStep; });
    it('should load PickRuntimeStep', () => { void PickRuntimeStep; });
});
