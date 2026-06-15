// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/llm-api/[[path]]';

function makeContext(path: string, init: RequestInit = {}) {
    const cleanPath = path.replace(/^\/+/, '');
    return {
        request: new Request(`https://example.test/llm-api/${cleanPath}?from=test`, init),
        params: {
            path: cleanPath ? cleanPath.split('/') : [],
        },
    };
}

describe('llm-api proxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('answers CORS preflight requests', async () => {
        const response = await onRequest(makeContext('chat/completions', { method: 'OPTIONS' }));

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });

    it('forwards model list requests to NVIDIA models endpoint', async () => {
        const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await onRequest(makeContext('models', {
            method: 'GET',
            headers: { Authorization: 'Bearer test-key', Accept: 'application/json' },
        }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [targetUrl, init] = fetchMock.mock.calls[0];
        expect(targetUrl).toBe('https://integrate.api.nvidia.com/v1/models?from=test');
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
        expect((init.headers as Headers).get('Authorization')).toBe('Bearer test-key');
        expect((init.headers as Headers).get('Accept')).toBe('application/json');
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({ data: [{ id: 'z-ai/glm-5.1' }] });
    });

    it('forwards chat completions requests with headers and body', async () => {
        const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const body = JSON.stringify({ model: 'z-ai/glm-5.1', messages: [{ role: 'user', content: 'hello' }] });
        const response = await onRequest(makeContext('chat/completions', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer test-key',
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body,
        }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [targetUrl, init] = fetchMock.mock.calls[0];
        expect(targetUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions?from=test');
        expect(init.method).toBe('POST');
        expect((init.headers as Headers).get('Authorization')).toBe('Bearer test-key');
        expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
        expect((init.headers as Headers).get('Accept')).toBe('application/json');
        await expect(new Response(init.body).json()).resolves.toEqual(JSON.parse(body));
        await expect(response.json()).resolves.toEqual({ choices: [{ message: { content: 'ok' } }] });
    });

    it('rejects unsupported paths without calling upstream', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const response = await onRequest(makeContext('embeddings', { method: 'POST' }));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: { message: 'Unsupported LLM proxy path' } });
    });

    it('passes through upstream error statuses', async () => {
        const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ error: { message: 'bad key' } }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await onRequest(makeContext('models', { method: 'GET' }));

        expect(response.status).toBe(401);
        expect(response.statusText).toBe('Unauthorized');
        await expect(response.json()).resolves.toEqual({ error: { message: 'bad key' } });
    });

    it('returns a JSON 502 when upstream fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('connect timeout');
        }));

        const response = await onRequest(makeContext('models', { method: 'GET' }));

        expect(response.status).toBe(502);
        expect(response.headers.get('Content-Type')).toContain('application/json');
        await expect(response.json()).resolves.toEqual({
            error: { message: 'NVIDIA LLM proxy error: connect timeout' },
        });
    });
});
