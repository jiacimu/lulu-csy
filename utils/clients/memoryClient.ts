import type { VectorMemory } from '../../types';
import { markVectorMemoryAsBackendGenerated } from '../vectorMemorySyncState';
import {
    buildBackendUrl,
    buildHeaders,
    clearBackendHealthCache,
    clearCloudMemoriesLegacyFallback,
    fetchWithRetry,
    getBackendUrl,
    isBackendAlive,
    type CloudMemoryListOptions,
    type CloudMemoryMutationResult,
} from './backendCore';
/**
 * Push local memories to the backend for syncing.
 */
export async function pushMemories(charId: string, memories: any[]): Promise<{ synced: number; skipped: number } | null> {
    if (!await isBackendAlive()) return null;

    const url = getBackendUrl()!;
    const headers = buildHeaders();

    try {
        const resp = await fetchWithRetry(
            `${url}/api/sync/push`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ charId, memories, clientTimestamp: Date.now() }),
            },
            { timeoutMs: 30000, maxAttempts: 2, baseDelayMs: 500 },
        );

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
 */
export async function pullMemories(charId: string, options: CloudMemoryListOptions = {}): Promise<VectorMemory[] | null> {
    if (!await isBackendAlive()) return null;

    const headers = buildHeaders();
    const requestUrl = buildBackendUrl(`/api/memories/${encodeURIComponent(charId)}`, {
        vectors: options.vectors ? 'true' : undefined,
        deprecated: options.includeDeprecated ? 'true' : undefined,
    });

    try {
        const resp = await fetchWithRetry(
            requestUrl,
            { headers },
            { timeoutMs: 15000 },
        );

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] Pull error ${resp.status}`);
            return null;
        }

        const data = await resp.json();
        const memories = (Array.isArray(data.memories) ? data.memories : [])
            .map((memory: VectorMemory) => markVectorMemoryAsBackendGenerated(memory));
        console.log(`☁️ [CloudSync] Pull success: ${memories.length} memories for ${charId}`);
        return memories;
    } catch (err: any) {
        console.error('☁️ [CloudSync] Pull failed:', err.message);
        clearBackendHealthCache();
        return null;
    }
}

/**
 * List all character IDs that have cloud memories for the current user.
 */
export async function listCloudChars(): Promise<{ charId: string; memoryCount: number }[] | null> {
    if (!await isBackendAlive()) return null;

    const url = getBackendUrl()!;
    const headers = buildHeaders();

    try {
        const resp = await fetchWithRetry(
            `${url}/api/memories/chars`,
            { headers },
            { timeoutMs: 10000 },
        );

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] ListChars error ${resp.status}`);
            return null;
        }

        const data = await resp.json();
        const chars = data.chars || [];
        console.log(`☁️ [CloudSync] Cloud has ${chars.length} character(s) with memories`);
        return chars;
    } catch (err: any) {
        console.error('☁️ [CloudSync] ListChars failed:', err.message);
        clearBackendHealthCache();
        return null;
    }
}

/**
 * Delete a single memory from the cloud backend.
 * Returns a structured result so callers can decide whether to mutate local cache.
 */
export async function deleteCloudMemory(id: string): Promise<CloudMemoryMutationResult> {
    if (!await isBackendAlive()) {
        return { ok: false, reason: 'backend_unavailable' };
    }

    const url = getBackendUrl()!;
    const headers = buildHeaders({ contentType: false });

    try {
        const resp = await fetchWithRetry(
            `${url}/api/memories/${encodeURIComponent(id)}`,
            { method: 'DELETE', headers },
            { timeoutMs: 10000 },
        );

        if (resp.status === 404) {
            return { ok: true, reason: 'not_found' };
        }

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] Delete memory error ${resp.status}`);
            return { ok: false, reason: 'request_failed' };
        }

        return { ok: true };
    } catch (err: any) {
        console.error('☁️ [CloudSync] Delete memory failed:', err.message);
        clearBackendHealthCache();
        return { ok: false, reason: 'request_failed' };
    }
}

/**
 * Update a single memory on the cloud backend.
 * Callers should only refresh local state after this succeeds.
 */
export async function updateCloudMemory(
    memoryId: string,
    updates: { title?: string; content?: string; importance?: number },
): Promise<{ ok: boolean; reason?: string }> {
    if (!await isBackendAlive()) {
        return { ok: false, reason: 'backend_unavailable' };
    }

    const url = getBackendUrl()!;
    const headers = buildHeaders();

    try {
        const resp = await fetchWithRetry(
            `${url}/api/memories/${encodeURIComponent(memoryId)}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify(updates),
            },
            { timeoutMs: 10000, maxAttempts: 2, baseDelayMs: 500 },
        );

        if (!resp.ok) {
            let reason = 'request_failed';
            try {
                const data = await resp.json();
                if (typeof data?.error === 'string' && data.error.trim()) {
                    reason = data.error.trim();
                }
            } catch {
                // Ignore malformed error bodies and fall back to a generic reason.
            }
            return { ok: false, reason };
        }

        return { ok: true };
    } catch (err: any) {
        console.error('[CloudSync] Update memory failed:', err.message);
        clearBackendHealthCache();
        return { ok: false, reason: 'offline' };
    }
}

/**
 * Clear all memories for a character from the cloud backend.
 * Callers should only clear the local mirror when this succeeds.
 */
export async function clearCloudMemories(charId: string): Promise<CloudMemoryMutationResult> {
    if (!await isBackendAlive()) {
        return { ok: false, reason: 'backend_unavailable' };
    }

    const url = getBackendUrl()!;
    const headers = buildHeaders({ contentType: false });

    try {
        const resp = await fetchWithRetry(
            `${url}/api/memories/char/${encodeURIComponent(charId)}`,
            { method: 'DELETE', headers },
            { timeoutMs: 15000 },
        );

        if (resp.status === 404) {
            console.warn('[CloudSync] Clear-char endpoint missing, falling back to per-memory deletes');
            return clearCloudMemoriesLegacyFallback(url, charId);
        }

        if (!resp.ok) {
            console.error(`☁️ [CloudSync] Clear memories error ${resp.status}`);
            return { ok: false, reason: 'request_failed' };
        }

        const data = await resp.json();
        return { ok: true, cleared: data.cleared || 0 };
    } catch (err: any) {
        console.error('☁️ [CloudSync] Clear memories failed:', err.message);
        clearBackendHealthCache();
        return { ok: false, reason: 'request_failed' };
    }
}
