
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { buildBackendHeaders,getBackendUrl,getUserId,sanitizeBackendHeader,setUserId,pushMemories,pullMemories,listCloudChars,migrateCloudCharacterInstance } from '../utils/backendClient';
import { DB } from '../utils/db';
import { useOS } from '../context/OSContext';
import { haptic } from '../utils/haptics';
import { getEmbeddingConfig,getSecondaryApiConfig } from '../utils/runtimeConfig';
import { safeTimeoutSignal } from '../utils/safeTimeout';
import { findCharacterByAnyId,getOrphanCloudStats,getSelectedCharacterStats } from '../utils/cognitiveNetworkCharacterStats';
import type { CognitiveCharStats } from '../utils/cognitiveNetworkCharacterStats';
import { MEMORY_RECORD_MODE_COPY,produceMemoryRecordAudio,shouldGenerateMemoryRecordMonologue,generateLyrics,checkLyricSingability,optimizeLyrics,generateStylePrompt,createRecordId,COVER_GRADIENTS,type MemoryRecordMemoryHeader,type SingabilityCheckResult,type StylePromptResult } from '../utils/memoryRecordService';
import { getMemoryRecordCoverImage } from '../utils/memoryRecordCovers';
import { hasPlayableMemoryRecordAudio,memoryRecordToPlayable } from '../utils/memoryRecordPlayable';
import { shareMemoryRecordPoster } from '../utils/memoryRecordShare';
import type { CharacterProfile,MemoryRecord,MemoryRecordMode,MemoryRecordSongRequest } from '../types';
import type { MemoryRecordPlayable } from '../types/music';
import { MEMORY_RECORD_STATUS_LABELS } from '../types';
import MemoryRecordShareModal from '../components/music/MemoryRecordShareModal';

/* Recovered comment */

type CharStats = CognitiveCharStats;

interface PerCharStatsResponse {
    characters: CharStats[];
    graph: { nodes: number; edges: number };
}

interface BackfillResult {
    success: boolean;
    dryRun: boolean;
    characters: { charId: string; memoryCount: number; linksCreated: number; edgesCreated: number; skipped?: boolean }[];
    totals: { memories: number; linksCreated: number; edgesCreated: number };
    verification: { charId: string; total: number; withPrev: number; withNext: number; expected: number; complete: boolean }[];
    graphStats: { nodes: number; edges: number };
}

interface SemanticResult {
    success: boolean;
    dryRun: boolean;
    results: { charId: string; total: number; needsEdges: number; queued: number }[];
    totalQueued: number;
    note: string;
}

interface SemanticRebuildResult {
    success: boolean;
    deleted: number;
    reset: number;
    toProcess: number;
}

interface DistillResetStats {
    l1Deleted: number;
    l0Cleared: number;
    relationsCleared: number;
}

interface OrphanMemoryPreview {
    id: string;
    title: string;
    content: string;
    emotionalJourney?: string;
    createdAt?: number;
}

interface OrphanPreviewState {
    loading: boolean;
    memories: OrphanMemoryPreview[];
    error?: string;
}

interface DistillResult {
    clustersFound: number;
    processedClusters?: number;
    maxClustersPerRun?: number;
    l1Created: number;
    l1Merged: number;
    l1Deduped: number;
    l0Linked: number;
    errors: number;
    elapsed: number;
    deferred?: {
        stage: string;
        stageLabel: string;
        clusterSize: number;
        preview: string;
        reason: string;
    }[];
    resetStats?: DistillResetStats;
}

type MemoryRecordFlowStatus =
    | 'idle'
    | 'generating_lyrics'
    | 'lyrics_ready'
    | 'checking_singability'
    | 'singability_checked'
    | 'optimizing_lyrics'
    | 'lyrics_optimized'
    | 'revising_lyrics'
    | 'lyrics_confirmed'
    | 'generating_style'
    | 'style_ready'
    | 'generating_song'
    | 'song_ready'
    | 'error';

interface LyricsEditorDraft {
    title: string;
    lyrics: string;
    stylePrompt: string;
    negativeStylePrompt: string;
    revisionInstruction: string;
    lyricistReference: string;
    optimizedLyrics?: string;
    optimizedTitle?: string;
    optimizationNotes?: import('../types').OptimizationNotes;
}

const createEmptySongRequest = (): MemoryRecordSongRequest => ({
    theme: '',
    mood: '',
    style: '',
    perspective: '',
    voicePreference: '',
    extraRequirements: '',
});

const createEmptyLyricsDraft = (): LyricsEditorDraft => ({
    title: '',
    lyrics: '',
    stylePrompt: '',
    negativeStylePrompt: '',
    revisionInstruction: '',
    lyricistReference: '',
});

const ORPHAN_PREVIEW_LIMIT = 3;

