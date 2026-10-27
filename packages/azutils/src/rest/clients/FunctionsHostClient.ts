/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client, ClientOptions, OperationOptions, RequestParameters } from '@azure-rest/core-client';
import { RestError } from '@azure/core-rest-pipeline';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { assertRestSuccess } from '../assertRestSuccess';
import { createDataPlaneRestClient } from '../createAzureClient';

export type { ClientOptions as FunctionsHostClientOptions };
export type { OperationOptions as FunctionsHostRequestOptions };

/**
 * A local Core Tools host, or a remote app whose master key is obtained lazily
 * from the management-plane host-keys operation. Remote endpoints must use HTTPS.
 */
export type FunctionsHostTarget =
    | { readonly port: number }
    | { readonly endpoint: string; readonly getMasterKey: () => Promise<string> };

/** Metadata as returned by the Functions host's `/admin/functions` API. */
export interface HostFunction {
    readonly name: string;
    readonly config?: Readonly<Record<string, unknown>> | null;
    readonly isDisabled?: boolean;
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Functions host wire field.
    readonly invoke_url_template?: string | null;
}

/** Host readiness information from `/admin/host/status`. */
export interface FunctionsHostStatus {
    readonly state: string;
    readonly version?: string;
    readonly errors?: readonly string[];
}

/** Host administration and HTTP-trigger requests used by local and remote Functions development. */
export interface IFunctionsHostClient {
    listFunctions(options?: OperationOptions): Promise<readonly HostFunction[]>;
    getStatus(options?: OperationOptions): Promise<FunctionsHostStatus>;
    /**
     * Acceptance queues execution; it does not wait for the function to finish.
     * Strings are passed through; other inputs are JSON-serialized to host input text.
     * Rejects before sending a request if serialization throws or produces no text.
     */
    invoke(functionName: string, input: unknown, options?: OperationOptions): Promise<void>;
    /** Posts raw input to a validated HTTP trigger on this host; keys are sent only in a header. */
    invokeHttp(url: URL, input: string, options?: OperationOptions): Promise<void>;
}

/** Creates a host client without querying keys or starting a host. */
export const IFunctionsHostClientProvider: ServiceIdentifier<IFunctionsHostClientProvider> = Symbol.for('IFunctionsHostClientProvider');
export type IFunctionsHostClientProvider = SyncFactory<IFunctionsHostClient, [FunctionsHostTarget]>;

/**
 * Uses the shared REST pipeline for the Functions host admin API.
 *
 * API contract: https://github.com/Azure/azure-functions-host/tree/dev/src/WebJobs.Script.WebHost/Controllers
 * Local requests are restricted to loopback; remote keys are sent in a header,
 * never in a URL, and redirects are rejected.
 */
export class FunctionsHostClient implements IFunctionsHostClient {
    private constructor(
        private readonly ctx: ICodeContext,
        private readonly inner: Client,
        private readonly target: FunctionsHostTarget,
    ) { }

