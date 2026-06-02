/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";

async function httpTrigger(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    const name = request.query.get("name") || (await request.text()) || "World";

    return { body: `Hello, ${name}!` };
}

app.http("httpTrigger", {
    methods: ["GET", "POST"],
    authLevel: "anonymous",
    handler: httpTrigger,
});
