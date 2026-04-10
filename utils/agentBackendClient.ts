import {
  buildBackendAuthQuery,
  buildBackendHeaders,
  getBackendResolutionDebug,
  buildBackendUrl,
  buildBackendUrlObject,
  getBackendToken,
  getBackendUrl,
} from './backendClient';
import type { AgentConfig } from './autonomousAgent';

type AgentApiConfig = {
    baseUrl: string;
    apiKey: string;
    model: string;
};

export type AgentWeatherConfig = {
    weatherEnabled: boolean;
    weatherProvider?: 'qweather';
    weatherApiKey?: string;
};

type AgentStartPayload = {
    charId: string;
    apiConfig: AgentApiConfig;
    mainApiConfig?: AgentApiConfig;
    weatherConfig?: AgentWeatherConfig;
    contextSnapshot?: Record<string, unknown>;
    agentConfig?: AgentConfig;
};

const STOP_REQUEST_DEDUPE_WINDOW_MS = 1500;
const AGENT_PROTOCOL_VERSION = '2';
const lastStopRequestAt = new Map<string, number>();

export type AgentBackendMessage = {
    id: number | string;
    char_id?: string;
    content: string;
    created_at?: number;
    createdAt?: number;
    metadata?: string | Record<string, unknown> | null;
};

export type LifeStreamFragment = {
    id?: number | string;
    fragment: string;
    time_label: string;
    created_at: number;
};

export type LifeStreamSyncState = {
    fragments: LifeStreamFragment[];
    visibleInChat: boolean;
};

function withAgentProtocolQuery(
    query?: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null | undefined> {
    return {
        ...(query || {}),
        agentProtocol: AGENT_PROTOCOL_VERSION,
    };
}

function getTimeoutMs(path: string): number {
    if (path.startsWith('/api/agent/start')) return 45000;
    return 15000;
}

async function agentFetch<T = any>(
    path: string,
    options: RequestInit = {},
    query?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
    const baseUrl = getBackendUrl();
    const token = getBackendToken();
    if (!baseUrl || !token) {
        const resolution = getBackendResolutionDebug();
        const missing: string[] = [];
        if (!baseUrl) {
            missing.push(`backend URL (source=${resolution.backendUrlSource})`);
        }
        if (!token) {
            missing.push(`backend token (source=${resolution.backendTokenSource})`);
        }
        throw new Error(
            `Backend config missing: ${missing.join(', ')}. `
            + 'Check VITE_CSYOS_BACKEND_URL / VITE_CSYOS_BACKEND_TOKEN or localStorage overrides csyos_backend_url / csyos_backend_token.',
        );
    }

    const headers = new Headers(buildBackendHeaders());
    for (const [key, value] of new Headers(options.headers || {})) {
        headers.set(key, value);
    }

    const response = await fetch(buildBackendUrl(path, query), {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(getTimeoutMs(path)),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Agent API ${response.status}: ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<T>;
}

async function agentFetchWithRetry<T = any>(
    path: string,
    options: RequestInit = {},
    maxRetries = 2,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await agentFetch<T>(path, options);
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                console.warn(`[Agent] ${path} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

export async function startAgentOnBackend(payload: AgentStartPayload): Promise<void> {
    lastStopRequestAt.delete(payload.charId);
    await agentFetchWithRetry('/api/agent/start', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export function stopAgentOnBackend(charId: string): void {
    try {
        const shouldSkipDuplicateStop = () => {
            const now = Date.now();
            const lastRequestedAt = lastStopRequestAt.get(charId);
            if (lastRequestedAt && now - lastRequestedAt < STOP_REQUEST_DEDUPE_WINDOW_MS) {
                return true;
            }
            lastStopRequestAt.set(charId, now);
            return false;
        };

        const baseUrl = getBackendUrl();
        const token = getBackendToken();
        const canUseBeacon = baseUrl
            && token
            && typeof navigator !== 'undefined'
            && typeof navigator.sendBeacon === 'function';

        if (canUseBeacon) {
            const blob = new Blob(
                [JSON.stringify({ charId })],
                { type: 'application/json' },
            );
            const url = buildBackendUrlObject('/api/agent/stop');
            if (url) {
                const authParams = new URLSearchParams(
                    buildBackendAuthQuery({ tokenKey: '_token', userIdKey: '_userId' }),
                );
                for (const [key, value] of authParams.entries()) {
                    url.searchParams.set(key, value);
                }

                if (shouldSkipDuplicateStop()) return;
                const sent = navigator.sendBeacon(url.toString(), blob);
                if (sent) return;
                lastStopRequestAt.delete(charId);
            }
        }

        if (shouldSkipDuplicateStop()) return;
        agentFetch('/api/agent/stop', {
            method: 'POST',
            body: JSON.stringify({ charId }),
        }).catch((error) => {
            console.warn('[Agent] Failed to stop backend agent:', error instanceof Error ? error.message : error);
        });
    } catch (error) {
        console.warn('[Agent] Failed to stop backend agent:', error instanceof Error ? error.message : error);
    }
}

export function buildAgentSseUrl(charId: string): string | null {
    const baseUrl = getBackendUrl();
    const token = getBackendToken();
    if (!baseUrl || !token) return null;

    try {
        const url = buildBackendUrlObject('/api/agent/stream', { charId });
        if (!url) return null;
        url.searchParams.set('agentProtocol', AGENT_PROTOCOL_VERSION);

        const authParams = new URLSearchParams(buildBackendAuthQuery());
        for (const [key, value] of authParams.entries()) {
            url.searchParams.set(key, value);
        }

        return url.toString();
    } catch (error) {
        console.warn('[Agent] Failed to build SSE URL:', error instanceof Error ? error.message : error);
        return null;
    }
}

export async function pushAgentContextSnapshot(
    contextSnapshot: Record<string, unknown>,
): Promise<void> {
    await agentFetch('/api/agent/context', {
        method: 'POST',
        body: JSON.stringify(contextSnapshot),
    });
}

export async function fetchPendingAgentMessages(charId: string): Promise<AgentBackendMessage[]> {
    const data = await agentFetch<{ messages?: AgentBackendMessage[] }>(
        '/api/agent/messages',
        {},
        withAgentProtocolQuery({ charId }),
    );
    return data.messages || [];
}

export async function ackAgentMessages(
    ids: Array<number | string>,
): Promise<void> {
    if (ids.length === 0) return;

    await agentFetch('/api/agent/messages/ack', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    });
}

export async function fetchAgentLifeStream(charId: string): Promise<LifeStreamSyncState> {
    const data = await agentFetch<{ fragments?: LifeStreamFragment[]; visibleInChat?: boolean }>(
        '/api/agent/lifestream',
        {},
        { charId },
    );
    return {
        fragments: data.fragments || [],
        visibleInChat: data.visibleInChat === true,
    };
}

export async function notifyAgentUserReplied(charId: string): Promise<void> {
    await agentFetch('/api/agent/user-replied', {
        method: 'POST',
        body: JSON.stringify({ charId }),
    });
}
