import { resolveProxyEndpoint } from './proxyEndpoint';

const NVIDIA_LLM_HOST = 'integrate.api.nvidia.com';
const NVIDIA_LLM_PROXY_BASE = '/llm-api';

const NVIDIA_PATH_MAP: Record<string, string> = {
    '/v1/models': `${NVIDIA_LLM_PROXY_BASE}/models`,
    '/v1/chat/completions': `${NVIDIA_LLM_PROXY_BASE}/chat/completions`,
};

export function resolveNvidiaLlmProxyUrl(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== NVIDIA_LLM_HOST) {
            return null;
        }

        const normalizedPath = url.pathname.replace(/\/+$/, '');
        const proxyPath = NVIDIA_PATH_MAP[normalizedPath];
        if (!proxyPath) return null;

        return resolveProxyEndpoint(`${proxyPath}${url.search}`);
    } catch {
        return null;
    }
}

export function resolveNvidiaLlmFetchResource(resource: RequestInfo | URL): RequestInfo | URL {
    const rawUrl = resource instanceof Request ? resource.url : String(resource);
    const proxyUrl = resolveNvidiaLlmProxyUrl(rawUrl);
    if (!proxyUrl) return resource;

    if (resource instanceof Request) {
        return new Request(proxyUrl, resource);
    }

    return proxyUrl;
}
