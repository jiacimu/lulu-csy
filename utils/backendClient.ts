/**
 * Backend Client — Unified backend API wrapper
 *
 * Provides transparent fallback: if the backend is reachable,
 * use it; otherwise, return null and let the frontend handle it locally.
 *
 * All API keys are collected from localStorage and passed via HTTP headers.
 * The backend never stores any keys.
 */

// ====== Config ======

const BACKEND_URL_KEY = 'csyos_backend_url';
const HEALTH_CACHE_KEY = 'csyos_backend_alive';
const HEALTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const USER_ID_KEY = 'csyos_user_id';

/**
 * Default backend URL — hardcoded for convenience.
 * Change this when deploying to production VPS.
 */
const DEFAULT_BACKEND_URL = 'http://43.134.141.80:6677';

/**
 * Get the configured backend URL.
 * Returns the default URL if a backend token is set (indicates user wants to use the backend).
 * Returns null if no token is set (user hasn't enabled the backend).
 */
export function getBackendUrl(): string | null {
    return 'https://csyos-backend.sully-tts-proxy.workers.dev';
}

/** Set the backend URL (called from Settings UI). */
export function setBackendUrl(url: string): void {
    const trimmed = url.replace(/\/+$/, '').trim();
    if (trimmed) {
        localStorage.setItem(BACKEND_URL_KEY, trimmed);
    } else {
        localStorage.removeItem(BACKEND_URL_KEY);
    }
    // Invalidate health cache
    localStorage.removeItem(HEALTH_CACHE_KEY);
}

// ====== User Identity (Sync Code) ======

/**
 * Get the current device's unique User ID (Sync Code).
 * Auto-generates a cryptographically random UUID on first access.
 * This ID is used to isolate each user's data in the cloud backend.
 */
export function getUserId(): string {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
        let uuid;
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            uuid = crypto.randomUUID();
        } else {
            // Fallback for non-secure contexts (e.g., local IP access via --host)
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        id = `csy-${uuid}`;
        localStorage.setItem(USER_ID_KEY, id);
        console.log(`🆔 [Identity] Generated new Sync Code: ${id}`);
    }
    return id;
}

/**
 * Override the current device's User ID with a Sync Code from another device.
 * Used for multi-device binding ("认领身份").
 */
export function setUserId(id: string): void {
    const trimmed = id.trim();
    if (trimmed) {
        localStorage.setItem(USER_ID_KEY, trimmed);
        // Invalidate health cache to re-test with new identity
        localStorage.removeItem(HEALTH_CACHE_KEY);
        console.log(`🆔 [Identity] Bound to Sync Code: ${trimmed}`);
    }
}

// ====== Health Check (Cached) ======

/**
 * Check if the backend is reachable.
 * Caches the result for 5 minutes to avoid per-request latency.
 */
async function isBackendAlive(): Promise<boolean> {
    const url = getBackendUrl();
    if (!url) return false;

    // Check cache
    const cached = localStorage.getItem(HEALTH_CACHE_KEY);
    if (cached) {
        const { alive, ts } = JSON.parse(cached);
        if (Date.now() - ts < HEALTH_CACHE_TTL) {
            console.log(`🔗 [Backend Debug] Health cache hit: alive=${alive} (expires in ${Math.round((HEALTH_CACHE_TTL - (Date.now() - ts))/1000)}s)`);
            return alive;
        }
    }

    try {
        const token = 'change-me-to-a-random-string';
        const resp = await fetch(`${url}/health`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(3000)
        });
        const alive = resp.ok;
        localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify({ alive, ts: Date.now() }));
        return alive;
    } catch {
        localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify({ alive: false, ts: Date.now() }));
        return false;
    }
}

// ====== Header Builder ======