function formatOrphanPreviewDate(timestamp?: number): string {
    if (!timestamp) return '最近时间待确认';
    const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '最近时间待确认';
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
        ? { month: 'numeric', day: 'numeric' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' };
    return date.toLocaleDateString('zh-CN', options);
}

function getOrphanPreviewTitle(memory: OrphanMemoryPreview): string {
    const title = memory.title?.trim();
    return title || '未命名回忆';
}

function getOrphanPreviewSnippet(memory: OrphanMemoryPreview): string {
    const text = (memory.emotionalJourney || memory.content || '').replace(/\s+/g, ' ').trim();
    if (!text) return '留下了一段还没归档的细节。';
    return text.length > 46 ? `${text.slice(0, 46)}...` : text;
}

function getOrphanGroupLabel(index: number, total: number): string {
    return total > 1 ? `第 ${index + 1} 组待归档回忆` : '一组待归档回忆';
}

function normalizeSongRequest(request: MemoryRecordSongRequest): MemoryRecordSongRequest {
    return {
        theme: request.theme.trim(),
        mood: request.mood.trim(),
        style: request.style.trim(),
        perspective: request.perspective.trim(),
        voicePreference: request.voicePreference?.trim() || undefined,
        extraRequirements: request.extraRequirements?.trim() || undefined,
    };
}

/* Recovered comment */

const HOME_MEMORY_MOTES = [
    { left: '82%', top: '18%', size: 3.8, opacity: 0.64, color: '#fff7dc', x: 5, y: -8, scale: 1.55, duration: 12.5, delay: 0.2 },
    { left: '11%', top: '32%', size: 3.1, opacity: 0.54, color: '#e5d08f', x: -5, y: 7, scale: 1.4, duration: 14.8, delay: 1.5 },
    { left: '92%', top: '43%', size: 4.1, opacity: 0.48, color: '#d4af37', x: -7, y: -5, scale: 1.28, duration: 15.5, delay: 2.2 },
    { left: '7%', top: '52%', size: 3.5, opacity: 0.58, color: '#fff1bd', x: 6, y: 8, scale: 1.35, duration: 13.2, delay: 0.9 },
    { left: '72%', top: '58%', size: 2.9, opacity: 0.5, color: '#e5d08f', x: 5, y: -6, scale: 1.6, duration: 10.8, delay: 3.1 },
    { left: '29%', top: '67%', size: 4.5, opacity: 0.44, color: '#d4af37', x: -4, y: -9, scale: 1.22, duration: 16, delay: 1.1 },
    { left: '88%', top: '76%', size: 3.3, opacity: 0.54, color: '#fff7dc', x: -6, y: 5, scale: 1.45, duration: 12.2, delay: 2.7 },
    { left: '13%', top: '82%', size: 2.8, opacity: 0.48, color: '#e5d08f', x: 5, y: -7, scale: 1.3, duration: 14.2, delay: 4.2 },
    { left: '58%', top: '90%', size: 3.9, opacity: 0.48, color: '#fff1bd', x: -3, y: -8, scale: 1.36, duration: 11.4, delay: 1.9 },
    { left: '39%', top: '36%', size: 2.7, opacity: 0.44, color: '#d4af37', x: 6, y: 6, scale: 1.65, duration: 15.2, delay: 3.5 },
] as const;

const CognitiveNetworkApp: React.FC = () => {
    const { closeApp, addToast, characters, userProfile, apiConfig, ttsConfig } = useOS();
    const { playSong } = useAudioPlayer();
    const [allStats, setAllStats] = useState<PerCharStatsResponse | null>(null);
    const [statsFailed, setStatsFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null); // null = 鍏ㄩ儴瑙掕壊
    const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
    const [semanticResult, setSemanticResult] = useState<SemanticResult | null>(null);
    const [backfilling, setBackfilling] = useState(false);
    const [semanticRunning, setSemanticRunning] = useState(false);
    const [showConfirm, setShowConfirm] = useState<'temporal' | 'semantic' | 'semanticRebuild' | 'rescan' | 'distill' | 'distillRebuild' | 'syncBind' | null>(null);
    // Navigation state
    const [activeTab, setActiveTab] = useState<'home' | 'browser' | 'workshop' | 'sync'>('home');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [queueStatus, setQueueStatus] = useState<{
        total: number; done: number; errors: number; running: boolean;
        lastError?: string; lastElapsed?: number;
        totalRelations?: number;
        lastRelations?: number;
        lastSnippet?: string;
        lastParseError?: string;
        lastRawCount?: number;
        lastFilterCount?: number;
        lastCandidateCount?: number;
        lastVecSim?: boolean;
        mode?: 'semantic' | 'semantic-rebuild';
        canAbort?: boolean;
        aborted?: boolean;
    } | null>(null);
    // Distillation state
    const [distilling, setDistilling] = useState(false);
    const [distillResult, setDistillResult] = useState<DistillResult | null>(null);
    const [semanticRebuilding, setSemanticRebuilding] = useState(false);
    const [semanticRebuildResult, setSemanticRebuildResult] = useState<({ charId: string } & Omit<SemanticRebuildResult, 'success'>) | null>(null);
    const [distillRebuilding, setDistillRebuilding] = useState(false);
    const [distillResetStats, setDistillResetStats] = useState<({ charId: string } & DistillResetStats) | null>(null);

    // Memory Browser state
    const [browserOpen, setBrowserOpen] = useState(false);
    const [browserMemories, setBrowserMemories] = useState<any[] | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);
    const [browserLevel, setBrowserLevel] = useState<'all' | '0' | '1' | 'musing'>('all');
    const [browserCounts, setBrowserCounts] = useState<{ total: number; l0: number; l1: number; musing: number }>({ total: 0, l0: 0, l1: 0, musing: 0 });
    const [expandedMemId, setExpandedMemId] = useState<string | null>(null);
    const [editingMemId, setEditingMemId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<{ title: string; content: string; importance: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const [recordMode, setRecordMode] = useState<MemoryRecordMode>('blind_box');
    const [recordReference, setRecordReference] = useState('');
    const [selectedRecordMemoryIds, setSelectedRecordMemoryIds] = useState<string[]>([]);
    const [recordMemoryOptions, setRecordMemoryOptions] = useState<MemoryRecordMemoryHeader[]>([]);
    const [recordMemoryOptionsLoading, setRecordMemoryOptionsLoading] = useState(false);
    const [recordMemoryOptionsError, setRecordMemoryOptionsError] = useState('');
    const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
    const [shareModalPlayable, setShareModalPlayable] = useState<MemoryRecordPlayable | null>(null);
    const [isSharingMemoryRecord, setIsSharingMemoryRecord] = useState(false);
    const [recordGenerating, setRecordGenerating] = useState(false);
    const [recordStatusText, setRecordStatusText] = useState('');
    const [recordFlowStatus, setRecordFlowStatus] = useState<MemoryRecordFlowStatus>('idle');
    const [recordSongRequest, setRecordSongRequest] = useState<MemoryRecordSongRequest>(() => createEmptySongRequest());
    const [activeDraftRecordId, setActiveDraftRecordId] = useState<string | null>(null);
    const [lyricsDraft, setLyricsDraft] = useState<LyricsEditorDraft>(() => createEmptyLyricsDraft());
    const [recordFlowError, setRecordFlowError] = useState('');
    const [singabilityResult, setSingabilityResult] = useState<SingabilityCheckResult | null>(null);
    const [stylePromptResult, setStylePromptResult] = useState<StylePromptResult | null>(null);
    const [showOptimizedLyrics, setShowOptimizedLyrics] = useState(false);
    const monologuePreviewRef = React.useRef<HTMLAudioElement | null>(null);
    const monologuePreviewUrlRef = React.useRef<string | null>(null);

    // Cloud Sync state
    const [syncCodeVisible, setSyncCodeVisible] = useState(false);
    const [bindInput, setBindInput] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ pushed: number; pulled: number } | null>(null);
    const [syncUserId, setSyncUserId] = useState(() => getUserId());
    const [claimingCloudCharId, setClaimingCloudCharId] = useState<string | null>(null);
    const [claimDrawerCharId, setClaimDrawerCharId] = useState<string | null>(null);
    const [claimTargetCharId, setClaimTargetCharId] = useState<string | null>(null);
    const [orphanPreviews, setOrphanPreviews] = useState<Record<string, OrphanPreviewState>>({});
    const semanticAbortRef = React.useRef<AbortController | null>(null);
    const orphanPreviewRequestsRef = React.useRef<Set<string>>(new Set());

    const charNameMap = useCallback((charId: string) => {
        const found = findCharacterByAnyId(characters, charId);
        return found?.name || charId.slice(0, 12);
    }, [characters]);

    const charAvatarMap = useCallback((charId: string) => {
        const found = findCharacterByAnyId(characters, charId);
        return found?.avatar || '';
    }, [characters]);

    const selectedBrowserChar = useMemo(
        () => findCharacterByAnyId(characters, selectedCharId),
        [characters, selectedCharId]
    );

    const selectedBackendCharId = useMemo(() => {
        if (!selectedCharId) return null;
        return selectedBrowserChar ? selectedBrowserChar.id : selectedCharId;
    }, [selectedBrowserChar, selectedCharId]);

    const authHeaders = useCallback(() => {
        const h = buildBackendHeaders();
        const subApiConfig = getSecondaryApiConfig();
        if (subApiConfig?.apiKey) h['X-LLM-Key'] = sanitizeBackendHeader(subApiConfig.apiKey);
        if (subApiConfig?.baseUrl) h['X-LLM-Base-URL'] = sanitizeBackendHeader(subApiConfig.baseUrl);
        if (subApiConfig?.model) h['X-LLM-Model'] = sanitizeBackendHeader(subApiConfig.model);
        return h;
    }, []);

    const backendUrl = getBackendUrl();
    const isConnected = !!backendUrl;
    const hasSubApi = !!getSecondaryApiConfig()?.apiKey;
    const hasEmbeddingApi = !!getEmbeddingConfig().apiKey;
    const distillBusy = distilling || distillRebuilding;
    void semanticResult;
    void semanticRebuildResult;
    void distillResetStats;
    void browserOpen;
    void setBrowserOpen;
    void charAvatarMap;
    void hasSubApi;
    void hasEmbeddingApi;
    void distillBusy;
    const shouldReduceMotion = useReducedMotion();
    const [isTouchLikeDevice, setIsTouchLikeDevice] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(pointer: coarse)').matches;
    });
    const shouldCalmHomeMotion = shouldReduceMotion || isTouchLikeDevice;

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(pointer: coarse)');
        const syncPointer = () => setIsTouchLikeDevice(query.matches);
        syncPointer();
        query.addEventListener('change', syncPointer);
        return () => query.removeEventListener('change', syncPointer);
    }, []);

    // Full headers with embedding keys (for distillation)
    const fullHeaders = useCallback(() => {
        const h = authHeaders();
        const embeddingConfig = getEmbeddingConfig();
        if (embeddingConfig.apiKey) h['X-Embedding-Key'] = sanitizeBackendHeader(embeddingConfig.apiKey);
        if (embeddingConfig.provider) h['X-Embedding-Provider'] = sanitizeBackendHeader(embeddingConfig.provider);
        if (embeddingConfig.baseUrl) h['X-Embedding-Base-URL'] = sanitizeBackendHeader(embeddingConfig.baseUrl);
        if (embeddingConfig.model) h['X-Embedding-Model'] = sanitizeBackendHeader(embeddingConfig.model);
        return h;
    }, [authHeaders]);

    // Current selected character stats
    const currentStats = useMemo(() => {
        if (!allStats || allStats.characters.length === 0) return null;
        return getSelectedCharacterStats(allStats.characters, characters, selectedCharId);
    }, [allStats, characters, selectedCharId]);

    const orphanCloudStats = useMemo(
        () => getOrphanCloudStats(allStats?.characters || [], characters),
        [allStats, characters]
    );

    const orphanMemoryTotal = useMemo(
        () => orphanCloudStats.reduce((sum, stat) => sum + (stat.memories || 0), 0),
        [orphanCloudStats]
    );

    const activeClaimStat = useMemo(
        () => orphanCloudStats.find(stat => stat.charId === claimDrawerCharId) || null,
        [orphanCloudStats, claimDrawerCharId]
    );

    const claimTargetChar = useMemo(
        () => findCharacterByAnyId(characters, claimTargetCharId),
        [characters, claimTargetCharId]
    );

    const activeClaimPreview = claimDrawerCharId ? orphanPreviews[claimDrawerCharId] : undefined;

    // 鍒濇杩炴帴鍚庡彧鎷夊彇涓€娆＄粺璁★紝閬垮厤閲嶅璇锋眰
    const statsLoaded = React.useRef(false);
    useEffect(() => {
        if (isConnected && !statsLoaded.current) {
            statsLoaded.current = true;
            fetchStats();
        }
    }, [isConnected]);

    const fetchStats = useCallback(async () => {
        const url = getBackendUrl();
        if (!url) return;
        setLoading(true);
        setStatsFailed(false);
        try {
            const resp = await fetch(`${url}/api/graph/stats-by-char`, {
                headers: authHeaders(),
                signal: safeTimeoutSignal(60000), // 60s timeout
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            setAllStats(data);
            setStatsFailed(false);
        } catch (e: any) {
            console.warn('鍔犺浇鍥捐氨缁熻澶辫触', e);
            setStatsFailed(true);
            // Set empty stats so the page doesn't get stuck on spinner
            setAllStats(prev => prev ?? { characters: [], graph: { nodes: 0, edges: 0 } });
        } finally { setLoading(false); }
    }, [authHeaders]);

    const fetchOrphanPreview = useCallback(async (cloudCharId: string, options?: { retry?: boolean }) => {
        const url = getBackendUrl();
        const legacyCharId = cloudCharId.trim();
        if (!url || !legacyCharId) return;

        const existing = orphanPreviews[legacyCharId];
        if (!options?.retry && (existing?.loading || existing?.memories.length || existing?.error)) return;
        if (orphanPreviewRequestsRef.current.has(legacyCharId)) return;

        orphanPreviewRequestsRef.current.add(legacyCharId);
        setOrphanPreviews(prev => ({ ...prev, [legacyCharId]: { loading: true, memories: [] } }));
        try {
            const resp = await fetch(
                `${url}/api/memories/${encodeURIComponent(legacyCharId)}/headers?limit=${ORPHAN_PREVIEW_LIMIT}`,
                { headers: authHeaders(), signal: safeTimeoutSignal(15000) },
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const memories = Array.isArray(data.headers)
                ? data.headers.slice(0, ORPHAN_PREVIEW_LIMIT).map((item: any) => {
                    const createdAt = Number(item.createdAt);
                    return {
                        id: String(item.id || ''),
                        title: String(item.title || ''),
                        content: String(item.content || ''),
                        emotionalJourney: item.emotionalJourney ? String(item.emotionalJourney) : undefined,
                        createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
                    };
                })
                : [];
            setOrphanPreviews(prev => ({ ...prev, [legacyCharId]: { loading: false, memories } }));
        } catch (e: any) {
            setOrphanPreviews(prev => ({
                ...prev,
                [legacyCharId]: { loading: false, memories: [], error: e?.message || 'preview failed' },
            }));
        } finally {
            orphanPreviewRequestsRef.current.delete(legacyCharId);
        }
    }, [authHeaders, orphanPreviews]);

    useEffect(() => {
        if (!isConnected || orphanCloudStats.length === 0) return;
        orphanCloudStats.slice(0, 4).forEach(stat => fetchOrphanPreview(stat.charId));
    }, [fetchOrphanPreview, isConnected, orphanCloudStats]);

    const doBackfill = useCallback(async (dryRun: boolean) => {
        const url = getBackendUrl();
        if (!url) return;
        setBackfilling(true);
        try {
            const resp = await fetch(`${url}/api/graph/backfill`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({ dryRun }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result: BackfillResult = await resp.json();
            setBackfillResult(result);
            if (!dryRun && result.success) {
                addToast('时间丝线已经重新整理好了', 'success');
                fetchStats();
            }
        } catch (e: any) { addToast(`编织失败: ${e.message}`, 'error'); }
        finally { setBackfilling(false); setShowConfirm(null); }
    }, [authHeaders, addToast, fetchStats]);

    const runSemanticQueue = useCallback(async (
        url: string,
        total: number,
        options?: { canAbort?: boolean; mode?: 'semantic' | 'semantic-rebuild' },
    ) => {
        const controller = options?.canAbort ? new AbortController() : null;
        semanticAbortRef.current = controller;

        let done = 0;
        let errors = 0;
        let totalRelations = 0;
        let aborted = false;

        const markAborted = () => {
            if (aborted) return;
            aborted = true;
            setQueueStatus(prev => prev ? { ...prev, running: false, aborted: true, canAbort: false } : null);
            addToast('这次重新寻找已经暂停，稍后还可以继续', 'info');
        };

        setQueueStatus({
            total,
            done: 0,
            errors: 0,
            running: true,
            totalRelations: 0,
            mode: options?.mode || 'semantic',
            canAbort: !!options?.canAbort,
        });

        for (let i = 0; i < total; i++) {
            try {
                const processBody: any = {};
                if (selectedBackendCharId) processBody.charId = selectedBackendCharId;
                const timeoutSignal = safeTimeoutSignal(120_000);
                // AbortSignal.any is Safari 17.4+; fall back to manual wiring
                let combinedSignal: AbortSignal;
                if (controller && typeof AbortSignal.any === 'function') {
                    combinedSignal = AbortSignal.any([controller.signal, timeoutSignal]);
                } else if (controller) {
                    // Manual fallback: listen for timeout and abort the main controller
                    const onTimeout = () => { if (!controller.signal.aborted) controller.abort(); };
                    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
                    combinedSignal = controller.signal;
                } else {
                    combinedSignal = timeoutSignal;
                }
                const r = await fetch(`${url}/api/graph/semantic-process-one`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(processBody),
                    signal: combinedSignal,
                });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json() as any;

                if (data.done) {
                    setQueueStatus(prev => prev ? { ...prev, done, running: false, canAbort: false } : null);
                    break;
                }

                if (data.processed) {
                    done++;
                    totalRelations += (data.relationsFound || 0);
                    setQueueStatus({
                        total,
                        done,
                        errors,
                        running: true,
                        lastElapsed: data.elapsed,
                        totalRelations,
                        lastRelations: data.relationsFound,
                        lastSnippet: data.debug?.llmSnippet,
                        lastParseError: data.debug?.parseError,
                        lastRawCount: data.debug?.rawParsedCount ?? data.debug?.rawParsed?.length,
                        lastFilterCount: data.relationsFound,
                        lastCandidateCount: data.debug?.candidateCount,
                        lastVecSim: data.debug?.vectorSimilarityUsed,
                        mode: options?.mode || 'semantic',
                        canAbort: !!options?.canAbort,
                    });
                } else if (data.error) {
                    errors++;
                    setQueueStatus({
                        total,
                        done,
                        errors,
                        running: true,
                        lastError: data.error,
                        lastElapsed: data.elapsed,
                        mode: options?.mode || 'semantic',
                        canAbort: !!options?.canAbort,
                    });
                    if (errors >= 5) {
                        addToast('连续出现了几次异常，我先替你暂停了', 'error');
                        setQueueStatus(prev => prev ? { ...prev, running: false, lastError: data.error, canAbort: false } : null);
                        break;
                    }
                }
            } catch (e: any) {
                if (e?.name === 'AbortError') {
                    markAborted();
                    break;
                }

                errors++;
                setQueueStatus(prev => prev ? {
                    ...prev,
                    errors,
                    running: true,
                    lastError: e.message,
                    mode: options?.mode || 'semantic',
                } : null);
                if (errors >= 5) {
                    addToast('网络波动有些频繁，我先替你暂停了', 'error');
                    setQueueStatus(prev => prev ? { ...prev, running: false, canAbort: false } : null);
                    break;
                }
            }

            await new Promise(r => setTimeout(r, 1000));

            if (controller?.signal.aborted) {
                markAborted();
                break;
            }
        }

        setQueueStatus(prev => prev ? { ...prev, running: false, aborted, canAbort: false } : null);
        if (semanticAbortRef.current === controller) semanticAbortRef.current = null;

        return { done, errors, totalRelations, aborted };
    }, [authHeaders, addToast, selectedBackendCharId]);

    const doSemanticBackfill = useCallback(async (dryRun: boolean, forceRescan = false) => {
        const url = getBackendUrl();
        if (!url) return;
        setSemanticRunning(true);
        setSemanticRebuilding(false);
        if (!dryRun) {
            setQueueStatus(null);
            setSemanticRebuildResult(null);
        }
        try {
            const body: any = { dryRun, forceRescan };
            if (selectedBackendCharId) body.charId = selectedBackendCharId;
            const resp = await fetch(`${url}/api/graph/backfill-semantic`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result: SemanticResult = await resp.json();
            setSemanticResult(result);

            if (dryRun) return;

            if (result.totalQueued === 0) {
                addToast('所有回忆都已找到彼此的联系', 'success');
                setShowConfirm('rescan');
                return;
            }

            // 鍚庣鍏堟妸闇€瑕佽ˉ璇箟杈圭殑璁板繂鍏ラ槦锛岀湡姝ｉ€愭潯澶勭悊浠嶈蛋 semantic-process-one
            const { done, errors, aborted } = await runSemanticQueue(url, result.totalQueued, { mode: 'semantic' });
            if (!aborted && done > 0) {
                addToast(`已为 ${done} 段回忆找到新的联系${errors > 0 ? `，另有 ${errors} 段暂未完成` : ''}`, 'success');
            }

            fetchStats();
        } catch (e: any) { addToast(`寻找失败: ${e.message}`, 'error'); }
        finally { setSemanticRunning(false); setShowConfirm(prev => prev === 'semantic' ? null : prev); }
    }, [authHeaders, addToast, selectedBackendCharId, fetchStats, runSemanticQueue]);

    const doSemanticRebuild = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedBackendCharId) return;
        setSemanticRunning(true);
        setSemanticRebuilding(true);
        setQueueStatus(null);
        setSemanticResult(null);
        try {
            const resp = await fetch(`${url}/api/graph/semantic-rebuild`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ charId: selectedBackendCharId }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const result: SemanticRebuildResult = await resp.json();
            setSemanticRebuildResult({
                charId: selectedBackendCharId,
                deleted: result.deleted,
                reset: result.reset,
                toProcess: result.toProcess,
            });

            addToast(`已清除 ${result.deleted} 条旧联系，${result.toProcess} 段回忆已排队重新寻找`, result.toProcess > 0 ? 'success' : 'info');
            fetchStats();

            if (result.toProcess === 0) return;

            const { done, errors, aborted } = await runSemanticQueue(url, result.toProcess, {
                canAbort: true,
                mode: 'semantic-rebuild',
            });

            if (!aborted) {
                if (done > 0) {
                    addToast(`重新织梦完成，已重新寻找 ${done} 段回忆${errors > 0 ? `，另有 ${errors} 段暂未完成` : ''}`, errors > 0 ? 'info' : 'success');
                } else if (errors > 0) {
                    addToast(`重新织梦暂未完成，还有 ${errors} 处异常`, 'error');
                }
            }

            fetchStats();
        } catch (e: any) {
            addToast(`重新织梦失败: ${e.message}`, 'error');
        } finally {
            setSemanticRunning(false);
            setSemanticRebuilding(false);
            setShowConfirm(prev => prev === 'semanticRebuild' ? null : prev);
        }
    }, [authHeaders, addToast, selectedBackendCharId, fetchStats, runSemanticQueue]);

    // Distillation 闇€瑕佸畬鏁?embedding 閰嶇疆锛屽洜姝や娇鐢?fullHeaders
    const doDistill = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedBackendCharId) return;
        setDistilling(true);
        setDistillResetStats(null);
        try {
            const charName = charNameMap(selectedBackendCharId);
            const resp = await fetch(`${url}/api/distillation/run`, {
                method: 'POST', headers: fullHeaders(),
                body: JSON.stringify({ charId: selectedBackendCharId, charName, userName: userProfile.name }),
            });
            if (!resp.ok) {
                let detail = `HTTP ${resp.status}`;
                try { const body = await resp.json(); detail = body?.message || body?.error || detail; } catch {}
                throw new Error(detail);
            }
            const result: DistillResult = await resp.json();
            setDistillResult(result);
            if (result.l1Created > 0 || result.l1Merged > 0 || result.l1Deduped > 0) {
                const parts: string[] = [];
                if (result.l1Created > 0) parts.push(`新建 ${result.l1Created}`);
                if (result.l1Merged > 0) parts.push(`合并 ${result.l1Merged}`);
                if (result.l1Deduped > 0) parts.push(`去重 ${result.l1Deduped}`);
                addToast(`回忆结晶完成：${parts.join('，')}`, 'success');
                fetchStats();
            } else {
                addToast('暂时还没有适合凝结成印象的新回忆', 'info');
            }
        } catch (e: any) { addToast(`凝结失败: ${e.message}`, 'error'); }
        finally { setDistilling(false); setShowConfirm(prev => prev === 'distill' ? null : prev); }
    }, [fullHeaders, addToast, selectedBackendCharId, charNameMap, fetchStats, userProfile.name]);

    const doDistillRebuild = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedBackendCharId) return;
        setDistillRebuilding(true);
        try {
            const charName = charNameMap(selectedBackendCharId);
            const resp = await fetch(`${url}/api/distillation/reset-and-run`, {
                method: 'POST',
                headers: fullHeaders(),
                body: JSON.stringify({ charId: selectedBackendCharId, charName, userName: userProfile.name }),
            });
            if (!resp.ok) {
                let detail = `HTTP ${resp.status}`;
                try { const body = await resp.json(); detail = body?.message || body?.error || detail; } catch {}
                throw new Error(detail);
            }

            const result: DistillResult = await resp.json();
            setDistillResult(result);
            setDistillResetStats(result.resetStats ? { charId: selectedBackendCharId, ...result.resetStats } : null);

            if (result.l1Created > 0 || result.l1Merged > 0 || result.l1Deduped > 0) {
                const parts: string[] = [];
                if (result.l1Created > 0) parts.push(`新建 ${result.l1Created}`);
                if (result.l1Merged > 0) parts.push(`合并 ${result.l1Merged}`);
                if (result.l1Deduped > 0) parts.push(`去重 ${result.l1Deduped}`);
                addToast(`重新凝结完成：${parts.join('，')}`, 'success');
            } else {
                addToast('重新凝结完成，但这次还没有新的回忆印象出现', 'info');
            }

            fetchStats();
        } catch (e: any) {
            addToast(`重新凝结失败: ${e.message}`, 'error');
        } finally {
            setDistillRebuilding(false);
            setShowConfirm(prev => prev === 'distillRebuild' ? null : prev);
        }
    }, [fullHeaders, addToast, selectedBackendCharId, charNameMap, fetchStats, userProfile.name]);

    // Memory browser
    const fetchBrowserMemories = useCallback(async (level?: 'all' | '0' | '1' | 'musing') => {
        const url = getBackendUrl();
        if (!url || !selectedBackendCharId) return;
        setBrowserLoading(true);
        try {
            const lvl = level || browserLevel;
            // For 'musing', fetch all and filter client-side by source
            const apiLevel = (lvl === 'musing' || lvl === 'all') ? undefined : lvl;
            const params = apiLevel ? `?level=${apiLevel}` : '';
            const resp = await fetch(`${url}/api/memories/browse/${selectedBackendCharId}${params}`, { headers: authHeaders() });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const allMemories = data.memories || [];
            const musingCount = allMemories.filter((m: any) => m.source === 'musing').length;
            setBrowserMemories(lvl === 'musing' ? allMemories.filter((m: any) => m.source === 'musing') : allMemories);
            setBrowserCounts({ total: data.count, l0: data.l0Count, l1: data.l1Count, musing: musingCount });
        } catch (e: any) { addToast(`载入失败: ${e.message}`, 'error'); }
        finally { setBrowserLoading(false); }
    }, [authHeaders, selectedBackendCharId, browserLevel, addToast]);

    // Auto-fetch when switching to browser tab
    useEffect(() => {
        if (activeTab === 'browser' && selectedBackendCharId && !browserMemories) {
            fetchBrowserMemories();
        }
    }, [activeTab, selectedBackendCharId, browserMemories, fetchBrowserMemories]);

    const doSaveEdit = useCallback(async (memId: string) => {
        const url = getBackendUrl();
        if (!url || !editDraft) return;
        setSaving(true);
        try {
            const resp = await fetch(`${url}/api/memories/${memId}`, {
                method: 'PATCH', headers: authHeaders(),
                body: JSON.stringify({ title: editDraft.title, content: editDraft.content, importance: editDraft.importance }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            addToast('已保存', 'success');
            setEditingMemId(null);
            setEditDraft(null);
            fetchBrowserMemories();
        } catch (e: any) { addToast(`保存失败: ${e.message}`, 'error'); }
        finally { setSaving(false); }
    }, [authHeaders, editDraft, addToast, fetchBrowserMemories]);



    // ─── Sync helpers (used by sync view) ───
    const handleAbortSemantic = useCallback(() => {
        if (semanticAbortRef.current) {
            semanticAbortRef.current.abort();
            semanticAbortRef.current = null;
        }
    }, []);

    const startTemporalBackfill = useCallback(() => doBackfill(false), [doBackfill]);
    const startSemanticSweep = useCallback(() => doSemanticBackfill(false), [doSemanticBackfill]);
    const startSemanticRebuild = useCallback(() => doSemanticRebuild(), [doSemanticRebuild]);
    const startDistillation = useCallback(() => doDistill(), [doDistill]);
    const startDistillRebuild = useCallback(() => doDistillRebuild(), [doDistillRebuild]);

    const pushSync = useCallback(async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            let totalPushed = 0;
            for (const char of characters) {
                const mems = await DB.getAllVectorMemories(char.id);
                const result = await pushMemories(char.id, mems);
                if (result) totalPushed += result.synced;
            }
            setSyncResult({ pushed: totalPushed, pulled: 0 });
            addToast(`已将 ${totalPushed} 段回忆写入云端`, 'success');
            fetchStats();
        } catch (e: any) { addToast(`写入失败: ${e.message}`, 'error'); }
        finally { setSyncing(false); }
    }, [addToast, characters, fetchStats]);

    const pullSync = useCallback(async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const localIdentityIds = new Set(
                characters.flatMap(c =>
                    [c.id, c.charInstanceId].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
                )
            );
            const cloudChars = await listCloudChars();
            if (!cloudChars || cloudChars.length === 0) {
                addToast('云端还没有回忆', 'info');
                setSyncing(false);
                return;
            }
            let totalPulled = 0;
            for (const cc of cloudChars) {
                const cloudCharId = cc.charId;
                const contentCharId = await DB.resolveCharacterContentId(cloudCharId);
                const isLocal = localIdentityIds.has(cloudCharId) || contentCharId !== cloudCharId;
                if (!isLocal) continue;

                const cloudMems = await pullMemories(cloudCharId);
                if (!cloudMems || cloudMems.length === 0) continue;
                for (const mem of cloudMems) {
                    const existing = await DB.getVectorMemoryById(mem.id);
                    if (!existing) {
                        await DB.saveVectorMemory(mem);
                        totalPulled++;
                    }
                }
            }
            setSyncResult({ pushed: 0, pulled: totalPulled });
            if (totalPulled === 0) addToast('云端回忆均已同步', 'info');
            else addToast(`已唤回 ${totalPulled} 段云端回忆`, 'success');
        } catch (e: any) { addToast(`唤回失败: ${e.message}`, 'error'); }
        finally { setSyncing(false); }
    }, [addToast, characters]);

    const claimCloudCharacter = useCallback(async (
        cloudCharId: string,
        targetChar: CharacterProfile | null,
    ): Promise<boolean> => {
        const legacyCharId = cloudCharId.trim();
        if (!legacyCharId) return false;
        if (!targetChar) {
            addToast('先选中要接收回忆的角色', 'info');
            return false;
        }

        const targetContentId = targetChar.id;
        setClaimingCloudCharId(legacyCharId);
        try {
            const cloudResult = await migrateCloudCharacterInstance(legacyCharId, targetContentId);
            if (!cloudResult?.ok) throw new Error('云端迁移没有完成');

            const localResult = await DB.migrateLocalCharacterContentToInstance(legacyCharId, targetContentId);
            const cloudMems = await pullMemories(targetContentId, { includeDeprecated: true, vectors: true });
            let pulled = 0;
            if (cloudMems) {
                for (const memory of cloudMems) {
                    await DB.saveVectorMemory({ ...memory, charId: targetContentId });
                    pulled++;
                }
            }

            const movedCount = Number(cloudResult.counts?.memories || localResult.vectorMemories || pulled || 0);
            setSelectedCharId(targetChar.id);
            setBrowserMemories(null);
            setSyncResult({ pushed: 0, pulled: movedCount });
            await fetchStats();
            addToast(`已把 ${movedCount} 段云端回忆归档到 ${targetChar.name}`, 'success');
            haptic.medium();
            return true;
        } catch (e: any) {
            addToast(`绑定失败: ${e.message}`, 'error');
            return false;
        } finally {
            setClaimingCloudCharId(null);
        }
    }, [addToast, fetchStats]);

    const openClaimDrawer = useCallback((cloudCharId: string) => {
        setClaimDrawerCharId(cloudCharId);
        setClaimTargetCharId(selectedBrowserChar?.id || null);
        fetchOrphanPreview(cloudCharId, { retry: true });
        haptic.light();
    }, [fetchOrphanPreview, selectedBrowserChar]);

    const closeClaimDrawer = useCallback(() => {
        setClaimDrawerCharId(null);
        setClaimTargetCharId(null);
        haptic.light();
    }, []);

    const confirmClaimDrawer = useCallback(async () => {
        if (!activeClaimStat) return;
        const migrated = await claimCloudCharacter(activeClaimStat.charId, claimTargetChar);
        if (migrated) {
            setClaimDrawerCharId(null);
            setClaimTargetCharId(null);
        }
    }, [activeClaimStat, claimCloudCharacter, claimTargetChar]);

    const handleBindSyncCode = useCallback(() => {
        const nextId = bindInput.trim();
        const currentId = getUserId().trim();
        if (!nextId) {
            addToast('请输入同步码', 'info');
            return;
        }
        if (nextId.toLowerCase() === currentId.toLowerCase()) {
            addToast('这已经是你的账号了', 'info');
            setBindInput('');
            setSyncCodeVisible(false);
            haptic.light();
            return;
        }
        setUserId(nextId, { source: 'manual' });
        setSyncUserId(nextId);
        setBindInput('');
        setSyncCodeVisible(false);
        setSyncResult(null);
        addToast('已登记这枚印记，点击「签收回忆」唤回云端回忆', 'success');
        haptic.medium();
    }, [addToast, bindInput]);

    const activeDraftRecord = useMemo(
        () => activeDraftRecordId ? memoryRecords.find(record => record.id === activeDraftRecordId) || null : null,
        [activeDraftRecordId, memoryRecords]
    );

    const upsertMemoryRecord = useCallback((record: MemoryRecord) => {
        setMemoryRecords(prev => {
            const next = [record, ...prev.filter(item => item.id !== record.id)];
            return next.sort((a, b) => b.createdAt - a.createdAt);
        });
    }, []);

    const loadMemoryRecords = useCallback(async () => {
        if (!selectedCharId) {
            setMemoryRecords([]);
            return;
        }

        try {
            const records = await DB.getMemoryRecords(selectedCharId);
            setMemoryRecords(records);
        } catch (e: any) {
            addToast(`唱片载入失败: ${e.message}`, 'error');
        }
    }, [addToast, selectedCharId]);

    useEffect(() => {
        if (activeTab === 'browser') {
            loadMemoryRecords();
        }
    }, [activeTab, loadMemoryRecords]);

    const loadRecordIntoLyricsEditor = useCallback((record: MemoryRecord, status: MemoryRecordFlowStatus = 'lyrics_ready') => {
        setActiveDraftRecordId(record.id);
        setLyricsDraft({
            title: record.title,
            lyrics: record.lyrics,
            stylePrompt: record.stylePrompt || record.musicPrompt || '',
            negativeStylePrompt: record.negativeStylePrompt || '',
            revisionInstruction: '',
            lyricistReference: '',
        });
        setRecordSongRequest({
            ...createEmptySongRequest(),
            ...(record.songRequest || {}),
        });
        setSingabilityResult(record.singabilityCheck ? {
            score: record.singabilityCheck.score,
            summary: record.singabilityCheck.summary,
            shouldOptimize: record.singabilityCheck.should_optimize,
            issues: record.singabilityCheck.issues,
        } : null);
        if (record.musicDirectorNotes && (record.stylePrompt || record.musicPrompt)) {
            setStylePromptResult({
                musicDirectorNotes: record.musicDirectorNotes || {
                    song_type: '', emotional_core: '', vocal_character: '', dynamic_curve: '',
                    arrangement_strategy: '', chorus_strategy: '', bridge_strategy: '',
                    final_chorus_strategy: '', outro_strategy: '', avoid: [],
                },
                stylePrompt: record.stylePrompt || record.musicPrompt || '',
                negativeStylePrompt: record.negativeStylePrompt || '',
            });
        } else {
            setStylePromptResult(null);
        }
        setShowOptimizedLyrics(false);
        setRecordFlowError(record.error || '');
        setRecordFlowStatus(status);
    }, []);

    useEffect(() => {
        if (!selectedCharId) {
            setActiveDraftRecordId(null);
            setLyricsDraft(createEmptyLyricsDraft());
            setRecordSongRequest(createEmptySongRequest());
            setRecordFlowStatus('idle');
            setRecordFlowError('');
            return;
        }

        const active = activeDraftRecordId ? memoryRecords.find(record => record.id === activeDraftRecordId) : null;
        if (active?.charId === selectedCharId) return;

        const latestDraft = memoryRecords.find(record =>
            record.charId === selectedCharId
            && record.status === 'draft'
            && !record.musicAudioId
        );

        if (latestDraft) {
            loadRecordIntoLyricsEditor(latestDraft);
        } else {
            setActiveDraftRecordId(null);
            setLyricsDraft(createEmptyLyricsDraft());
            setRecordSongRequest(createEmptySongRequest());
            setRecordFlowStatus('idle');
            setRecordFlowError('');
        }
    }, [activeDraftRecordId, loadRecordIntoLyricsEditor, memoryRecords, selectedCharId]);

    useEffect(() => {
        setSelectedRecordMemoryIds([]);
        setRecordMemoryOptions([]);
        setRecordMemoryOptionsError('');
    }, [selectedCharId, recordMode]);

    useEffect(() => {
        if (recordMode !== 'selected_memory' || !selectedCharId) {
            setRecordMemoryOptionsLoading(false);
            return;
        }

        let alive = true;
        setRecordMemoryOptionsLoading(true);
        setRecordMemoryOptionsError('');

        DB.getVectorMemoryHeaders(selectedCharId)
            .then((headers) => {
                if (!alive) return;
                const options = headers
                    .filter((memory) => !memory.deprecated)
                    .sort((a, b) => (b.lastMentioned || b.createdAt || 0) - (a.lastMentioned || a.createdAt || 0));
                setRecordMemoryOptions(options);
            })
            .catch((error: any) => {
                if (!alive) return;
                setRecordMemoryOptions([]);
                setRecordMemoryOptionsError(error?.message || '读取记忆失败');
            })
            .finally(() => {
                if (alive) setRecordMemoryOptionsLoading(false);
            });

        return () => {
            alive = false;
        };
    }, [recordMode, selectedCharId]);

    const toggleRecordMemorySeed = useCallback((memoryId: string) => {
        setSelectedRecordMemoryIds(prev => {
            if (prev.includes(memoryId)) return prev.filter(id => id !== memoryId);
            return [...prev, memoryId].slice(0, 8);
        });
        haptic.light();
    }, []);

    const playMemoryRecord = useCallback((record: MemoryRecord) => {
        if (!hasPlayableMemoryRecordAudio(record)) {
            addToast(record.monologueAudioId ? '独白已经生成，歌曲分轨还没回来，先重压一次' : '这张还停在内页里，先重压一次再听', 'info');
            return;
        }

        const playable = memoryRecordToPlayable(record);
        void playSong(playable, [playable]);
        addToast('已放进 Emo Cloud', 'success');
    }, [addToast, playSong]);

    const stopMonologuePreview = useCallback(() => {
        if (monologuePreviewRef.current) {
            monologuePreviewRef.current.pause();
            monologuePreviewRef.current = null;
        }
        if (monologuePreviewUrlRef.current) {
            URL.revokeObjectURL(monologuePreviewUrlRef.current);
            monologuePreviewUrlRef.current = null;
        }
    }, []);

    useEffect(() => stopMonologuePreview, [stopMonologuePreview]);

    const previewMemoryRecordMonologue = useCallback(async (record: MemoryRecord) => {
        if (!shouldGenerateMemoryRecordMonologue(record.mode) || !record.monologueAudioId) {
            addToast('这张没有可试听的独白分轨', 'info');
            return;
        }

        try {
            stopMonologuePreview();
            const blob = await DB.getMemoryRecordAudio(record.monologueAudioId);
            if (!blob) throw new Error('独白音频不在本机了');

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            monologuePreviewRef.current = audio;
            monologuePreviewUrlRef.current = url;
            audio.onended = stopMonologuePreview;
            audio.onerror = stopMonologuePreview;
            await audio.play();
            addToast('正在试听独白', 'success');
        } catch (e: any) {
            stopMonologuePreview();
            addToast(`独白试听失败: ${e.message}`, 'error');
        }
    }, [addToast, stopMonologuePreview]);

    const persistMemoryRecord = useCallback(async (record: MemoryRecord): Promise<MemoryRecord> => {
        await DB.saveMemoryRecord(record);
        upsertMemoryRecord(record);
        return record;
    }, [upsertMemoryRecord]);

    const saveActiveLyricsSnapshot = useCallback(async (): Promise<MemoryRecord> => {
        if (!activeDraftRecord) {
            throw new Error('还没有可确认的歌词草稿');
        }

        const next: MemoryRecord = {
            ...activeDraftRecord,
            title: lyricsDraft.title.trim(),
            lyrics: lyricsDraft.lyrics.trim(),
            musicPrompt: lyricsDraft.stylePrompt.trim() || activeDraftRecord.musicPrompt,
            stylePrompt: lyricsDraft.stylePrompt.trim() || undefined,
            negativeStylePrompt: lyricsDraft.negativeStylePrompt.trim() || undefined,
            songRequest: normalizeSongRequest(recordSongRequest),
            updatedAt: Date.now(),
        };
        return persistMemoryRecord(next);
    }, [activeDraftRecord, lyricsDraft.lyrics, lyricsDraft.stylePrompt, lyricsDraft.negativeStylePrompt, lyricsDraft.title, persistMemoryRecord, recordSongRequest]);

    const handleLyricsFieldChange = useCallback((field: keyof Pick<LyricsEditorDraft, 'title' | 'stylePrompt' | 'negativeStylePrompt' | 'lyrics' | 'revisionInstruction' | 'lyricistReference'>, value: string) => {
        setLyricsDraft(prev => ({ ...prev, [field]: value }));

        if (!activeDraftRecord || field === 'revisionInstruction' || field === 'lyricistReference') return;

        const patch: Partial<MemoryRecord> =
            field === 'title'
                ? { title: value }
                : field === 'stylePrompt'
                    ? { musicPrompt: value, stylePrompt: value }
                    : field === 'negativeStylePrompt'
                        ? { negativeStylePrompt: value }
                        : { lyrics: value };
        const next: MemoryRecord = {
            ...activeDraftRecord,
            ...patch,
            songRequest: normalizeSongRequest(recordSongRequest),
            updatedAt: Date.now(),
        };
        upsertMemoryRecord(next);
        void DB.saveMemoryRecord(next).catch((e: any) => {
            addToast(`歌词草稿保存失败: ${e.message}`, 'error');
        });
    }, [activeDraftRecord, addToast, recordSongRequest, upsertMemoryRecord]);

    const handleSongRequestChange = useCallback((field: keyof MemoryRecordSongRequest, value: string) => {
        setRecordSongRequest(prev => {
            const nextRequest = { ...prev, [field]: value };
            if (activeDraftRecord) {
                const nextRecord: MemoryRecord = {
                    ...activeDraftRecord,
                    songRequest: normalizeSongRequest(nextRequest),
                    updatedAt: Date.now(),
                };
                upsertMemoryRecord(nextRecord);
                void DB.saveMemoryRecord(nextRecord).catch((e: any) => {
                    addToast(`写歌需求保存失败: ${e.message}`, 'error');
                });
            }
            return nextRequest;
        });
    }, [activeDraftRecord, addToast, upsertMemoryRecord]);

    const removeGeneratedMusicArtifacts = useCallback(async (record: MemoryRecord): Promise<void> => {
        const ids = [record.musicAudioId, record.masterAudioId].filter((id): id is string => Boolean(id));
        await Promise.all(ids.map(id => DB.deleteMemoryRecordAudio(id)));
    }, []);

    // ── 阶段 1: 只生成歌词（不含 style_prompt）──
    const handleCreateMemoryRecord = useCallback(async () => {
        if (!selectedCharId || !selectedBrowserChar) {
            addToast('先选一个人，唱片匣才知道要为谁落针', 'info');
            return;
        }
        if (!recordSongRequest.theme.trim()) {
            addToast('先写一个歌曲主题，歌词才知道从哪里落笔', 'info');
            return;
        }
        if (recordMode === 'selected_memory' && selectedRecordMemoryIds.length === 0) {
            addToast('亲手封存要先挑至少一段记忆', 'info');
            return;
        }

        setRecordGenerating(true);
        setRecordFlowStatus('generating_lyrics');
        setRecordFlowError('');
        setRecordStatusText('正在生成歌词...');
        setSingabilityResult(null);
        setStylePromptResult(null);
        setShowOptimizedLyrics(false);

        try {
            const memoryHeaders = await DB.getVectorMemoryHeaders(selectedCharId);
            const result = await generateLyrics({
                char: selectedBrowserChar,
                userProfile,
                mode: recordMode,
                memories: memoryHeaders,
                apiConfig,
                selectedMemoryIds: recordMode === 'selected_memory' ? selectedRecordMemoryIds : undefined,
                inspirationReference: recordReference,
                songRequest: normalizeSongRequest(recordSongRequest),
                contextBudget: 'expanded',
            });

            const now = Date.now();
            const recordId = createRecordId();
            const draft: MemoryRecord = {
                id: recordId,
                charId: selectedBrowserChar.id,
                charName: selectedBrowserChar.name,
                userName: userProfile.name || '你',
                mode: recordMode,
                status: 'draft',
                title: result.title,
                albumName: '回忆唱片匣',
                artistName: selectedBrowserChar.name,
                monologueText: '',
                lyrics: result.lyrics,
                musicPrompt: '',
                lyricIntent: result.lyricIntent,
                songRequest: normalizeSongRequest(recordSongRequest),
                inspirationReference: recordReference?.trim() || undefined,
                coverGradient: COVER_GRADIENTS[Math.floor(Math.random() * COVER_GRADIENTS.length)],
                seedMemoryIds: [],
                selectedMemoryIds: recordMode === 'selected_memory' ? selectedRecordMemoryIds?.slice() : undefined,
                createdAt: now,
                updatedAt: now,
            };

            await DB.saveMemoryRecord(draft);
            upsertMemoryRecord(draft);
            setLyricsDraft({
                title: result.title,
                lyrics: result.lyrics,
                stylePrompt: '',
                negativeStylePrompt: '',
                revisionInstruction: '',
                lyricistReference: '',
            });
            setActiveDraftRecordId(recordId);
            setRecordFlowStatus('lyrics_ready');
            addToast('歌词已生成，可以查看可唱性评分', 'success');
        } catch (e: any) {
            setRecordFlowStatus('error');
            setRecordFlowError(e.message);
            addToast(`歌词生成失败: ${e.message}`, 'error');
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [addToast, apiConfig, recordMode, recordReference, recordSongRequest, selectedBrowserChar, selectedCharId, selectedRecordMemoryIds, upsertMemoryRecord, userProfile]);

    // ── 阶段 2: 可唱性自检 ──
    const handleCheckSingability = useCallback(async () => {
        if (!activeDraftRecord || !lyricsDraft.lyrics.trim()) {
            addToast('先生成歌词再检查可唱性', 'info');
            return;
        }

        setRecordGenerating(true);
        setRecordFlowStatus('checking_singability');
        setRecordFlowError('');
        setRecordStatusText('正在检查歌词可唱性...');

        try {
            const result = await checkLyricSingability(
                lyricsDraft.title || activeDraftRecord.title,
                lyricsDraft.lyrics,
                apiConfig,
            );
            setSingabilityResult(result);
            setRecordFlowStatus('singability_checked');

            // Persist to record
            const updated: MemoryRecord = {
                ...activeDraftRecord,
                singabilityCheck: {
                    score: result.score,
                    summary: result.summary,
                    should_optimize: result.shouldOptimize,
                    issues: result.issues,
                },
                updatedAt: Date.now(),
            };
            await persistMemoryRecord(updated);

            if (result.shouldOptimize) {
                addToast(`可唱性评分 ${result.score}/100 — 建议优化歌词`, 'info');
            } else {
                addToast(`可唱性评分 ${result.score}/100 — 歌词结构良好`, 'success');
            }
        } catch (e: any) {
            setRecordFlowError(e.message);
            addToast(`可唱性检查失败: ${e.message}`, 'error');
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [activeDraftRecord, addToast, apiConfig, lyricsDraft.lyrics, lyricsDraft.title, persistMemoryRecord]);

    // ── 阶段 3: 歌词优化（用户可选）──
    const handleOptimizeLyrics = useCallback(async () => {
        if (!activeDraftRecord || !lyricsDraft.lyrics.trim()) {
            addToast('先生成歌词再优化', 'info');
            return;
        }

        setRecordGenerating(true);
        setRecordFlowStatus('optimizing_lyrics');
        setRecordFlowError('');
        setRecordStatusText('正在优化歌词可唱性...');

        try {
            const current = await saveActiveLyricsSnapshot();
            const result = await optimizeLyrics(
                lyricsDraft.title || current.title,
                lyricsDraft.lyrics,
                apiConfig,
                {
                    singabilityReport: singabilityResult,
                    userInstruction: lyricsDraft.revisionInstruction,
                    songRequest: normalizeSongRequest(recordSongRequest),
                    lyricistReference: lyricsDraft.lyricistReference,
                },
            );

            // Save optimized version alongside original
            setLyricsDraft(prev => ({
                ...prev,
                optimizedTitle: result.title,
                optimizedLyrics: result.lyrics,
                optimizationNotes: result.optimizationNotes,
            }));
            setShowOptimizedLyrics(true);
            setRecordFlowStatus('lyrics_optimized');

            // Persist optimization notes
            const updated: MemoryRecord = {
                ...current,
                optimizationNotes: result.optimizationNotes,
                updatedAt: Date.now(),
            };
            await persistMemoryRecord(updated);

            addToast('歌词已优化，可以对比原版和优化版', 'success');
        } catch (e: any) {
            setRecordFlowError(e.message);
            addToast(`歌词优化失败: ${e.message}`, 'error');
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [activeDraftRecord, addToast, apiConfig, lyricsDraft, persistMemoryRecord, recordSongRequest, saveActiveLyricsSnapshot, singabilityResult]);

    // ── 用户选择采用优化版或原版 ──
    const handleAdoptOptimizedLyrics = useCallback(() => {
        if (!lyricsDraft.optimizedLyrics) return;
        setLyricsDraft(prev => ({
            ...prev,
            title: prev.optimizedTitle || prev.title,
            lyrics: prev.optimizedLyrics || prev.lyrics,
            optimizedLyrics: undefined,
            optimizedTitle: undefined,
            revisionInstruction: '',
        }));
        setShowOptimizedLyrics(false);
        setRecordFlowStatus('lyrics_ready');
        addToast('已采用优化版歌词', 'success');
    }, [addToast, lyricsDraft.optimizedLyrics, lyricsDraft.optimizedTitle]);

    const handleKeepOriginalLyrics = useCallback(() => {
        setShowOptimizedLyrics(false);
        setRecordFlowStatus('lyrics_ready');
    }, []);

    // ── 确认歌词定稿（不生成歌曲，只标记定稿）──
    const handleConfirmLyricsFinal = useCallback(async () => {
        if (!activeDraftRecord) {
            addToast('先生成歌词草稿', 'info');
            return;
        }
        if (!lyricsDraft.title.trim() || !lyricsDraft.lyrics.trim()) {
            addToast('歌名和歌词都不能为空', 'info');
            return;
        }

        try {
            const current = await saveActiveLyricsSnapshot();
            const confirmed: MemoryRecord = {
                ...current,
                lyricsConfirmedAt: Date.now(),
                updatedAt: Date.now(),
            };
            await persistMemoryRecord(confirmed);
            setRecordFlowStatus('lyrics_confirmed');
            addToast('歌词已定稿，现在可以生成曲风提示词', 'success');
        } catch (e: any) {
            setRecordFlowError(e.message);
            addToast(`保存失败: ${e.message}`, 'error');
        }
    }, [activeDraftRecord, addToast, lyricsDraft.lyrics, lyricsDraft.title, persistMemoryRecord, saveActiveLyricsSnapshot]);

    // ── 阶段 4: 生成曲风提示词 ──
    const handleGenerateStylePrompt = useCallback(async () => {
        if (!activeDraftRecord || !lyricsDraft.lyrics.trim()) {
            addToast('先确认歌词定稿', 'info');
            return;
        }

        setRecordGenerating(true);
        setRecordFlowStatus('generating_style');
        setRecordFlowError('');
        setRecordStatusText('正在根据定稿歌词生成曲风方案...');

        try {
            const current = await saveActiveLyricsSnapshot();
            const result = await generateStylePrompt(
                lyricsDraft.lyrics,
                lyricsDraft.title || current.title,
                apiConfig,
                {
                    lyricIntent: current.lyricIntent,
                    songRequest: normalizeSongRequest(recordSongRequest),
                },
            );

            setStylePromptResult(result);
            setLyricsDraft(prev => ({
                ...prev,
                stylePrompt: result.stylePrompt,
                negativeStylePrompt: result.negativeStylePrompt,
            }));
            setRecordFlowStatus('style_ready');

            // Persist
            const updated: MemoryRecord = {
                ...current,
                stylePrompt: result.stylePrompt,
                negativeStylePrompt: result.negativeStylePrompt,
                musicPrompt: result.stylePrompt,
                musicDirectorNotes: result.musicDirectorNotes,
                updatedAt: Date.now(),
            };
            await persistMemoryRecord(updated);

            addToast('曲风提示词已生成，你可以继续调整', 'success');
        } catch (e: any) {
            setRecordFlowError(e.message);
            addToast(`曲风生成失败: ${e.message}`, 'error');
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [activeDraftRecord, addToast, apiConfig, lyricsDraft.lyrics, lyricsDraft.title, persistMemoryRecord, recordSongRequest, saveActiveLyricsSnapshot]);

    const handleConfirmLyricsAndGenerateSong = useCallback(async () => {
        if (!selectedBrowserChar) return;
        if (!activeDraftRecord) {
            addToast('先生成并确认歌词草稿', 'info');
            return;
        }
        if (!lyricsDraft.title.trim() || !lyricsDraft.lyrics.trim()) {
            addToast('歌名和歌词都不能为空', 'info');
            return;
        }
        if (!lyricsDraft.stylePrompt.trim()) {
            addToast('请先生成曲风提示词', 'info');
            return;
        }

        setRecordGenerating(true);
        setRecordFlowStatus('lyrics_confirmed');
        setRecordFlowError('');
        setRecordStatusText('词已定稿，正在准备谱曲...');

        try {
            const current = await saveActiveLyricsSnapshot();
            await removeGeneratedMusicArtifacts(current);
            const confirmed: MemoryRecord = {
                ...current,
                status: 'draft',
                lyricsConfirmedAt: Date.now(),
                musicAudioId: undefined,
                masterAudioId: undefined,
                model: undefined,
                fallbackUsed: undefined,
                durationMs: undefined,
                error: undefined,
                updatedAt: Date.now(),
            };
            await persistMemoryRecord(confirmed);

            setRecordFlowStatus('generating_song');
            setRecordStatusText('正在把定稿歌词送去谱曲...');
            const finalRecord = await produceMemoryRecordAudio({
                record: confirmed,
                char: selectedBrowserChar,
                ttsConfig,
                onRecordUpdate: (next) => {
                    upsertMemoryRecord(next);
                    setRecordStatusText(MEMORY_RECORD_STATUS_LABELS[next.status] || next.status);
                },
            });

            upsertMemoryRecord(finalRecord);
            loadRecordIntoLyricsEditor(finalRecord, finalRecord.status === 'ready' ? 'song_ready' : 'error');
            if (finalRecord.status === 'ready') {
                addToast('这张唱片已经压好', 'success');
                playMemoryRecord(finalRecord);
            } else if (finalRecord.error) {
                setRecordFlowError(finalRecord.error);
                addToast(`生成歌曲失败: ${finalRecord.error}`, 'error');
            } else {
                addToast('这张还没压完，内页和分轨都替你留着', 'info');
            }
        } catch (e: any) {
            setRecordFlowStatus('error');
            setRecordFlowError(e.message);
            addToast(`生成歌曲失败: ${e.message}`, 'error');
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [activeDraftRecord, addToast, loadRecordIntoLyricsEditor, lyricsDraft.lyrics, lyricsDraft.stylePrompt, lyricsDraft.title, persistMemoryRecord, playMemoryRecord, removeGeneratedMusicArtifacts, saveActiveLyricsSnapshot, selectedBrowserChar, ttsConfig, upsertMemoryRecord]);

    const handleReturnToLyrics = useCallback(() => {
        if (!activeDraftRecord) return;
        setRecordFlowStatus('lyrics_ready');
        setRecordFlowError(activeDraftRecord.error || '');
        setRecordStatusText('');
    }, [activeDraftRecord]);

    const handleRetryMemoryRecord = useCallback(async (record: MemoryRecord) => {
        if (!selectedBrowserChar) return;

        setRecordGenerating(true);
        setRecordStatusText('正在重新落针...');
        try {
            const next = await produceMemoryRecordAudio({
                record,
                char: selectedBrowserChar,
                ttsConfig,
                forceRemaster: true,
                onRecordUpdate: (updated) => {
                    upsertMemoryRecord(updated);
                    setRecordStatusText(MEMORY_RECORD_STATUS_LABELS[updated.status] || updated.status);
                },
            });

            upsertMemoryRecord(next);
            if (next.status === 'ready') {
                addToast('重新压好了', 'success');
                playMemoryRecord(next);
            } else if (next.error) {
                addToast(`重压失败: ${next.error}`, 'error');
            } else {
                addToast('这次还没压完，内页和分轨还在', 'info');
            }
        } finally {
            setRecordGenerating(false);
            setRecordStatusText('');
        }
    }, [addToast, playMemoryRecord, selectedBrowserChar, ttsConfig, upsertMemoryRecord]);

    const handleDeleteMemoryRecord = useCallback(async (record: MemoryRecord) => {
        const confirmed = window.confirm(`删除《${record.title}》？歌词、独白和音频都会从本机移除。`);
        if (!confirmed) return;

        try {
            await DB.deleteMemoryRecord(record.id);
            setMemoryRecords(prev => prev.filter(item => item.id !== record.id));
            addToast('唱片已删除', 'success');
            haptic.medium();
        } catch (e: any) {
            addToast(`删除失败: ${e.message}`, 'error');
        }
    }, [addToast]);

    const openMemoryRecordShare = useCallback((record: MemoryRecord) => {
        if (!hasPlayableMemoryRecordAudio(record)) {
            addToast('这首歌还没有可分享的音频', 'info');
            return;
        }

        setShareModalPlayable(memoryRecordToPlayable(record));
        haptic.light();
    }, [addToast]);

    const handleShareMemoryRecordPoster = useCallback(async (playable: MemoryRecordPlayable) => {
        setIsSharingMemoryRecord(true);
        try {
            const result = await shareMemoryRecordPoster(playable);
            setShareModalPlayable(null);
            addToast(result.method === 'download' ? '分享海报已下载' : '已打开系统分享', 'success');
        } catch (e: any) {
            addToast(e?.message || '分享失败', 'error');
        } finally {
            setIsSharingMemoryRecord(false);
        }
    }, [addToast]);

    const copyMemoryRecordError = useCallback((record: MemoryRecord) => {
        const errorText = [
            `曲目: ${record.title}`,
            `状态: ${MEMORY_RECORD_STATUS_LABELS[record.status] || record.status}`,
            `模式: ${MEMORY_RECORD_MODE_COPY[record.mode].label}`,
            record.model ? `模型: ${record.model}${record.fallbackUsed ? ' (fallback)' : ''}` : '',
            '',
            record.error || '无错误详情',
        ].filter(Boolean).join('\n');

        try {
            navigator.clipboard.writeText(errorText);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = errorText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }

        addToast('错误详情已复制', 'success');
    }, [addToast]);

    /* ─── Render ─── */

    return (
        <div className="fixed inset-0 flex flex-col bg-[#F8F3ED] text-[#6B5E50] overflow-hidden font-sans selection:bg-[#8B7355]/20 selection:text-[#5C4F40]">

            {/* ── Floating Menu Button (when sidebar closed) ── */}
            {!sidebarOpen && (
                <button
                    aria-label="打开认知网络菜单"
                    onClick={() => { setSidebarOpen(true); haptic.light(); }}
                    className="fixed top-[max(0.6rem,calc(env(safe-area-inset-top)+0.25rem))] left-3 z-40 flex h-6 w-6 items-center justify-center text-[#e5d08f]/80 transition-transform active:scale-95"
                >
                    <span className="relative flex h-[18px] w-[18px] rotate-[-8deg] items-center justify-center rounded-[6px] border border-[#e5d08f]/36 bg-[#0d0c11]/18 shadow-[0_0_8px_rgba(229,208,143,0.10),0_1px_0_rgba(255,255,255,0.08)_inset] backdrop-blur-[2px]">
                        <span className="absolute inset-[3px] rounded-[4px] border border-[#e5d08f]/16" />
                        <span className="absolute h-px w-2 bg-gradient-to-r from-transparent via-[#fff1bd]/58 to-transparent" />
                        <span className="absolute h-2 w-px bg-gradient-to-b from-transparent via-[#fff1bd]/42 to-transparent" />
                        <span className="h-[4px] w-[4px] rounded-full border border-[#fff1bd]/58 bg-[#fff7dc]/26 shadow-[0_0_6px_rgba(255,241,189,0.28)]" />
                    </span>
                </button>
            )}

            {/* ── Sidebar Overlay (when open) ── */}
            {sidebarOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/45 backdrop-blur-[3px] z-40 transition-opacity"
                        onClick={() => { setSidebarOpen(false); haptic.light(); }}
                    />

                    {/* Drawer */}
                    <div className="fixed top-0 left-0 bottom-0 w-64 z-50 flex flex-col overflow-hidden bg-[#101621]/96 backdrop-blur-2xl border-r border-[#d7b56c]/22 shadow-[14px_0_44px_rgba(0,0,0,0.34)]" style={{ animation: 'slideInLeft 250ms ease-out' }}>
                        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,232,163,0.08),transparent_38%,rgba(255,255,255,0.03))]" />
                        <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,232,163,0.72)_1px,transparent_0)] [background-size:18px_18px]" />

                        {/* Header */}
                        <div className="relative z-10 flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl border border-[#d7b56c]/38 bg-[#172235] shadow-[0_8px_18px_rgba(0,0,0,0.24)] flex items-center justify-center">
                                    <span className="text-[#ffe8a3] text-[11px] font-serif italic">N</span>
                                </div>
                                <div>
                                    <h2 className="text-[#ffe8a3] font-bold text-[15px] tracking-widest font-serif">认知网络</h2>
                                    <p className="mt-0.5 text-[8px] font-semibold tracking-[0.22em] text-[#d7b56c]/42">MEMORY INDEX</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setSidebarOpen(false); haptic.light(); }}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-[#d7b56c]/58 hover:bg-white/[0.06] hover:text-[#ffe8a3] transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[16px] h-[16px]">
                                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                                </svg>
                            </button>
                        </div>

                        {/* Nav Items */}
                        <nav className="relative z-10 flex flex-col gap-1 px-3 mt-2">
                    {([
                        { id: 'home' as const, label: '认知全览', iconPath: 'M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z' },
                        { id: 'browser' as const, label: '回忆唱片匣', iconPath: 'M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Zm2.25-.75a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75H4.25ZM5 16.5a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H5Z' },
                        { id: 'workshop' as const, label: '拾念', iconPath: 'M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z' },
                        { id: 'sync' as const, label: '漫游备份', iconPath: 'M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-2.234a8.865 8.865 0 0 1-1.087-.215c-1.922-.25-3.291-1.86-3.405-3.727a46.606 46.606 0 0 1 0-8.862c.114-1.866 1.483-3.477 3.405-3.727ZM14.75 7.5c-1.946 0-3.87.078-5.77.226-1.46.122-2.48 1.362-2.48 2.682v4.286c0 1.32 1.02 2.56 2.48 2.682a48.93 48.93 0 0 0 5.77.226c1.946 0 3.87-.078 5.77-.226 1.46-.122 2.48-1.362 2.48-2.682v-4.286c0-1.32-1.02-2.56-2.48-2.682A48.574 48.574 0 0 0 14.75 7.5Z' },
                    ]).map(item => (
                        <button
                            key={item.id}
                            onClick={() => { setActiveTab(item.id); setSidebarOpen(false); haptic.medium(); }}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all relative overflow-hidden group
                                ${activeTab === item.id ? 'text-[#ffe8a3] bg-[#172235]/92 shadow-[0_10px_22px_rgba(0,0,0,0.22)] ring-1 ring-[#d7b56c]/20' : 'text-[#d7b56c]/48 hover:bg-white/[0.055] hover:text-[#f2e6c6]/86'}
                            `}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-[18px] h-[18px] shrink-0 transition-transform ${activeTab === item.id ? 'scale-110 drop-shadow-sm' : 'opacity-80 group-hover:scale-105'}`}>
                                <path fillRule="evenodd" d={item.iconPath} clipRule="evenodd" />
                            </svg>
                            <span className="text-[13px] font-medium tracking-wide truncate">{item.label}</span>
                            {activeTab === item.id && <div className="absolute right-0 w-1 h-5 bg-[#d7b56c]/54 rounded-l-full" />}
                        </button>
                    ))}
                        </nav>

                        <div className="flex-1" />

                        {/* Exit Button */}
                        <button
                            onClick={() => { haptic.light(); closeApp(); }}
                            className="relative z-10 flex items-center gap-3 mx-3 mb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-2xl px-4 py-3 text-[#d7b56c]/46 hover:bg-[#5f2b3a]/22 hover:text-[#ffd7df] transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px] shrink-0 opacity-80">
                                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                                <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
                            </svg>
                            <span className="text-[12px] font-medium tracking-wide">退出系统</span>
                        </button>
                    </div>
                </>
            )}

            {/* ── Main Content Area ── */}
            <div className="flex-1 overflow-hidden relative flex flex-col min-w-0">

                {/* ── HOME TAB ── */}
                {activeTab === 'home' && (
                    <div className="flex-1 overflow-y-auto no-scrollbar relative" style={{ background: 'radial-gradient(circle at 18% -8%, rgba(216,163,184,0.18) 0%, transparent 34%), radial-gradient(circle at 88% 16%, rgba(181,154,116,0.14) 0%, transparent 32%), linear-gradient(180deg, #0D0C11 0%, #141116 52%, #0F0E13 100%)' }}>
                        <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                            <img src="/images/bg-dusk.png" alt="" className="absolute inset-x-0 top-0 w-full h-64 object-cover opacity-[0.14]" />
                            <img src="/images/paper-texture.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.05]" />
                            <img src="/images/collage/flower-cosmos.png" alt="" className="absolute -left-16 top-36 w-56 opacity-[0.08]" style={{ filter: 'invert(1) brightness(1.6)', transform: 'rotate(-18deg)' }} />
                            <img src="/images/decorations/postmark3.png" alt="" className="absolute right-4 top-24 w-24 opacity-[0.08]" style={{ filter: 'invert(1) brightness(1.5)', transform: 'rotate(11deg)' }} />
                            {HOME_MEMORY_MOTES.map((mote, i) => (
                                <motion.span
                                    key={i}
                                    aria-hidden="true"
                                    data-home-memory-mote=""
                                    className={`absolute rounded-full ${shouldCalmHomeMotion ? '' : 'mix-blend-screen'}`}
                                    style={{
                                        left: mote.left,
                                        top: mote.top,
                                        width: mote.size,
                                        height: mote.size,
                                        background: `radial-gradient(circle, rgba(255,255,255,0.96) 0%, ${mote.color} 38%, rgba(212,175,55,0.18) 68%, transparent 100%)`,
                                        opacity: shouldCalmHomeMotion ? mote.opacity * 0.72 : mote.opacity,
                                        boxShadow: shouldCalmHomeMotion
                                            ? `0 0 ${mote.size * 3}px rgba(229,208,143,0.45)`
                                            : `0 0 ${mote.size * 6}px ${mote.color}, 0 0 ${mote.size * 20}px rgba(212,175,55,0.34)`,
                                        willChange: shouldCalmHomeMotion ? 'auto' : 'transform, opacity',
                                        backfaceVisibility: 'hidden',
                                    }}
                                    animate={shouldCalmHomeMotion ? undefined : {
                                        x: [0, mote.x, mote.x * -0.35, 0],
                                        y: [0, mote.y, mote.y * 0.45, 0],
                                        opacity: [mote.opacity * 0.35, mote.opacity, mote.opacity * 0.62, mote.opacity * 0.35],
                                        scale: [1, mote.scale, 0.92, 1],
                                    }}
                                    transition={shouldCalmHomeMotion ? undefined : {
                                        duration: mote.duration,
                                        repeat: Infinity,
                                        delay: mote.delay,
                                        ease: 'easeInOut',
                                    }}
                                />
                            ))}
                        </div>

                        <div className="relative z-10 px-5 pt-16 pb-24 space-y-5">
                            <section className="relative min-h-[218px] overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141217]/90 shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
                                <img
                                    src="/images/akashic-texture.png"
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-[0.34]"
                                    style={{ filter: 'brightness(1.12) contrast(1.16)', objectPosition: '50% 50%' }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#141217]/92 via-[#141217]/72 to-[#141217]/82" />
                                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,251,247,0.08),transparent_42%),radial-gradient(circle_at_78%_18%,rgba(216,163,184,0.16),transparent_34%)]" />
                                <div className="absolute left-0 top-0 h-full w-[42%] bg-[#FFFBF7]/[0.04] border-r border-white/[0.06]" />
                                <div className="absolute top-5 left-5 text-[8px] text-white/25 tracking-[0.28em] font-semibold">MEMORY DOSSIER</div>
                                <div className="absolute top-5 right-5 flex items-center gap-2 text-[8px] text-white/25 tracking-[0.18em]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#D8A3B8]/70 shadow-[0_0_12px_rgba(216,163,184,0.5)]" />
                                    PRIVATE
                                </div>
                                <div className="absolute right-5 bottom-5 h-12 w-[104px] -skew-x-6 overflow-hidden rounded-[6px] border border-[#e5d08f]/16 bg-[#0d0c11]/24 shadow-[0_1px_0_rgba(255,255,255,0.07)_inset,0_0_22px_rgba(212,175,55,0.08)]">
                                    <div className="absolute inset-px rounded-[5px] border border-white/[0.035]" />
                                    <div className="absolute left-3 top-3 h-px w-16 bg-gradient-to-r from-[#fff1bd]/34 via-[#e5d08f]/12 to-transparent" />
                                    <div className="absolute left-3 top-[18px] h-px w-10 bg-gradient-to-r from-[#e5d08f]/20 to-transparent" />
                                    <div className="absolute left-3 bottom-3 flex gap-1">
                                        {[0, 1, 2, 3, 4].map(mark => (
                                            <span key={mark} className="h-2.5 w-px bg-[#e5d08f]/16" />
                                        ))}
                                    </div>
                                    <div className="absolute right-3 top-2 h-7 w-5 bg-[linear-gradient(135deg,rgba(255,241,189,0.18),rgba(255,255,255,0.03)_44%,rgba(0,0,0,0.18))] shadow-[0_0_12px_rgba(229,208,143,0.08)]" />
                                </div>

                                <div className="relative h-full min-h-[218px] flex flex-col justify-end p-5">
                                    <p className="text-[10px] text-white/32 tracking-[0.22em] mb-3" style={{ fontFamily: "Georgia, serif" }}>
                                        {selectedCharId ? `VIEWING / ${charNameMap(selectedCharId)}` : 'VIEWING / ALL'}
                                    </p>
                                    <h1 className="text-[31px] font-bold text-[#FFFBF7] tracking-[0.16em] leading-none" style={{ fontFamily: "'Noto Serif SC', serif" }}>回忆卷宗</h1>
                                    <p className="text-[12px] text-white/60 leading-relaxed mt-4 tracking-[0.08em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                                        不必追问他记不记得，痕迹会自己浮上来。
                                    </p>
                                    <div className="mt-5 flex items-center gap-3 text-[9px] text-white/30 tracking-[0.14em]">
                                        <span className="h-px flex-1 bg-white/[0.08]" />
                                        <span>COGNITIVE ARCHIVE</span>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-2.5">
                                <div className="flex items-center justify-between px-1">
                                    <p className="text-[10px] text-white/46 tracking-[0.22em] font-semibold">观测对象</p>
                                    <p className="text-[9px] text-white/28 tracking-[0.14em]">{characters.length} PROFILES</p>
                                </div>
                                <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                                    <button
                                        onClick={() => { setSelectedCharId(null); haptic.light(); }}
                                        className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-semibold transition-all border ${
                                            !selectedCharId
                                                ? 'bg-[#FFFBF7] text-[#17151B] border-transparent shadow-[0_8px_24px_rgba(255,251,247,0.16)]'
                                                : 'bg-white/[0.05] text-white/38 border-white/[0.07] hover:bg-white/[0.08]'
                                        }`}
                                    >
                                        全部角色
                                    </button>
                                    {characters.map(c => (
                                        <button key={c.id} onClick={() => { setSelectedCharId(c.id); haptic.light(); }}
                                            className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                                                selectedCharId === c.id
                                                    ? 'bg-[#FFFBF7] text-[#17151B] border-transparent shadow-[0_8px_24px_rgba(255,251,247,0.16)]'
                                                    : 'bg-white/[0.05] text-white/42 border-white/[0.07] hover:bg-white/[0.08]'
                                            }`}
                                        >
                                            <img src={c.avatar} alt={c.name} className="w-5 h-5 rounded-full object-cover ring-1 ring-white/20" />
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                                {orphanCloudStats.length > 0 && (
                                    <div className="space-y-2 rounded-[14px] border border-[#e5d08f]/18 bg-[#171419]/76 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-[9px] font-semibold tracking-[0.22em] text-[#e5d08f]/70">待归档回忆</p>
                                                <p className="mt-1 text-[11px] leading-relaxed text-white/46">
                                                    发现 {orphanMemoryTotal} 段还没连到本机角色的云端回忆。
                                                </p>
                                            </div>
                                        </div>
                                        <div className="grid gap-2">
                                            {orphanCloudStats.map((stat, index) => {
                                                const isClaiming = claimingCloudCharId === stat.charId;
                                                const preview = orphanPreviews[stat.charId];
                                                const latestCreatedAt = preview?.memories?.[0]?.createdAt;
                                                return (
                                                    <div key={stat.charId} className="rounded-[10px] border border-white/[0.055] bg-white/[0.035] px-3 py-2.5">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-[11px] font-semibold text-white/72">{getOrphanGroupLabel(index, orphanCloudStats.length)}</p>
                                                                <p className="mt-0.5 text-[12px] font-semibold text-[#fff1bd]">
                                                                    {stat.memories} 段
                                                                    {latestCreatedAt ? ` · 最近 ${formatOrphanPreviewDate(latestCreatedAt)}` : ''}
                                                                </p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                disabled={isClaiming || syncing || !isConnected}
                                                                onClick={() => openClaimDrawer(stat.charId)}
                                                                className="shrink-0 rounded-full border border-[#e5d08f]/22 bg-[#FFFBF7] px-3 py-1.5 text-[10px] font-bold text-[#17151B] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-white/32"
                                                            >
                                                                {isClaiming ? '归档中...' : '整理归属'}
                                                            </button>
                                                        </div>
                                                        <div className="mt-2 space-y-1.5">
                                                            {preview?.loading ? (
                                                                <p className="text-[10px] text-white/36">正在拾取回忆线索...</p>
                                                            ) : preview?.memories.length ? (
                                                                preview.memories.map(memory => (
                                                                    <div key={memory.id || `${stat.charId}-${memory.createdAt || getOrphanPreviewTitle(memory)}`} className="rounded-[8px] border border-white/[0.045] bg-black/12 px-2.5 py-2">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <p className="min-w-0 truncate text-[10px] font-semibold text-white/62">{getOrphanPreviewTitle(memory)}</p>
                                                                            <p className="shrink-0 text-[9px] text-white/28">{formatOrphanPreviewDate(memory.createdAt)}</p>
                                                                        </div>
                                                                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/40">{getOrphanPreviewSnippet(memory)}</p>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="text-[10px] leading-relaxed text-white/36">
                                                                    {preview?.error ? '这组线索暂时没有回来，点整理归属还能继续处理。' : '回忆线索正在回温。'}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </section>

                            <section className="grid grid-cols-2 gap-3">
                                {[
                                    { label: '回忆片段', value: currentStats?.memories ?? '--', unit: '段', note: '被悄悄留下的细节' },
                                    { label: '心意相通', value: currentStats?.relations ?? '--', unit: '处', note: '暗暗互相回应的瞬间' },
                                    { label: '时间丝线', value: currentStats?.temporalEdges ?? '--', unit: '条', note: '相遇被重新串起' },
                                    { label: '系统状态', value: statsFailed ? '暂缺' : loading ? '回温中' : '安静运转', unit: '', note: statsFailed ? '部分数据还没回来' : '他的痕迹正在安静归档', isStatus: true },
                                ].map((stat, i) => (
                                    <div
                                        key={i}
                                        className="relative overflow-hidden rounded-[14px] border border-[#d4af37]/26 bg-[#171419] p-4 shadow-[0_18px_34px_rgba(0,0,0,0.46),0_1px_0_rgba(255,255,255,0.10)_inset,0_-1px_0_rgba(0,0,0,0.78)_inset] transition-transform duration-300 active:scale-[0.985]"
                                        style={{
                                            backgroundImage: [
                                                'linear-gradient(145deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.025) 24%, rgba(0,0,0,0.18) 58%, rgba(212,175,55,0.09) 100%)',
                                                'radial-gradient(circle at 12% 8%, rgba(255,241,189,0.12), transparent 30%)',
                                                'radial-gradient(circle at 86% 14%, rgba(255,255,255,0.055), transparent 34%)',
                                            ].join(', '),
                                        }}
                                    >
                                        <div className="absolute inset-px rounded-[13px] border border-white/[0.045] pointer-events-none" />
                                        <div className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-[#fff1bd]/52 to-transparent" />
                                        <div className="absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-[#7b6320]/32 to-transparent" />
                                        <div className="absolute -left-10 -top-14 h-28 w-40 rotate-[-16deg] bg-gradient-to-r from-transparent via-white/[0.075] to-transparent blur-[0.5px]" />
                                        <div className="absolute right-3 top-3 h-[18px] w-[26px] rounded-[5px] border border-[#e5d08f]/18 bg-[linear-gradient(135deg,rgba(229,208,143,0.12),rgba(255,255,255,0.025)_48%,rgba(0,0,0,0.18))] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]" />
                                        <div className="absolute right-4 top-5 h-px w-[18px] bg-gradient-to-r from-transparent via-[#e5d08f]/24 to-transparent" />
                                        <div
                                            className="absolute left-0 top-[11%] bottom-[11%] w-[2px] overflow-hidden bg-[#d4af37]/26 shadow-[0_0_10px_rgba(212,175,55,0.18)]"
                                            style={{
                                                WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 24%, #000 76%, transparent 100%)',
                                                maskImage: 'linear-gradient(180deg, transparent 0%, #000 24%, #000 76%, transparent 100%)',
                                            }}
                                        >
                                            <motion.div
                                                className="absolute left-0 right-0 h-[92%]"
                                                style={{
                                                    background: 'linear-gradient(180deg, transparent 0%, rgba(229,208,143,0.08) 22%, rgba(229,208,143,0.32) 40%, rgba(255,255,248,0.78) 50%, rgba(229,208,143,0.32) 60%, rgba(229,208,143,0.08) 78%, transparent 100%)',
                                                    filter: shouldCalmHomeMotion ? 'none' : 'blur(0.55px)',
                                                    boxShadow: '0 0 8px rgba(229,208,143,0.42), 0 0 16px rgba(212,175,55,0.18)',
                                                    willChange: shouldCalmHomeMotion ? 'auto' : 'transform, opacity',
                                                }}
                                                animate={shouldCalmHomeMotion ? undefined : { y: ['-118%', '128%'], opacity: [0, 0.78, 0.78, 0] }}
                                                transition={shouldCalmHomeMotion ? undefined : {
                                                    duration: 4.2,
                                                    repeat: Infinity,
                                                    repeatDelay: 0.85,
                                                    delay: i * 0.28,
                                                    ease: 'easeInOut',
                                                }}
                                            />
                                        </div>
                                        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035),transparent_22%,transparent_78%,rgba(0,0,0,0.18))] pointer-events-none" />
                                        <div className="absolute left-4 right-4 bottom-3 h-px bg-gradient-to-r from-[#e5d08f]/18 via-transparent to-[#e5d08f]/10" />
                                        <div className="relative">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] text-[#e5d08f]/90 tracking-[0.18em] font-semibold mb-3">
                                                <span className="w-1.5 h-1.5 rounded-full bg-[#e5d08f] shadow-[0_0_8px_rgba(229,208,143,0.58)]" />
                                                {stat.label}
                                            </div>
                                            {(stat as any).isStatus ? (
                                                <div className="text-[17px] font-bold text-[#FFFBF7] tracking-[0.08em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>{stat.value}</div>
                                            ) : (
                                                <div className="text-[28px] font-bold text-[#FFFBF7] leading-none" style={{ fontFamily: "Georgia, serif" }}>
                                                    {stat.value}
                                                    <span className="ml-1.5 text-[10px] text-white/42 font-sans font-medium">{stat.unit}</span>
                                                </div>
                                            )}
                                            <p className="text-[9px] text-white/36 mt-3 leading-relaxed">{stat.note}</p>
                                        </div>
                                    </div>
                                ))}
                            </section>

                            <section className="relative overflow-hidden rounded-[14px] border border-[#d4af37]/18 bg-[#151319] p-4 shadow-[0_16px_34px_rgba(0,0,0,0.36),0_1px_0_rgba(255,255,255,0.07)_inset]">
                                <div className="absolute inset-px rounded-[13px] border border-white/[0.035] pointer-events-none" />
                                <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[#fff1bd]/34 to-transparent" />
                                <div className="absolute -right-10 -top-14 h-28 w-32 rotate-[-14deg] bg-gradient-to-r from-transparent via-[#e5d08f]/[0.055] to-transparent blur-[1px]" />
                                <div className="relative space-y-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="inline-flex items-center gap-1.5 text-[10px] text-[#e5d08f]/88 tracking-[0.2em] font-semibold">
                                                <span className="h-1.5 w-1.5 rounded-full bg-[#e5d08f] shadow-[0_0_8px_rgba(229,208,143,0.52)]" />
                                                未被发现的回声
                                            </div>
                                            <p className="mt-2 text-[12px] text-[#FFFBF7]/66 leading-relaxed" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                                                {typeof currentStats?.unscannedCount === 'number' && currentStats.unscannedCount > 0 ? (
                                                    <>还有 <span className="text-[#fff1bd] font-bold">{currentStats.unscannedCount}</span> 段回忆，等着被重新串回时间线。</>
                                                ) : currentStats ? (
                                                    <>暂时没有遗漏的回声，关系线索已经安静归位。</>
                                                ) : (
                                                    <>回忆索引还在回温，散落的线索会慢慢浮上来。</>
                                                )}
                                            </p>
                                        </div>
                                        <div className="shrink-0 rounded-[10px] border border-[#e5d08f]/16 bg-[#0d0c11]/28 px-2.5 py-2 text-right shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
                                            <div className="text-[9px] text-white/28 tracking-[0.16em]">WAITING</div>
                                            <div className="mt-1 text-[18px] leading-none font-bold text-[#fff1bd]" style={{ fontFamily: "Georgia, serif" }}>
                                                {currentStats?.unscannedCount ?? '--'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { label: '回声', value: currentStats?.unscannedCount ?? '--' },
                                            { label: '节点', value: allStats?.graph?.nodes ?? '--' },
                                            { label: '连线', value: allStats?.graph?.edges ?? '--' },
                                        ].map(item => (
                                            <div key={item.label} className="min-w-0 rounded-[10px] border border-white/[0.055] bg-white/[0.035] px-2 py-2">
                                                <div className="truncate text-[8px] text-white/28 tracking-[0.18em] font-semibold">{item.label}</div>
                                                <div className="mt-1 truncate text-[13px] text-[#FFFBF7]/82 font-semibold" style={{ fontFamily: "Georgia, serif" }}>{item.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {/* ── BROWSER TAB ── */}
                {activeTab === 'browser' && (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar relative bg-[#08070b]">
                        <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                            <img src="/music-skins/skin-ribbon.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.34]" />
                            <img src="/images/cognitive-vinyl/pressed-flower.png" alt="" className="absolute -left-16 top-32 w-44 opacity-[0.18] mix-blend-screen" />
                            <img src="/images/cognitive-vinyl/ticket-stack.png" alt="" className="absolute -right-20 top-6 w-52 rotate-[-8deg] opacity-[0.14] mix-blend-screen" />
                            <img src="/images/cognitive-vinyl/archive-card.png" alt="" className="absolute right-3 top-[42%] w-48 opacity-[0.08] mix-blend-screen" />
                            <img src="/images/paper-texture.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.07] mix-blend-soft-light" />
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(74,51,45,0.18)_0%,transparent_36%),linear-gradient(180deg,rgba(8,7,11,0.28)_0%,rgba(8,7,11,0.9)_52%,rgba(6,5,8,0.98)_100%)]" />
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,transparent_0%,transparent_44%,rgba(0,0,0,0.5)_100%)]" />
                            <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(112deg,rgba(255,232,176,0.13),transparent_42%,rgba(151,102,73,0.1))]" />
                            <div className="absolute inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,241,189,0.62)_1px,transparent_0)] [background-size:18px_18px]" />
                        </div>

                        <div className="relative z-10 mx-auto max-w-[860px] space-y-5 px-5 pt-[calc(4.25rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                            <section className="relative min-h-[560px] overflow-hidden rounded-tl-[34px] rounded-tr-[24px] rounded-br-[42px] rounded-bl-[26px] border border-[#e6c486]/28 bg-[#1f171b]/72 px-7 py-8 shadow-[0_32px_68px_rgba(0,0,0,0.52),0_1px_0_rgba(255,244,214,0.16)_inset] backdrop-blur-2xl transition-[border-color,transform] duration-200 hover:border-[#f4d69b]/38 active:scale-[0.992] sm:min-h-[620px]">
                                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#ffe4a3]/68 to-transparent" />
                                <div className="absolute -right-14 -top-5 h-44 w-44 rotate-[-8deg] rounded-[20px] bg-[#4a332d]/18 shadow-[0_18px_42px_rgba(0,0,0,0.22)]" />
                                <div className="absolute -right-16 top-24 h-44 w-44 rounded-full border border-[#c5a06a]/16 bg-[radial-gradient(circle,#151216_0%,#151216_42%,#070609_43%,#070609_100%)] shadow-[inset_0_0_0_8px_rgba(255,255,255,0.02),0_18px_40px_rgba(0,0,0,0.38)]" />
                                <img src="/images/cognitive-vinyl/archive-seal.png" alt="" className="absolute right-8 top-48 w-28 opacity-[0.12] mix-blend-screen" />
                                <img src="/images/cognitive-vinyl/pressed-flower.png" alt="" className="absolute -left-8 top-48 w-32 opacity-[0.15] mix-blend-screen" />
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_8%,rgba(255,235,190,0.1)_0%,transparent_28%),radial-gradient(circle_at_62%_66%,rgba(255,214,148,0.12)_0%,transparent_28%),linear-gradient(145deg,rgba(255,255,255,0.052),transparent_48%)]" />

                                <div className="relative z-10 max-w-[285px]">
                                    <p className="text-[10px] font-semibold tracking-[0.46em] text-[#f3d092]/76">PRIVATE VINYL ARCHIVE</p>
                                    <h2 className="mt-5 text-[43px] font-bold leading-none tracking-[0.13em] text-[#fff1bd] drop-shadow-[0_2px_12px_rgba(255,226,171,0.16)] sm:text-[58px]" style={{ fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif" }}>
                                        回忆唱片匣
                                    </h2>
                                    <div className="mt-4 h-px w-4 bg-[#f3d092]/72" />
                                    <p className="mt-4 max-w-[250px] text-[14px] font-medium leading-[1.95] text-[#e9ddcf]/78" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                                        把他留下的瞬间收进唱片内页，等夜色安静时再轻轻翻到那一轨。
                                    </p>
                                </div>

                                <div className="absolute left-6 top-[318px] z-20 max-w-[112px] sm:left-8">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[18px] font-semibold tracking-[0.16em] text-[#e5bf7f]" style={{ fontFamily: "'Noto Serif SC', serif" }}>声纹片段</p>
                                        <span className="h-1.5 w-1.5 rotate-45 bg-[#e5bf7f]/50" />
                                    </div>
                                    <p className="mt-1 text-[9px] tracking-[0.18em] text-[#d8bd90]/46">VOICE MEMORY</p>
                                    <p className="mt-6 w-[94px] text-[12px] leading-relaxed text-[#d8d0c8]/42">那些未说完的话，都会被收录在这里。</p>
                                </div>

                                <div className="absolute bottom-1 left-[58%] z-10 h-[300px] w-[300px] max-w-[88vw] -translate-x-1/2 sm:h-[380px] sm:w-[380px]">
                                    <img
                                        src="/images/cognitive-vinyl/voice-player.png"
                                        alt=""
                                        className="absolute inset-0 h-full w-full opacity-[0.9] drop-shadow-[0_28px_44px_rgba(0,0,0,0.5)] [filter:invert(1)_sepia(0.78)_saturate(1.35)_hue-rotate(350deg)_brightness(0.74)_contrast(1.06)]"
                                    />
                                    <div className="absolute left-1/2 top-[34%] flex h-[58px] w-[58px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#e6c486]/22 bg-[#171115]/72 shadow-[0_8px_20px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm">
                                        {selectedBrowserChar ? (
                                            <div className="relative h-11 w-11">
                                                <img src={selectedBrowserChar.avatar} alt={selectedBrowserChar.name} className="absolute left-0 top-0 h-8 w-8 rounded-full object-cover ring-1 ring-[#e6c486]/34" />
                                                <img src={userProfile.avatar} alt={userProfile.name} className="absolute bottom-0 right-0 h-7 w-7 rounded-full object-cover ring-1 ring-[#e6c486]/30" />
                                                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#e6c486]/72" />
                                            </div>
                                        ) : (
                                            <span className="h-2 w-2 rounded-full bg-[#e6c486]/66 shadow-[0_0_12px_rgba(230,196,134,0.42)]" />
                                        )}
                                    </div>
                                </div>

                                <p className="absolute bottom-16 right-10 hidden rotate-[-9deg] text-[28px] italic tracking-[0.08em] text-[#b99575]/20 sm:block" style={{ fontFamily: 'Georgia, serif' }}>Memories</p>
                            </section>

                            <section className="-mt-1 space-y-3">
                                <div className="flex items-end justify-between px-1">
                                    <div>
                                        <p className="text-[18px] font-semibold tracking-[0.14em] text-[#e5bf7f]" style={{ fontFamily: "'Noto Serif SC', serif" }}>唱片归属</p>
                                        <p className="mt-1 text-[8px] tracking-[0.18em] text-[#d8bd90]/40">SLEEVE OWNER</p>
                                    </div>
                                    <p className="text-[9px] tracking-[0.22em] text-[#d8bd90]/38">{characters.length} SLEEVES 〉</p>
                                </div>
                                <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-5 scroll-px-16 px-16 pb-5 pt-6">
                                    {characters.map(c => {
                                        const isActive = selectedCharId === c.id;
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => { setSelectedCharId(c.id); setBrowserMemories(null); haptic.light(); }}
                                                className={`relative h-[122px] w-[104px] shrink-0 overflow-visible rounded-[14px] border text-center transition-all duration-200 active:scale-[0.97] sm:h-[142px] sm:w-[132px] ${
                                                    isActive
                                                        ? 'z-20 mx-5 -translate-y-1 border-[#e6c486]/58 bg-[#f3eadc] text-[#241814] shadow-[0_22px_38px_rgba(0,0,0,0.38),0_0_0_1px_rgba(255,241,189,0.18)_inset,-10px_0_0_-5px_rgba(197,139,71,0.78)]'
                                                        : 'z-0 border-white/[0.09] bg-[#151319]/70 text-white/48 shadow-[0_16px_28px_rgba(0,0,0,0.2)] hover:border-[#e6c486]/26 hover:bg-white/[0.08]'
                                                }`}
                                            >
                                                {isActive && (
                                                    <>
                                                        <span className="absolute -inset-2 z-0 rounded-[18px] border border-[#e6c486]/12 bg-[#fff1bd]/[0.035] shadow-[0_18px_34px_rgba(0,0,0,0.18)]" />
                                                        <span className="absolute -left-8 top-7 z-0 h-16 w-16 rounded-full border border-[#c09254]/18 bg-[radial-gradient(circle,#171316_0%,#171316_42%,#050406_43%,#050406_100%)] opacity-[0.86] shadow-[0_10px_20px_rgba(0,0,0,0.38)] sm:-left-10 sm:h-20 sm:w-20" />
                                                        <span className="absolute left-0 top-0 h-full w-[7px] bg-gradient-to-b from-[#c58b47] via-[#f2d290] to-[#a66b38]" />
                                                    </>
                                                )}
                                                <span className="absolute inset-x-4 top-3 h-px bg-gradient-to-r from-transparent via-current/18 to-transparent" />
                                                <span className="relative z-10 flex h-full flex-col items-center justify-center px-3">
                                                    <img src={c.avatar} alt={c.name} className={`h-12 w-12 rounded-full object-cover shadow-[0_6px_12px_rgba(0,0,0,0.28)] ${isActive ? 'ring-2 ring-[#c58b47]/28' : 'ring-1 ring-white/18'}`} />
                                                    <span className="mt-3 min-w-0 max-w-full">
                                                        <span className="block truncate text-[15px] font-semibold tracking-wide" style={{ fontFamily: "'Noto Serif SC', serif" }}>{c.name}</span>
                                                        <span className={`mt-2 block text-[9px] tracking-[0.28em] ${isActive ? 'text-[#8f6b3b]/72' : 'text-white/28'}`}>MEMORY</span>
                                                    </span>
                                                    <span className={`mt-3 h-1.5 w-1.5 rotate-45 ${isActive ? 'bg-[#c58b47]/72' : 'bg-[#e5bf7f]/24'}`} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            {selectedCharId && selectedBrowserChar ? (
                                <>
                                {/* ── 落针方式 ── */}
                                <section className="rounded-[20px] border border-white/[0.07] bg-[#131016]/72 p-4">
                                    <div className="mb-3">
                                        <p className="text-[9px] font-semibold tracking-[0.28em] text-[#d8bd90]/48">NEEDLE DROP</p>
                                        <h3 className="mt-1.5 text-[16px] font-semibold tracking-[0.10em] text-[#fff1bd]" style={{ fontFamily: "'Noto Serif SC', serif" }}>落针方式</h3>
                                        <p className="mt-1 text-[11px] leading-relaxed text-white/36">选一种方式，决定这段旋律从哪里开始</p>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-5">
                                        {(Object.keys(MEMORY_RECORD_MODE_COPY) as MemoryRecordMode[]).map(mode => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => { setRecordMode(mode); haptic.light(); }}
                                                className={`rounded-[14px] border px-3 py-3 text-left transition-all active:scale-[0.97] ${
                                                    recordMode === mode
                                                        ? 'border-[#f2d290]/54 bg-[#f2d290]/14 text-[#fff1bd]'
                                                        : 'border-white/[0.07] bg-white/[0.035] text-white/48 hover:border-[#f2d290]/24'
                                                }`}
                                            >
                                                <span className="block text-[12px] font-bold tracking-[0.08em]">{MEMORY_RECORD_MODE_COPY[mode].label}</span>
                                                <span className="mt-1 block text-[9px] leading-relaxed opacity-62">{MEMORY_RECORD_MODE_COPY[mode].detail}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {recordMode === 'selected_memory' ? (
                                        <div className="mt-3 rounded-[16px] border border-white/[0.07] bg-white/[0.035] p-3">
                                            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-white/40">
                                                <span>封存片段</span>
                                                <span>{selectedRecordMemoryIds.length}/8 · {recordMemoryOptions.length} 段可选</span>
                                            </div>
                                            {recordMemoryOptionsLoading ? (
                                                <p className="text-[11px] leading-relaxed text-white/34">正在取出这位角色的全部记忆...</p>
                                            ) : recordMemoryOptionsError ? (
                                                <p className="text-[11px] leading-relaxed text-[#ffb4a8]/70">读取记忆失败：{recordMemoryOptionsError}</p>
                                            ) : recordMemoryOptions.length > 0 ? (
                                                <div className="max-h-[220px] overflow-y-auto no-scrollbar rounded-[12px] border border-white/[0.055] bg-black/12 p-2">
                                                    <div className="flex flex-wrap gap-2">
                                                        {recordMemoryOptions.map((memory) => {
                                                            const picked = selectedRecordMemoryIds.includes(memory.id);
                                                            const label = memory.title || memory.content?.slice(0, 28) || '未命名回忆';
                                                            return (
                                                                <button
                                                                    key={memory.id}
                                                                    type="button"
                                                                    title={label}
                                                                    onClick={() => toggleRecordMemorySeed(memory.id)}
                                                                    className={`max-w-full rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-all active:scale-[0.97] ${
                                                                        picked
                                                                            ? 'border-[#f2d290]/54 bg-[#f2d290]/18 text-[#fff1bd]'
                                                                            : 'border-white/[0.08] bg-black/14 text-white/44'
                                                                    }`}
                                                                >
                                                                    <span className="block max-w-[220px] truncate">{label}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-[11px] leading-relaxed text-white/34">这位角色本机还没有可封存的记忆。</p>
                                            )}
                                            <p className="mt-2 text-[10px] leading-relaxed text-white/30">已列出本机全部回忆，最多挑 8 段交给这张唱片。</p>
                                        </div>
                                    ) : null}
                                </section>

                                <section className="relative overflow-hidden rounded-[24px] border border-[#d4af37]/20 bg-[#131016]/82 p-5 shadow-[0_22px_44px_rgba(0,0,0,0.38),0_1px_0_rgba(255,244,214,0.08)_inset] backdrop-blur-2xl">
                                    <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#ffe4a3]/42 to-transparent" />
                                    <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#e5bf7f]/[0.045] blur-2xl" />
                                    <div className="relative space-y-5">
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                            <div>
                                                <p className="text-[9px] font-semibold tracking-[0.32em] text-[#d8bd90]/48">PRIVATE CUT</p>
                                                <h3 className="mt-2 text-[20px] font-semibold tracking-[0.12em] text-[#fff1bd]" style={{ fontFamily: "'Noto Serif SC', serif" }}>词曲手札</h3>
                                                <p className="mt-2 max-w-[460px] text-[12px] leading-relaxed text-white/42">把心事写成词，反复斟酌，最后让旋律替你轻声唱出来。</p>
                                            </div>
                                            <div className="grid grid-cols-4 gap-2 rounded-[16px] border border-white/[0.07] bg-black/16 p-1.5">
                                                {[
                                                    { step: 1, label: '写词', active: recordFlowStatus === 'idle' || recordFlowStatus === 'generating_lyrics' || recordFlowStatus === 'lyrics_ready' || recordFlowStatus === 'checking_singability' || recordFlowStatus === 'singability_checked' || recordFlowStatus === 'optimizing_lyrics' || recordFlowStatus === 'lyrics_optimized' },
                                                    { step: 2, label: '定稿', active: recordFlowStatus === 'lyrics_confirmed' },
                                                    { step: 3, label: '曲风', active: recordFlowStatus === 'generating_style' || recordFlowStatus === 'style_ready' },
                                                    { step: 4, label: '生歌', active: recordFlowStatus === 'generating_song' || recordFlowStatus === 'song_ready' },
                                                ].map(item => (
                                                    <div
                                                        key={item.step}
                                                        className={`min-w-0 rounded-[12px] px-3 py-2 text-center ${item.active ? 'bg-[#f2d290] text-[#241814]' : 'text-white/34'}`}
                                                    >
                                                        <div className="text-[10px] font-black leading-none">{item.step}</div>
                                                        <div className="mt-1 truncate text-[9px] font-bold tracking-[0.08em]">{item.label}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="rounded-[18px] border border-white/[0.07] bg-white/[0.035] p-4">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[9px] font-semibold tracking-[0.24em] text-[#d8bd90]/48">STEP 1</p>
                                                    <h4 className="mt-1 text-[15px] font-semibold text-[#fff1bd]">填写歌曲需求</h4>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={recordGenerating}
                                                    onClick={handleCreateMemoryRecord}
                                                    className="shrink-0 rounded-full bg-[#f2d290] px-4 py-2 text-[11px] font-bold text-[#241814] shadow-[0_12px_24px_rgba(242,210,144,0.18)] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {recordFlowStatus === 'generating_lyrics' ? '生成中...' : '生成歌词草稿'}
                                                </button>
                                            </div>

                                            {/* 歌词方向 */}
                                            <div className="rounded-[16px] border border-[#f2d290]/10 bg-[#f2d290]/[0.025] p-3">
                                                <p className="mb-2.5 text-[9px] font-semibold tracking-[0.18em] text-[#f2d290]/52">歌词方向 — 影响歌词的内容和口吻</p>
                                                <div className="grid gap-2.5 sm:grid-cols-3">
                                                    {([
                                                        ['theme', '歌曲主题', '雨夜重逢、秘密恋爱、梦醒前的告白'],
                                                        ['mood', '情绪/氛围', '暧昧、克制、热烈、失落但不伤感'],
                                                        ['perspective', '叙事口吻', '我唱给你听、第三人称旁观、像在讲故事'],
                                                    ] as const).map(([field, label, placeholder]) => (
                                                        <label key={field} className="block">
                                                            <span className="mb-1 block text-[10px] font-semibold tracking-[0.06em] text-white/48">{label}</span>
                                                            <input
                                                                value={String(recordSongRequest[field as keyof MemoryRecordSongRequest] || '')}
                                                                onChange={e => handleSongRequestChange(field as keyof MemoryRecordSongRequest, e.target.value)}
                                                                placeholder={placeholder}
                                                                className="w-full rounded-[12px] border border-white/[0.08] bg-black/18 px-3.5 py-2.5 text-[12px] text-[#fff1bd] outline-none placeholder:text-white/22 focus:border-[#f2d290]/34"
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* 音乐方向 */}
                                            <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3">
                                                <p className="mb-2.5 text-[9px] font-semibold tracking-[0.18em] text-white/36">音乐方向 — 影响旋律、编曲和声音质感</p>
                                                <div className="grid gap-2.5 sm:grid-cols-2">
                                                    {([
                                                        ['style', '曲风', 'R&B、抒情流行、电子梦核、city pop'],
                                                        ['voicePreference', '声线描述', '女声、低沉男声、气声、少年感 — 写入音乐提示词而非直接选声'],
                                                    ] as const).map(([field, label, placeholder]) => (
                                                        <label key={field} className="block">
                                                            <span className="mb-1 block text-[10px] font-semibold tracking-[0.06em] text-white/48">{label}</span>
                                                            <input
                                                                value={String(recordSongRequest[field as keyof MemoryRecordSongRequest] || '')}
                                                                onChange={e => handleSongRequestChange(field as keyof MemoryRecordSongRequest, e.target.value)}
                                                                placeholder={placeholder}
                                                                className="w-full rounded-[12px] border border-white/[0.08] bg-black/18 px-3.5 py-2.5 text-[12px] text-[#fff1bd] outline-none placeholder:text-white/22 focus:border-[#f2d290]/34"
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                                <input
                                                    value={recordReference}
                                                    onChange={e => setRecordReference(e.target.value)}
                                                    placeholder="审美参考（可选）：歌手、歌曲、电影或年代"
                                                    className="mt-2.5 w-full rounded-[12px] border border-white/[0.08] bg-black/18 px-3.5 py-2.5 text-[12px] text-[#fff1bd] outline-none placeholder:text-white/26 focus:border-[#f2d290]/34"
                                                />
                                            </div>

                                            {/* 额外要求 — 影响歌词+音乐 */}
                                            <label className="block">
                                                <span className="mb-1 block text-[10px] font-semibold tracking-[0.06em] text-white/48">额外要求（可选）— 同时影响歌词和音乐</span>
                                                <input
                                                    value={String(recordSongRequest.extraRequirements || '')}
                                                    onChange={e => handleSongRequestChange('extraRequirements', e.target.value)}
                                                    placeholder="副歌更有 Hook、不要太伤感、适合睡前听"
                                                    className="w-full rounded-[12px] border border-white/[0.08] bg-black/18 px-3.5 py-2.5 text-[12px] text-[#fff1bd] outline-none placeholder:text-white/22 focus:border-[#f2d290]/34"
                                                />
                                            </label>

                                        </div>

                                        {/* ── STEP 2: 歌词工作区 ── */}
                                        {activeDraftRecord ? (
                                            <div className="rounded-[18px] border border-[#f2d290]/18 bg-black/18 p-4">
                                                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-[9px] font-semibold tracking-[0.24em] text-[#d8bd90]/48">STEP 2</p>
                                                        <h4 className="mt-1 text-[15px] font-semibold text-[#fff1bd]">歌词工作区</h4>
                                                    </div>
                                                    <div className="text-[10px] font-semibold text-white/38">
                                                        {recordGenerating ? '处理中...' : '草稿会自动保存到本机'}
                                                    </div>
                                                </div>

                                                {/* 歌名 + 歌词 */}
                                                <label className="block">
                                                    <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/42">歌名 title</span>
                                                    <input
                                                        value={lyricsDraft.title}
                                                        onChange={e => handleLyricsFieldChange('title', e.target.value)}
                                                        className="w-full rounded-[14px] border border-white/[0.08] bg-black/24 px-4 py-3 text-[13px] font-semibold text-[#fff1bd] outline-none focus:border-[#f2d290]/34"
                                                    />
                                                </label>

                                                <label className="mt-3 block">
                                                    <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/42">完整歌词 lyrics</span>
                                                    <textarea
                                                        value={lyricsDraft.lyrics}
                                                        onChange={e => handleLyricsFieldChange('lyrics', e.target.value)}
                                                        className="min-h-[320px] w-full resize-y rounded-[16px] border border-white/[0.08] bg-[#08070b]/72 px-4 py-4 font-mono text-[12px] leading-6 text-[#fff6d8] outline-none placeholder:text-white/24 focus:border-[#f2d290]/34 sm:min-h-[400px]"
                                                        spellCheck={false}
                                                    />
                                                </label>

                                                {/* 可唱性评分卡片 */}
                                                {singabilityResult ? (
                                                    <div className={`mt-3 rounded-[14px] border p-3 ${singabilityResult.score >= 80 ? 'border-[#81b29a]/24 bg-[#81b29a]/[0.06]' : singabilityResult.score >= 60 ? 'border-[#f2d290]/24 bg-[#f2d290]/[0.06]' : 'border-[#d99aae]/24 bg-[#d99aae]/[0.06]'}`}>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[11px] font-semibold text-white/60">可唱性评分</span>
                                                            <span className={`text-[18px] font-black ${singabilityResult.score >= 80 ? 'text-[#81b29a]' : singabilityResult.score >= 60 ? 'text-[#f2d290]' : 'text-[#d99aae]'}`}>{singabilityResult.score}<span className="text-[11px] font-normal">/100</span></span>
                                                        </div>
                                                        {singabilityResult.summary ? <p className="mt-1.5 text-[10px] leading-relaxed text-white/48">{singabilityResult.summary}</p> : null}
                                                        {singabilityResult.issues.length > 0 ? (
                                                            <div className="mt-2 space-y-1.5">
                                                                {singabilityResult.issues.slice(0, 5).map((issue, i) => (
                                                                    <div key={i} className="flex items-start gap-2 text-[10px]">
                                                                        <span className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[8px] font-bold ${issue.severity === 'high' ? 'bg-[#d99aae]/20 text-[#d99aae]' : issue.severity === 'medium' ? 'bg-[#f2d290]/18 text-[#f2d290]' : 'bg-white/[0.06] text-white/40'}`}>{issue.severity}</span>
                                                                        <span className="text-white/52">{issue.problem}{issue.suggestion ? ` → ${issue.suggestion}` : ''}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}

                                                {/* 优化版歌词预览 */}
                                                {showOptimizedLyrics && lyricsDraft.optimizedLyrics ? (
                                                    <div className="mt-3 rounded-[14px] border border-[#81b29a]/22 bg-[#81b29a]/[0.06] p-3">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-[11px] font-semibold text-[#81b29a]">优化版歌词</span>
                                                            <div className="flex gap-2">
                                                                <button type="button" onClick={handleAdoptOptimizedLyrics} disabled={recordGenerating} className="rounded-full bg-[#81b29a] px-3 py-1.5 text-[10px] font-bold text-[#152033] active:scale-[0.97] disabled:opacity-45">采用优化版</button>
                                                                <button type="button" onClick={handleKeepOriginalLyrics} disabled={recordGenerating} className="rounded-full border border-white/[0.12] px-3 py-1.5 text-[10px] font-bold text-white/52 active:scale-[0.97]">保留原版</button>
                                                            </div>
                                                        </div>
                                                        {lyricsDraft.optimizationNotes ? (
                                                            <div className="mb-2 space-y-1 text-[10px]">
                                                                {lyricsDraft.optimizationNotes.kept.length > 0 ? <p className="text-[#81b29a]/70">保留：{lyricsDraft.optimizationNotes.kept.join('、')}</p> : null}
                                                                {lyricsDraft.optimizationNotes.changed.length > 0 ? <p className="text-[#f2d290]/70">修改：{lyricsDraft.optimizationNotes.changed.join('、')}</p> : null}
                                                                {lyricsDraft.optimizationNotes.reason ? <p className="text-white/38">原因：{lyricsDraft.optimizationNotes.reason}</p> : null}
                                                            </div>
                                                        ) : null}
                                                        <pre className="max-h-[280px] overflow-y-auto rounded-[10px] bg-black/20 p-3 text-[11px] leading-5 text-[#dce9ff]/80 whitespace-pre-wrap font-mono">{lyricsDraft.optimizedLyrics}</pre>
                                                    </div>
                                                ) : null}

                                                {/* 歌词操作按钮行 */}
                                                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-between">
                                                    <div className="flex flex-wrap gap-2">
                                                        {/* 可唱性检查 */}
                                                        {['lyrics_ready', 'lyrics_optimized'].includes(recordFlowStatus) ? (
                                                            <button type="button" disabled={recordGenerating} onClick={handleCheckSingability}
                                                                className="rounded-full border border-[#cfe0ff]/28 px-3 py-2 text-[10px] font-bold text-[#cfe0ff] active:scale-[0.97] disabled:opacity-45">
                                                                {recordFlowStatus === 'checking_singability' ? '检查中...' : '查看可唱性评分'}
                                                            </button>
                                                        ) : null}
                                                        {/* 优化歌词 */}
                                                        {singabilityResult?.shouldOptimize && ['singability_checked', 'lyrics_optimized'].includes(recordFlowStatus) ? (
                                                            <button type="button" disabled={recordGenerating} onClick={handleOptimizeLyrics}
                                                                className="rounded-full border border-[#f2d290]/30 px-3 py-2 text-[10px] font-bold text-[#fff1bd] active:scale-[0.97] disabled:opacity-45">
                                                                {recordFlowStatus === 'optimizing_lyrics' ? '优化中...' : '优化歌词'}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {/* 确认歌词定稿 */}
                                                        {['lyrics_ready', 'singability_checked', 'lyrics_optimized'].includes(recordFlowStatus) ? (
                                                            <button type="button" disabled={recordGenerating} onClick={handleConfirmLyricsFinal}
                                                                className="rounded-full bg-[#f2d290] px-4 py-2.5 text-[11px] font-bold text-[#241814] shadow-[0_12px_24px_rgba(242,210,144,0.18)] active:scale-[0.97] disabled:opacity-50">
                                                                确认歌词定稿
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                {/* 修改意见 + 词作人（折叠区） */}
                                                {(recordFlowStatus === 'lyrics_ready' || recordFlowStatus === 'singability_checked' || recordFlowStatus === 'lyrics_optimized') ? (
                                                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                                                        <label className="block">
                                                            <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/42">修改意见（优化歌词时使用）</span>
                                                            <textarea
                                                                value={lyricsDraft.revisionInstruction}
                                                                onChange={e => handleLyricsFieldChange('revisionInstruction', e.target.value)}
                                                                placeholder="例如：副歌更暧昧一点，不要太伤感"
                                                                className="min-h-[72px] w-full resize-y rounded-[14px] border border-white/[0.08] bg-black/24 px-4 py-3 text-[12px] leading-relaxed text-[#fff1bd] outline-none placeholder:text-white/24 focus:border-[#f2d290]/34"
                                                            />
                                                        </label>
                                                        <label className="mt-2 block">
                                                            <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/42">想模仿的词作人 <span className="text-white/20">· 选填</span></span>
                                                            <input type="text" value={lyricsDraft.lyricistReference} onChange={e => handleLyricsFieldChange('lyricistReference', e.target.value)}
                                                                placeholder="例如：林夕、方文山、吴青峰"
                                                                className="w-full rounded-[14px] border border-white/[0.08] bg-black/24 px-4 py-3 text-[12px] leading-relaxed text-[#fff1bd] outline-none placeholder:text-white/24 focus:border-[#f2d290]/34"
                                                            />
                                                        </label>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {/* ── STEP 3: 曲风生成（歌词定稿后）── */}
                                        {activeDraftRecord && (recordFlowStatus === 'lyrics_confirmed' || recordFlowStatus === 'generating_style' || recordFlowStatus === 'style_ready' || recordFlowStatus === 'generating_song' || recordFlowStatus === 'song_ready') ? (
                                            <div className="rounded-[18px] border border-[#cfe0ff]/18 bg-[#cfe0ff]/[0.04] p-4">
                                                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-[9px] font-semibold tracking-[0.24em] text-[#cfe0ff]/62">STEP 3</p>
                                                        <h4 className="mt-1 text-[15px] font-semibold text-[#dce9ff]">曲风制作</h4>
                                                    </div>
                                                </div>

                                                {/* 曲风提示词编辑 */}
                                                <label className="block">
                                                    <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/42">style_prompt（英文，可手动调整）</span>
                                                    <textarea
                                                        value={lyricsDraft.stylePrompt}
                                                        onChange={e => handleLyricsFieldChange('stylePrompt', e.target.value)}
                                                        className="min-h-[72px] w-full resize-y rounded-[14px] border border-white/[0.08] bg-black/24 px-4 py-3 text-[11px] leading-relaxed text-[#fff1bd] outline-none focus:border-[#cfe0ff]/34 font-mono"
                                                        spellCheck={false}
                                                    />
                                                </label>

                                                {lyricsDraft.negativeStylePrompt ? (
                                                    <label className="mt-2 block">
                                                        <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-white/32">negative_style_prompt</span>
                                                        <textarea
                                                            value={lyricsDraft.negativeStylePrompt}
                                                            onChange={e => handleLyricsFieldChange('negativeStylePrompt', e.target.value)}
                                                            className="min-h-[48px] w-full resize-y rounded-[14px] border border-white/[0.06] bg-black/18 px-4 py-3 text-[11px] leading-relaxed text-white/48 outline-none focus:border-[#cfe0ff]/28 font-mono"
                                                            spellCheck={false}
                                                        />
                                                    </label>
                                                ) : null}

                                                {/* music_director_notes */}
                                                {stylePromptResult?.musicDirectorNotes ? (
                                                    <div className="mt-3 rounded-[12px] border border-white/[0.06] bg-black/14 p-3">
                                                        <p className="text-[9px] font-semibold tracking-[0.14em] text-white/32 mb-2">制作人笔记</p>
                                                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                                            {stylePromptResult.musicDirectorNotes.song_type ? <p className="text-white/42">类型：<span className="text-white/62">{stylePromptResult.musicDirectorNotes.song_type}</span></p> : null}
                                                            {stylePromptResult.musicDirectorNotes.emotional_core ? <p className="text-white/42">情绪：<span className="text-white/62">{stylePromptResult.musicDirectorNotes.emotional_core}</span></p> : null}
                                                            {stylePromptResult.musicDirectorNotes.vocal_character ? <p className="text-white/42">人声：<span className="text-white/62">{stylePromptResult.musicDirectorNotes.vocal_character}</span></p> : null}
                                                            {stylePromptResult.musicDirectorNotes.dynamic_curve ? <p className="text-white/42">动态：<span className="text-white/62">{stylePromptResult.musicDirectorNotes.dynamic_curve}</span></p> : null}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                                    {/* 生成曲风按钮 */}
                                                    {(recordFlowStatus === 'lyrics_confirmed' || recordFlowStatus === 'generating_style' || recordFlowStatus === 'style_ready') ? (
                                                        <button type="button" disabled={recordGenerating} onClick={handleGenerateStylePrompt}
                                                            className="rounded-full border border-[#cfe0ff]/30 px-4 py-2.5 text-[11px] font-bold text-[#dce9ff] active:scale-[0.97] disabled:opacity-45">
                                                            {recordFlowStatus === 'generating_style' ? '生成中...' : '生成曲风提示词'}
                                                        </button>
                                                    ) : null}
                                                    {/* 确认并生成歌曲 */}
                                                    {(recordFlowStatus === 'style_ready' || recordFlowStatus === 'generating_song' || recordFlowStatus === 'song_ready') ? (
                                                        <button type="button" disabled={recordGenerating} onClick={handleConfirmLyricsAndGenerateSong}
                                                            className="rounded-full bg-[#f2d290] px-4 py-2.5 text-[11px] font-bold text-[#241814] shadow-[0_12px_24px_rgba(242,210,144,0.18)] active:scale-[0.97] disabled:opacity-50">
                                                            {recordFlowStatus === 'generating_song' ? '歌曲生成中...' : '确认并生成歌曲'}
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}

                                        {/* ── STEP 4: 歌曲生成状态 ── */}
                                        {(recordStatusText || recordFlowError || recordFlowStatus === 'song_ready') ? (
                                            <div className="rounded-[18px] border border-[#8bb8f1]/18 bg-[#8bb8f1]/[0.055] p-4">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-[9px] font-semibold tracking-[0.24em] text-[#cfe0ff]/62">STEP 4</p>
                                                        <h4 className="mt-1 text-[15px] font-semibold text-[#dce9ff]">生成歌曲</h4>
                                                        {recordStatusText ? <p className="mt-2 text-[11px] leading-relaxed text-[#dce9ff]/70">{recordStatusText}</p> : null}
                                                        {recordFlowError ? <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#ffd0d8]/82">{recordFlowError}</p> : null}
                                                        {recordFlowStatus === 'song_ready' ? <p className="mt-2 text-[11px] leading-relaxed text-[#dce9ff]/70">歌曲已经生成，可以播放，也可以回到歌词继续修改后重新生成。</p> : null}
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap gap-2">
                                                        <button type="button" disabled={!activeDraftRecord || !hasPlayableMemoryRecordAudio(activeDraftRecord)}
                                                            onClick={() => activeDraftRecord && playMemoryRecord(activeDraftRecord)}
                                                            className="rounded-full border border-[#8bb8f1]/30 px-3 py-2 text-[10px] font-bold text-[#dce9ff] disabled:opacity-35">
                                                            播放
                                                        </button>
                                                        <button type="button" disabled={!activeDraftRecord || recordGenerating}
                                                            onClick={handleReturnToLyrics}
                                                            className="rounded-full bg-[#dce9ff] px-3 py-2 text-[10px] font-bold text-[#152033] disabled:opacity-45">
                                                            返回修改歌词
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        {memoryRecords.length > 0 ? (
                                            <div className="space-y-2">
                                                {memoryRecords.slice(0, 5).map(record => {
                                                    const playable = hasPlayableMemoryRecordAudio(record);
                                                    const canPreviewMonologue = shouldGenerateMemoryRecordMonologue(record.mode) && Boolean(record.monologueAudioId);
                                                    const coverImage = getMemoryRecordCoverImage(record);
                                                    return (
                                                        <div key={record.id} className="rounded-[16px] border border-white/[0.07] bg-black/16 p-3">
                                                            <div className="flex items-start gap-3">
                                                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] border border-[#f2d290]/18 shadow-[0_8px_18px_rgba(0,0,0,0.24)]" style={coverImage ? undefined : { background: record.coverGradient }}>
                                                                    {coverImage ? (
                                                                        <img src={coverImage} alt={record.title} className="h-full w-full object-cover" />
                                                                    ) : null}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="truncate text-[13px] font-semibold text-[#fff1bd]">{record.title}</div>
                                                                    <div className="mt-1 truncate text-[10px] text-white/38">
                                                                        {MEMORY_RECORD_MODE_COPY[record.mode].label} · {MEMORY_RECORD_STATUS_LABELS[record.status] || record.status}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {record.error ? (
                                                                <details className="mt-3 w-full rounded-[10px] border border-[#d99aae]/18 bg-[#d99aae]/[0.055] px-2.5 py-2">
                                                                    <summary className="cursor-pointer select-none text-[10px] font-semibold text-[#ffd0d8]/78 outline-none">
                                                                        查看生成记录
                                                                    </summary>
                                                                    <pre className="mt-2 max-h-28 w-full overflow-auto whitespace-pre-wrap break-normal rounded-[8px] bg-black/20 p-2 text-left text-[9px] leading-relaxed text-[#ffe1e7]/76">{record.error}</pre>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => copyMemoryRecordError(record)}
                                                                        className="mt-2 rounded-full border border-[#d99aae]/24 px-2.5 py-1 text-[9px] font-semibold text-[#ffd0d8]/82 active:scale-[0.97]"
                                                                    >
                                                                        复制记录
                                                                    </button>
                                                                </details>
                                                            ) : null}
                                                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => loadRecordIntoLyricsEditor(record, playable ? 'song_ready' : 'lyrics_ready')}
                                                                    className="rounded-full border border-[#f2d290]/28 px-3 py-1.5 text-[10px] font-semibold text-[#fff1bd]"
                                                                >
                                                                    编辑歌词
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={!playable}
                                                                    onClick={() => playMemoryRecord(record)}
                                                                    className="rounded-full border border-[#f2d290]/28 px-3 py-1.5 text-[10px] font-semibold text-[#fff1bd] disabled:opacity-32"
                                                                >
                                                                    播放
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={!playable}
                                                                    onClick={() => openMemoryRecordShare(record)}
                                                                    className="rounded-full border border-[#8bb8f1]/30 px-3 py-1.5 text-[10px] font-semibold text-[#cfe0ff] disabled:opacity-32"
                                                                >
                                                                    分享
                                                                </button>
                                                                {canPreviewMonologue ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { void previewMemoryRecordMonologue(record); }}
                                                                        className="rounded-full border border-[#8bb8f1]/30 px-3 py-1.5 text-[10px] font-semibold text-[#cfe0ff]"
                                                                    >
                                                                        试听独白
                                                                    </button>
                                                                ) : null}
                                                                <button
                                                                    type="button"
                                                                    disabled={recordGenerating}
                                                                    onClick={() => { void handleRetryMemoryRecord(record); }}
                                                                    className="rounded-full bg-[#f2d290] px-3 py-1.5 text-[10px] font-bold text-[#241814] disabled:opacity-50"
                                                                >
                                                                    重压
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={recordGenerating}
                                                                    onClick={() => { void handleDeleteMemoryRecord(record); }}
                                                                    className="rounded-full border border-[#d99aae]/32 px-3 py-1.5 text-[10px] font-semibold text-[#ffd0d8] disabled:opacity-40"
                                                                >
                                                                    删除
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                    </div>
                                </section>
                                </>
                            ) : null}

                            {!selectedCharId ? (
                                <section className="relative min-h-[260px] overflow-hidden rounded-[24px] border border-[#b98e5e]/24 bg-[#161217]/78 px-6 text-center shadow-[0_24px_44px_rgba(0,0,0,0.36),0_1px_0_rgba(255,244,214,0.08)_inset] backdrop-blur-2xl transition-[border-color,transform] duration-200 hover:border-[#e6c486]/30 active:scale-[0.992]">
                                    <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#ffe4a3]/40 to-transparent" />
                                    <div className="absolute left-1/2 top-9 h-28 w-28 -translate-x-1/2 rounded-full border border-[#d1aa73]/18">
                                        <div className="absolute inset-5 rounded-full border border-[#d1aa73]/12" />
                                        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e5bf7f]/70" />
                                    </div>
                                    <div className="relative flex min-h-[260px] flex-col items-center justify-center pt-12">
                                        <p className="text-[17px] font-semibold tracking-[0.12em] text-[#e9d5ad]" style={{ fontFamily: "'Noto Serif SC', serif" }}>先抽出一张唱片</p>
                                        <p className="mt-4 max-w-[250px] text-[13px] font-medium leading-relaxed text-white/44">选中一个角色后，匣子会只展开属于他的那一格回忆。</p>
                                    </div>
                                </section>
                            ) : (
                                <>
                                    <div className="rounded-[28px] border border-[#b98e5e]/24 bg-[#111015]/78 px-2 py-2 shadow-[0_18px_34px_rgba(0,0,0,0.34),0_1px_0_rgba(255,244,214,0.08)_inset] backdrop-blur-xl">
                                        <div className="grid grid-cols-4">
                                            {(['all', '0', '1', 'musing'] as const).map(lvl => {
                                                const count = lvl === 'all' ? browserCounts.total
                                                    : lvl === '0' ? browserCounts.l0
                                                    : lvl === '1' ? browserCounts.l1
                                                    : browserCounts.musing;
                                                const labelStr = lvl === 'all' ? '全部'
                                                    : lvl === '0' ? '场景'
                                                    : lvl === '1' ? '印象'
                                                    : '碎念';
                                                return (
                                                    <button
                                                        key={lvl}
                                                        onClick={() => { setBrowserLevel(lvl); fetchBrowserMemories(lvl); haptic.light(); }}
                                                        className={`relative min-w-0 px-2 py-2.5 text-[12px] font-bold tracking-[0.08em] transition-[color,transform] duration-200 active:scale-[0.97] after:absolute after:bottom-1 after:left-1/2 after:h-[2px] after:w-8 after:-translate-x-1/2 after:rounded-full after:transition-opacity ${
                                                            browserLevel === lvl
                                                                ? 'text-[#ffe3a0] after:bg-[#f0c878] after:opacity-100'
                                                                : 'text-white/36 after:bg-transparent after:opacity-0 hover:text-white/58'
                                                        }`}
                                                        style={{ fontFamily: "'Noto Serif SC', serif" }}
                                                    >
                                                        {lvl !== 'all' && <span className="absolute left-0 top-1/2 h-8 w-px -translate-y-1/2 bg-white/[0.08]" />}
                                                        <span className="block truncate">{labelStr}</span>
                                                        <span className={`mt-1 block text-[10px] ${browserLevel === lvl ? 'text-[#ffe3a0]/76' : 'text-white/28'}`}>{count}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {browserLoading ? (
                                        <div className="flex justify-center py-12 opacity-70"><Spinner /></div>
                                    ) : browserMemories && browserMemories.length > 0 ? (
                                        <div className="space-y-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                                            {browserMemories.map((m: any, index: number) => {
                                                const isExpanded = expandedMemId === m.id;
                                                const isEditing = editingMemId === m.id;
                                                const timeStr = new Date(m.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                                const tag = m.source === 'musing' ? '碎念' : m.level === 1 ? '印象' : '场景';
                                                const tagClassName = m.source === 'musing'
                                                    ? 'border-[#f7bfd2]/36 bg-[#f7bfd2]/12 text-[#ffdce8]'
                                                    : m.level === 1
                                                        ? 'border-[#b9e1c9]/30 bg-[#b9e1c9]/10 text-[#d9f3e4]'
                                                        : 'border-[#fff1bd]/28 bg-[#fff1bd]/10 text-[#fff1bd]';
                                                return (
                                                    <div key={m.id} className={`relative overflow-hidden rounded-[16px] border bg-[#100c11]/76 shadow-[0_16px_32px_rgba(0,0,0,0.3),0_1px_0_rgba(255,255,255,0.06)_inset] backdrop-blur-xl transition-[border-color,transform,box-shadow] duration-200 hover:border-[#fff1bd]/20 active:scale-[0.992] ${isExpanded ? 'border-[#fff1bd]/20' : 'border-white/[0.075]'}`}>
                                                        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[#fff1bd]/28 to-transparent" />
                                                        <div className="absolute -left-8 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-[#fff1bd]/[0.025] blur-2xl" />
                                                        <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-b from-[#f7bfd2]/40 via-[#fff1bd]/46 to-[#a98bd8]/32" />
                                                        <button
                                                            onClick={() => { setExpandedMemId(isExpanded ? null : m.id); haptic.light(); }}
                                                            className="relative flex w-full gap-3 px-4 py-4 pl-5 text-left"
                                                        >
                                                            <div className="shrink-0 pt-0.5">
                                                                <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[#fff1bd]/18 bg-[#09080c]/62 shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
                                                                    <div className="absolute inset-2 rounded-full border border-white/[0.055]" />
                                                                    <div className="absolute h-1.5 w-1.5 rounded-full bg-[#fff1bd]/70" />
                                                                    <div className="relative mt-14 text-[10px] font-bold leading-none text-[#fff1bd]/84" style={{ fontFamily: 'Georgia, serif' }}>{String(index + 1).padStart(2, '0')}</div>
                                                                </div>
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] ${tagClassName}`}>{tag}</span>
                                                                    <span className="truncate text-[13px] font-semibold text-[#fffaf0]/90">{m.title || '未命名回忆'}</span>
                                                                </div>
                                                                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] text-white/34">
                                                                    <span className="font-mono">{timeStr}</span>
                                                                    <span>重要度 {m.importance || 5}/10</span>
                                                                    {m.source === 'musing' && <span className="text-[#ffdce8]/62 italic">独处浮现录</span>}
                                                                </div>
                                                            </div>
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                                                                className={`mt-1 h-4 w-4 shrink-0 text-[#fff1bd]/56 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                                            </svg>
                                                        </button>

                                                        {isExpanded && (
                                                            <div className="relative px-4 pb-4 pt-1">
                                                                <div className="absolute left-5 right-4 top-0 h-px bg-gradient-to-r from-transparent via-[#fff1bd]/18 to-transparent" />
                                                                {!isEditing ? (
                                                                    <div className="mt-3 rounded-[14px] border border-[#ead8b8]/70 bg-[#fff8ed]/[0.94] p-4 text-[#211913] shadow-[0_12px_24px_rgba(0,0,0,0.2),0_1px_0_rgba(255,255,255,0.62)_inset]">
                                                                        <div className="mb-3 flex items-center gap-2 text-[8px] font-semibold tracking-[0.18em] text-[#9c7650]/62">
                                                                            <span className="h-px flex-1 bg-[#d8b987]/34" />
                                                                            INNER SLEEVE
                                                                        </div>
                                                                        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#3a2f27]/82" style={{ fontFamily: "'Noto Serif SC', serif" }}>{m.content}</p>
                                                                        {m.emotionalJourney && (
                                                                            <div className="mt-4 rounded-[12px] border border-[#d99aae]/28 bg-[#f7bfd2]/18 p-3">
                                                                                <p className="mb-1 text-[9px] font-semibold tracking-[0.16em] text-[#a45f76]/72">情绪余回</p>
                                                                                <p className="text-[11px] italic leading-relaxed text-[#5c414a]/76">{m.emotionalJourney}</p>
                                                                            </div>
                                                                        )}
                                                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#d8b987]/26 pt-3">
                                                                            <div className="text-[8px] tracking-[0.12em] text-[#9c7650]/58">ID <span className="font-mono">{String(m.id || '').split('-').pop()}</span></div>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setEditDraft({ title: m.title, content: m.content, importance: m.importance }); setEditingMemId(m.id); }}
                                                                                className="rounded-full bg-[#211913] px-3.5 py-1.5 text-[10px] font-semibold text-[#fff1bd] shadow-[0_8px_18px_rgba(33,25,19,0.18)] transition-all active:scale-[0.97]"
                                                                            >
                                                                                修饰回忆
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="mt-3 flex flex-col gap-3 rounded-[14px] border border-[#ead8b8]/70 bg-[#fff8ed]/[0.95] p-4 shadow-[0_12px_24px_rgba(0,0,0,0.2),0_1px_0_rgba(255,255,255,0.62)_inset]">
                                                                        <input value={editDraft?.title || ''} onChange={e => setEditDraft(prev => prev ? { ...prev, title: e.target.value } : null)}
                                                                            className="w-full rounded-[10px] border border-[#d8b987]/38 bg-white/62 px-3 py-2 text-[12px] font-semibold text-[#211913] outline-none focus:border-[#b88952]/54 focus:bg-white"
                                                                            placeholder="回忆标题..." />
                                                                        <textarea value={editDraft?.content || ''} onChange={e => setEditDraft(prev => prev ? { ...prev, content: e.target.value } : null)}
                                                                            className="h-28 w-full resize-none rounded-[10px] border border-[#d8b987]/38 bg-white/62 px-3 py-2 text-[12px] leading-relaxed text-[#3a2f27] outline-none focus:border-[#b88952]/54 focus:bg-white"
                                                                            placeholder="记忆内容..." />
                                                                        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                                                                            <label className="flex items-center gap-2 rounded-full border border-[#d8b987]/32 bg-white/58 px-3 py-1.5 text-[10px] font-semibold text-[#8f6b3b]">
                                                                                重要度
                                                                                <input type="number" min="1" max="10" value={editDraft?.importance || 5}
                                                                                    onChange={e => setEditDraft(prev => prev ? { ...prev, importance: parseInt(e.target.value) || 5 } : null)}
                                                                                    className="w-10 bg-transparent text-right text-[#211913] outline-none" />
                                                                            </label>
                                                                            <div className="flex gap-2">
                                                                                <button onClick={() => setEditingMemId(null)} className="rounded-full px-4 py-1.5 text-[10px] font-semibold text-[#8f6b3b] transition-colors hover:bg-[#ead8b8]/28">取消</button>
                                                                                <button disabled={saving} onClick={() => doSaveEdit(m.id)}
                                                                                    className="rounded-full bg-[#211913] px-4 py-1.5 text-[10px] font-bold text-[#fff1bd] shadow-[0_8px_18px_rgba(33,25,19,0.18)] disabled:opacity-50">
                                                                                    {saving ? '结晶中...' : '保存修改'}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <section className="relative min-h-[300px] overflow-hidden rounded-[24px] border border-[#b98e5e]/28 bg-[#1a1416]/78 px-5 py-7 shadow-[0_24px_48px_rgba(0,0,0,0.4),0_1px_0_rgba(255,244,214,0.09)_inset] backdrop-blur-2xl transition-[border-color,transform] duration-200 hover:border-[#e6c486]/34 active:scale-[0.992] sm:px-6">
                                            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#ffe4a3]/38 to-transparent" />
                                            <div className="absolute -left-12 bottom-8 h-44 w-44 rounded-full border border-[#c5a06a]/12 bg-[radial-gradient(circle,#171316_0%,#171316_42%,#050406_43%,#050406_100%)] shadow-[0_18px_38px_rgba(0,0,0,0.45)]" />
                                            <div className="absolute left-2 bottom-9 h-36 w-36 sm:left-5">
                                                <img src="/images/cognitive-vinyl/clock-postage.png" alt="" className="absolute -left-4 -top-5 w-40 rotate-[-8deg] opacity-[0.58] mix-blend-screen sm:w-44" />
                                                <img src="/images/cognitive-vinyl/archive-card.png" alt="" className="absolute -right-8 bottom-1 w-24 rotate-[5deg] opacity-[0.22] mix-blend-screen sm:w-28" />
                                            </div>
                                            <div className="relative ml-[122px] flex min-h-[240px] min-w-0 max-w-none flex-col justify-center text-left sm:ml-auto sm:max-w-[380px] sm:pr-8">
                                                <p className="text-[41px] leading-[0.9] text-[#f6d8a1] drop-shadow-[0_4px_18px_rgba(246,216,161,0.12)] sm:text-[52px]" style={{ fontFamily: "'Cognitive Vinyl Script', 'Pinyon Script', 'Bickham Script Pro', 'Edwardian Script ITC', cursive" }}>No Needle Yet</p>
                                                <div className="mt-4 flex items-center gap-3">
                                                    <span className="h-1.5 w-1.5 rotate-45 bg-[#e9c489]/70" />
                                                    <span className="h-px w-28 bg-gradient-to-r from-[#e9c489]/46 to-transparent" />
                                                </div>
                                                <p className="mt-5 max-w-[170px] text-[12px] font-medium leading-relaxed text-[#d8d0c8]/54 sm:max-w-[250px] sm:text-[14px]">新的回忆写入后，会成为这里的第一首私人藏曲。</p>
                                                <button
                                                    type="button"
                                                    onClick={() => { setActiveTab('workshop'); haptic.medium(); }}
                                                    className="mt-7 inline-flex w-fit max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-[12px] border border-[#d8b987]/34 bg-white/[0.035] px-3.5 py-3 text-[11px] font-semibold tracking-[0.04em] text-[#e9c489] shadow-[0_12px_24px_rgba(0,0,0,0.2)] transition-[border-color,background-color,transform] duration-200 hover:border-[#e9c489]/48 hover:bg-white/[0.06] active:scale-[0.97] sm:px-5 sm:text-[13px]"
                                                    style={{ fontFamily: "'Noto Serif SC', serif" }}
                                                >
                                                    <span className="text-[12px]">▸</span>
                                                    记录一段回忆声纹
                                                </button>
                                            </div>
                                        </section>
                                    )}
                                </>
                            )}
                            <div className="flex items-center justify-center gap-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-1 text-[11px] tracking-[0.22em] text-[#d8bd90]/28" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                                <span className="h-px w-16 bg-gradient-to-r from-transparent via-[#d8bd90]/22 to-transparent" />
                                所有声音，仅为你而存
                                <span className="h-px w-16 bg-gradient-to-r from-transparent via-[#d8bd90]/22 to-transparent" />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── WORKSHOP TAB ── */}
                {activeTab === 'workshop' && (
                    <div className="flex-1 overflow-y-auto no-scrollbar relative" style={{ background: 'radial-gradient(circle at 50% -20%, rgba(255,255,255,0.08) 0%, transparent 34%), linear-gradient(175deg, #0C0B0F 0%, #111015 48%, #0D0C11 100%)' }}>
                        <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                            <img src="/images/collage/flower-cosmos.png" alt="" className="absolute top-[16%] -left-10 w-48 opacity-[0.1]" style={{ filter: 'invert(1) brightness(1.5)', transform: 'rotate(-25deg)' }} />
                            <img src="/images/collage/clock-airmail.png" alt="" className="absolute top-8 right-1 w-28 opacity-[0.14]" style={{ filter: 'invert(1) brightness(1.6)', transform: 'rotate(8deg)' }} />
                        </div>
                        <div className="relative z-10 px-5 pt-16 pb-20">
                            <div className="text-center mb-2 relative">
                                <h2 className="text-[34px] font-bold text-white/90 tracking-[0.34em] leading-none mb-1" style={{ fontFamily: "'Noto Serif SC', serif" }}>拾 念</h2>
                                <p className="text-[10px] text-white/28 mt-3 tracking-[0.16em] italic leading-relaxed" style={{ fontFamily: "'Noto Serif SC', serif" }}>没说出口的心动，也会被他悄悄珍藏</p>
                            </div>
                            <div className="flex justify-center gap-2 overflow-x-auto no-scrollbar mt-6 mb-10 -mx-5 px-5">
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => { setSelectedCharId(c.id); haptic.light(); }}
                                        className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[10px] font-medium transition-all ${selectedCharId === c.id ? 'bg-white/90 text-[#1E1E20] shadow-[0_4px_20px_rgba(255,255,255,0.12)]' : 'bg-white/[0.04] text-white/35 border border-white/[0.06] hover:bg-white/[0.08]'}`}>
                                        <img src={c.avatar} alt={c.name} className="w-4 h-4 rounded-full object-cover" />
                                        {c.name}
                                    </button>
                                ))}
                            </div>
                            <div className="relative space-y-[14px]">
                                <span className="absolute -top-5 right-2 text-[7px] text-white/[0.1] italic tracking-[0.15em] select-none pointer-events-none" style={{ fontFamily: "Georgia, serif" }}>Good night</span>
                                <div className="relative transition-transform duration-300 hover:-translate-y-0.5">
                                    <span className="absolute -top-5 -left-1 text-[46px] font-extralight text-white/[0.06] select-none pointer-events-none z-0" style={{ fontFamily: "'Ma Shan Zheng', serif", letterSpacing: '0.05em' }}>01</span>
                                    <div className="bg-[#FFFBF7]/[0.96] backdrop-blur-xl rounded-[14px] border border-white/30 overflow-hidden shadow-[0_12px_30px_rgba(0,0,0,0.38),0_1px_0_rgba(255,255,255,0.45)_inset] relative z-10">
                                        <div className="absolute top-4 bottom-4 left-[38%] border-l border-[#D9CDC0]/80" />
                                        <div className="flex items-stretch gap-0 p-0 min-h-[140px]">
                                            <div className="w-[38%] shrink-0 overflow-hidden"><img src="/images/workshop-birds.jpg" alt="" className="w-full h-full object-cover" style={{ filter: 'brightness(0.88) contrast(1.08)' }} /></div>
                                            <div className="flex-1 flex flex-col justify-between p-4 min-w-0">
                                                <div><h4 className="text-[13px] font-bold text-[#1E1C22] tracking-wide mb-1.5" style={{ fontFamily: "'Noto Serif SC', serif" }}>时光编织</h4><p className="text-[10px] text-[#6B6675] leading-[1.7]">把每一次相遇串成时间轴上的珠子，让前因后果自然相连。</p></div>
                                                <div className="flex justify-end mt-2"><button onClick={() => { setShowConfirm('temporal'); haptic.light(); }} disabled={backfilling || !selectedCharId} className="px-4 py-1.5 rounded-full text-[10px] font-semibold text-white bg-[#2A2830] hover:bg-[#1E1C22] active:scale-[0.97] transition-all disabled:opacity-40">{backfilling ? '编织中…' : '纺线 →'}</button></div>
                                            </div>
                                        </div>
                                        {backfillResult && !backfilling && (<div className="mx-5 mb-5 pt-4 border-t border-[#EEEDF0]"><ResultCard title="编织报告" isDryRun={false} stats={[{value:backfillResult.totals?.memories??0,label:'跨越片段'},{value:backfillResult.totals?.linksCreated??0,label:'丝线成型'},{value:backfillResult.totals?.edgesCreated??0,label:'因果落定'}]} items={[]} note={undefined} /></div>)}
                                    </div>
                                </div>
                                <div className="relative transition-transform duration-300 hover:-translate-y-0.5">
                                    <span className="absolute -top-5 -left-1 text-[46px] font-extralight text-white/[0.06] select-none pointer-events-none z-0" style={{ fontFamily: "'Ma Shan Zheng', serif", letterSpacing: '0.05em' }}>02</span>
                                    <div className="bg-[#FFFBF7]/[0.96] backdrop-blur-xl rounded-[14px] border border-white/30 overflow-hidden shadow-[0_12px_30px_rgba(0,0,0,0.38),0_1px_0_rgba(255,255,255,0.45)_inset] relative z-10">
                                        <div className="absolute top-4 bottom-4 left-[38%] border-l border-[#D9CDC0]/80" />
                                        <div className="flex items-stretch gap-0 p-0 min-h-[140px]">
                                            <div className="w-[38%] shrink-0 overflow-hidden"><img src="/images/workshop-window.jpg" alt="" className="w-full h-full object-cover" style={{ filter: 'brightness(0.88) contrast(1.08)' }} /></div>
                                            <div className="flex-1 flex flex-col justify-between p-4 min-w-0">
                                                <div><h4 className="text-[13px] font-bold text-[#1E1C22] tracking-wide mb-1.5" style={{ fontFamily: "'Noto Serif SC', serif" }}>心意提取</h4><p className="text-[10px] text-[#6B6675] leading-[1.7]">捕捉话语间微妙的情感共振，找到那些不曾说出口的默契。</p></div>
                                                <div className="flex justify-end gap-1.5 mt-2 flex-wrap">
                                                    {queueStatus?.running && queueStatus.canAbort && !queueStatus.aborted && (<button onClick={handleAbortSemantic} className="px-3 py-1.5 rounded-full text-[10px] font-medium text-[#C48070] border border-[#E0DDE4] hover:bg-[#F5F4F6] transition-all">暂停</button>)}
                                                    <button onClick={() => { setShowConfirm('semanticRebuild'); haptic.light(); }} disabled={semanticRebuilding || !selectedCharId} className="px-3 py-1.5 rounded-full text-[10px] font-medium text-[#6B6675] border border-[#E0DDE4] hover:bg-[#F5F4F6] active:scale-[0.97] transition-all disabled:opacity-40">全部重来</button>
                                                    <button onClick={() => { setShowConfirm('semantic'); haptic.light(); }} disabled={semanticRunning || !selectedCharId} className="px-4 py-1.5 rounded-full text-[10px] font-semibold text-white bg-[#2A2830] hover:bg-[#1E1C22] active:scale-[0.97] transition-all disabled:opacity-40">{semanticRunning && !semanticRebuilding ? '感应中…' : '执行 →'}</button>
                                                </div></div></div></div></div>
                                <div className="relative transition-transform duration-300 hover:-translate-y-0.5">
                                    <span className="absolute -top-5 -left-1 text-[46px] font-extralight text-white/[0.06] select-none pointer-events-none z-0" style={{ fontFamily: "'Ma Shan Zheng', serif", letterSpacing: '0.05em' }}>03</span>
                                    <div className="bg-[#FFFBF7]/[0.96] backdrop-blur-xl rounded-[14px] border border-white/30 overflow-hidden shadow-[0_12px_30px_rgba(0,0,0,0.38),0_1px_0_rgba(255,255,255,0.45)_inset] relative z-10">
                                        <div className="absolute top-4 bottom-4 left-[38%] border-l border-[#D9CDC0]/80" />
                                        <div className="flex items-stretch gap-0 p-0 min-h-[140px]">
                                            <div className="w-[38%] shrink-0 overflow-hidden"><img src="/images/workshop-papers.jpg" alt="" className="w-full h-full object-cover" style={{ filter: 'brightness(0.88) contrast(1.08)' }} /></div>
                                            <div className="flex-1 flex flex-col justify-between p-4 min-w-0">
                                                <div><h4 className="text-[13px] font-bold text-[#1E1C22] tracking-wide mb-1.5" style={{ fontFamily: "'Noto Serif SC', serif" }}>回忆结晶</h4><p className="text-[10px] text-[#6B6675] leading-[1.7]">将零碎的日常沉淀成一枚枚恒久的印象，像琥珀封住光阴。</p></div>
                                                <div className="flex justify-end gap-1.5 mt-2">
                                                    <button onClick={() => { setShowConfirm('distillRebuild'); haptic.light(); }} disabled={distillRebuilding || !selectedCharId} className="px-3 py-1.5 rounded-full text-[10px] font-medium text-[#6B6675] border border-[#E0DDE4] hover:bg-[#F5F4F6] active:scale-[0.97] transition-all disabled:opacity-40">打破重聚</button>
                                                    <button onClick={() => { setShowConfirm('distill'); haptic.light(); }} disabled={distilling || !selectedCharId} className="px-4 py-1.5 rounded-full text-[10px] font-semibold text-white bg-[#2A2830] hover:bg-[#1E1C22] active:scale-[0.97] transition-all disabled:opacity-40">{distilling ? '结晶中…' : '萃取印象 →'}</button>
                                                </div></div></div>
                                        {distillResult && !distilling && (distillResult.l1Created > 0 || distillResult.l1Merged > 0) && (<div className="mx-5 mb-5 pt-4 border-t border-[#EEEDF0]"><ResultCard title="结晶报告" isDryRun={false} stats={[{value:distillResult.l1Created,label:'L1 新建'},{value:distillResult.l1Merged,label:'合并'},{value:distillResult.l0Linked,label:'L0 关联'}]} items={[]} note={undefined} /></div>)}
                                    </div>
                                </div>
                                {queueStatus && (<div className="bg-white/[0.05] backdrop-blur-xl border border-white/[0.06] text-white/90 rounded-2xl p-5 overflow-hidden mt-4" style={{ transform: 'rotate(0.3deg)' }}>
                                    <div className="flex justify-between items-center mb-3"><h4 className="text-[12px] font-semibold tracking-wider flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${queueStatus.running ? 'bg-emerald-400 animate-pulse' : 'bg-white/30'}`} />处理进度</h4><span className="text-[9px] text-white/40 font-mono">{queueStatus.aborted ? '已暂停' : queueStatus.running ? '进行中' : '完成'}</span></div>
                                    <div className="relative h-1 bg-white/10 rounded-full overflow-hidden mb-4"><div className="absolute top-0 left-0 h-full bg-white/50 rounded-full transition-all duration-500" style={{ width: `${queueStatus.total > 0 ? ((queueStatus.done + queueStatus.errors) / queueStatus.total) * 100 : 0}%` }} /></div>
                                    <div className="flex justify-between text-[10px] text-white/50"><span>{queueStatus.done} / {queueStatus.total} 完成</span>{queueStatus.errors > 0 && <span className="text-rose-300">{queueStatus.errors} 异常</span>}{(queueStatus.totalRelations ?? 0) > 0 && <span>{queueStatus.totalRelations} 关联</span>}</div>
                                    {queueStatus.lastError && (<div className="mt-3 text-[9px] text-rose-300/80 font-mono break-words bg-white/5 p-2 rounded-lg">{queueStatus.lastError}</div>)}
                                </div>)}
                            </div>
                            <div className="mt-20 mb-4 text-center"><div className="w-10 h-px bg-white/[0.06] mx-auto mb-5" /><p className="text-[8px] text-white/[0.1] tracking-[0.3em] italic leading-loose" style={{ fontFamily: "'Noto Serif SC', serif" }}>记忆从不褪色，只是被时间温柔收藏。</p><p className="text-[7px] text-white/[0.05] tracking-[0.15em] mt-3 italic" style={{ fontFamily: "Georgia, serif" }}>Cognitive Engine</p></div>
                        </div></div>
                )}

                {/* ── SYNC TAB ── */}
                {activeTab === 'sync' && (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#0b0a0c]">
                        <div className="mx-auto flex min-h-full max-w-[860px] flex-col justify-center px-4 pt-[calc(3.25rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6">
                            <div className="mb-3 flex items-center justify-between px-1">
                                <p className="text-[10px] font-semibold tracking-[0.28em] text-[#d8bd90]/58">漫游备份</p>
                                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold ${isConnected ? 'border-[#8bb99a]/34 bg-[#8bb99a]/12 text-[#ccefd9]' : 'border-[#d99aae]/30 bg-[#d99aae]/10 text-[#ffdce8]'}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-[#a9d9ba]' : 'bg-[#d99aae]'}`} />
                                    {isConnected ? '云端可通行' : '未连接'}
                                </span>
                            </div>

                            <section className="overflow-hidden rounded-[26px] border border-[#d2b16f]/34 bg-[#f4ead8] shadow-[0_28px_64px_rgba(0,0,0,0.46)] lg:grid lg:grid-cols-[0.92fr_1.08fr]">
                                <div className="relative min-h-[360px] overflow-hidden bg-[#152238] text-[#f6df9f]">
                                    <div className="absolute inset-5 rounded-[18px] border border-[#d7b56c]/40" />
                                    <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%,rgba(0,0,0,0.18))]" />
                                    <img src="/images/cognitive-passport/passport-ticket-banner.png" alt="" loading="eager" decoding="async" className="absolute -bottom-10 left-1/2 w-[430px] max-w-none -translate-x-1/2 rotate-[-2deg] opacity-[0.08] mix-blend-screen" />

                                    <div className="relative z-10 flex min-h-[360px] flex-col justify-between p-8 sm:p-9">
                                        <p className="text-[10px] font-semibold tracking-[0.42em] text-[#e8cf8b]/78">MEMORY PASSPORT</p>

                                        <div className="text-center">
                                            <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full border border-[#d7b56c]/50">
                                                <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.35} d="M12 3.75 18.25 6v5.4c0 4.08-2.68 7.55-6.25 8.85-3.57-1.3-6.25-4.77-6.25-8.85V6L12 3.75Z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.35} d="M9.2 12.2h5.6M12 9.4V15" />
                                                </svg>
                                            </div>
                                            <h2 className="text-[42px] font-bold leading-none tracking-[0.16em] text-[#ffe8a3]" style={{ fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif" }}>回忆护照</h2>
                                            <p className="mx-auto mt-5 max-w-[280px] text-[12px] font-medium leading-[1.9] text-[#f2e6c6]/76" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                                                把这一份关系盖上云端印章，换个设备也能继续想起他。
                                            </p>
                                        </div>

                                        <div className="flex items-end justify-between gap-4 text-[10px] font-semibold tracking-[0.18em] text-[#e8cf8b]/62">
                                            <span>NO. {syncUserId.slice(0, 12).toUpperCase()}</span>
                                            <span>{characters.length} 位</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="relative overflow-hidden p-5 text-[#271e17] sm:p-7">
                                    <img src="/images/cognitive-passport/passport-lace-frame.png" alt="" loading="eager" decoding="async" className="pointer-events-none absolute -right-24 -bottom-24 w-[260px] opacity-[0.06]" />

                                    <div className="relative z-10">
                                        <div className="flex items-start justify-between gap-4 border-b border-[#d3b982]/45 pb-5">
                                            <div>
                                                <p className="text-[9px] font-bold tracking-[0.3em] text-[#9f7a49]/58">RELATION ENTRY</p>
                                                <h3 className="mt-2 text-[22px] font-bold tracking-[0.08em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>云端通行页</h3>
                                            </div>
                                            <div className="flex h-16 w-16 shrink-0 rotate-[-8deg] items-center justify-center rounded-full border-2 border-[#b98552]/45 text-center text-[8px] font-black leading-[1.25] tracking-[0.16em] text-[#a4683d]">
                                                CLOUD<br />SEAL
                                            </div>
                                        </div>

                                        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                                            {[
                                                { label: '持有人', value: userProfile.name || '我' },
                                                { label: '收录对象', value: `${characters.length} 位` },
                                                { label: '通行状态', value: isConnected ? '云端可通行' : '暂未连接' },
                                                { label: '同步方式', value: '手动签收' },
                                            ].map(item => (
                                                <div key={item.label} className="min-w-0 border-b border-[#d3b982]/32 pb-2">
                                                    <p className="text-[8px] font-bold tracking-[0.22em] text-[#9f7a49]/55">{item.label}</p>
                                                    <p className="mt-1 truncate text-[13px] font-bold text-[#271e17]">{item.value}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-5 rounded-[16px] border border-[#d0ad70]/45 bg-[#fffaf0]/72 p-4">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <span className="text-[9px] font-bold tracking-[0.24em] text-[#8b663e]/60">我的通行印记</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        try { navigator.clipboard.writeText(syncUserId); } catch { const t = document.createElement('textarea'); t.value = syncUserId; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
                                                        addToast('已复制', 'success'); haptic.light();
                                                    }}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-[#b98552]/30 bg-white/60 px-3 py-1.5 text-[9px] font-bold text-[#7b5632] transition-all active:scale-[0.97]"
                                                >
                                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
                                                    复制
                                                </button>
                                            </div>
                                            <p className="break-all font-mono text-[11px] font-bold leading-relaxed tracking-[0.08em] text-[#2c2119] select-all">{syncUserId}</p>
                                        </div>

                                        {!isConnected && (
                                            <p className="mt-4 rounded-[12px] border border-[#b46a6a]/24 bg-[#b46a6a]/10 px-3 py-2 text-[10px] font-medium leading-relaxed text-[#8c4a4a]">还没有连接到记忆服务，暂时不能签收或盖章。</p>
                                        )}

                                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                            <button
                                                type="button"
                                                disabled={syncing || !isConnected}
                                                onClick={pullSync}
                                                className="rounded-[14px] bg-[#172235] px-4 py-3 text-left text-[#ffe8a3] shadow-[0_10px_22px_rgba(23,34,53,0.22)] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-[#d8cfbf] disabled:text-[#8d8271]"
                                            >
                                                <span className="block text-[14px] font-bold tracking-[0.12em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>{syncing ? '签收中...' : '签收回忆'}</span>
                                                <span className="mt-1 block text-[10px] font-medium opacity-70">从云端唤回</span>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={syncing || !isConnected || !!bindInput.trim()}
                                                onClick={pushSync}
                                                className="rounded-[14px] border border-[#172235]/16 bg-white/64 px-4 py-3 text-left text-[#271e17] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-42"
                                            >
                                                <span className="block text-[14px] font-bold tracking-[0.12em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>{syncing ? '盖章中...' : '盖章入云'}</span>
                                                <span className="mt-1 block text-[10px] font-medium opacity-60">写入云端护照</span>
                                            </button>
                                        </div>

                                        <div className="mt-5 border-t border-[#d3b982]/45 pt-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="text-[9px] font-bold tracking-[0.26em] text-[#9f7a49]/52">OTHER PASSPORT</p>
                                                    <h4 className="mt-1 text-[15px] font-bold tracking-[0.08em]" style={{ fontFamily: "'Noto Serif SC', serif" }}>登记另一枚印记</h4>
                                                </div>
                                                {!syncCodeVisible && (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setSyncCodeVisible(true); haptic.light(); }}
                                                        className="rounded-full border border-[#b98552]/32 bg-[#fffaf0]/78 px-4 py-2 text-[11px] font-bold text-[#6f4b2d] transition-all active:scale-[0.97]"
                                                    >
                                                        登记
                                                    </button>
                                                )}
                                            </div>

                                            {syncCodeVisible && (
                                                <div className="mt-3 space-y-2">
                                                    <div className="flex min-w-0 gap-2">
                                                        <input
                                                            type="text"
                                                            value={bindInput}
                                                            onChange={e => setBindInput(e.target.value)}
                                                            placeholder="输入另一台设备上的印记 ID"
                                                            autoCapitalize="off"
                                                            spellCheck={false}
                                                            className="min-w-0 flex-1 rounded-[12px] border border-[#b98552]/30 bg-white/78 px-3 py-3 font-mono text-[11px] font-bold tracking-[0.04em] text-[#271e17] outline-none focus:border-[#8d673c]"
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={!bindInput.trim()}
                                                            onClick={() => setShowConfirm('syncBind')}
                                                            className="shrink-0 rounded-[12px] bg-[#172235] px-4 py-3 text-[11px] font-bold text-[#ffe8a3] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
                                                        >
                                                            登记
                                                        </button>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setBindInput(''); setSyncCodeVisible(false); haptic.light(); }}
                                                        className="text-[10px] font-medium text-[#7f684e]/70"
                                                    >
                                                        收起
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {syncResult && !syncing && (
                                            <div className="mt-5 grid grid-cols-2 gap-3 text-center">
                                                <div className="rounded-[14px] border border-[#d0ad70]/36 bg-white/44 px-3 py-3">
                                                    <p className="text-[9px] font-bold tracking-[0.18em] text-[#9f7a49]/56">本次签收</p>
                                                    <p className="mt-1 text-[24px] font-bold leading-none text-[#40694f]" style={{ fontFamily: "Georgia, serif" }}>{syncResult.pulled}</p>
                                                </div>
                                                <div className="rounded-[14px] border border-[#d0ad70]/36 bg-white/44 px-3 py-3">
                                                    <p className="text-[9px] font-bold tracking-[0.18em] text-[#9f7a49]/56">本次盖章</p>
                                                    <p className="mt-1 text-[24px] font-bold leading-none text-[#8b5e32]" style={{ fontFamily: "Georgia, serif" }}>{syncResult.pushed}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </div>

            {activeClaimStat && (
                <div className="fixed inset-0 z-[60]">
                    <button
                        type="button"
                        aria-label="关闭整理归属"
                        onClick={closeClaimDrawer}
                        className="absolute inset-0 bg-black/58 backdrop-blur-[2px]"
                    />
                    <div className="absolute inset-x-0 bottom-0 z-[61] mx-auto max-h-[86vh] w-full max-w-[520px] overflow-y-auto rounded-t-[22px] border border-white/[0.08] bg-[#121015]/96 px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_70px_rgba(0,0,0,0.62)]">
                        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/18" />
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold tracking-[0.24em] text-[#e5d08f]/68">待归档回忆</p>
                                <h3 className="mt-1 text-[22px] font-semibold leading-tight text-[#fffaf0]" style={{ fontFamily: "'Noto Serif SC', serif" }}>整理归属</h3>
                            </div>
                            <button
                                type="button"
                                onClick={closeClaimDrawer}
                                className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[10px] font-semibold text-white/48 transition-colors hover:bg-white/[0.08]"
                            >
                                收起
                            </button>
                        </div>

                        <section className="mt-4 rounded-[14px] border border-[#e5d08f]/16 bg-white/[0.035] p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-semibold tracking-[0.18em] text-white/34">这组回忆</p>
                                    <p className="mt-1 text-[24px] font-semibold leading-none text-[#fff1bd]" style={{ fontFamily: "Georgia, serif" }}>{activeClaimStat.memories}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-semibold tracking-[0.18em] text-white/34">最近时间</p>
                                    <p className="mt-1 text-[13px] font-semibold text-white/66">
                                        {formatOrphanPreviewDate(activeClaimPreview?.memories?.[0]?.createdAt)}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3 space-y-2">
                                {activeClaimPreview?.loading ? (
                                    <p className="rounded-[10px] border border-white/[0.045] bg-black/14 px-3 py-3 text-[11px] text-white/42">正在拾取回忆线索...</p>
                                ) : activeClaimPreview?.memories.length ? (
                                    activeClaimPreview.memories.map(memory => (
                                        <div key={memory.id || `${memory.createdAt || 0}-${getOrphanPreviewTitle(memory)}`} className="rounded-[10px] border border-white/[0.055] bg-black/14 px-3 py-2.5">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="min-w-0 truncate text-[11px] font-semibold text-white/68">{getOrphanPreviewTitle(memory)}</p>
                                                <p className="shrink-0 text-[9px] text-white/30">{formatOrphanPreviewDate(memory.createdAt)}</p>
                                            </div>
                                            <p className="mt-1.5 text-[11px] leading-relaxed text-white/42">{getOrphanPreviewSnippet(memory)}</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="rounded-[10px] border border-white/[0.045] bg-black/14 px-3 py-3 text-[11px] leading-relaxed text-white/42">
                                        暂时没有取到预览，但这组云端回忆仍然可以归档到本机角色。
                                    </p>
                                )}
                            </div>
                        </section>

                        <section className="mt-4">
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-[10px] font-semibold tracking-[0.22em] text-[#e5d08f]/62">选择归属角色</p>
                                <p className="text-[9px] text-white/28">{characters.length} PROFILES</p>
                            </div>
                            <div className="grid gap-2">
                                {characters.map(char => {
                                    const selected = claimTargetCharId === char.id;
                                    return (
                                        <button
                                            key={char.id}
                                            type="button"
                                            onClick={() => { setClaimTargetCharId(char.id); haptic.light(); }}
                                            className={`flex items-center justify-between gap-3 rounded-[13px] border px-3 py-2.5 text-left transition-all active:scale-[0.985] ${
                                                selected
                                                    ? 'border-[#e5d08f]/40 bg-[#fff7dc]/10 shadow-[0_10px_24px_rgba(229,208,143,0.08)]'
                                                    : 'border-white/[0.065] bg-white/[0.035] hover:bg-white/[0.06]'
                                            }`}
                                        >
                                            <span className="flex min-w-0 items-center gap-3">
                                                <img src={char.avatar} alt={char.name} className="h-8 w-8 rounded-full object-cover ring-1 ring-white/18" />
                                                <span className="min-w-0 truncate text-[13px] font-semibold text-white/72">{char.name}</span>
                                            </span>
                                            <span className={`h-4 w-4 rounded-full border ${selected ? 'border-[#fff1bd] bg-[#fff1bd]' : 'border-white/18 bg-white/[0.03]'}`} />
                                        </button>
                                    );
                                })}
                                {characters.length === 0 && (
                                    <div className="rounded-[13px] border border-white/[0.06] bg-white/[0.035] px-3 py-4 text-[11px] text-white/42">
                                        还没有可归档的本机角色。
                                    </div>
                                )}
                            </div>
                        </section>

                        <button
                            type="button"
                            disabled={!claimTargetChar || claimingCloudCharId === activeClaimStat.charId || syncing}
                            onClick={confirmClaimDrawer}
                            className="mt-4 w-full rounded-[14px] border border-[#e5d08f]/22 bg-[#FFFBF7] px-4 py-3.5 text-[12px] font-bold text-[#17151B] shadow-[0_12px_30px_rgba(255,251,247,0.12)] transition-all active:scale-[0.985] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-white/30 disabled:shadow-none"
                        >
                            {claimingCloudCharId === activeClaimStat.charId
                                ? '归档中...'
                                : claimTargetChar
                                    ? `归档到${claimTargetChar.name}`
                                    : '先选择角色'}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Confirm Overlay ── */}
            {showConfirm && (
                <ConfirmBar
                    type={showConfirm}
                    onConfirm={() => {
                        if (showConfirm === 'temporal') startTemporalBackfill();
                        if (showConfirm === 'semantic') startSemanticSweep();
                        if (showConfirm === 'semanticRebuild') startSemanticRebuild();
                        if (showConfirm === 'distill') startDistillation();
                        if (showConfirm === 'distillRebuild') startDistillRebuild();
                        if (showConfirm === 'rescan') { doSemanticBackfill(false, true); }
                        if (showConfirm === 'syncBind') handleBindSyncCode();
                        setShowConfirm(null);
                    }}
                    onCancel={() => setShowConfirm(null)}
                />
            )}

            <MemoryRecordShareModal
                playable={shareModalPlayable}
                isSharing={isSharingMemoryRecord}
                onClose={() => setShareModalPlayable(null)}
                onShare={() => {
                    if (shareModalPlayable) {
                        void handleShareMemoryRecordPoster(shareModalPlayable);
                    }
                }}
            />
        </div>
    );
};

/* ─── Sub-components ─── */

const ConfirmBar: React.FC<{ type: string; onConfirm: () => void; onCancel: () => void }> = ({ type, onConfirm, onCancel }) => {
    let msg = '';
    let btn = '';
    if (type === 'temporal') { msg = '穿越时间的隧道，从头编织时光丝线？'; btn = '穿越'; }
    if (type === 'semantic') { msg = '开始感应散落的心意羁绊？'; btn = '开始感应'; }
    if (type === 'semanticRebuild') { msg = '打碎所有心意连接并重新构建全貌？'; btn = '彻底打碎并重建'; }
    if (type === 'rescan') { msg = '是否需要强制重新扫描所有回忆？'; btn = '重新扫描'; }
    if (type === 'distill') { msg = '将浮光掠影凝聚成深刻的印象？'; btn = '开始凝聚'; }
    if (type === 'distillRebuild') { msg = '将所有已有印象打碎退回，并重新凝聚？'; btn = '彻底重构印象'; }
    if (type === 'syncBind') { msg = '登记这枚印记后，之后会从它的云端回忆签收内容。继续吗？'; btn = '登记印记'; }

    return (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-50 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="backdrop-blur-2xl bg-[#111015]/90 p-4 rounded-[18px] shadow-[0_18px_44px_rgba(0,0,0,0.48)] border border-white/[0.08] max-w-sm w-full mx-auto">
                <p className="text-[12px] font-semibold text-[#F4EEE6]/80 mb-4 text-center leading-relaxed px-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>{msg}</p>
                <div className="flex gap-2.5">
                    <button onClick={onCancel} className="flex-1 py-3 text-[11px] font-semibold text-white/45 bg-white/[0.05] border border-white/[0.08] rounded-[12px] hover:bg-white/[0.08] transition-colors active:scale-[0.98]">
                        稍后再说
                    </button>
                    <button onClick={onConfirm} className={`flex-1 py-3 text-[11px] font-bold rounded-[12px] shadow-sm transition-all active:scale-[0.98] ${type.includes('Rebuild') || type === 'rescan' ? 'bg-[#F1DFD8] text-[#7B3F3A] hover:bg-[#F6E7E2]' : 'bg-[#FFFBF7] text-[#1E1C22] hover:bg-white'}`}>
                        {btn}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Spinner = () => <div className="w-5 h-5 border-[2px] border-[#E8DDD4] border-t-[#8B7355] rounded-full animate-spin mx-auto" />;

const ResultCard: React.FC<{
    title: string;
    isDryRun: boolean;
    items: { name: string; avatar: string; count: number; status: string; complete: boolean }[];
    stats: { value: number; label: string }[];
    note?: string;
}> = ({ title, isDryRun, stats, note }) => (
    <div className="pt-2">
        <div className="flex justify-between items-center mb-3">
            <h5 className="text-[11px] font-bold text-[#5C4F40] tracking-widest">{title}</h5>
            {isDryRun ? (
                <span className="text-[8px] bg-sky-50 text-sky-500 px-2.5 py-0.5 rounded-md font-bold">预览</span>
            ) : (
                <span className="text-[8px] bg-[#7EB5A0]/10 text-[#7EB5A0] px-2.5 py-0.5 rounded-md font-bold">落卷</span>
            )}
        </div>
        <div className="grid grid-cols-3 gap-2">
            {stats.map((s, idx) => (
                <div key={idx} className="bg-[#F8F3ED]/60 rounded-xl p-2.5 text-center border border-[#E8DDD4]/40">
                    <div className="text-[14px] font-mono font-bold text-[#8B7355]">{s.value}</div>
                    <div className="text-[8px] text-[#A89B8C] font-semibold mt-0.5">{s.label}</div>
                </div>
            ))}
        </div>
        {note && <div className="mt-3 text-[10px] text-rose-400 font-semibold text-center italic">{note}</div>}
    </div>
);

// inject slide-in animation
const sidebarStyle = document.createElement('style');
sidebarStyle.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700&display=swap');
@font-face {
  font-family: 'Cognitive Vinyl Script';
  src: url('/fonts/pinyon-script.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@keyframes slideInLeft {
  from { transform: translateX(-100%); opacity: 0.5; }
  to { transform: translateX(0); opacity: 1; }
}
`;
if (!document.querySelector('#sidebar-anim')) {
    sidebarStyle.id = 'sidebar-anim';
    document.head.appendChild(sidebarStyle);
}

export default CognitiveNetworkApp;
