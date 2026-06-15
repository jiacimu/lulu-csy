const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
};

const FORWARDED_HEADERS = [
    'Authorization',
    'Content-Type',
    'Accept',
];

type PagesContext = {
    request: Request;
    params: {
        path?: string[] | string;
    };
};

type Route =
    | { ok: true; path: 'models'; method: 'GET' }
    | { ok: true; path: 'chat/completions'; method: 'POST' }
    | { ok: false; status: number; message: string; allow?: string };

function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: {
            ...CORS_HEADERS,
            ...extraHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function getPath(params: PagesContext['params']): string {
    const rawPath = params.path;
    if (Array.isArray(rawPath)) return rawPath.join('/');
    return rawPath || '';
}

function resolveRoute(request: Request, params: PagesContext['params']): Route {
    const path = getPath(params).replace(/^\/+|\/+$/g, '');

    if (path === 'models') {
        if (request.method !== 'GET') {
            return { ok: false, status: 405, message: 'Method not allowed for /llm-api/models', allow: 'GET, OPTIONS' };
        }
        return { ok: true, path, method: 'GET' };
    }

    if (path === 'chat/completions') {
        if (request.method !== 'POST') {
            return { ok: false, status: 405, message: 'Method not allowed for /llm-api/chat/completions', allow: 'POST, OPTIONS' };
        }
        return { ok: true, path, method: 'POST' };
    }

    return { ok: false, status: 404, message: 'Unsupported LLM proxy path' };
}

function buildForwardHeaders(request: Request): Headers {
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

function buildTargetUrl(request: Request, path: Route & { ok: true }): string {
    const url = new URL(request.url);
    return `${NVIDIA_API_BASE}/${path.path}${url.search}`;
}

function buildProxyResponse(upstream: Response): Response {
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', CORS_HEADERS['Access-Control-Allow-Methods']);
    headers.set('Access-Control-Allow-Headers', CORS_HEADERS['Access-Control-Allow-Headers']);
    headers.set('Access-Control-Max-Age', CORS_HEADERS['Access-Control-Max-Age']);
    headers.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
    const { request, params } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const route = resolveRoute(request, params);
    if (!route.ok) {
        const allowHeader: Record<string, string> = route.allow ? { Allow: route.allow } : {};
        return jsonError(route.message, route.status, allowHeader);
    }

    try {
        const init: RequestInit = {
            method: route.method,
            headers: buildForwardHeaders(request),
        };

        if (route.method !== 'GET') {
            init.body = request.body;
        }

        const upstream = await fetch(buildTargetUrl(request, route), init);
        return buildProxyResponse(upstream);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown upstream error';
        return jsonError(`NVIDIA LLM proxy error: ${message}`, 502);
    }
};
