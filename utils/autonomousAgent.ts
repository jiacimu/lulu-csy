/**
 * Autonomous Agent - frontend orchestrator for the backend-driven agent flow.
 *
 * The backend owns decision-making. The frontend only:
 *   1. Starts and stops the backend agent
 *   2. Pushes fresh context snapshots
 *   3. Receives backend-generated messages via SSE or polling
 *   4. Mirrors LifeStream fragments into the local message store
 *   5. Notifies the backend when the user replies
 */

import { DB } from './db';
import { CharacterProfile,VectorMemory } from '../types';
import { pullMemories } from './backendClient';
import { buildCoreMemoryDigest,buildMountedWorldbooksDigest } from './agentContextSnapshot';
import { getPrimaryApiConfig as getRuntimePrimaryApiConfig,getRealtimeConfig } from './runtimeConfig';
import {
    readJsonStorage,
    safeLocalStorageGet,
    safeLocalStorageSet,
    writeJsonStorage,
} from './storage';
import {
  ackAgentMessages,
  AgentBackendMessage,
  AgentWeatherConfig,
  LifeStreamFragment,
  buildAgentSseUrl,
  fetchAgentLifeStream,
  fetchPendingAgentMessages,
  notifyAgentUserReplied,
  pushAgentContextSnapshot,
  startAgentOnBackend,
  stopAgentOnBackend,
} from './agentBackendClient';

export interface SecondaryApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface LLMDecision {
    action: 'none' | 'send' | 'call' | 'think';
    topic?: string;
    reason?: string;
    content?: string;
}

export interface AgentConfig {
    minIntervalMin: number;
    maxIntervalMin: number;
    cooldownHours: number;
    maxDailyActions: number;
    maxConsecutiveIgnored: number;
    baseProb: number;
    notificationsEnabled: boolean;
}

type ContextSnapshot = {
    charId: string;
    charName: string;
    charSystemPrompt: string;
    charPersonality: string;
    worldview?: string;
    mountedWorldbooksDigest?: string;
    coreMemoryDigest?: string;
    cityOverride?: string;
    cityAdcode?: string;
    isFictionalCity?: boolean;
    cityReferenceReal?: string;
    userName: string;
    recentMessages: Array<{
        role: string;
        content: string;
        timestamp: number;
    }>;
    moodState: Record<string, unknown> | null;
    lastUserMsgAt: number;
    lastAIMsgAt: number;
    lastAIMsgWasAutonomous: boolean;
    emojiNames: string[];
    topMemory?: string;
    updatedAt: number;
};

const AGENT_CONFIG_DEFAULTS: AgentConfig = {
    minIntervalMin: 15,
    maxIntervalMin: 40,
    cooldownHours: 2,
    maxDailyActions: 5,
    maxConsecutiveIgnored: 2,
    baseProb: 0.15,
    notificationsEnabled: true,
};

const AGENT_CONFIG_STORAGE_KEY = 'agent_config';
const LIFE_STREAM_VISIBILITY_STORAGE_PREFIX = 'agent_lifestream_visibility_';
const AUTONOMOUS_DEBUG_STORAGE_KEY = 'autonomous_debug';
export const LIFE_STREAM_VISIBILITY_EVENT_NAME = 'agent-lifestream-visibility-changed';

type MemorySummary = Pick<
    VectorMemory,
    'title' | 'content' | 'importance' | 'createdAt' | 'deprecated' | 'salienceScore'
>;

export function getAutonomousDebugEnabled(): boolean {
    return safeLocalStorageGet(AUTONOMOUS_DEBUG_STORAGE_KEY) === 'true';
}

export function setAutonomousDebugEnabled(enabled: boolean): void {
    safeLocalStorageSet(AUTONOMOUS_DEBUG_STORAGE_KEY, String(enabled));
}

function parseBackendMetadata(
    metadata: AgentBackendMessage['metadata'],
): Record<string, unknown> {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata) as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    if (typeof metadata === 'object') {
        return metadata;
    }
    return {};
}

