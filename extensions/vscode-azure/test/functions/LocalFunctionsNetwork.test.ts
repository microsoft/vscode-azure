/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnection } from 'node:net';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { LocalFunctionsNetwork } from '../../src/functions/host/LocalFunctionsNetwork';

describe('LocalFunctionsNetwork (integration)', () => {
    it('releases a reservation even when a client keeps its connection open', async () => {
        const reservation = await new LocalFunctionsNetwork(createMockVsCode().vscode).reserve();
        const client = createConnection({ port: reservation.port, host: '127.0.0.1' });
        await new Promise<void>(resolve => client.once('connect', resolve));
        client.on('error', () => undefined);

        await reservation.release();
        client.destroy();
    });
});