    /** Creates a lightweight client; authentication is deferred until a request. */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        target: FunctionsHostTarget,
        options?: ClientOptions,
    ): FunctionsHostClient {
        let endpoint: string;
        if ('port' in target) {
            if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
                throw new TypeError(ctx.code.l10n.t('The Functions host port must be an integer from 1 to 65535.'));
            }
            endpoint = `http://127.0.0.1:${target.port}`;
        } else {
            if (!URL.canParse(target.endpoint)) {
                throw new TypeError(ctx.code.l10n.t('The remote Functions host endpoint must be an HTTPS origin.'));
            }
            const url = new URL(target.endpoint);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
                throw new TypeError(ctx.code.l10n.t('The remote Functions host endpoint must be an HTTPS origin.'));
            }
            endpoint = url.origin;
        }
        const inner = createDataPlaneRestClient(ctx, executor, { name: 'functions-host', endpoint }, options);
        inner.pipeline.removePolicy({ name: 'redirectPolicy' });
        return new FunctionsHostClient(ctx, inner, target);
    }

    /** Lists the whole function collection; the host API does not page this endpoint. */
    public async listFunctions(options?: OperationOptions): Promise<readonly HostFunction[]> {
        const response = await this.inner.pathUnchecked('/admin/functions').get(await this.requestOptions(options));
        assertRestSuccess(this.ctx.code, response);
        const body: unknown = response.body;
        if (!Array.isArray(body) || !body.every(isHostFunction)) {
            throw new RestError(this.ctx.code.l10n.t('The Functions host returned invalid function metadata.'));
        }
        return body;
    }

    /** Reads readiness without converting unavailable or unauthorized hosts into a ready state. */
    public async getStatus(options?: OperationOptions): Promise<FunctionsHostStatus> {
        const response = await this.inner.pathUnchecked('/admin/host/status').get(await this.requestOptions(options));
        assertRestSuccess(this.ctx.code, response);
        const body: unknown = response.body;
        if (!isHostStatus(body)) {
            throw new RestError(this.ctx.code.l10n.t('The Functions host returned an invalid status.'));
        }
        return body;
    }

    /** Queues a function invocation with string input or JSON-serialized input text. */
    public async invoke(functionName: string, input: unknown, options?: OperationOptions): Promise<void> {
        if (!functionName) {
            throw new TypeError(this.ctx.code.l10n.t('A function name is required.'));
        }
        const serializedInput = typeof input === 'string' ? input : JSON.stringify(input);
        // JSON.stringify can return undefined for unsupported top-level values despite its return type.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (serializedInput === undefined) {
            throw new TypeError(this.ctx.code.l10n.t('The function input must be a string or a JSON-serializable value.'));
        }
        const response = await this.inner.pathUnchecked('/admin/functions/{name}', functionName).post({
            ...await this.requestOptions(options),
            contentType: 'application/json',
            body: { input: serializedInput },
        });
        assertRestSuccess(this.ctx.code, response);
    }

    /** Rejects other origins and redirects, and never acquires an admin master key for an HTTP trigger. */
    public async invokeHttp(url: URL, input: string, options?: OperationOptions): Promise<void> {
        const local = 'port' in this.target;
        const matchesHost = local
            ? url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
                && Number(url.port || '80') === this.target.port
            : url.origin === new URL(this.target.endpoint).origin;
        if (!matchesHost || url.username || url.password) {
            throw new TypeError(this.ctx.code.l10n.t('The HTTP function URL must belong to the selected Functions host.'));
        }
        const target = new URL(url);
        let key: string | undefined;
        for (const name of [...target.searchParams.keys()]) {
            if (name.toLowerCase() === 'code') {
                key = target.searchParams.get(name) ?? undefined;
                target.searchParams.delete(name);
            }
        }
        const response = await this.inner.pathUnchecked(target.toString()).post({
            ...options?.requestOptions,
            abortSignal: options?.abortSignal,
            tracingOptions: options?.tracingOptions,
            onResponse: options?.onResponse,
            allowInsecureConnection: local,
            headers: { ...options?.requestOptions?.headers, ...(key ? { 'x-functions-key': key } : {}) },
            contentType: 'application/json',
            // Bytes bypass the REST client's JSON string quoting.
            body: new TextEncoder().encode(input),
        });
        assertRestSuccess(this.ctx.code, response);
    }

    private async requestOptions(options?: OperationOptions): Promise<RequestParameters> {
        const requestOptions: RequestParameters = {
            ...options?.requestOptions,
            abortSignal: options?.abortSignal,
            tracingOptions: options?.tracingOptions,
            onResponse: options?.onResponse,
        };
        if ('port' in this.target) {
            return { ...requestOptions, allowInsecureConnection: true };
        }
        const key = await this.target.getMasterKey();
        if (!key) {
            throw new Error(this.ctx.code.l10n.t('The Function App did not return a host master key.'));
        }
        return {
            ...requestOptions,
            allowInsecureConnection: false,
            headers: { ...requestOptions.headers, 'x-functions-key': key },
        };
    }
}

function isHostFunction(value: unknown): value is HostFunction {
    return !!value && typeof value === 'object'
        && 'name' in value && typeof value.name === 'string' && value.name.length > 0
        && (!('config' in value) || value.config === null || (typeof value.config === 'object' && !Array.isArray(value.config)))
        && (!('isDisabled' in value) || typeof value.isDisabled === 'boolean')
        && (!('invoke_url_template' in value) || value.invoke_url_template === null || typeof value.invoke_url_template === 'string');
}

function isHostStatus(value: unknown): value is FunctionsHostStatus {
    return !!value && typeof value === 'object'
        && 'state' in value && typeof value.state === 'string'
        && (!('version' in value) || typeof value.version === 'string')
        && (!('errors' in value) || (Array.isArray(value.errors) && value.errors.every(error => typeof error === 'string')));
}