function pickTopMemory(memories: MemorySummary[]): MemorySummary | undefined {
    return memories
        .filter(memory => !memory.deprecated)
        .sort((a, b) => {
            const salienceDiff = (b.salienceScore || 0) - (a.salienceScore || 0);
            if (salienceDiff !== 0) return salienceDiff;

            const importanceDiff = (b.importance || 0) - (a.importance || 0);
            if (importanceDiff !== 0) return importanceDiff;

            return (b.createdAt || 0) - (a.createdAt || 0);
        })[0];
}

function formatTopMemory(memory?: MemorySummary): string | undefined {
    if (!memory) return undefined;
    return `${memory.title || 'Memory'}: ${(memory.content || '').slice(0, 80)}`;
}

async function loadTopMemorySummary(charId: string): Promise<string | undefined> {
    try {
        const cloudMemories = await pullMemories(charId);
        const topCloudMemory = pickTopMemory((cloudMemories || []) as MemorySummary[]);
        if (topCloudMemory) {
            return formatTopMemory(topCloudMemory);
        }
    } catch {
        // Fall through to the local cache/offline fallback.
    }

    try {
        const localHeaders = await DB.getVectorMemoryHeaders(charId);
        const topLocalMemory = pickTopMemory(localHeaders as MemorySummary[]);
        return formatTopMemory(topLocalMemory);
    } catch {
        return undefined;
    }
}

function getCharWeatherConfig(): AgentWeatherConfig | undefined {
    const parsed = getRealtimeConfig();
    if (!parsed.weatherEnabled && !parsed.weatherApiKey) {
        return undefined;
    }

    return {
        weatherEnabled: !!parsed.weatherEnabled,
        weatherProvider: 'qweather',
        weatherApiKey: parsed.weatherApiKey || '',
    };
}

function getPrimaryApiConfig(): SecondaryApiConfig | undefined {
    const cfg = getRuntimePrimaryApiConfig();
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
        return undefined;
    }

    return {
        baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
        apiKey: cfg.apiKey,
        model: cfg.model,
    };
}

export function getAgentConfig(): AgentConfig {
    const parsed = readJsonStorage<Partial<AgentConfig>>(AGENT_CONFIG_STORAGE_KEY);
    if (parsed) {
        return { ...AGENT_CONFIG_DEFAULTS, ...parsed };
    }
    return { ...AGENT_CONFIG_DEFAULTS };
}

export function saveAgentConfig(config: Partial<AgentConfig>): void {
    const current = getAgentConfig();
    const merged = { ...current, ...config };
    writeJsonStorage(AGENT_CONFIG_STORAGE_KEY, merged);
}

export function getLifeStreamVisibleInChat(charId: string): boolean {
    return safeLocalStorageGet(`${LIFE_STREAM_VISIBILITY_STORAGE_PREFIX}${charId}`) === 'true';
}

function setLifeStreamVisibleInChat(charId: string, visibleInChat: boolean): void {
    safeLocalStorageSet(
        `${LIFE_STREAM_VISIBILITY_STORAGE_PREFIX}${charId}`,
        String(visibleInChat),
    );

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(LIFE_STREAM_VISIBILITY_EVENT_NAME));
    }
}

