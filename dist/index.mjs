import { print, getOperationAST, buildASTSchema, buildSchema } from 'graphql';
import { isAsyncIterable, observableToAsyncIterable, parseGraphQLSDL, withCancel, mapAsyncIterator } from '@graphql-tools/utils';
import { isWebUri } from 'valid-url';
import { fetch as fetch$1 } from 'cross-fetch';
import { introspectSchema, wrapSchema } from '@graphql-tools/wrap';
import { createClient } from 'graphql-ws';
import { createClient as createClient$1 } from 'graphql-sse';
import WebSocket from 'isomorphic-ws';
import syncFetchImported from 'sync-fetch';
import isPromise from 'is-promise';
import { extractFiles, isExtractableFile } from 'extract-files';
import FormData from 'form-data';
import { fetchEventSource } from '@ardatan/fetch-event-source';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import AbortController from 'abort-controller';
import { meros } from 'meros';
import _ from 'lodash';
import { ValueOrPromise } from 'value-or-promise';
import { isLiveQueryOperationDefinitionNode } from '@n1ru4l/graphql-live-query';

/* eslint-disable no-case-declarations */
const syncFetch = (input, init) => {
    if (typeof input === 'string') {
        init === null || init === void 0 ? true : delete init.signal;
    }
    else {
        delete input.signal;
    }
    return syncFetchImported(input, init);
};
const asyncImport = (moduleName) => import(moduleName);
const syncImport = (moduleName) => require(moduleName);
var SubscriptionProtocol;
(function (SubscriptionProtocol) {
    SubscriptionProtocol["WS"] = "WS";
    /**
     * Use legacy web socket protocol `graphql-ws` instead of the more current standard `graphql-transport-ws`
     */
    SubscriptionProtocol["LEGACY_WS"] = "LEGACY_WS";
    /**
     * Use SSE for subscription instead of WebSocket
     */
    SubscriptionProtocol["SSE"] = "SSE";
    /**
     * Use `graphql-sse` for subscriptions
     */
    SubscriptionProtocol["GRAPHQL_SSE"] = "GRAPHQL_SSE";
})(SubscriptionProtocol || (SubscriptionProtocol = {}));
const isCompatibleUri = (uri) => {
    if (isWebUri(uri)) {
        return true;
    }
    // we just replace the url part, the remaining validation is the same
    const wsUri = uri.replace('wss://', 'http://').replace('ws://', 'http://');
    return !!isWebUri(wsUri);
};
/**
 * This loader loads a schema from a URL. The loaded schema is a fully-executable,
 * remote schema since it's created using [@graphql-tools/wrap](/docs/remote-schemas).
 *
 * ```
 * const schema = await loadSchema('http://localhost:3000/graphql', {
 *   loaders: [
 *     new UrlLoader(),
 *   ]
 * });
 * ```
 */
