/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Barrel exports for the hand-authored Microsoft.Resources REST client.

import createClient from './resourceClient.js';

export default createClient;
export * from './clientDefinitions.js';
export * from './isUnexpected.js';
// export * from './models.js'; // No input models yet — read-only client.
export * from './outputModels.js';
export * from './paginators.js';
export * from './parameters.js';
export * from './resourceClient.js';
export * from './responses.js';
export { createClient };

