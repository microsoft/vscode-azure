/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// SPIKE shim. The real `VoidFunction` global augmentation now lives in the
// permanent `../data/queryCoreGlobals` module (adopted alongside the production
// query-core rewrite of `DataItemTree`). This file re-exports it so the spike's
// side-effect import keeps working while the global is declared exactly once.

import '../data/queryCoreGlobals';

export {};