async function buildContextSnapshot(
    charId: string,
    char: CharacterProfile,
): Promise<ContextSnapshot> {
    const now = Date.now();
    const recentMessages = await DB.getRecentMessagesByCharId(charId, 20);

    let lastUserMsgAt = 0;
    let lastAIMsgAt = 0;
    let lastAIMsgWasAutonomous = false;

    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const message = recentMessages[i];
        if (message.role === 'user' && !lastUserMsgAt) {
            lastUserMsgAt = message.timestamp;
        }
        if (message.role === 'assistant' && !lastAIMsgAt) {
            lastAIMsgAt = message.timestamp;
            lastAIMsgWasAutonomous = message.metadata?.source === 'autonomous';
        }
    }

    let userName = 'User';
    try {
        const userProfile = await DB.getUserProfile();
        if (userProfile?.name) userName = userProfile.name;
    } catch {
        // Ignore user profile lookup failure.
    }

    let emojiNames: string[] = [];
    try {
        const emojis = await DB.getEmojis();
        emojiNames = emojis.map(emoji => emoji.name).slice(0, 30);
    } catch {
        // Ignore emoji lookup failure.
    }

    const moodState = (char.moodState as unknown as Record<string, unknown> | undefined) || null;
    const charSystemPrompt = (char.systemPrompt || '').slice(0, 2000);
    const charPersonality = (char.description || '').slice(0, 300);
    const topMemory = await loadTopMemorySummary(charId);
    const worldview = (char.worldview || '').slice(0, 1200) || undefined;
    const mountedWorldbooksDigest = buildMountedWorldbooksDigest(char.mountedWorldbooks);
    const coreMemoryDigest = buildCoreMemoryDigest(char, topMemory);
    const cityOverride = char.cityOverride?.trim() || undefined;
    const cityAdcode = char.cityAdcode?.trim() || undefined;
    const isFictionalCity = char.isFictionalCity || undefined;
    const cityReferenceReal = char.isFictionalCity
        ? (char.cityReferenceReal?.trim() || undefined)
        : undefined;

    return {
        charId,
        charName: char.name,
        charSystemPrompt,
        charPersonality,
        worldview,
        mountedWorldbooksDigest,
        coreMemoryDigest,
        cityOverride,
        cityAdcode,
        isFictionalCity,
        cityReferenceReal,
        userName,
        recentMessages: recentMessages.map(message => ({
            role: message.role,
            content: message.content.slice(0, 500),
            timestamp: message.timestamp,
        })),
        moodState,
        lastUserMsgAt,
        lastAIMsgAt,
        lastAIMsgWasAutonomous,
        emojiNames,
        topMemory,
        updatedAt: now,
    };
}

let activeInstance: BackendAgentManager | null = null;

export class BackendAgentManager {
    private contextTimer: ReturnType<typeof setInterval> | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private eventSource: EventSource | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private charId = '';
    private charRef: CharacterProfile | null = null;
    private sseFailCount = 0;
    private useFallbackPolling = false;
    private reconnectDelay = 1000;

    start(
        charId: string,
        char: CharacterProfile,
        secondaryApi: SecondaryApiConfig,
    ): () => void {
        if (activeInstance && activeInstance !== this) {
            activeInstance.stop();
        }
        activeInstance = this;

        this.stopped = false;
        this.charId = charId;
        this.charRef = char;
        this.sseFailCount = 0;
        this.useFallbackPolling = false;
        this.reconnectDelay = 1000;

        const isDebug = getAutonomousDebugEnabled();

        (async () => {
            try {
                const contextSnapshot = await buildContextSnapshot(charId, char);
                const mainApiConfig = getPrimaryApiConfig();

                if (!mainApiConfig) {
                    console.warn('[Agent] No primary API config, agent will not generate messages');
                }

                await startAgentOnBackend({
                    charId,
                    apiConfig: secondaryApi,
                    mainApiConfig,
                    weatherConfig: getCharWeatherConfig(),
                    contextSnapshot,
                    agentConfig: getAgentConfig(),
                });

                console.log(`[Agent] Backend agent started for ${char.name}`);

                if (this.stopped) return;

                this.connectSSE();
                this.contextTimer = setInterval(() => {
                    if (this.stopped) return;
                    this.pushContext().catch(error => {
                        if (isDebug) {
                            console.warn('[Agent] Context push error:', error.message);
                        }
                    });
                }, 5 * 60 * 1000);
            } catch (error: any) {
                console.error('[Agent] Failed to start backend agent:', error.message);
            }
        })();

        return () => this.stop();
    }