function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer change-me-to-a-random-string`,
        'X-User-Id': getUserId(),
    };

    // Embedding keys
    const embeddingKey = localStorage.getItem('embedding_api_key') || '';
    const embeddingProvider = localStorage.getItem('embedding_provider') || 'openai';
    const embeddingBaseUrl = localStorage.getItem('embedding_base_url') || '';
    const embeddingModel = localStorage.getItem('embedding_model') || '';

    if (embeddingKey) headers['X-Embedding-Key'] = embeddingKey;
    if (embeddingProvider) headers['X-Embedding-Provider'] = embeddingProvider;
    if (embeddingBaseUrl) headers['X-Embedding-Base-URL'] = embeddingBaseUrl;
    if (embeddingModel) headers['X-Embedding-Model'] = embeddingModel;

    // Rerank key (Cohere Trial)
    const rerankKey = localStorage.getItem('cohere_rerank_api_key') || '';
    const rerankUsePaid = localStorage.getItem('cohere_rerank_use_paid') === 'true';
    if (rerankKey) headers['X-Rerank-Key'] = rerankKey;
    if (rerankUsePaid) headers['X-Rerank-Use-Paid'] = 'true';

    // STT keys (for Cohere users' Query Rewrite)
    try {
        const sttRaw = localStorage.getItem('os_stt_config');
        if (sttRaw) {
            const sttCfg = JSON.parse(sttRaw);
            if (sttCfg.siliconflowApiKey) headers['X-STT-Silicon-Key'] = sttCfg.siliconflowApiKey;
            if (sttCfg.groqApiKey) headers['X-STT-Groq-Key'] = sttCfg.groqApiKey;
        }
    } catch { /* ignore parse errors */ }

    return headers;
}

/**
 * Add LLM (sub-model) headers.
 * Called when the sub-model API config is available.
 */
function addLlmHeaders(
    headers: Record<string, string>,
    subApiConfig?: { baseUrl: string; model: string; apiKey: string },
): void {
    if (subApiConfig) {
        headers['X-LLM-Key'] = subApiConfig.apiKey;
        headers['X-LLM-Base-URL'] = subApiConfig.baseUrl;
        headers['X-LLM-Model'] = subApiConfig.model;
    }
}

// ====== API Methods ======

/**
 * Try to retrieve memories from the backend.
 * Returns the formatted markdown string, or null if backend is unavailable.
 */
export async function tryBackendRetrieval(
    charId: string,
    charName: string,
    userName: string,
    contextMsgs: { role: string; content: string; type?: string }[],
    currentHormoneState?: Record<string, number>,
): Promise<{ fallback: boolean; memories: string }> {
    const alive = await isBackendAlive();
    if (!alive) {
        console.warn('🔗 [Backend Debug] Skipping backend retrieval because isBackendAlive returned false');
        return { fallback: true, memories: '' };
    }

    const url = getBackendUrl()!;
    console.log(`🔗 [Backend Debug] Starting retrieval request to ${url}/api/retrieval/search...`);
    const headers = buildHeaders();

    // Add LLM headers from sub-API config if stored
    try {
        const subRaw = localStorage.getItem('os_sub_api_config');
        if (subRaw) {
            const sub = JSON.parse(subRaw);
            addLlmHeaders(headers, sub);
        }
    } catch { /* ignore */ }

    try {
        const resp = await fetch(`${url}/api/retrieval/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ charId, charName, userName, contextMsgs, currentHormoneState }),
            signal: AbortSignal.timeout(15000), // 15s timeout for retrieval
        });

        if (!resp.ok) {
            console.warn(`🔗 [Backend] Retrieval error ${resp.status}, falling back to local`);
            return { fallback: true, memories: '' };
        }

        const data = await resp.json();
        console.log(`🔗 [Backend] Retrieval success (${data.elapsed}ms) - found ${data.memories ? 'memories' : '0 memories'}`);
        return { fallback: false, memories: data.memories || '' };
    } catch (err: any) {
        console.warn('🔗 [Backend] Retrieval failed, falling back to local:', err.message);
        // Invalidate cache so next check re-tests
        localStorage.removeItem(HEALTH_CACHE_KEY);
        return { fallback: true, memories: '' };
    }
}

/**
 * Try to extract memories via the backend.
 * Returns true if backend handled it, false if frontend should handle.
 */
