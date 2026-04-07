
import React,{ useState,useCallback,useEffect,useMemo } from 'react';
import { buildBackendHeaders,getBackendUrl,getUserId,sanitizeBackendHeader,setUserId,pushMemories,pullMemories,listCloudChars } from '../utils/backendClient';
import { DB } from '../utils/db';
import { useOS } from '../context/OSContext';
import { haptic } from '../utils/haptics';
import { getEmbeddingConfig,getSecondaryApiConfig } from '../utils/runtimeConfig';

/* Recovered comment */

interface CharStats {
    charId: string;
    memories: number;
    relations: number;
    temporalEdges: number;
    semanticEdges: number;
    linkedCount: number;
    unscannedCount: number;
}

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

interface DistillResult {
    clustersFound: number;
    l1Created: number;
    l1Merged: number;
    l1Deduped: number;
    l0Linked: number;
    errors: number;
    elapsed: number;
    resetStats?: DistillResetStats;
}

/* Recovered comment */

const CognitiveNetworkApp: React.FC = () => {
    const { closeApp, addToast, characters, userProfile } = useOS();
    const [allStats, setAllStats] = useState<PerCharStatsResponse | null>(null);
    const [statsFailed, setStatsFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null); // null = 鍏ㄩ儴瑙掕壊
    const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
    const [semanticResult, setSemanticResult] = useState<SemanticResult | null>(null);
    const [backfilling, setBackfilling] = useState(false);
    const [semanticRunning, setSemanticRunning] = useState(false);
    const [showConfirm, setShowConfirm] = useState<'temporal' | 'semantic' | 'semanticRebuild' | 'rescan' | 'distill' | 'distillRebuild' | null>(null);
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
    const [browserLevel, setBrowserLevel] = useState<'all' | '0' | '1'>('all');
    const [browserCounts, setBrowserCounts] = useState<{ total: number; l0: number; l1: number }>({ total: 0, l0: 0, l1: 0 });
    const [expandedMemId, setExpandedMemId] = useState<string | null>(null);
    const [editingMemId, setEditingMemId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<{ title: string; content: string; importance: number } | null>(null);
    const [saving, setSaving] = useState(false);

    // Cloud Sync state
    const [syncCodeVisible, setSyncCodeVisible] = useState(false);
    const [bindInput, setBindInput] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ pushed: number; pulled: number } | null>(null);
    const semanticAbortRef = React.useRef<AbortController | null>(null);

    const charNameMap = useCallback((charId: string) => {
        const found = characters.find(c => c.id === charId);
        return found?.name || charId.slice(0, 12);
    }, [characters]);

    const charAvatarMap = useCallback((charId: string) => {
        const found = characters.find(c => c.id === charId);
        return found?.avatar || '';
    }, [characters]);

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
        if (!selectedCharId) {
            // 姹囨€诲叏閮ㄨ鑹诧紱鍚庣鍙兘缂哄皯閮ㄥ垎瀛楁锛岄粯璁よˉ 0
            return allStats.characters.reduce((acc, c) => ({
                memories: acc.memories + (c.memories || 0),
                relations: acc.relations + (c.relations || 0),
                temporalEdges: acc.temporalEdges + (c.temporalEdges || 0),
                semanticEdges: acc.semanticEdges + (c.semanticEdges || 0),
                linkedCount: acc.linkedCount + (c.linkedCount || 0),
                unscannedCount: acc.unscannedCount + (c.unscannedCount || 0),
            }), { memories: 0, relations: 0, temporalEdges: 0, semanticEdges: 0, linkedCount: 0, unscannedCount: 0 });
        }
        const found = allStats.characters.find(c => c.charId === selectedCharId);
        if (!found) return null;
        // Fill missing fields with defaults
        return {
            ...found,
            temporalEdges: found.temporalEdges || 0,
            semanticEdges: found.semanticEdges || 0,
            linkedCount: found.linkedCount || 0,
            unscannedCount: found.unscannedCount || 0,
        };
    }, [allStats, selectedCharId]);

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
                signal: AbortSignal.timeout(60000), // 60s timeout
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
                if (selectedCharId) processBody.charId = selectedCharId;
                const r = await fetch(`${url}/api/graph/semantic-process-one`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(processBody),
                    signal: controller?.signal,
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
    }, [authHeaders, addToast, selectedCharId]);

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
            if (selectedCharId) body.charId = selectedCharId;
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
    }, [authHeaders, addToast, selectedCharId, fetchStats, runSemanticQueue]);

    const doSemanticRebuild = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedCharId) return;
        setSemanticRunning(true);
        setSemanticRebuilding(true);
        setQueueStatus(null);
        setSemanticResult(null);
        try {
            const resp = await fetch(`${url}/api/graph/semantic-rebuild`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ charId: selectedCharId }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const result: SemanticRebuildResult = await resp.json();
            setSemanticRebuildResult({
                charId: selectedCharId,
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
    }, [authHeaders, addToast, selectedCharId, fetchStats, runSemanticQueue]);

    // Distillation 闇€瑕佸畬鏁?embedding 閰嶇疆锛屽洜姝や娇鐢?fullHeaders
    const doDistill = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedCharId) return;
        setDistilling(true);
        setDistillResetStats(null);
        try {
            const charName = charNameMap(selectedCharId);
            const resp = await fetch(`${url}/api/distillation/run`, {
                method: 'POST', headers: fullHeaders(),
                body: JSON.stringify({ charId: selectedCharId, charName, userName: userProfile.name }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
    }, [fullHeaders, addToast, selectedCharId, charNameMap, fetchStats]);

    const doDistillRebuild = useCallback(async () => {
        const url = getBackendUrl();
        if (!url || !selectedCharId) return;
        setDistillRebuilding(true);
        try {
            const charName = charNameMap(selectedCharId);
            const resp = await fetch(`${url}/api/distillation/reset-and-run`, {
                method: 'POST',
                headers: fullHeaders(),
                body: JSON.stringify({ charId: selectedCharId, charName, userName: userProfile.name }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const result: DistillResult = await resp.json();
            setDistillResult(result);
            setDistillResetStats(result.resetStats ? { charId: selectedCharId, ...result.resetStats } : null);

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
    }, [fullHeaders, addToast, selectedCharId, charNameMap, fetchStats, userProfile.name]);

    // Memory browser
    const fetchBrowserMemories = useCallback(async (level?: 'all' | '0' | '1') => {
        const url = getBackendUrl();
        if (!url || !selectedCharId) return;
        setBrowserLoading(true);
        try {
            const lvl = level || browserLevel;
            const params = lvl !== 'all' ? `?level=${lvl}` : '';
            const resp = await fetch(`${url}/api/memories/browse/${selectedCharId}${params}`, { headers: authHeaders() });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            setBrowserMemories(data.memories);
            setBrowserCounts({ total: data.count, l0: data.l0Count, l1: data.l1Count });
        } catch (e: any) { addToast(`载入失败: ${e.message}`, 'error'); }
        finally { setBrowserLoading(false); }
    }, [authHeaders, selectedCharId, browserLevel, addToast]);

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

    /* Render */

    /* Main UI */
    return (
        <div className="w-full h-full bg-[#f5f5f0] flex flex-col overflow-hidden">
            <header className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3">
                <button
                    onClick={() => { haptic.light(); closeApp(); }}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 active:bg-black/10 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-stone-400">
                        <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                    </svg>
                </button>
                <h1 className="text-[17px] font-semibold text-stone-800 tracking-tight">认知网络</h1>
            </header>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8 space-y-3">
                <section className="relative overflow-hidden backdrop-blur-xl bg-white/60 rounded-[28px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                    <div className="absolute -top-16 -right-8 w-40 h-40 rounded-full bg-stone-200/30 blur-3xl" />
                    <div className="absolute -bottom-12 left-4 w-32 h-32 rounded-full bg-stone-300/20 blur-3xl" />
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
                    <div className="relative flex items-start justify-between gap-4">
                        <div className="max-w-[220px]">
                            <div className="inline-flex items-center gap-2 rounded-full bg-white/50 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-stone-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-stone-400/60" />
                                Cognitive Network
                            </div>
                            <h2 className="mt-4 text-[24px] font-semibold tracking-tight text-stone-800">回忆织梦</h2>
                            <p className="mt-2 text-[12px] leading-relaxed text-stone-400">
                                让你们的每一段回忆，都温柔地交织在一起
                            </p>
                        </div>

                        <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-full border border-stone-200/60" />
                            <div className="absolute inset-2 rounded-full border border-stone-200/40" />
                            <div className="absolute inset-4 rounded-full border border-stone-200/30" />
                            <div className="w-2 h-2 rounded-full bg-stone-300/80" />
                        </div>
                    </div>
                </section>

                <section className="relative overflow-hidden backdrop-blur-xl bg-white/60 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-stone-100/80 border border-stone-200/50 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-stone-500">
                                <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-[13px] font-semibold text-stone-700">记忆漫游</h3>
                            <p className="text-[10px] text-stone-400">在不同的角落想起同一个人</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="rounded-2xl bg-white/75 border border-white/70 p-3.5">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-medium tracking-[0.18em] uppercase text-stone-400">账号</span>
                                <button
                                    onClick={() => { setSyncCodeVisible(!syncCodeVisible); haptic.light(); }}
                                    className="px-2.5 py-1 bg-white/70 border border-stone-200/60 rounded-xl text-[10px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                                >
                                    {syncCodeVisible ? '隐藏' : '显示'}
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-[11px] font-mono text-stone-600 break-all leading-relaxed select-all">
                                    {syncCodeVisible ? getUserId() : `${getUserId().slice(0, 12)}${'*'.repeat(20)}`}
                                </code>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(getUserId());
                                        addToast('已复制', 'success');
                                        haptic.light();
                                    }}
                                    className="shrink-0 px-3 py-2 bg-white/70 border border-stone-200/60 rounded-xl text-[10px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                                >
                                    复制
                                </button>
                            </div>
                            <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
                                这是你们共享回忆的凭证，在另一处输入同样的账号，就能再次遇见同一段回忆。
                            </p>
                        </div>

                        <div className="rounded-2xl bg-white/75 border border-white/70 p-3.5">
                            <span className="block mb-2 text-[9px] font-medium tracking-[0.18em] uppercase text-stone-400">绑定</span>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={bindInput}
                                    onChange={e => setBindInput(e.target.value)}
                                    onTouchStart={e => e.stopPropagation()}
                                    placeholder="输入另一台设备的同步码"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    className="flex-1 bg-white/80 border border-stone-200/60 rounded-xl px-3 py-2.5 text-[11px] font-mono text-stone-600 focus:border-stone-400 focus:bg-white transition-all select-text"
                                    style={{ userSelect: 'text', WebkitUserSelect: 'text', touchAction: 'auto' }}
                                />
                                <button
                                    onClick={() => {
                                        if (!bindInput.trim()) {
                                            addToast('请输入同步码', 'info');
                                            return;
                                        }
                                        if (bindInput.trim() === getUserId()) {
                                            addToast('这已经是你的账号了', 'info');
                                            return;
                                        }
                                        setUserId(bindInput.trim());
                                        setBindInput('');
                                        setSyncResult(null);
                                        setAllStats(null);
                                        addToast('已切换身份，点击「拾取回忆」来唤回云端的记忆', 'success');
                                        haptic.medium();
                                    }}
                                    className="py-3 px-4 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                                >
                                    绑定
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={async () => {
                                    setSyncing(true);
                                    setSyncResult(null);
                                    haptic.medium();
                                    try {
                                        let totalPushed = 0;
                                        for (const char of characters) {
                                            const mems = await DB.getAllVectorMemories(char.id);
                                            if (mems.length === 0) continue;
                                            const result = await pushMemories(char.id, mems);
                                            if (result) totalPushed += result.synced;
                                        }
                                        setSyncResult({ pushed: totalPushed, pulled: 0 });
                                        addToast(`已将 ${totalPushed} 段回忆写入云端`, 'success');
                                        fetchStats();
                                    } catch (e: any) {
                                        addToast(`写入失败: ${e.message}`, 'error');
                                    } finally {
                                        setSyncing(false);
                                    }
                                }}
                                disabled={syncing}
                                className="py-3 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                            >
                                {syncing ? <Spinner /> : '轻轻落笔'}
                                {!syncing && <span className="block mt-1 text-[10px] text-white/40">将回忆写入云端</span>}
                            </button>
                            <button
                                onClick={async () => {
                                    setSyncing(true);
                                    setSyncResult(null);
                                    haptic.medium();
                                    try {
                                        const cloudChars = await listCloudChars();
                                        const localCharIds = new Set(characters.map(c => c.id));
                                        const allCharIds = new Set(localCharIds);
                                        if (cloudChars) {
                                            for (const cc of cloudChars) allCharIds.add(cc.charId);
                                        }

                                        if (allCharIds.size === 0) {
                                            addToast('云端还没有回忆', 'info');
                                            setSyncing(false);
                                            return;
                                        }

                                        let totalPulled = 0;
                                        for (const charId of allCharIds) {
                                            const cloudMems = await pullMemories(charId);
                                            if (!cloudMems || cloudMems.length === 0) continue;
                                            for (const mem of cloudMems) {
                                                const existing = await DB.getVectorMemoryById(mem.id);
                                                if (!existing) {
                                                    await DB.saveVectorMemory({
                                                        ...mem,
                                                        charId: mem.charId || charId,
                                                    });
                                                    totalPulled++;
                                                }
                                            }
                                        }
                                        setSyncResult({ pushed: 0, pulled: totalPulled });
                                        addToast(`已唤回 ${totalPulled} 段云端回忆`, 'success');
                                    } catch (e: any) {
                                        addToast(`唤回失败: ${e.message}`, 'error');
                                    } finally {
                                        setSyncing(false);
                                    }
                                }}
                                disabled={syncing}
                                className="py-3 bg-stone-700 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                            >
                                {syncing ? <Spinner /> : '拾取回忆'}
                                {!syncing && <span className="block mt-1 text-[10px] text-white/40">从云端唤回记忆</span>}
                            </button>
                        </div>

                        {syncResult && (
                            <div className="text-center text-[10px] font-medium text-stone-500">
                                {syncResult.pushed > 0 && `已写入 ${syncResult.pushed} 段`}
                                {syncResult.pushed > 0 && syncResult.pulled > 0 && ' · '}
                                {syncResult.pulled > 0 && `已唤回 ${syncResult.pulled} 段`}
                            </div>
                        )}
                    </div>
                </section>
                {characters.length > 0 && (
                    <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                        <button
                            onClick={() => { haptic.light(); setSelectedCharId(null); }}
                            className={`shrink-0 px-4 py-2.5 rounded-xl text-[11px] font-medium transition-all active:scale-[0.97] ${
                                !selectedCharId
                                    ? 'bg-stone-800 text-white/90'
                                    : 'bg-white/60 text-stone-500 border border-stone-200/50'
                            }`}
                        >
                            全部
                        </button>

                        {characters.map(c => {
                            const isActive = selectedCharId === c.id;
                            const backendStats = allStats?.characters.find(cs => cs.charId === c.id);
                            const memCount = backendStats?.memories ?? 0;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => { haptic.light(); setSelectedCharId(c.id); }}
                                    className={`shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[11px] font-medium transition-all active:scale-[0.97] ${
                                        isActive
                                            ? 'bg-stone-800 text-white/90'
                                            : 'bg-white/60 text-stone-500 border border-stone-200/50'
                                    }`}
                                >
                                    {c.avatar ? (
                                        <img src={c.avatar} className="w-5 h-5 rounded-full object-cover" alt="" />
                                    ) : (
                                        <div className="w-5 h-5 rounded-full bg-stone-200 flex items-center justify-center text-[9px] text-stone-600">
                                            {c.name.charAt(0)}
                                        </div>
                                    )}
                                    {c.name}
                                    {memCount > 0 && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-stone-100 text-stone-400'}`}>
                                            {memCount}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                        </div>
                    </section>
                )}

                {!isConnected ? (
                    <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-8 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50 text-center">
                        <div className="w-10 h-10 rounded-full bg-stone-100 mx-auto mb-3 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-stone-300">
                                <path fillRule="evenodd" d="M3.28 3.22a.75.75 0 011.06 0l12.44 12.44a.75.75 0 11-1.06 1.06l-2.364-2.364A7.976 7.976 0 0110 15c-2.027 0-3.877-.754-5.286-1.996l-1.434 1.434a.75.75 0 01-1.06-1.06l2.193-2.193A7.965 7.965 0 012 10c0-2.21.895-4.21 2.343-5.657L3.28 3.28a.75.75 0 010-1.06zM10 6.5c1.933 0 3.5 1.567 3.5 3.5 0 .36-.054.706-.155 1.032L8.968 6.655A3.486 3.486 0 0110 6.5z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <p className="text-xs text-stone-400">还没有连接到记忆服务</p>
                    </section>
                ) : loading && !allStats ? (
                    <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-8 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50 flex justify-center">
                        <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin" />
                    </section>
                ) : (() => {
                    const stats = currentStats || { memories: 0, relations: 0, temporalEdges: 0, semanticEdges: 0, linkedCount: 0, unscannedCount: 0 };
                    return (
                        <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                            {statsFailed && (
                                <div className="mb-3 flex items-center gap-2.5 px-3 py-2.5 bg-amber-50/60 border border-amber-100/60 rounded-xl">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                    <p className="text-[10px] text-amber-600/80 font-medium flex-1">无法加载完整数据，部分信息可能暂缺</p>
                                    <button
                                        onClick={fetchStats}
                                        disabled={loading}
                                        className="px-2.5 py-1 bg-white/80 border border-slate-200/80 rounded-xl text-[10px] font-medium text-slate-500 active:scale-[0.97] transition-all disabled:opacity-40"
                                    >
                                        {loading ? '稍候' : '重试'}
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2.5">
                                {[
                                    { value: stats.memories, label: '回忆片段' },
                                    { value: stats.semanticEdges, label: '心意相通' },
                                    { value: stats.temporalEdges, label: '时间丝线' },
                                    { value: stats.linkedCount, label: '记忆连贯' },
                                ].map((item, i) => (
                                    <div key={i} className="bg-white/50 rounded-2xl overflow-hidden border border-white/60">
                                        <div className="h-[2px] bg-gradient-to-r from-stone-300/60 to-stone-200/40" />
                                        <div className="p-4">
                                            <div className="text-[9px] font-medium text-stone-400 tracking-wider mb-1">{item.label}</div>
                                            <div className="text-[28px] font-bold text-stone-700 tracking-tight leading-none">{item.value}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {stats.unscannedCount > 0 && (
                                <div className="mt-3 flex items-center gap-2.5 px-3 py-2.5 bg-amber-50/60 border border-amber-100/60 rounded-xl">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                    <p className="text-[10px] text-amber-600/80 font-medium">
                                        还有 {stats.unscannedCount} 段回忆等待被发现更深的联系
                                    </p>
                                </div>
                            )}

                            <button
                                onClick={fetchStats}
                                disabled={loading}
                                className="w-full mt-3 py-3 bg-white/60 border border-stone-200/50 rounded-xl text-[12px] font-medium text-stone-500 active:scale-[0.97] transition-all disabled:opacity-40"
                            >
                                {loading ? '刷新中...' : '刷新'}
                            </button>
                        </section>
                    );
                })()}

                <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-stone-100/80 border border-stone-200/50 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-stone-500">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-[13px] font-semibold text-stone-700">时光丝线</h3>
                            <p className="text-[10px] text-stone-400">沿着时间线，串起每一个相遇的瞬间</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => doBackfill(true)}
                            disabled={backfilling || !isConnected}
                            className="flex-1 py-3 bg-white/60 border border-stone-200/50 rounded-xl text-[12px] font-medium text-stone-500 active:scale-[0.97] transition-all disabled:opacity-40"
                        >
                            {backfilling ? <Spinner /> : '预览'}
                        </button>
                        <button
                            onClick={() => setShowConfirm('temporal')}
                            disabled={backfilling || !isConnected}
                            className="flex-[1.2] py-3 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                        >
                            开始编织
                        </button>
                    </div>

                    {showConfirm === 'temporal' && (
                        <ConfirmBar
                            text="这是一个安全的操作，可以重复执行。开始编织吗？"
                            loading={backfilling}
                            onCancel={() => setShowConfirm(null)}
                            onConfirm={() => doBackfill(false)}
                        />
                    )}
                </section>

                <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-stone-100/80 border border-stone-200/50 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-stone-500">
                                <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-[13px] font-semibold text-stone-700">心意相通</h3>
                            <p className="text-[10px] text-stone-400">
                                发现那些看似无关、却彼此呼应的记忆
                                {selectedCharId && <span className="text-stone-500"> · 只为「{charNameMap(selectedCharId)}」寻找</span>}
                            </p>
                        </div>
                    </div>

                    {!hasSubApi && (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-stone-50/60 border border-stone-100/60 rounded-xl mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
                            <p className="text-[10px] text-stone-500 font-medium">需要先在设置中开启「副 API」</p>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => doSemanticBackfill(true)}
                            disabled={semanticRunning || !isConnected || !hasSubApi}
                            className="py-3 bg-white/60 border border-stone-200/50 rounded-xl text-[12px] font-medium text-stone-500 active:scale-[0.97] transition-all disabled:opacity-40"
                        >
                            {semanticRunning ? <Spinner /> : '预览'}
                        </button>
                        <button
                            onClick={() => setShowConfirm('semantic')}
                            disabled={semanticRunning || !isConnected || !hasSubApi}
                            className="py-3 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                        >
                            寻找关联
                        </button>
                        <button
                            onClick={() => setShowConfirm('semanticRebuild')}
                            disabled={semanticRunning || !isConnected || !hasSubApi || !selectedCharId}
                            className="py-3 bg-stone-600 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                        >
                            {semanticRebuilding ? <Spinner /> : '重新织梦'}
                        </button>
                    </div>

                    {showConfirm === 'semantic' && (
                        <ConfirmBar
                            text={selectedCharId
                                ? `将为「${charNameMap(selectedCharId)}」寻找记忆之间隐藏的联系，可能需要一些时间。开始吗？`
                                : '将为所有角色寻找记忆之间隐藏的联系，可能需要一些时间。开始吗？'}
                            loading={semanticRunning}
                            onCancel={() => setShowConfirm(null)}
                            onConfirm={() => doSemanticBackfill(false)}
                            color="violet"
                        />
                    )}

                    {showConfirm === 'semanticRebuild' && selectedCharId && (
                        <ConfirmBar
                            text={`将清除「${charNameMap(selectedCharId)}」现有的记忆关联并重新分析，需要一些时间。确定吗？`}
                            loading={semanticRebuilding}
                            onCancel={() => setShowConfirm(null)}
                            onConfirm={doSemanticRebuild}
                            color="rose"
                        />
                    )}

                    {showConfirm === 'rescan' && (
                        <div className="mt-3 rounded-2xl border border-emerald-100/70 bg-emerald-50/60 p-3.5">
                            <p className="text-[10px] text-emerald-700/80 mb-3 leading-relaxed">所有回忆都已找到彼此的联系。如需重新分析，可以点击下方按钮。</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowConfirm(null)}
                                    className="flex-1 py-3 bg-white/80 border border-slate-200/80 rounded-xl text-[12px] font-medium text-slate-500 active:scale-[0.97] transition-all"
                                >
                                    关闭
                                </button>
                                <button
                                    onClick={() => { setShowConfirm(null); doSemanticBackfill(false, true); }}
                                    disabled={semanticRunning}
                                    className="flex-1 py-3 bg-stone-700 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                                >
                                    重新寻找
                                </button>
                            </div>
                        </div>
                    )}
                </section>
                {selectedCharId && semanticRebuildResult?.charId === selectedCharId && (
                    <section className="backdrop-blur-xl bg-white/70 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-white/80">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-[13px] font-semibold text-stone-700">重新织梦已经开始</h3>
                                <p className="text-[10px] text-stone-400">还有 {semanticRebuildResult.toProcess} 段回忆会再次被寻找联系</p>
                            </div>
                            <div className="w-2 h-2 rounded-full bg-stone-400" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { value: semanticRebuildResult.deleted, label: '旧联系清除' },
                                { value: semanticRebuildResult.reset, label: '重看标记' },
                                { value: semanticRebuildResult.toProcess, label: '等待重看' },
                            ].map((item, i) => (
                                <div key={i} className="rounded-2xl overflow-hidden border border-white/60 bg-stone-50/50">
                                    <div className="h-[2px] bg-gradient-to-r from-stone-300/60 to-stone-200/40" />
                                    <div className="p-3 text-center">
                                        <div className="text-[18px] font-bold text-stone-700">{item.value}</div>
                                        <div className="text-[9px] font-medium tracking-wider text-stone-400">{item.label}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {queueStatus && queueStatus.total > 0 && (
                    <section className="backdrop-blur-xl bg-white/70 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-white/80">
                        <div className="flex items-center gap-2 mb-3">
                            {queueStatus.running ? (
                                <div className="w-2 h-2 rounded-full bg-stone-500 animate-pulse" />
                            ) : queueStatus.aborted ? (
                                <div className="w-2 h-2 rounded-full bg-slate-300" />
                            ) : (
                                <div className={`w-2 h-2 rounded-full ${queueStatus.errors > 0 && queueStatus.done === 0 ? 'bg-red-400' : 'bg-emerald-400'}`} />
                            )}
                            <h3 className="text-[13px] font-semibold text-stone-700 flex-1">
                                {queueStatus.running
                                    ? queueStatus.mode === 'semantic-rebuild' ? '重新织梦进行中' : '寻找关联进行中'
                                    : queueStatus.aborted
                                        ? '重新织梦已暂停'
                                        : queueStatus.done > 0
                                            ? queueStatus.mode === 'semantic-rebuild' ? '重新织梦已完成' : '寻找关联已完成'
                                            : '连接有些不稳定'}
                            </h3>
                            {queueStatus.canAbort && queueStatus.running && queueStatus.mode === 'semantic-rebuild' ? (
                                <button
                                    onClick={() => semanticAbortRef.current?.abort()}
                                    className="px-3 py-1.5 rounded-xl bg-white/60 border border-stone-200/50 text-[10px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                                >
                                    暂停
                                </button>
                            ) : (
                                <span className="text-[11px] font-semibold text-stone-600">
                                    {queueStatus.done}/{queueStatus.total}
                                </span>
                            )}
                        </div>

                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                            <div
                                className="h-full bg-stone-600 rounded-full transition-all duration-500"
                                style={{ width: `${Math.round((queueStatus.done / Math.max(1, queueStatus.total)) * 100)}%` }}
                            />
                        </div>

                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>
                                已完成 {queueStatus.done} · 暂缓 {queueStatus.errors}
                                {queueStatus.totalRelations !== undefined ? ` · 已发现 ${queueStatus.totalRelations} 条呼应` : ''}
                                {queueStatus.lastElapsed ? ` · ${(queueStatus.lastElapsed / 1000).toFixed(1)}s` : ''}
                            </span>
                            <span>{Math.round((queueStatus.done / Math.max(1, queueStatus.total)) * 100)}%</span>
                        </div>

                        {queueStatus.lastSnippet && (
                            <div className="mt-2 rounded-xl bg-slate-50/80 border border-slate-100/80 px-3 py-2 text-[10px] text-slate-500 font-mono" style={{ wordBreak: 'break-all' }}>
                                本轮回应: {queueStatus.lastSnippet.slice(0, 100)}...
                            </div>
                        )}

                        {queueStatus.lastParseError && (
                            <div className="mt-2 text-[10px] text-red-500 font-mono" style={{ wordBreak: 'break-all' }}>
                                解析异常: {queueStatus.lastParseError}
                            </div>
                        )}

                        <div className="mt-2 text-[10px] text-slate-400 font-mono">
                            本轮: 读到{queueStatus.lastRawCount ?? '—'}条 · 写下{queueStatus.lastFilterCount ?? '—'}条
                            {queueStatus.lastVecSim !== undefined ? ` · 向量${queueStatus.lastVecSim ? '✓' : '✗'}` : ''}
                            {' · '}候选{queueStatus.lastCandidateCount ?? '—'}条
                        </div>

                        {queueStatus.aborted && (
                            <div className="mt-3 flex items-center gap-2.5 px-3 py-2.5 bg-slate-50/80 border border-slate-100/80 rounded-xl">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                <p className="text-[10px] text-slate-500 leading-relaxed">这次重新寻找已经暂停，稍后还可以从未完成的地方继续。</p>
                            </div>
                        )}

                        {queueStatus.lastError && (
                            <div className="mt-3 rounded-xl bg-amber-50/70 border border-amber-100/70 px-3 py-2.5">
                                <p className="text-[10px] font-medium text-amber-700/90 mb-1 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    {queueStatus.running ? '最近一次错误' : '错误信息'}
                                </p>
                                <p className="text-[10px] text-amber-900 font-mono break-all">{queueStatus.lastError}</p>
                            </div>
                        )}
                    </section>
                )}

                {backfillResult && (
                    <ResultCard
                        title={backfillResult.dryRun ? '时光丝线预览' : '时光丝线已织好'}
                        isDryRun={backfillResult.dryRun}
                        items={(backfillResult.verification || [])
                            .filter(v => !selectedCharId || v.charId === selectedCharId)
                            .map(v => ({
                                name: charNameMap(v.charId),
                                avatar: charAvatarMap(v.charId),
                                count: v.total,
                                status: v.complete ? '✓ 完整' : `${v.withPrev}/${v.expected}`,
                                complete: v.complete,
                            }))}
                        stats={[
                            { value: backfillResult.totals.memories, label: '回忆片段' },
                            { value: backfillResult.totals.linksCreated, label: '连起片段' },
                            { value: backfillResult.totals.edgesCreated, label: '丝线新增' },
                        ]}
                    />
                )}

                {semanticResult && (
                    <ResultCard
                        title={semanticResult.dryRun ? '心意相通预览' : '寻找关联已开始'}
                        isDryRun={semanticResult.dryRun}
                        items={semanticResult.results
                            .filter(r => !selectedCharId || r.charId === selectedCharId)
                            .map(r => ({
                                name: charNameMap(r.charId),
                                avatar: charAvatarMap(r.charId),
                                count: r.total,
                                status: r.needsEdges > 0 ? `${r.needsEdges} 待寻找` : '✓ 已完成',
                                complete: r.needsEdges === 0,
                            }))}
                        stats={[
                            { value: semanticResult.results.reduce((sum, item) => sum + item.total, 0), label: '回忆总数' },
                            { value: semanticResult.results.reduce((sum, item) => sum + item.needsEdges, 0), label: '等待发现' },
                            { value: semanticResult.totalQueued, label: '已启程' },
                        ]}
                        note={semanticResult.dryRun ? undefined : '寻找关联会在后台继续，稍后刷新就能看见新的呼应。'}
                    />
                )}
                <section className="backdrop-blur-xl bg-white/70 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-white/80">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-stone-100/80 border border-stone-200/50 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-stone-500">
                                <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-[13px] font-semibold text-stone-700">回忆结晶</h3>
                            <p className="text-[10px] text-stone-400">
                                将零散的回忆凝结成永恒的印象
                                {!selectedCharId && <span className="text-stone-500"> · 先选定想要整理的那位</span>}
                            </p>
                        </div>
                    </div>

                    {!hasSubApi || !hasEmbeddingApi ? (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-stone-50/60 border border-stone-100/60 rounded-xl">
                            <div className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
                            <p className="text-[10px] text-stone-500 font-medium">
                                {!hasEmbeddingApi ? '需要先在设置中开启「记忆引擎」' : '需要先在设置中开启「副 API」'}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setShowConfirm('distill')}
                                    disabled={distillBusy || !isConnected || !selectedCharId}
                                    className="py-3 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                                >
                                    {distilling ? <Spinner /> : '凝结回忆'}
                                </button>
                                <button
                                    onClick={() => setShowConfirm('distillRebuild')}
                                    disabled={distillBusy || !isConnected || !selectedCharId}
                                    className="py-3 bg-stone-600 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                                >
                                    {distillRebuilding ? <Spinner /> : '重新凝结'}
                                </button>
                            </div>

                            {showConfirm === 'distill' && selectedCharId && (
                                <ConfirmBar
                                    text={`将从「${charNameMap(selectedCharId)}」的回忆中寻找新的共通之处并凝结成印象。开始吗？`}
                                    loading={distilling}
                                    onCancel={() => setShowConfirm(null)}
                                    onConfirm={doDistill}
                                    color="amber"
                                />
                            )}

                            {showConfirm === 'distillRebuild' && selectedCharId && (
                                <ConfirmBar
                                    text={`将重新整理「${charNameMap(selectedCharId)}」的所有回忆印象。已有的印象会被清除后重新生成，确定吗？`}
                                    loading={distillRebuilding}
                                    onCancel={() => setShowConfirm(null)}
                                    onConfirm={doDistillRebuild}
                                    color="rose"
                                />
                            )}
                        </>
                    )}

                    {distillResult && (
                        <div className="mt-3 rounded-2xl border border-cyan-100/70 bg-cyan-50/50 p-3.5">
                            {selectedCharId && distillResetStats?.charId === selectedCharId && (
                                <div className="mb-3 rounded-2xl border border-rose-100/70 bg-white/75 p-3">
                                    <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-rose-500/70 mb-2">重新整理</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { value: distillResetStats.l1Deleted, label: '旧印象清除' },
                                            { value: distillResetStats.l0Cleared, label: '回忆解绑' },
                                            { value: distillResetStats.relationsCleared, label: '联系清理' },
                                        ].map((item, i) => (
                                            <div key={i} className="rounded-xl bg-rose-50/70 py-2 text-center">
                                                <div className="text-[15px] font-bold text-rose-700">{item.value}</div>
                                                <div className="text-[8px] font-semibold text-rose-400">{item.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 mb-2">
                                {[
                                    { value: distillResult.clustersFound, label: '共鸣簇' },
                                    { value: distillResult.l1Created, label: '新印象' },
                                    { value: distillResult.l1Merged || 0, label: '印象合并' },
                                    { value: distillResult.l1Deduped || 0, label: '重复收束' },
                                ].map((item, i) => (
                                    <div key={i} className="rounded-xl bg-white/75 py-2 text-center">
                                        <div className="text-[16px] font-bold text-teal-700">{item.value}</div>
                                        <div className="text-[8px] font-semibold text-teal-500/70">{item.label}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>用时 {(distillResult.elapsed / 1000).toFixed(1)}s</span>
                                {distillResult.errors > 0 && <span className="text-rose-500">{distillResult.errors} 处暂缓</span>}
                            </div>
                        </div>
                    )}
                </section>

                {selectedCharId && (
                    <section className="backdrop-blur-xl bg-white/60 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50 overflow-hidden">
                        <button
                            onClick={() => { if (!browserOpen) fetchBrowserMemories(); setBrowserOpen(!browserOpen); haptic.light(); }}
                            className="w-full flex items-center gap-3 p-5 active:bg-black/5 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-xl bg-stone-100/80 border border-stone-200/50 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-stone-500">
                                    <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v11.75A2.75 2.75 0 0016.75 18h-12A2.75 2.75 0 012 15.25V3.5zm3.75 7a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zm0-3a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="text-left flex-1">
                                <h3 className="text-[13px] font-semibold text-stone-700">回忆匣子</h3>
                                <p className="text-[10px] text-stone-400">打开那些被悉心收藏的回忆</p>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                                className={`w-4 h-4 text-stone-400 transition-transform duration-300 ${browserOpen ? 'rotate-180' : ''}`}>
                                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                            </svg>
                        </button>

                        {browserOpen && (
                            <div className="px-5 pb-5">
                                <div className="flex gap-1.5 mb-3">
                                    {(['all', '0', '1'] as const).map(lvl => {
                                        const label = lvl === 'all' ? `全部 (${browserCounts.total})` : lvl === '0' ? `L0 场景 (${browserCounts.l0})` : `L1 印象 (${browserCounts.l1})`;
                                        const isActive = browserLevel === lvl;
                                        return (
                                            <button
                                                key={lvl}
                                                onClick={() => { setBrowserLevel(lvl); fetchBrowserMemories(lvl); haptic.light(); }}
                                                className={`px-3 py-1.5 rounded-xl text-[10px] font-medium transition-all active:scale-[0.97] ${
                                                    isActive ? 'bg-stone-800 text-white/90' : 'bg-white/60 border border-stone-200/50 text-stone-500'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {browserLoading ? (
                                    <div className="flex justify-center py-6">
                                        <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                                    </div>
                                ) : browserMemories && browserMemories.length > 0 ? (
                                    <div className="space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar">
                                        {browserMemories.map((m: any) => {
                                            const isExpanded = expandedMemId === m.id;
                                            const ageMs = Date.now() - Number(m.createdAt || 0);
                                            const days = Math.floor(ageMs / 86400000);
                                            const timeLabel = days === 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? `${days}天前` : days < 30 ? `${Math.round(days / 7)}周前` : `${Math.round(days / 30)}月前`;
                                            return (
                                                <div
                                                    key={m.id}
                                                    className={`rounded-2xl border transition-all ${
                                                        m.level === 1
                                                            ? 'bg-gradient-to-r from-cyan-50/50 to-teal-50/50 border-cyan-100/70'
                                                            : 'bg-slate-50/70 border-slate-100/80'
                                                    }`}
                                                >
                                                    <button
                                                        onClick={() => { setExpandedMemId(isExpanded ? null : m.id); haptic.light(); }}
                                                        className="w-full text-left px-3 py-3 flex items-start gap-2"
                                                    >
                                                        <span className={`shrink-0 mt-0.5 text-[8px] font-bold px-2 py-0.5 rounded-full ${
                                                            m.level === 1 ? 'bg-cyan-100 text-cyan-600' : 'bg-white/90 text-slate-500'
                                                        }`}>{m.level === 1 ? 'L1' : 'L0'}</span>

                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[11px] font-semibold text-slate-700 truncate">{m.title}</div>
                                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                <span className="text-[9px] text-slate-400">{timeLabel}</span>
                                                                <span className="text-[9px] text-amber-500">重要度 {m.importance ?? 0}</span>
                                                                {m.distilledInto && <span className="text-[9px] text-cyan-500">已凝成印象</span>}
                                                                {m.sourceMemoryIds && <span className="text-[9px] text-teal-500">来自 {m.sourceMemoryIds.length} 段回忆</span>}
                                                            </div>
                                                        </div>

                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                                                            className={`w-3.5 h-3.5 text-slate-400 shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="px-3 pb-3 space-y-2">
                                                            {editingMemId === m.id && editDraft ? (
                                                                <div className="space-y-2">
                                                                    <input
                                                                        value={editDraft.title}
                                                                        onChange={e => setEditDraft({ ...editDraft, title: e.target.value })}
                                                                        className="w-full text-[11px] font-semibold text-slate-700 bg-white/95 border border-slate-200/80 rounded-xl px-3 py-2 focus:ring-1 focus:ring-violet-300 outline-none"
                                                                    />
                                                                    <textarea
                                                                        value={editDraft.content}
                                                                        onChange={e => setEditDraft({ ...editDraft, content: e.target.value })}
                                                                        rows={4}
                                                                        className="w-full text-[10px] text-slate-600 bg-white/95 border border-slate-200/80 rounded-xl px-3 py-2 resize-none focus:ring-1 focus:ring-violet-300 outline-none leading-relaxed"
                                                                    />
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[9px] text-slate-400">重要度</span>
                                                                        <input
                                                                            type="range"
                                                                            min="1"
                                                                            max="10"
                                                                            value={editDraft.importance}
                                                                            onChange={e => setEditDraft({ ...editDraft, importance: parseInt(e.target.value) })}
                                                                            className="flex-1 h-1 accent-violet-500"
                                                                        />
                                                                        <span className="text-[9px] font-semibold text-violet-500">{editDraft.importance}</span>
                                                                    </div>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            onClick={() => { setEditingMemId(null); setEditDraft(null); }}
                                                                            className="flex-1 py-3 bg-white/60 border border-stone-200/50 rounded-xl text-[12px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                                                                        >
                                                                            取消
                                                                        </button>
                                                                        <button
                                                                            onClick={() => doSaveEdit(m.id)}
                                                                            disabled={saving}
                                                                            className="flex-1 py-3 bg-stone-800 rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40"
                                                                        >
                                                                            {saving ? '保存中...' : '保存'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <p className="text-[10px] text-slate-600 leading-relaxed whitespace-pre-wrap">{m.content}</p>
                                                                    {m.emotionalJourney && (
                                                                        <p className="text-[10px] text-violet-500/80 italic">情绪回响：{m.emotionalJourney}</p>
                                                                    )}
                                                                </>
                                                            )}

                                                            {m.relations && m.relations.length > 0 && (
                                                                <div className="pt-1">
                                                                    <div className="text-[9px] font-semibold text-slate-500 mb-1">心意相通</div>
                                                                    <div className="space-y-1">
                                                                        {m.relations.map((r: any, ri: number) => {
                                                                            let colorClass = 'bg-slate-50 text-slate-500 border-slate-100';
                                                                            if (r.relation === '同一话题') colorClass = 'bg-blue-50 text-blue-500 border-blue-100';
                                                                            else if (r.relation === '前因后果') colorClass = 'bg-amber-50 text-amber-500 border-amber-100';
                                                                            else if (r.relation === '同一人物') colorClass = 'bg-violet-50 text-violet-500 border-violet-100';
                                                                            else if (r.relation === '情感相似') colorClass = 'bg-rose-50 text-rose-500 border-rose-100';
                                                                            else if (r.relation === '对比反差') colorClass = 'bg-emerald-50 text-emerald-500 border-emerald-100';
                                                                            else if (r.relation === '时间相近') colorClass = 'bg-slate-50 text-slate-500 border-slate-100';
                                                                            return (
                                                                                <div key={ri} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl border ${colorClass} text-[9px]`}>
                                                                                    <span className="font-semibold shrink-0">{r.relation}</span>
                                                                                    <span className="text-slate-300">|</span>
                                                                                    <span className="truncate flex-1 opacity-80">{r.neighborTitle}</span>
                                                                                    <span className="shrink-0 opacity-60">{r.weight.toFixed(1)}</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <div className="flex items-center justify-between pt-1">
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    <span className="text-[8px] bg-white/80 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200/70">提及 {m.mentionCount ?? 0} 次</span>
                                                                    <span className="text-[8px] bg-white/80 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200/70">清晰度 {Number(m.salienceScore ?? 0).toFixed(2)}</span>
                                                                    <span className="text-[8px] bg-white/80 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200/70 font-mono">{m.id.slice(0, 20)}...</span>
                                                                </div>
                                                                {editingMemId !== m.id && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setEditingMemId(m.id); setEditDraft({ title: m.title, content: m.content, importance: m.importance }); haptic.light(); }}
                                                                        className="shrink-0 px-3 py-2 bg-white/60 border border-stone-200/50 rounded-xl text-[10px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                                                                    >
                                                                        编辑
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-400 text-center py-4">还没有收藏回忆</p>
                                )}
                            </div>
                        )}
                    </section>
                )}

                {allStats && (
                    <section className="backdrop-blur-xl bg-white/60 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03),0_0_0_1px_rgba(255,255,255,0.7)] border border-white/50">
                        <h3 className="text-[12px] font-semibold text-stone-600 mb-3">回忆说明</h3>
                        <div className="space-y-2 text-[10px] leading-relaxed text-stone-400">
                            <p>
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-400 mr-1.5 align-middle" />
                                <span className="font-bold text-stone-600">回忆片段</span> — 从对话中沉淀下来的记忆
                            </p>
                            <p>
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-400 mr-1.5 align-middle" />
                                <span className="font-bold text-stone-600">心意相通</span> — 不同回忆之间被发现的隐藏联系
                            </p>
                            <p>
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-400 mr-1.5 align-middle" />
                                <span className="font-bold text-stone-600">时间丝线</span> — 按时间顺序串起的相邻回忆
                            </p>
                            <p>
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-400 mr-1.5 align-middle" />
                                <span className="font-bold text-stone-600">记忆连贯</span> — 前后回忆之间的衔接完整度
                            </p>
                        </div>
                        <div className="mt-3 pt-3 border-t border-stone-100/60">
                            <span className="text-[9px] text-stone-400">当前图谱 · {allStats.graph?.nodes ?? '—'} 个节点 · {allStats.graph?.edges ?? '—'} 条联系</span>
                        </div>
                    </section>
                )}

                <p className="text-[10px] text-stone-300 text-center pt-1 pb-2 tracking-wide">
                    Powered by Cognitive Engine
                </p>
            </div>
        </div>
    );
};
const Spinner = () => (
    <div className="w-3.5 h-3.5 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin mx-auto" />
);

const ConfirmBar: React.FC<{
    text: string;
    loading: boolean;
    color?: 'amber' | 'violet' | 'rose';
    onCancel: () => void;
    onConfirm: () => void;
}> = ({ text, loading, color = 'amber', onCancel, onConfirm }) => {
    const theme = color === 'violet'
        ? {
            panel: 'bg-stone-50/60 border-stone-100/70',
            text: 'text-stone-600',
            button: 'bg-stone-800',
            dot: 'bg-stone-400',
        }
        : color === 'rose'
            ? {
                panel: 'bg-stone-50/60 border-stone-100/70',
                text: 'text-stone-600',
                button: 'bg-stone-700',
                dot: 'bg-stone-400',
            }
            : {
                panel: 'bg-stone-50/60 border-stone-100/70',
                text: 'text-stone-600',
                button: 'bg-stone-800',
                dot: 'bg-stone-400',
            };

    return (
        <div className={`mt-3 rounded-2xl border p-3.5 ${theme.panel}`}>
            <div className="flex items-start gap-2.5 mb-3">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${theme.dot}`} />
                <p className={`text-[10px] leading-relaxed ${theme.text}`}>{text}</p>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={onCancel}
                    className="flex-1 py-3 bg-white/60 border border-stone-200/50 rounded-xl text-[12px] font-medium text-stone-500 active:scale-[0.97] transition-all"
                >
                    取消
                </button>
                <button
                    onClick={onConfirm}
                    disabled={loading}
                    className={`flex-1 py-3 ${theme.button} rounded-xl text-[12px] font-medium text-white/90 tracking-wide active:scale-[0.97] transition-all disabled:opacity-40 flex items-center justify-center`}
                >
                    {loading ? <Spinner /> : '开始'}
                </button>
            </div>
        </div>
    );
};

const ResultCard: React.FC<{
    title: string;
    isDryRun: boolean;
    items: { name: string; avatar: string; count: number; status: string; complete: boolean }[];
    stats: { value: number; label: string }[];
    note?: string;
}> = ({ title, isDryRun, items, stats, note }) => (
    <section className="backdrop-blur-xl bg-white/70 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-white/80">
        <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-slate-300" />
            <h3 className="text-[13px] font-semibold text-stone-700 flex-1">{title}</h3>
            {isDryRun ? (
                <span className="text-[8px] bg-sky-50 text-sky-500 px-2 py-0.5 rounded-full font-bold tracking-wider border border-sky-100">预览</span>
            ) : (
                <span className="text-[8px] bg-emerald-50 text-emerald-500 px-2 py-0.5 rounded-full font-bold tracking-wider border border-emerald-100">完成</span>
            )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
            {stats.map((item, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-white/60 bg-slate-50/60">
                <div className="h-[2px] bg-gradient-to-r from-stone-300/60 to-stone-200/40" />
                    <div className="p-3 text-center">
                        <div className="text-[16px] font-bold text-stone-700">{item.value}</div>
                        <div className="text-[8px] font-medium tracking-wider text-stone-400">{item.label}</div>
                    </div>
                </div>
            ))}
        </div>

        {items.length > 0 && (
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between rounded-2xl bg-slate-50/70 border border-slate-100/80 px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                            {item.avatar ? (
                                <img src={item.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />
                            ) : (
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] text-slate-600">
                                    {item.name.charAt(0)}
                                </div>
                            )}
                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-slate-700 truncate">{item.name}</div>
                                <div className="text-[9px] text-slate-400">{item.count} 段回忆</div>
                            </div>
                        </div>
                        <span className={`text-[9px] font-semibold px-2 py-1 rounded-full shrink-0 border ${item.complete ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            {item.status}
                        </span>
                    </div>
                ))}
            </div>
        )}

        {note && <p className="text-[10px] text-slate-400 mt-3 text-center">{note}</p>}
    </section>
);

export default CognitiveNetworkApp;

