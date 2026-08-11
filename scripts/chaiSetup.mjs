/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Registers `chai-as-promised`, which adds the `rejected` / `rejectedWith`
 * assertions used to test async behavior.
 *
 * TEMPORARY: `@microsoft/vscode-azext-eng` already depends on
 * `chai-as-promised` but does not call `use()` on it, so each repo has to do
 * this itself. Once https://github.com/microsoft/vscode-azuretools/issues/2382
 * ships this in the shared mocha setup, delete this file along with the
 * `mocha.require` entries that reference it and the `publicHoistPattern`
 * entries in `pnpm-workspace.yaml`.
 */

import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);