export async function tryBackendExtraction(
    charId: string,
    charName: string,
    messages: { role: string; content: string; type?: string; timestamp: number; id?: number }[],
    subApiConfig?: { baseUrl: string; model: string; apiKey: string },
): Promise<boolean> {
    if (!await isBackendAlive()) return false;

    const url = getBackendUrl()!;
    const headers = buildHeaders();
    addLlmHeaders(headers, subApiConfig);

    // LLM key is required for extraction
    if (!headers['X-LLM-Key'] || !headers['X-Embedding-Key']) return false;

    try {
        const resp = await fetch(`${url}/api/extraction/extract`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ charId, charName, messages }),
            signal: AbortSignal.timeout(60000), // 60s timeout for extraction (multi-window)
        });

        if (!resp.ok) {
            console.warn(`🔗 [Backend] Extraction error ${resp.status}, falling back to local`);
            return false;
        }

        const data = await resp.json();
        console.log(`🔗 [Backend] Extraction: ${data.created?.length || 0} created, ${data.updated?.length || 0} updated (${data.elapsed}ms)`);
        return true;
    } catch (err: any) {
        console.warn('🔗 [Backend] Extraction failed, falling back to local:', err.message);
        localStorage.removeItem(HEALTH_CACHE_KEY);
        return false;
    }
}

/**
 * Try to extract memories from call history via the backend.
 */
export async function tryBackendCallExtraction(
    charId: string,
    charName: string,
    callHistory: { role: string; content: string }[],
    callTimestamp: number,
    subApiConfig?: { baseUrl: string; model: string; apiKey: string },
): Promise<boolean> {
    if (!await isBackendAlive()) return false;

    const url = getBackendUrl()!;
    const headers = buildHeaders();
    addLlmHeaders(headers, subApiConfig);

    if (!headers['X-LLM-Key'] || !headers['X-Embedding-Key']) return false;

    try {
        const resp = await fetch(`${url}/api/extraction/extract-call`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ charId, charName, callHistory, callTimestamp }),
            signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) return false;

        const data = await resp.json();
        console.log(`🔗 [Backend] Call extraction: ${data.created?.length || 0} created (${data.elapsed}ms)`);
        return true;
    } catch {
        localStorage.removeItem(HEALTH_CACHE_KEY);
        return false;
    }
}

/**
 * Push local memories to the backend for syncing.
 * Requires backend to be alive.
 */
export async function pushMemories(charId: string, memories: any[]): Promise<{ synced: number; skipped: number } | null> {
    if (!await isBackendAlive()) return null;

    const url = getBackendUrl()!;
    const headers = buildHeaders();

    try {
        const resp = await fetch(`${url}/api/sync/push`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ charId, memories, clientTimestamp: Date.now() }),
            signal: AbortSignal.timeout(30000), // 30s timeout
        });

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] Push error ${resp.status}`);
            return null;
        }

        const data = await resp.json();
        console.log(`☁️ [CloudSync] Push success: ${data.synced} synced, ${data.skipped} skipped`);
        return { synced: data.synced, skipped: data.skipped };
    } catch (err: any) {
        console.error('☁️ [CloudSync] Push failed:', err.message);
        return null;
    }
}

/**
 * Pull memories from the cloud backend for a given character.
 * Used for multi-device sync ("星图唤醒").
 * Returns the array of cloud memories, or null if backend is unavailable.
 */
export async function pullMemories(charId: string): Promise<any[] | null> {
    if (!await isBackendAlive()) return null;

    const url = getBackendUrl()!;
    const headers = buildHeaders();

    try {
        const resp = await fetch(`${url}/api/memories/${charId}`, {
            headers,
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] Pull error ${resp.status}`);
            return null;
        }

        const data = await resp.json();
        const memories = data.memories || [];
        console.log(`☁️ [CloudSync] Pull success: ${memories.length} memories for ${charId}`);
        return memories;
    } catch (err: any) {
        console.error('☁️ [CloudSync] Pull failed:', err.message);
        localStorage.removeItem(HEALTH_CACHE_KEY);
        return null;
    }
}
