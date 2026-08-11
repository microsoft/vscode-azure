/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mocha root hook that registers `chai-as-promised`, which adds the
 * `rejected` / `rejectedWith` / `fulfilled` assertions used to test async
 * behavior.
 *
 * Every test package loads this so the assertions are available without each
 * spec calling `use()` itself. Registering twice is harmless, but doing it
 * here keeps the plugin from being silently missing in one package.
 */

import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);