class UrlLoader {
    async canLoad(pointer, options) {
        return this.canLoadSync(pointer, options);
    }
    canLoadSync(pointer, _options) {
        return isCompatibleUri(pointer);
    }
    createFormDataFromVariables({ query, variables, operationName, extensions, }) {
        const vars = Object.assign({}, variables);
        const { clone, files } = extractFiles(vars, 'variables', ((v) => isExtractableFile(v) || (v === null || v === void 0 ? void 0 : v.promise) || isAsyncIterable(v) || isPromise(v)));
        const map = Array.from(files.values()).reduce((prev, curr, currIndex) => {
            prev[currIndex] = curr;
            return prev;
        }, {});
        const uploads = new Map(Array.from(files.keys()).map((u, i) => [i, u]));
        const form = new FormData();
        form.append('operations', JSON.stringify({
            query,
            variables: clone,
            operationName,
            extensions,
        }));
        form.append('map', JSON.stringify(map));
        return ValueOrPromise.all(Array.from(uploads.entries()).map(params => new ValueOrPromise(() => {
            const [i, u$] = params;
            return new ValueOrPromise(() => u$).then(u => [i, u]).resolve();
        }).then(([i, u]) => {
            if (u === null || u === void 0 ? void 0 : u.promise) {
                return u.promise.then((upload) => {
                    const stream = upload.createReadStream();
                    form.append(i.toString(), stream, {
                        filename: upload.filename,
                        contentType: upload.mimetype,
                    });
                });
            }
            else {
                form.append(i.toString(), u, {
                    filename: 'name' in u ? u['name'] : i,
                    contentType: u.type,
                });
            }
        })))
            .then(() => form)
            .resolve();
    }
    prepareGETUrl({ baseUrl, query, variables, operationName, extensions, }) {
        const HTTP_URL = switchProtocols(baseUrl, {
            wss: 'https',
            ws: 'http',
        });
        const dummyHostname = 'https://dummyhostname.com';
        const validUrl = HTTP_URL.startsWith('http')
            ? HTTP_URL
            : HTTP_URL.startsWith('/')
                ? `${dummyHostname}${HTTP_URL}`
                : `${dummyHostname}/${HTTP_URL}`;
        const urlObj = new URL(validUrl);
        urlObj.searchParams.set('query', query);
        if (variables && Object.keys(variables).length > 0) {
            urlObj.searchParams.set('variables', JSON.stringify(variables));
        }
        if (operationName) {
            urlObj.searchParams.set('operationName', operationName);
        }
        if (extensions) {
            urlObj.searchParams.set('extensions', JSON.stringify(extensions));
        }
        const finalUrl = urlObj.toString().replace(dummyHostname, '');
        return finalUrl;
    }
    buildHTTPExecutor(endpoint, fetch, options) {
        const defaultMethod = this.getDefaultMethodFromOptions(options === null || options === void 0 ? void 0 : options.method, 'POST');
        const HTTP_URL = switchProtocols(endpoint, {
            wss: 'https',
            ws: 'http',
        });
        const executor = ({ document, variables, operationName, extensions, operationType, }) => {
            const controller = new AbortController();
            let method = defaultMethod;
            if (options === null || options === void 0 ? void 0 : options.useGETForQueries) {
                if (operationType === 'query') {
                    method = 'GET';
                }
                else {
                    method = defaultMethod;
                }
            }
            const headers = Object.assign({}, options === null || options === void 0 ? void 0 : options.headers, (extensions === null || extensions === void 0 ? void 0 : extensions.headers) || {});
            return new ValueOrPromise(() => {
                const query = print(document);
                switch (method) {
                    case 'GET':
                        const finalUrl = this.prepareGETUrl({ baseUrl: endpoint, query, variables, operationName, extensions });
                        return fetch(finalUrl, {
                            method: 'GET',
                            credentials: (options === null || options === void 0 ? void 0 : options.requestCredentials) || 'include',
                            headers: {
                                accept: 'application/json',
                                ...headers,
                            },
                        });
                    case 'POST':
                        if (options === null || options === void 0 ? void 0 : options.multipart) {
                            return new ValueOrPromise(() => this.createFormDataFromVariables({ query, variables, operationName, extensions }))
                                .then(form => fetch(HTTP_URL, {
                                method: 'POST',
                                credentials: (options === null || options === void 0 ? void 0 : options.requestCredentials) || 'include',
                                body: form,
                                headers: {
                                    accept: 'application/json',
                                    ...headers,
                                },
                                signal: controller.signal,
                            }))
                                .resolve();
                        }
                        else {
                            return fetch(HTTP_URL, {
                                method: 'POST',
                                credentials: (options === null || options === void 0 ? void 0 : options.requestCredentials) || 'include',
                                body: JSON.stringify({
                                    query,
                                    variables,
                                    operationName,
                                    extensions,
                                }),
                                headers: {
                                    accept: 'application/json, multipart/mixed',
                                    'content-type': 'application/json',
                                    ...headers,
                                },
                                signal: controller.signal,
                            });
                        }
                }
            })
                .then((fetchResult) => {
                const response = {};
                const contentType = fetchResult.headers.get
                    ? fetchResult.headers.get('content-type')
                    : fetchResult['content-type'];
                if (contentType === null || contentType === void 0 ? void 0 : contentType.includes('multipart/mixed')) {
                    return meros(fetchResult).then(maybeStream => {
                        if (isAsyncIterable(maybeStream)) {
                            return withCancel(mapAsyncIterator(maybeStream, part => {
                                if (part.json) {
                                    const chunk = part.body;
                                    if (chunk.path) {
                                        if (chunk.data) {
                                            const path = ['data'];
                                            _.merge(response, _.set({}, path.concat(chunk.path), chunk.data));
                                        }
                                        if (chunk.errors) {
                                            response.errors = (response.errors || []).concat(chunk.errors);
                                        }
                                    }
                                    else {
                                        if (chunk.data) {
                                            response.data = chunk.data;
                                        }
                                        if (chunk.errors) {
                                            response.errors = chunk.errors;
                                        }
                                    }
                                    return response;
                                }
                            }), () => controller.abort());
                        }
                        else {
                            return maybeStream.json();
                        }
                    });
                }
                return fetchResult.json();
            })
                .resolve();
        };
        return executor;
    }
    buildWSExecutor(subscriptionsEndpoint, webSocketImpl, connectionParams) {
        const WS_URL = switchProtocols(subscriptionsEndpoint, {
            https: 'wss',
            http: 'ws',
        });
        const subscriptionClient = createClient({
            url: WS_URL,
            webSocketImpl,
            connectionParams,
            lazy: true,
        });
        return async ({ document, variables, operationName, extensions }) => {
            const query = print(document);
            return observableToAsyncIterable({
                subscribe: observer => {
                    const unsubscribe = subscriptionClient.subscribe({
                        query,
                        variables: variables,
                        operationName,
                        extensions,
                    }, observer);
                    return {
                        unsubscribe,
                    };
                },
            });
        };
    }
    buildWSLegacyExecutor(subscriptionsEndpoint, webSocketImpl, connectionParams) {
        const WS_URL = switchProtocols(subscriptionsEndpoint, {
            https: 'wss',
            http: 'ws',
        });
        const subscriptionClient = new SubscriptionClient(WS_URL, {
            connectionParams,
            lazy: true,
        }, webSocketImpl);
        return async ({ document, variables, operationName }) => {
            return observableToAsyncIterable(subscriptionClient.request({
                query: document,
                variables,
                operationName,
            }));
        };
    }
    buildSSEExecutor(endpoint, fetch, options) {
        return async ({ document, variables, extensions, operationName }) => {
            const controller = new AbortController();
            const query = print(document);
            const finalUrl = this.prepareGETUrl({ baseUrl: endpoint, query, variables, operationName, extensions });
            return observableToAsyncIterable({
                subscribe: observer => {
                    const headers = Object.assign({}, (options === null || options === void 0 ? void 0 : options.headers) || {}, (extensions === null || extensions === void 0 ? void 0 : extensions.headers) || {});
                    fetchEventSource(finalUrl, {
                        credentials: (options === null || options === void 0 ? void 0 : options.requestCredentials) || 'include',
                        headers,
                        method: 'GET',
                        onerror: error => {
                            observer.error(error);
                        },
                        onmessage: event => {
                            observer.next(JSON.parse(event.data || '{}'));
                        },
                        onopen: async (response) => {
                            const contentType = response.headers.get('content-type');
                            if (!(contentType === null || contentType === void 0 ? void 0 : contentType.startsWith('text/event-stream'))) {
                                let error;
                                try {
                                    const { errors } = await response.json();
                                    error = errors[0];
                                }
                                catch (error) {
                                    // Failed to parse body
                                }
                                if (error) {
                                    throw error;
                                }
                                throw new Error(`Expected content-type to be ${'text/event-stream'} but got "${contentType}".`);
                            }
                        },
                        fetch,
                        signal: controller.signal,
                        ...((options === null || options === void 0 ? void 0 : options.eventSourceOptions) || {}),
                    });
                    return {
                        unsubscribe: () => controller.abort(),
                    };
                },
            });
        };
    }
    buildGraphQLSSEExecutor(endpoint, fetch, options = {}) {
        const { headers } = options;
        const client = createClient$1({
            ...options.graphqlSseOptions,
            url: endpoint,
            fetchFn: fetch,
            abortControllerImpl: AbortController,
            headers,
        });
        return async ({ document, variables, operationName, extensions }) => {
            return observableToAsyncIterable({
                subscribe: observer => {
                    const unsubscribe = client.subscribe({
                        query: document,
                        variables: variables,
                        operationName,
                        extensions,
                    }, observer);
                    return {
                        unsubscribe,
                    };
                },
            });
        };
    }
    getFetch(customFetch, importFn) {
        if (customFetch) {
            if (typeof customFetch === 'string') {
                const [moduleName, fetchFnName] = customFetch.split('#');
                return new ValueOrPromise(() => importFn(moduleName))
                    .then(module => (fetchFnName ? module[fetchFnName] : module))
                    .resolve();
            }
            else {
                return customFetch;
            }
        }
        if (importFn === asyncImport) {
            if (typeof fetch === 'undefined') {
                return fetch$1;
            }
            return fetch;
        }
        else {
            return syncFetch;
        }
    }
    getDefaultMethodFromOptions(method, defaultMethod) {
        if (method) {
            defaultMethod = method;
        }
        return defaultMethod;
    }
    getWebSocketImpl(importFn, options) {
        if (typeof (options === null || options === void 0 ? void 0 : options.webSocketImpl) === 'string') {
            const [moduleName, webSocketImplName] = options.webSocketImpl.split('#');
            return new ValueOrPromise(() => importFn(moduleName))
                .then(importedModule => (webSocketImplName ? importedModule[webSocketImplName] : importedModule))
                .resolve();
        }
        else {
            const websocketImpl = (options === null || options === void 0 ? void 0 : options.webSocketImpl) || WebSocket;
            return websocketImpl;
        }
    }
    async buildSubscriptionExecutor(subscriptionsEndpoint, fetch, options) {
        if ((options === null || options === void 0 ? void 0 : options.subscriptionsProtocol) === SubscriptionProtocol.SSE) {
            return this.buildSSEExecutor(subscriptionsEndpoint, fetch, options);
        }
        else if ((options === null || options === void 0 ? void 0 : options.subscriptionsProtocol) === SubscriptionProtocol.GRAPHQL_SSE) {
            if (!(options === null || options === void 0 ? void 0 : options.subscriptionsEndpoint)) {
                // when no custom subscriptions endpoint is specified,
                // graphql-sse is recommended to be used on `/graphql/stream`
                subscriptionsEndpoint += '/stream';
            }
            return this.buildGraphQLSSEExecutor(subscriptionsEndpoint, fetch, options);
        }
        else {
            const webSocketImpl = await this.getWebSocketImpl(asyncImport, options);
            const connectionParams = () => ({ headers: options === null || options === void 0 ? void 0 : options.headers });
            if ((options === null || options === void 0 ? void 0 : options.subscriptionsProtocol) === SubscriptionProtocol.LEGACY_WS) {
                return this.buildWSLegacyExecutor(subscriptionsEndpoint, webSocketImpl, connectionParams);
            }
            else {
                return this.buildWSExecutor(subscriptionsEndpoint, webSocketImpl, connectionParams);
            }
        }
    }
    async getExecutorAsync(endpoint, options) {
        const fetch = await this.getFetch(options === null || options === void 0 ? void 0 : options.customFetch, asyncImport);
        const httpExecutor = this.buildHTTPExecutor(endpoint, fetch, options);
        const subscriptionsEndpoint = (options === null || options === void 0 ? void 0 : options.subscriptionsEndpoint) || endpoint;
        const subscriptionExecutor = await this.buildSubscriptionExecutor(subscriptionsEndpoint, fetch, options);
        return params => {
            const operationAst = getOperationAST(params.document, params.operationName);
            if (!operationAst) {
                throw new Error(`No valid operations found: ${params.operationName || ''}`);
            }
            if (params.operationType === 'subscription' ||
                isLiveQueryOperationDefinitionNode(operationAst, params.variables)) {
                return subscriptionExecutor(params);
            }
            return httpExecutor(params);
        };
    }
    getExecutorSync(endpoint, options) {
        const fetch = this.getFetch(options === null || options === void 0 ? void 0 : options.customFetch, syncImport);
        const executor = this.buildHTTPExecutor(endpoint, fetch, options);
        return executor;
    }
    handleSDL(pointer, fetch, options) {
        const defaultMethod = this.getDefaultMethodFromOptions(options === null || options === void 0 ? void 0 : options.method, 'GET');
        return new ValueOrPromise(() => fetch(pointer, {
            method: defaultMethod,
            headers: options.headers,
        }))
            .then(response => response.text())
            .then(schemaString => parseGraphQLSDL(pointer, schemaString, options))
            .resolve();
    }
    async load(pointer, options) {
        if (!(await this.canLoad(pointer, options))) {
            return [];
        }
        let source = {
            location: pointer,
        };
        const fetch = await this.getFetch(options === null || options === void 0 ? void 0 : options.customFetch, asyncImport);
        let executor = await this.getExecutorAsync(pointer, options);
        if ((options === null || options === void 0 ? void 0 : options.handleAsSDL) || pointer.endsWith('.graphql')) {
            source = await this.handleSDL(pointer, fetch, options);
            if (!source.schema && !source.document && !source.rawSDL) {
                throw new Error(`Invalid SDL response`);
            }
            source.schema =
                source.schema ||
                    (source.document
                        ? buildASTSchema(source.document, options)
                        : source.rawSDL
                            ? buildSchema(source.rawSDL, options)
                            : undefined);
        }
        else {
            source.schema = await introspectSchema(executor, {}, options);
        }
        if (!source.schema) {
            throw new Error(`Invalid introspected schema`);
        }
        if (options === null || options === void 0 ? void 0 : options.endpoint) {
            executor = await this.getExecutorAsync(options.endpoint, options);
        }
        source.schema = wrapSchema({
            schema: source.schema,
            executor,
        });
        return [source];
    }
    loadSync(pointer, options) {
        if (!this.canLoadSync(pointer, options)) {
            return [];
        }
        let source = {
            location: pointer,
        };
        const fetch = this.getFetch(options === null || options === void 0 ? void 0 : options.customFetch, syncImport);
        let executor = this.getExecutorSync(pointer, options);
        if ((options === null || options === void 0 ? void 0 : options.handleAsSDL) || pointer.endsWith('.graphql')) {
            source = this.handleSDL(pointer, fetch, options);
            if (!source.schema && !source.document && !source.rawSDL) {
                throw new Error(`Invalid SDL response`);
            }
            source.schema =
                source.schema ||
                    (source.document
                        ? buildASTSchema(source.document, options)
                        : source.rawSDL
                            ? buildSchema(source.rawSDL, options)
                            : undefined);
        }
        else {
            source.schema = introspectSchema(executor, {}, options);
        }
        if (!source.schema) {
            throw new Error(`Invalid introspected schema`);
        }
        if (options === null || options === void 0 ? void 0 : options.endpoint) {
            executor = this.getExecutorSync(options.endpoint, options);
        }
        source.schema = wrapSchema({
            schema: source.schema,
            executor,
        });
        return [source];
    }
}
function switchProtocols(pointer, protocolMap) {
    return Object.entries(protocolMap).reduce((prev, [source, target]) => prev.replace(`${source}://`, `${target}://`).replace(`${source}:\\`, `${target}:\\`), pointer);
}

export { SubscriptionProtocol, UrlLoader };