    private teardownClientRuntime(): void {
        this.stopped = true;
        activeInstance = null;

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.contextTimer) {
            clearInterval(this.contextTimer);
            this.contextTimer = null;
        }
    }

    disconnectFrontend(): void {
        this.teardownClientRuntime();
        console.log('[Agent] Frontend runtime disconnected, backend kept alive');
    }

    stop(): void {
        const charId = this.charId;
        this.teardownClientRuntime();

        if (charId) {
            stopAgentOnBackend(charId);
        }

        console.log('[Agent] Stopped');
    }

    private async enqueueBackendMessage(
        message: AgentBackendMessage,
        options: { delayMs?: number } = {},
    ): Promise<void> {
        const now = Date.now();
        const metadata = parseBackendMetadata(message.metadata);

        await DB.saveScheduledMessage({
            id: `backend-${message.id}`,
            charId: this.charId,
            content: message.content,
            dueAt: now + (options.delayMs || 0),
            createdAt: message.createdAt || message.created_at || now,
            metadata: {
                source: 'autonomous',
                reason: metadata.reason,
                backendMessageId: String(message.id),
                fromBackend: true,
            },
        });
    }

    private async acknowledgeMessages(
        ids: Array<number | string>,
    ): Promise<void> {
        if (ids.length === 0) return;

        try {
            await ackAgentMessages(ids);
        } catch (error: any) {
            if (getAutonomousDebugEnabled()) {
                console.warn('[Agent] Ack failed:', error.message);
            }
        }
    }

    private async syncLifeStreamFragments(
        fragments: LifeStreamFragment[],
    ): Promise<void> {
        if (!this.charId || fragments.length === 0) return;

        const existingMessages = await DB.getRecentMessagesByCharId(this.charId, 200);
        const existingTimestamps = new Set(
            existingMessages
                .filter(message => (message.type as string) === 'lifestream')
                .map(message => message.timestamp),
        );

        let saved = 0;
        for (const fragment of fragments) {
            if (existingTimestamps.has(fragment.created_at)) continue;

            await DB.saveMessage({
                charId: this.charId,
                role: 'assistant',
                type: 'lifestream' as any,
                content: `${fragment.time_label} · ${fragment.fragment}`,
                timestamp: fragment.created_at,
            });
            saved++;
        }

        if (saved > 0 && getAutonomousDebugEnabled()) {
            console.log(`[LifeStream] Saved ${saved} new fragment(s) as local messages`);
        }
    }

    private connectSSE(): void {
        if (this.stopped || !this.charId) return;

        const sseUrl = buildAgentSseUrl(this.charId);
        if (!sseUrl) {
            console.warn('[Agent] No backend URL, falling back to polling');
            this.startFallbackPolling();
            return;
        }

        const isDebug = getAutonomousDebugEnabled();

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        try {
            const eventSource = new EventSource(sseUrl);
            this.eventSource = eventSource;

            eventSource.addEventListener('connected', () => {
                console.log('[Agent] SSE connected');
                this.sseFailCount = 0;
                this.reconnectDelay = 1000;

                if (this.useFallbackPolling && this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.pollTimer = null;
                    this.useFallbackPolling = false;
                    console.log('[Agent] SSE recovered, stopped fallback polling');
                }
            });

            eventSource.addEventListener('message', async (event: MessageEvent) => {
                if (this.stopped) return;

                try {
                    const message = JSON.parse(event.data) as AgentBackendMessage;
                    if (isDebug) {
                        console.log(`[Agent] SSE message: "${(message.content || '').slice(0, 40)}..."`);
                    }

                    await this.enqueueBackendMessage(message);
                    await this.acknowledgeMessages([message.id]);
                } catch (error: any) {
                    if (isDebug) {
                        console.warn('[Agent] SSE message parse error:', error.message);
                    }
                }
            });

            eventSource.addEventListener('done', () => {
                if (isDebug) {
                    console.log('[Agent] SSE session ended, reconnecting...');
                }

                eventSource.close();
                this.eventSource = null;

                if (!this.stopped) {
                    this.reconnectTimer = setTimeout(() => this.connectSSE(), 500);
                }
            });

            eventSource.onerror = () => {
                if (this.stopped) return;

                this.sseFailCount++;
                eventSource.close();
                this.eventSource = null;

                if (this.sseFailCount >= 3 && !this.useFallbackPolling) {
                    console.warn(`[Agent] SSE failed ${this.sseFailCount} times, degrading to polling`);
                    this.startFallbackPolling();
                    this.reconnectTimer = setTimeout(() => this.connectSSE(), 60000);
                    return;
                }

                const delay = Math.min(this.reconnectDelay, 30000);
                if (isDebug) {
                    console.log(`[Agent] SSE error, reconnecting in ${delay}ms (fail #${this.sseFailCount})`);
                }
                this.reconnectTimer = setTimeout(() => this.connectSSE(), delay);
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
            };
        } catch (error: any) {
            console.warn('[Agent] EventSource constructor failed:', error.message);
            this.startFallbackPolling();
        }
    }

    private startFallbackPolling(): void {
        if (this.pollTimer || this.stopped) return;

        this.useFallbackPolling = true;
        console.log('[Agent] Starting fallback polling (30s interval)');

        this.pollTimer = setInterval(() => {
            if (this.stopped) return;
            this.pollMessages().catch(() => {});
        }, 30000);

        this.pollMessages().catch(() => {});
    }

    async pollMessages(): Promise<void> {
        if (!this.charId) return;

        const isDebug = getAutonomousDebugEnabled();

        try {
            const messages = await fetchPendingAgentMessages(this.charId);
            if (messages.length === 0) return;

            if (isDebug) {
                console.log(`[Agent] Polled ${messages.length} pending message(s)`);
            }

            for (let i = 0; i < messages.length; i++) {
                await this.enqueueBackendMessage(messages[i], {
                    delayMs: i * 3000,
                });
            }

            await this.acknowledgeMessages(messages.map(message => message.id));

            console.log(`[Agent] Saved ${messages.length} backend message(s) to scheduled queue`);
        } catch (error: any) {
            if (isDebug) {
                console.warn('[Agent] Poll failed:', error.message);
            }
        }
    }

    async pushContext(nextChar?: CharacterProfile): Promise<void> {
        if (nextChar?.id === this.charId) {
            this.charRef = nextChar;
        }
        if (!this.charId || !this.charRef) return;

        try {
            let freshChar = nextChar && nextChar.id === this.charId
                ? nextChar
                : this.charRef;
            try {
                const allChars = await DB.getAllCharacters();
                const found = allChars.find(char => char.id === this.charId);
                if (found) {
                    freshChar = found;
                    this.charRef = found;
                }
            } catch {
                // Keep using the cached character reference.
            }

            const contextSnapshot = await buildContextSnapshot(this.charId, freshChar);
            await pushAgentContextSnapshot(contextSnapshot);

            if (getAutonomousDebugEnabled()) {
                console.log('[Agent] Context pushed to backend');
            }

            try {
                const lifeStreamState = await fetchAgentLifeStream(this.charId);
                setLifeStreamVisibleInChat(this.charId, lifeStreamState.visibleInChat);
                await this.syncLifeStreamFragments(lifeStreamState.fragments);
            } catch (error: any) {
                if (getAutonomousDebugEnabled()) {
                    console.log(`[LifeStream] fetch/save error: ${error.message}`);
                }
            }
        } catch (error: any) {
            if (getAutonomousDebugEnabled()) {
                console.warn('[Agent] Context push failed:', error.message);
            }
        }
    }

    static async notifyUserReplied(charId: string): Promise<void> {
        try {
            await notifyAgentUserReplied(charId);
        } catch {
            // Silent on purpose. User replies should not block the chat flow.
        }
    }
}
