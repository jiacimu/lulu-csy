
import React,{ useState,useEffect,useRef } from 'react';
import { useOS } from '../context/OSContext';
import { useVirtualTime } from '../context/VirtualTimeContext';
import { DB } from '../utils/db';
import { CharacterProfile,Message,DateState } from '../types';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import DateSession,{ DateExitSyncMode } from '../components/date/DateSession';
import DateSettings from '../components/date/DateSettings';
import { buildDatePreamble,buildTheaterScene,buildDateTail } from '../utils/datePrompts';
import { extractThinking, extractInnerWhispers, type InnerWhisper } from '../utils/thinkingExtractor';
import { DEFAULT_DATE_SUMMARY_PROMPT,buildSummaryPrompt,formatDateMessagesForBridge,formatMessagesForSummary } from '../utils/dateSummaryPrompts';
import {
    buildDateDiaryMemoryPrompt,
    parseDateDiaryMemoryResponse,
    renderDateDiaryMemoryTemplate,
    toDateDiaryMemoryTemplate,
    type DateDiaryMemoryDraft,
} from '../utils/dateDiaryMemory';
import { getSecondaryApiConfig } from '../utils/runtimeConfig';
import { renderMarkdown } from '../utils/markdownLite';
import { stripTranslationTags } from '../utils/chatParser';
import { isDateModeContextMessage } from '../utils/mainlineMemory';
import { trackedApiRequest } from '../utils/apiRequestLedger';

type SummaryType = 'auto' | 'manual';
const DATE_SUMMARY_CONTEXT_KEEP_COUNT = 5;
const DATE_FORK_CONTEXT_KEEP_COUNT = 80;
export type DateHistorySession = { date: string, msgs: Message[], rawMsgs: Message[], startMsgId: number, summaries: Message[], bridges: Message[] };
type SummaryDraft = {
    content: string;
    summaryType: SummaryType;
    coveredMsgIds: number[];
    sessionStartMsgId: number;
    promptSnapshot: string;
    lastCoveredMsgId: number;
    exitState?: DateState;
    fromPendingAuto?: boolean;
    /** Set only during exit flow — after saving, also create bridge + finishExit */
    bridgeOnSave?: boolean;
    injectToVectorMemory?: boolean;
};
type DateDiaryMemoryPreviewEntry = DateDiaryMemoryDraft & { id: string };
type DateDiaryMemoryPreviewState = {
    summaryDraft: SummaryDraft;
    entries: DateDiaryMemoryPreviewEntry[];
};

const isDateSummaryMessage = (m: Message) => m.metadata?.source === 'date' && m.metadata?.isSummary === true;
const isDateBridgeMessage = (m: Message) => m.metadata?.source === 'date' && m.metadata?.isDateContextBridge === true;
const isDateRawDialogueMessage = (m: Message) => (
    m.metadata?.source === 'date'
    && !m.metadata?.isSummary
    && !m.metadata?.isDateContextBridge
);
const isDateDialogueMessage = (m: Message) => (
    isDateRawDialogueMessage(m)
    && !m.metadata?.hiddenFromUser
);
const isDateForkBridge = (m: Message) => m.metadata?.bridgeType === 'fork';
const getBridgeTypeLabel = (m: Message) => {
    if (m.metadata?.bridgeType === 'raw') return '原始记录';
    if (isDateForkBridge(m)) return '复刻背景';
    return '总结';
};
const getBridgeStatusLabel = (bridges: Message[]) => (
    bridges.every(isDateForkBridge) ? '已带入旧见面背景' : '已同步到主聊天'
);

const getCurrentSessionMessages = (msgs: Message[]) => {
    const dateMsgs = msgs.filter(isDateRawDialogueMessage).sort((a, b) => a.timestamp - b.timestamp);
    const openingIndex = dateMsgs.map(m => m.metadata?.isOpening).lastIndexOf(true);
    return openingIndex >= 0 ? dateMsgs.slice(openingIndex) : dateMsgs;
};

const buildDateSummaryMemoryPrompt = (msgs: Message[]) => {
    const sessionMessages = getCurrentSessionMessages(msgs);
    if (sessionMessages.length === 0) return '';
    const sessionStartMsgId = sessionMessages[0].id;
    const sessionMsgIds = new Set(sessionMessages.map(m => m.id));
    const summaries = msgs
        .filter(isDateSummaryMessage)
        .filter(summary => (
            summary.metadata?.sessionStartMsgId === sessionStartMsgId
            || (
                Array.isArray(summary.metadata?.coveredMsgIds)
                && summary.metadata.coveredMsgIds.some((id: unknown) => typeof id === 'number' && sessionMsgIds.has(id))
            )
        ))
        .sort((a, b) => a.timestamp - b.timestamp);
    if (summaries.length === 0) return '';

    const blocks = summaries.map((summary, index) => {
        const label = summary.metadata?.summaryType === 'auto' ? '自动总结' : '手动总结';
        return `### 已总结片段 ${index + 1}（${label}）\n${summary.content}`;
    }).join('\n\n');

    return `\n\n### 【本次见面的已总结上下文】\n以下是本次见面中较早内容的压缩总结。它们是刚才线下见面已经发生过的事，不是新的用户消息。继续当前线下见面时，请把这些当作共同经历的背景，和后续未总结原文自然衔接。\n\n${blocks}\n`;
};

const hasCompleteApiConfig = (config?: { baseUrl?: string; apiKey?: string; model?: string } | null): config is { baseUrl: string; apiKey: string; model: string } => (
    !!config?.baseUrl?.trim() && !!config?.apiKey?.trim() && !!config?.model?.trim()
);

const fetchDateChatCompletion = (
    config: { baseUrl: string; apiKey: string; model: string },
    body: Record<string, unknown>,
    reason: string,
    conversationId?: string,
    messageId?: number,
    userInitiated = false,
): Promise<Response> => {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    return trackedApiRequest({
        feature: 'date',
        reason,
        model: config.model,
        conversationId,
        messageId,
        userInitiated,
        url,
    }, () => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
    }));
};

const createDiaryMemoryPreviewEntry = (draft?: Partial<DateDiaryMemoryDraft>): DateDiaryMemoryPreviewEntry => ({
    id: `date-diary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: draft?.title || '未命名片段',
    content: draft?.content || '',
    emotionalJourney: draft?.emotionalJourney || '',
    importance: Math.min(10, Math.max(1, Math.round(draft?.importance || 5))),
});

const parseDiaryMemoryImportance = (value: string): number => {
    const parsed = parseInt(value || '5', 10);
    return Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : 5;
};

export const buildHistorySessions = (msgs: Message[]): DateHistorySession[] => {
    const dateMsgs = msgs
        .filter(isDateRawDialogueMessage)
        .sort((a, b) => b.timestamp - a.timestamp);

    const sessions: DateHistorySession[] = [];
    if (dateMsgs.length === 0) return sessions;

    let currentSession: Message[] = [dateMsgs[0]];

    for (let i = 1; i < dateMsgs.length; i++) {
        const prev = dateMsgs[i - 1];
        const curr = dateMsgs[i];
        const isTimeBreak = Math.abs(prev.timestamp - curr.timestamp) > 30 * 60 * 1000;
        const splitSincePrevWasOpening = prev.metadata?.isOpening === true;

        if (isTimeBreak || splitSincePrevWasOpening) {
            const sessionStartMsg = currentSession[currentSession.length - 1];
            const orderedSessionMsgs = [...currentSession].reverse();
            sessions.push({
                date: new Date(sessionStartMsg.timestamp).toLocaleString(),
                msgs: orderedSessionMsgs,
                rawMsgs: [...orderedSessionMsgs],
                startMsgId: sessionStartMsg.id,
                summaries: [],
                bridges: [],
            });
            currentSession = [curr];
        } else {
            currentSession.push(curr);
        }
    }

    const sessionStartMsg = currentSession[currentSession.length - 1];
    const orderedSessionMsgs = [...currentSession].reverse();
    sessions.push({
        date: new Date(sessionStartMsg.timestamp).toLocaleString(),
        msgs: orderedSessionMsgs,
        rawMsgs: [...orderedSessionMsgs],
        startMsgId: sessionStartMsg.id,
        summaries: [],
        bridges: [],
    });

    const summaries = msgs.filter(isDateSummaryMessage).sort((a, b) => a.timestamp - b.timestamp);
    const bridges = msgs.filter(isDateBridgeMessage).sort((a, b) => a.timestamp - b.timestamp);
    return sessions.map(session => {
        const rawIds = new Set(session.rawMsgs.map(m => m.id));
        const matchesSession = (m: Message) => (
            m.metadata?.sessionStartMsgId === session.startMsgId
            || (
                Array.isArray(m.metadata?.coveredMsgIds)
                && m.metadata.coveredMsgIds.some((id: unknown) => typeof id === 'number' && rawIds.has(id))
            )
        );
        return {
            ...session,
            summaries: summaries.filter(matchesSession),
            bridges: bridges.filter(matchesSession),
        };
    });
};

export const buildDateForkOpeningText = ({
    charName,
    userName,
}: {
    charName: string;
    userName: string;
}): string => [
    '[normal] 像是某一天被轻轻翻回，空气里还留着那场见面的余温。',
    `[normal] ${charName}站在熟悉的光影里，抬眼看向${userName}，这条没有被走完的岔路又安静地展开。`,
].join('\n');

export const buildDateForkBridgeContent = ({
    session,
    charName,
    userName,
}: {
    session: DateHistorySession;
    charName: string;
    userName: string;
}): string => {
    const keptRawMessages = session.rawMsgs.slice(-DATE_FORK_CONTEXT_KEEP_COUNT);
    const omittedCount = Math.max(0, session.rawMsgs.length - keptRawMessages.length);
    const summaryBlock = session.summaries.length > 0
        ? session.summaries.map((summary, index) => {
            const label = summary.metadata?.summaryType === 'auto' ? '自动总结' : '手动总结';
            return `### 已有总结 ${index + 1}（${label}）\n${summary.content}`;
        }).join('\n\n')
        : '';
    const rawBlock = formatDateMessagesForBridge(keptRawMessages, charName, userName);

    return [
        '【旧见面分岔背景】',
        `这是从 ${session.date} 的见面记录复制出来的新见面。旧记录不应被改写；下面内容只作为已经发生过的背景和情绪余温。`,
        summaryBlock ? `\n【旧记录总结】\n${summaryBlock}` : '',
        rawBlock ? `\n【旧记录原始片段${omittedCount > 0 ? `（已省略更早 ${omittedCount} 条）` : ''}】\n${rawBlock}` : '',
        '\n请不要把这条背景当成正在发生的新动作；新的互动从下一条用户消息开始。',
    ].filter(Boolean).join('\n');
};

const DateApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, setActiveCharacterId, apiConfig, addToast, updateCharacter, userProfile } = useOS();
    const virtualTime = useVirtualTime();

    // Modes: 'select' -> 'peek' -> 'session' | 'settings' | 'history'
    const [mode, setMode] = useState<'select' | 'peek' | 'session' | 'settings' | 'history'>('select');
    // Track previous mode for Settings back navigation
    const [previousMode, setPreviousMode] = useState<'select' | 'peek'>('select');

    const [peekStatus, setPeekStatus] = useState<string>('');
    const [peekThinking, setPeekThinking] = useState<string>('');
    const [peekLoading, setPeekLoading] = useState(false);

    // History State
    const [historySessions, setHistorySessions] = useState<DateHistorySession[]>([]);
    const [expandedSummarySessions, setExpandedSummarySessions] = useState<Set<number>>(() => new Set());

    // Resume Logic State
    const [pendingSessionCharId, setPendingSessionCharId] = useState<string | null>(null);

    // --- NEW: Editing State lifted to here for DB sync ---
    const [dateMessages, setDateMessages] = useState<Message[]>([]);
    const [hasSavedOpening, setHasSavedOpening] = useState(false);
    const [forceFreshSession, setForceFreshSession] = useState(false);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editTargetMsg, setEditTargetMsg] = useState<Message | null>(null);
    const [editContent, setEditContent] = useState('');
    const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
    const [activeSummaryDraft, setActiveSummaryDraft] = useState<SummaryDraft | null>(null);
    const [pendingAutoSummary, setPendingAutoSummary] = useState<SummaryDraft | null>(null);
    const [diaryMemoryPreview, setDiaryMemoryPreview] = useState<DateDiaryMemoryPreviewState | null>(null);
    const [isDiaryMemoryGenerating, setIsDiaryMemoryGenerating] = useState(false);
    const [isDiaryMemorySaving, setIsDiaryMemorySaving] = useState(false);
    const [showSummarySettings, setShowSummarySettings] = useState(false);
    const [summaryPromptDraft, setSummaryPromptDraft] = useState('');
    const summaryGeneratingRef = useRef(false);

    const char = characters.find(c => c.id === activeCharacterId);
    const pendingChar = pendingSessionCharId ? characters.find(c => c.id === pendingSessionCharId) : null;
    const secondaryApiConfig = getSecondaryApiConfig();
    const canManualSummary = hasCompleteApiConfig(secondaryApiConfig) || hasCompleteApiConfig(apiConfig);
    const canAutoSummary = hasCompleteApiConfig(secondaryApiConfig);
    const summaryDisabledReason = canManualSummary ? undefined : '请先配置主 API 或副 API';

    // --- Translation State (persisted to localStorage per character) ---
    const [dateTranslationEnabled, setDateTranslationEnabled] = useState(() => {
        if (!char) return false;
        try { return JSON.parse(localStorage.getItem(`date_translation_${char.id}`) || 'false'); } catch { return false; }
    });
    const [dateTranslateSourceLang, setDateTranslateSourceLang] = useState(() => {
        if (!char) return '日本語';
        return localStorage.getItem(`date_trans_src_${char.id}`) || '日本語';
    });
    const [dateTranslateTargetLang, setDateTranslateTargetLang] = useState(() => {
        if (!char) return '中文';
        return localStorage.getItem(`date_trans_tgt_${char.id}`) || '中文';
    });

    // Persist translation settings when they change
    useEffect(() => {
        if (!char) return;
        localStorage.setItem(`date_translation_${char.id}`, JSON.stringify(dateTranslationEnabled));
    }, [char?.id, dateTranslationEnabled]);
    useEffect(() => {
        if (!char) return;
        localStorage.setItem(`date_trans_src_${char.id}`, dateTranslateSourceLang);
    }, [char?.id, dateTranslateSourceLang]);
    useEffect(() => {
        if (!char) return;
        localStorage.setItem(`date_trans_tgt_${char.id}`, dateTranslateTargetLang);
    }, [char?.id, dateTranslateTargetLang]);

    // --- Data Loading ---
    const loadDateMessages = async () => {
        if (char) {
            const msgs = await DB.getMessagesByCharId(char.id);
            // 只筛选 source='date' 的消息用于小说模式显示
            const filtered = msgs.filter(isDateDialogueMessage).sort((a, b) => a.timestamp - b.timestamp);
            setDateMessages(filtered);

            // 检查数据库中是否已经包含当前的 peekStatus（通过内容比对），避免重复保存
            if (peekStatus && filtered.some(m => m.content === peekStatus && m.role === 'assistant')) {
                setHasSavedOpening(true);
            }
        }
    };

    useEffect(() => {
        if (char && mode === 'session') {
            loadDateMessages();
        }
    }, [char, mode]);

    // --- Navigation Helpers ---
    const handleBack = () => {
        if (mode === 'peek') {
            setMode('select');
            setPeekStatus('');
        } else if (mode === 'history') {
            setMode('select');
        } else closeApp();
    };

    const formatTime = () => `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;

    const loadHistorySessions = async (charId: string) => {
        const msgs = await DB.getMessagesByCharId(charId);
        setHistorySessions(buildHistorySessions(msgs));
    };

    const closeEditModal = () => {
        setIsEditModalOpen(false);
        setEditTargetMsg(null);
        setEditContent('');
    };

    const openEditModal = (msg: Message) => {
        setEditTargetMsg(msg);
        setEditContent(msg.content);
        setIsEditModalOpen(true);
    };

    const renderEditModal = () => (
        <Modal
            isOpen={isEditModalOpen}
            title="编辑内容"
            onClose={closeEditModal}
            footer={
                <>
                    <button onClick={closeEditModal} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
                    <button onClick={confirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button>
                </>
            }
        >
            <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed"
            />
        </Modal>
    );

    const buildTimeLabel = () => `${virtualTime.day} ${formatTime()}`;

    const openSummarySettings = () => {
        if (!char) return;
        setSummaryPromptDraft(char.dateSummaryPrompt || DEFAULT_DATE_SUMMARY_PROMPT);
        setShowSummarySettings(true);
    };

    const saveSummarySettings = () => {
        if (!char) return;
        updateCharacter(char.id, {
            dateSummaryPrompt: summaryPromptDraft.trim() || DEFAULT_DATE_SUMMARY_PROMPT,
        });
        setShowSummarySettings(false);
        addToast('总结设置已保存', 'success');
    };

    const restoreDefaultSummarySettings = () => {
        if (!char) return;
        setSummaryPromptDraft(DEFAULT_DATE_SUMMARY_PROMPT);
        updateCharacter(char.id, { dateSummaryPrompt: DEFAULT_DATE_SUMMARY_PROMPT });
        addToast('总结提示词已恢复默认', 'success');
    };

    const generateSummaryDraft = async (summaryType: SummaryType): Promise<SummaryDraft | null> => {
        if (!char || summaryGeneratingRef.current) return null;

        const secondaryConfig = getSecondaryApiConfig();
        const selectedApi = summaryType === 'auto'
            ? secondaryConfig
            : (hasCompleteApiConfig(secondaryConfig) ? secondaryConfig : apiConfig);

        if (!hasCompleteApiConfig(selectedApi)) {
            if (summaryType === 'manual') addToast('请先配置 API', 'error');
            return null;
        }

        summaryGeneratingRef.current = true;
        setIsSummaryGenerating(true);

        try {
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const sessionMessages = getCurrentSessionMessages(allMsgs);
            if (sessionMessages.length === 0) {
                if (summaryType === 'manual') addToast('还没有可总结的见面内容', 'info');
                return null;
            }

            const targetMessages = summaryType === 'auto'
                ? sessionMessages.filter(m => (!char.dateSummaryLastAutoMsgId || m.id > char.dateSummaryLastAutoMsgId) && !m.metadata?.dateSummaryAutoHidden)
                : sessionMessages;

            const threshold = char.dateSummaryAutoThreshold || 20;
            if (summaryType === 'auto' && targetMessages.length < threshold) return null;
            if (targetMessages.length < 4) {
                if (summaryType === 'manual') addToast('消息太少，无法总结', 'info');
                return null;
            }

            const promptSnapshot = char.dateSummaryPrompt?.trim() || DEFAULT_DATE_SUMMARY_PROMPT;
            const prompt = buildSummaryPrompt(char.name, userProfile.name, buildTimeLabel(), targetMessages, promptSnapshot);

            const response = await fetchDateChatCompletion(selectedApi, {
                    model: selectedApi.model,
                    messages: [
                        { role: 'system', content: '你负责把线下见面记录整理成可供角色之后自然记住的总结。只输出总结正文。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.45,
                },
                summaryType === 'auto' ? '见面自动摘要更新' : '见面手动摘要生成',
                char.id,
                undefined,
                summaryType === 'manual',
            );

            if (!response.ok) throw new Error(`Summary API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const extracted = extractThinking(data.choices?.[0]?.message?.content || '');
            const content = extracted.content.trim();
            if (!content) throw new Error('Summary content empty');

            const sessionStartMsgId = sessionMessages[0].id;
            const coveredMsgIds = targetMessages.map(m => m.id);
            return {
                content,
                summaryType,
                coveredMsgIds,
                sessionStartMsgId,
                promptSnapshot,
                lastCoveredMsgId: coveredMsgIds[coveredMsgIds.length - 1],
            };
        } catch (e: any) {
            if (summaryType === 'manual') addToast(`总结生成失败: ${e.message || e}`, 'error');
            else console.warn('[DateSummary] auto summary failed:', e);
            return null;
        } finally {
            summaryGeneratingRef.current = false;
            setIsSummaryGenerating(false);
        }
    };

    /**
     * Generate a comprehensive exit summary:
     * Combines existing auto-summaries + unsummarized raw messages into one complete summary.
     */
    const generateExitSummaryDraft = async (): Promise<SummaryDraft | null> => {
        if (!char || summaryGeneratingRef.current) return null;
        const secondaryConfig = getSecondaryApiConfig();
        const selectedApi = hasCompleteApiConfig(secondaryConfig) ? secondaryConfig : apiConfig;
        if (!hasCompleteApiConfig(selectedApi)) { addToast('请先配置 API', 'error'); return null; }

        summaryGeneratingRef.current = true;
        setIsSummaryGenerating(true);
        try {
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const sessionMessages = getCurrentSessionMessages(allMsgs);
            if (sessionMessages.length === 0) { addToast('还没有可总结的见面内容', 'info'); return null; }

            const sessionStartMsgId = sessionMessages[0].id;
            const sessionMsgIds = new Set(sessionMessages.map(m => m.id));

            const savedSummaries = allMsgs
                .filter(isDateSummaryMessage)
                .filter(s => s.metadata?.sessionStartMsgId === sessionStartMsgId
                    || (Array.isArray(s.metadata?.coveredMsgIds) && s.metadata.coveredMsgIds.some((id: unknown) => typeof id === 'number' && sessionMsgIds.has(id as number))))
                .sort((a, b) => a.timestamp - b.timestamp);

            const coveredByExistingSummaries = new Set<number>();
            for (const s of savedSummaries) {
                if (Array.isArray(s.metadata?.coveredMsgIds)) {
                    for (const id of s.metadata.coveredMsgIds) {
                        if (typeof id === 'number') coveredByExistingSummaries.add(id);
                    }
                }
            }

            const unsummarizedMessages = sessionMessages.filter(m => !coveredByExistingSummaries.has(m.id));

            const promptSnapshot = char.dateSummaryPrompt?.trim() || DEFAULT_DATE_SUMMARY_PROMPT;
            let exitPromptContent = '';

            if (savedSummaries.length > 0) {
                const summaryBlocks = savedSummaries.map((s, i) => `### 已总结片段 ${i + 1}\n${s.content}`).join('\n\n');
                exitPromptContent += `【之前的阶段总结】\n${summaryBlocks}\n\n`;
            }

            if (unsummarizedMessages.length > 0) {
                const rawBlock = formatMessagesForSummary(unsummarizedMessages, char.name, userProfile.name);
                exitPromptContent += `【未总结的新记录】\n${rawBlock}\n\n`;
            } else if (savedSummaries.length > 0) {
                exitPromptContent += '（所有内容均已在上方总结中覆盖）\n\n';
            }

            if (!exitPromptContent.trim()) { addToast('没有可总结的内容', 'info'); return null; }

            const fullPrompt = `你正在为 ${char.name} 和 ${userProfile.name} 的一次线下见面写最终总结。
请把下面所有内容（包括已总结的片段和新增原始记录）合并成一份完整的、连贯的总结。

当前时间: ${buildTimeLabel()}

${exitPromptContent}
【输出要求】
- 使用 Markdown。
- 写成 ${char.name} 之后能自然记住的事实与情绪脉络。
- 保留关键事件、关系变化、未说出口的情绪、值得之后线上承接的小细节。
- 不要生成新的剧情，不要改写已经发生的事实。
- 把之前的总结片段和新内容融合成一份流畅的整体，不要简单拼接。`;

            const response = await fetchDateChatCompletion(selectedApi, {
                    model: selectedApi.model,
                    messages: [
                        { role: 'system', content: '你负责把线下见面的所有记录整理成一份完整的最终总结。只输出总结正文。' },
                        { role: 'user', content: fullPrompt },
                    ],
                    temperature: 0.45,
                },
                '见面退出最终摘要',
                char.id,
                undefined,
                true,
            );
            if (!response.ok) throw new Error(`Summary API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const extracted = extractThinking(data.choices?.[0]?.message?.content || '');
            const content = extracted.content.trim();
            if (!content) throw new Error('Exit summary content empty');

            const allCoveredMsgIds = sessionMessages.map(m => m.id);
            return {
                content, summaryType: 'manual', coveredMsgIds: allCoveredMsgIds,
                sessionStartMsgId, promptSnapshot,
                lastCoveredMsgId: allCoveredMsgIds[allCoveredMsgIds.length - 1],
            };
        } catch (e: any) {
            addToast(`总结生成失败: ${e.message || e}`, 'error');
            return null;
        } finally {
            summaryGeneratingRef.current = false;
            setIsSummaryGenerating(false);
        }
    };

    const saveSummaryRecord = async (draft: SummaryDraft): Promise<number> => {
        if (!char) return 0;
        // Save summary as pure summary — NO bridge flag in metadata.
        const savedSummaryId = await DB.saveMessage({
            charId: char.id, role: 'system', type: 'text', content: draft.content,
            metadata: {
                source: 'date', hiddenFromUser: true, isSummary: true, summaryType: draft.summaryType,
                coveredMsgIds: draft.coveredMsgIds, sessionStartMsgId: draft.sessionStartMsgId, promptSnapshot: draft.promptSnapshot,
            },
        });
        if (char.dateSummaryAutoHideEnabled) await hideSummarizedDateMessages(draft, savedSummaryId);
        if (draft.summaryType === 'auto') updateCharacter(char.id, { dateSummaryLastAutoMsgId: draft.lastCoveredMsgId });
        if (draft.fromPendingAuto || pendingAutoSummary?.lastCoveredMsgId === draft.lastCoveredMsgId) setPendingAutoSummary(null);
        await loadDateMessages();
        return savedSummaryId;
    };

    const finishSummarySave = async (draft: SummaryDraft, diaryMemoryCount = 0) => {
        const memorySuffix = diaryMemoryCount > 0 ? `，已刻入 ${diaryMemoryCount} 条日记记忆` : '';
        // If this save was triggered from exit flow, create bridge then exit
        if (draft.bridgeOnSave && draft.exitState) {
            const bridged = await createBridgeFromSummary();
            addToast(bridged ? `总结已同步到主聊天${memorySuffix}` : `总结已保存${memorySuffix}`, 'success');
            finishExitSession(draft.exitState);
        } else {
            addToast(`总结已保存${memorySuffix}`, 'success');
            if (draft.exitState) finishExitSession(draft.exitState);
        }
    };

    const prepareDiaryMemoryPreview = async (draft: SummaryDraft) => {
        if (!char || isDiaryMemoryGenerating) return;
        const secondaryConfig = getSecondaryApiConfig();
        const selectedApi = hasCompleteApiConfig(secondaryConfig) ? secondaryConfig : apiConfig;
        if (!hasCompleteApiConfig(selectedApi)) {
            addToast('请先配置主 API 或副 API 来生成日记记忆', 'error');
            return;
        }

        setIsDiaryMemoryGenerating(true);
        try {
            const prompt = buildDateDiaryMemoryPrompt(char.name, userProfile.name, buildTimeLabel(), draft.content);
            const response = await fetchDateChatCompletion(selectedApi, {
                    model: selectedApi.model,
                    messages: [
                        { role: 'system', content: '你负责把线下见面总结拆成角色第一人称的长期日记记忆。只输出 JSON 数组。' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.5,
                    max_tokens: 3500,
                },
                '见面日记记忆预览',
                char.id,
                undefined,
                true,
            );

            if (!response.ok) throw new Error(`Diary Memory API Error: ${response.status}`);
            const data = await safeResponseJson(response);
            const extracted = extractThinking(data.choices?.[0]?.message?.content || '');
            const entries = parseDateDiaryMemoryResponse(extracted.content);
            if (entries.length === 0) throw new Error('日记记忆内容为空或无法解析');

            setDiaryMemoryPreview({
                summaryDraft: draft,
                entries: entries.map(entry => createDiaryMemoryPreviewEntry(entry)),
            });
            setActiveSummaryDraft(null);
        } catch (e: any) {
            console.error('[DateApp] Generate diary memory preview failed', e);
            addToast(`日记记忆生成失败: ${e.message || e}`, 'error');
        } finally {
            setIsDiaryMemoryGenerating(false);
        }
    };

    const saveDateDiaryVectorMemories = async (
        entries: DateDiaryMemoryPreviewEntry[],
        draft: SummaryDraft,
    ): Promise<number> => {
        if (!char) return 0;
        const validEntries = entries
            .map(entry => ({
                ...entry,
                title: entry.title.trim(),
                content: entry.content.trim(),
                emotionalJourney: entry.emotionalJourney?.trim() || undefined,
                importance: Number.isFinite(entry.importance)
                    ? Math.min(10, Math.max(1, Math.round(entry.importance)))
                    : 5,
            }))
            .filter(entry => entry.title && entry.content);
        if (validEntries.length === 0) return 0;

        const { getEmbeddingConfig, hasCloudSyncTarget } = await import('../utils/runtimeConfig');
        const { EmbeddingService } = await import('../utils/embeddingService');
        const { markVectorMemoryAsPendingSync, markVectorMemoryAsLocalOnly, markVectorMemoryAsSynced } = await import('../utils/vectorMemorySyncState');
        const { pushMemories } = await import('../utils/backendClient');

        const embedConfig = getEmbeddingConfig();
        const embedKey = embedConfig.apiKey;
        if (!embedKey) throw new Error('未配置 Embedding API Key');

        const textsToEmbed = validEntries.map(entry => {
            const renderedContent = renderDateDiaryMemoryTemplate(entry.content, char.name, userProfile.name);
            const renderedEmotion = entry.emotionalJourney
                ? renderDateDiaryMemoryTemplate(entry.emotionalJourney, char.name, userProfile.name)
                : '';
            return `${entry.title}: ${renderedContent}${renderedEmotion ? `\n当时的感受: ${renderedEmotion}` : ''}`;
        });
        const vectors = await EmbeddingService.embedBatch(textsToEmbed, 'VECTOR_MEMORY', embedKey);
        if (vectors.length !== validEntries.length) throw new Error('Embedding 返回数量不一致');

        const sourceMessageIds = Array.isArray(draft.coveredMsgIds)
            ? draft.coveredMsgIds.filter((id): id is number => typeof id === 'number')
            : [];
        const createdAt = Date.now();
        const memories = validEntries.map((entry, index) => ({
            id: `vmem-date-${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            charId: char.id,
            title: entry.title,
            content: entry.content,
            emotionalJourney: entry.emotionalJourney,
            vector: vectors[index],
            modelId: embedConfig.model,
            source: 'manual' as const,
            importance: entry.importance,
            createdAt: createdAt + index,
            mentionCount: 0,
            lastMentioned: 0,
            sourceMessageIds,
        }));

        const isCloud = hasCloudSyncTarget();
        const finalMemories = memories.map(memory => (
            isCloud ? markVectorMemoryAsPendingSync(memory) : markVectorMemoryAsLocalOnly(memory)
        ));
        await Promise.all(finalMemories.map(memory => DB.saveVectorMemory(memory)));

        if (isCloud) {
            pushMemories(char.id, finalMemories).then(success => {
                if (!success) return;
                finalMemories.forEach(memory => {
                    DB.saveVectorMemory(markVectorMemoryAsSynced(memory)).catch(() => {});
                });
            }).catch(() => {});
        }

        return finalMemories.length;
    };

    const saveSummaryDraft = async (draft: SummaryDraft) => {
        if (!char) return;
        if (draft.injectToVectorMemory) {
            await prepareDiaryMemoryPreview(draft);
            return;
        }

        const savedSummaryId = await saveSummaryRecord(draft);
        if (savedSummaryId) {
            setActiveSummaryDraft(null);
            await finishSummarySave(draft);
        }
    };

    const saveDiaryMemoryPreview = async () => {
        if (!diaryMemoryPreview || !char || isDiaryMemorySaving) return;
        const validEntries = diaryMemoryPreview.entries.filter(entry => entry.title.trim() && entry.content.trim());
        if (validEntries.length === 0) {
            addToast('至少保留一条日记记忆，或选择跳过记忆保存', 'info');
            return;
        }

        setIsDiaryMemorySaving(true);
        try {
            const summaryDraft = { ...diaryMemoryPreview.summaryDraft, injectToVectorMemory: false };
            const diaryMemoryCount = await saveDateDiaryVectorMemories(validEntries, summaryDraft);
            const savedSummaryId = await saveSummaryRecord(summaryDraft);
            if (savedSummaryId) {
                setDiaryMemoryPreview(null);
                setActiveSummaryDraft(null);
                await finishSummarySave(summaryDraft, diaryMemoryCount);
            }
        } catch (e: any) {
            console.error('[DateApp] Save diary memory preview failed', e);
            addToast(`日记记忆写入失败: ${e.message || e}`, 'error');
        } finally {
            setIsDiaryMemorySaving(false);
        }
    };

    const skipDiaryMemoryPreview = async () => {
        if (!diaryMemoryPreview || isDiaryMemorySaving) return;
        setIsDiaryMemorySaving(true);
        try {
            const summaryDraft = { ...diaryMemoryPreview.summaryDraft, injectToVectorMemory: false };
            const savedSummaryId = await saveSummaryRecord(summaryDraft);
            if (savedSummaryId) {
                setDiaryMemoryPreview(null);
                setActiveSummaryDraft(null);
                await finishSummarySave(summaryDraft);
            }
        } catch (e: any) {
            console.error('[DateApp] Save summary without diary memory failed', e);
            addToast(`总结保存失败: ${e.message || e}`, 'error');
        } finally {
            setIsDiaryMemorySaving(false);
        }
    };

    const returnToSummaryFromDiaryPreview = () => {
        if (!diaryMemoryPreview || isDiaryMemorySaving) return;
        setActiveSummaryDraft(diaryMemoryPreview.summaryDraft);
        setDiaryMemoryPreview(null);
    };

    const updateDiaryMemoryPreviewEntry = (
        id: string,
        updates: Partial<Omit<DateDiaryMemoryPreviewEntry, 'id'>>,
    ) => {
        setDiaryMemoryPreview(current => current ? {
            ...current,
            entries: current.entries.map(entry => entry.id === id ? { ...entry, ...updates } : entry),
        } : current);
    };

    const removeDiaryMemoryPreviewEntry = (id: string) => {
        setDiaryMemoryPreview(current => current ? {
            ...current,
            entries: current.entries.filter(entry => entry.id !== id),
        } : current);
    };

    const addDiaryMemoryPreviewEntry = () => {
        setDiaryMemoryPreview(current => current ? {
            ...current,
            entries: [...current.entries, createDiaryMemoryPreviewEntry()],
        } : current);
    };

    const closeSummaryModal = () => {
        setActiveSummaryDraft(null);
    };

    const discardSummaryDraft = () => {
        if (!char || !activeSummaryDraft) return;
        const draft = activeSummaryDraft;
        if (draft.summaryType === 'auto') {
            updateCharacter(char.id, { dateSummaryLastAutoMsgId: draft.lastCoveredMsgId });
            setPendingAutoSummary(null);
        }
        setActiveSummaryDraft(null);
        addToast('已丢弃总结草稿', 'info');
        if (draft.exitState) finishExitSession(draft.exitState);
    };

    const discardPendingAutoSummary = () => {
        if (!char || !pendingAutoSummary) return;
        updateCharacter(char.id, { dateSummaryLastAutoMsgId: pendingAutoSummary.lastCoveredMsgId });
        setPendingAutoSummary(null);
        addToast('已丢弃自动总结', 'info');
    };

    const hideCoveredDateMessageIds = async (coveredMsgIds: number[], summaryMsgId: number) => {
        const idsToHide = coveredMsgIds.slice(0, Math.max(0, coveredMsgIds.length - DATE_SUMMARY_CONTEXT_KEEP_COUNT));
        if (idsToHide.length === 0) return;

        await Promise.all(idsToHide.map(id => DB.updateMessageMetadata(id, {
            hiddenFromUser: true,
            dateSummaryAutoHidden: true,
            hiddenBySummaryMsgId: summaryMsgId,
        })));
    };

    const hideSummarizedDateMessages = async (draft: SummaryDraft, summaryMsgId: number) => {
        await hideCoveredDateMessageIds(draft.coveredMsgIds, summaryMsgId);
    };

    const compressExistingDateSummaries = async () => {
        if (!char) return;
        const allMsgs = await DB.getMessagesByCharId(char.id);
        const summaries = allMsgs
            .filter(isDateSummaryMessage)
            .sort((a, b) => a.timestamp - b.timestamp);

        for (const summary of summaries) {
            if (!Array.isArray(summary.metadata?.coveredMsgIds)) continue;
            const coveredMsgIds = summary.metadata.coveredMsgIds.filter((id: unknown): id is number => typeof id === 'number');
            await hideCoveredDateMessageIds(coveredMsgIds, summary.id);
        }

        await loadDateMessages();
    };

    const requestManualSummary = async () => {
        const draft = await generateSummaryDraft('manual');
        if (draft) setActiveSummaryDraft(draft);
    };

    const maybeTriggerAutoSummary = async (msgs: Message[]) => {
        if (!char || !char.dateSummaryAutoEnabled || pendingAutoSummary || summaryGeneratingRef.current) return;
        if (!hasCompleteApiConfig(getSecondaryApiConfig())) return;
        const sessionMessages = getCurrentSessionMessages(msgs);
        const unsummarizedSessionMessages = sessionMessages.filter(m => !m.metadata?.dateSummaryAutoHidden);
        const newCount = char.dateSummaryLastAutoMsgId
            ? unsummarizedSessionMessages.filter(m => m.id > char.dateSummaryLastAutoMsgId!).length
            : unsummarizedSessionMessages.length;
        const threshold = char.dateSummaryAutoThreshold || 20;
        if (newCount < threshold) return;

        const draft = await generateSummaryDraft('auto');
        if (draft) {
            setPendingAutoSummary(draft);
        }
    };

    const finishExitSession = (finalState: DateState) => {
        if (char) {
            updateCharacter(char.id, { savedDateState: finalState });
            addToast('进度已保存', 'success');
        }
        setPendingAutoSummary(null);
        setActiveSummaryDraft(null);
        setMode('select');
        setPeekStatus('');
        setHasSavedOpening(false);
    };

    const saveRawBridgeAndExit = async (finalState: DateState) => {
        if (!char) return;
        const allMsgs = await DB.getMessagesByCharId(char.id);
        const sessionMessages = getCurrentSessionMessages(allMsgs);
        if (sessionMessages.length > 0) {
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: formatDateMessagesForBridge(sessionMessages, char.name, userProfile.name),
                metadata: {
                    source: 'date',
                    hiddenFromUser: true,
                    isDateContextBridge: true,
                    bridgeType: 'raw',
                    coveredMsgIds: sessionMessages.map(m => m.id),
                    sessionStartMsgId: sessionMessages[0].id,
                },
            });
            addToast('原始记录已同步到主聊天', 'success');
        }
        finishExitSession(finalState);
    };

    /** Remove all bridge messages created during this date session */
    const cleanSessionBridges = async () => {
        if (!char) return;
        const allMsgs = await DB.getMessagesByCharId(char.id);
        const sessionMessages = getCurrentSessionMessages(allMsgs);
        if (sessionMessages.length === 0) return;
        const sessionMsgIds = new Set(sessionMessages.map(m => m.id));
        const sessionStartMsgId = sessionMessages[0].id;
        const bridges = allMsgs.filter(m =>
            m.metadata?.source === 'date' && m.metadata?.isDateContextBridge === true
            && !isDateForkBridge(m)
            && (m.metadata?.sessionStartMsgId === sessionStartMsgId
                || (Array.isArray(m.metadata?.coveredMsgIds) && m.metadata.coveredMsgIds.some((id: unknown) => typeof id === 'number' && sessionMsgIds.has(id as number))))
        );
        if (bridges.length > 0) {
            await DB.deleteMessages(bridges.map(m => m.id));
            console.log(`[Date] Cleaned ${bridges.length} bridge messages on 'none' exit`);
        }
    };

    /** Create a bridge message from an existing saved summary */
    const createBridgeFromSummary = async (): Promise<boolean> => {
        if (!char) return false;
        const allMsgs = await DB.getMessagesByCharId(char.id);
        const sessionMessages = getCurrentSessionMessages(allMsgs);
        if (sessionMessages.length === 0) return false;
        const sessionStartMsgId = sessionMessages[0].id;
        const sessionMsgIds = new Set(sessionMessages.map(m => m.id));
        const savedSummary = allMsgs
            .filter(isDateSummaryMessage)
            .sort((a, b) => b.timestamp - a.timestamp || b.id - a.id)
            .find(m => m.metadata?.sessionStartMsgId === sessionStartMsgId
                || (Array.isArray(m.metadata?.coveredMsgIds) && m.metadata.coveredMsgIds.some((id: unknown) => typeof id === 'number' && sessionMsgIds.has(id as number))));
        if (!savedSummary) return false;
        const existingBridge = allMsgs.find(m =>
            m.metadata?.source === 'date' && m.metadata?.isDateContextBridge === true && m.metadata?.summarySourceMsgId === savedSummary.id
        );
        if (existingBridge) return true;
        const coveredMsgIds = Array.isArray(savedSummary.metadata?.coveredMsgIds)
            ? savedSummary.metadata.coveredMsgIds.filter((id: unknown): id is number => typeof id === 'number')
            : sessionMessages.map(m => m.id);
        await DB.saveMessage({
            charId: char.id, role: 'system', type: 'text', content: savedSummary.content,
            metadata: {
                source: 'date', hiddenFromUser: true, isDateContextBridge: true, bridgeType: 'summary',
                coveredMsgIds, sessionStartMsgId, summarySourceMsgId: savedSummary.id,
                promptSnapshot: savedSummary.metadata?.promptSnapshot || '',
            },
        });
        return true;
    };

    const renderSummaryModal = () => {
        if (!activeSummaryDraft) return null;
        const saveLabel = activeSummaryDraft.injectToVectorMemory
            ? '生成日记预览'
            : activeSummaryDraft.bridgeOnSave ? '保存并同步' : activeSummaryDraft.exitState ? '保存并退出' : '保存';
        return (
            <Modal
                isOpen={!!activeSummaryDraft}
                title="场次总结预览"
                onClose={closeSummaryModal}
                footer={
                    <>
                        <button
                            onClick={() => navigator.clipboard.writeText(activeSummaryDraft.content).then(() => addToast('已复制', 'success')).catch(() => addToast('复制失败', 'error'))}
                            className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold"
                        >
                            复制
                        </button>
                        <button onClick={discardSummaryDraft} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-500 font-bold">丢弃</button>
                        <button
                            disabled={!activeSummaryDraft.content.trim() || isDiaryMemoryGenerating}
                            onClick={() => saveSummaryDraft(activeSummaryDraft)}
                            className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl disabled:opacity-50"
                        >
                            {isDiaryMemoryGenerating ? '生成日记...' : saveLabel}
                        </button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-400">
                            <span>总结正文</span>
                            <span>{activeSummaryDraft.content.trim().length} 字</span>
                        </div>
                        <textarea
                            value={activeSummaryDraft.content}
                            onChange={e => setActiveSummaryDraft(current => current ? { ...current, content: e.target.value } : current)}
                            rows={10}
                            className="w-full resize-y rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        />
                    </div>
                    {activeSummaryDraft.content.trim() && (
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">排版预览</div>
                            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed">
                                {renderMarkdown(activeSummaryDraft.content)}
                            </div>
                        </div>
                    )}
                    {activeSummaryDraft.summaryType === 'manual' && activeSummaryDraft.bridgeOnSave && (
                        <label className="flex items-center gap-2 mt-4 cursor-pointer p-3 bg-slate-50 rounded-xl border border-slate-200 transition-colors hover:bg-slate-100">
                            <input 
                                type="checkbox" 
                                className="w-4 h-4 text-emerald-500 rounded border-slate-300 focus:ring-emerald-500" 
                                checked={activeSummaryDraft.injectToVectorMemory || false} 
                                onChange={e => setActiveSummaryDraft({ ...activeSummaryDraft, injectToVectorMemory: e.target.checked })} 
                            />
                            <span className="text-sm font-medium text-slate-700">提取角色日记碎片，确认后刻入永久向量记忆库</span>
                        </label>
                    )}
                </div>
            </Modal>
        );
    };

    const renderDiaryMemoryPreviewModal = () => {
        if (!diaryMemoryPreview) return null;
        const validCount = diaryMemoryPreview.entries.filter(entry => entry.title.trim() && entry.content.trim()).length;
        return (
            <Modal
                isOpen={!!diaryMemoryPreview}
                title="日记记忆预览"
                onClose={returnToSummaryFromDiaryPreview}
                footer={
                    <>
                        <button
                            disabled={isDiaryMemorySaving}
                            onClick={returnToSummaryFromDiaryPreview}
                            className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-500 font-bold disabled:opacity-50"
                        >
                            返回总结
                        </button>
                        <button
                            disabled={isDiaryMemorySaving}
                            onClick={skipDiaryMemoryPreview}
                            className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold disabled:opacity-50"
                        >
                            跳过记忆
                        </button>
                        <button
                            disabled={isDiaryMemorySaving || validCount === 0}
                            onClick={saveDiaryMemoryPreview}
                            className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl disabled:opacity-50"
                        >
                            {isDiaryMemorySaving ? '写入中...' : `写入 ${validCount} 条`}
                        </button>
                    </>
                }
            >
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-xs leading-relaxed text-slate-400">这些碎片会单独向量化。预览里显示当前名字，写入时会保留可替换的名字锚点。</p>
                        <button
                            type="button"
                            disabled={isDiaryMemorySaving}
                            onClick={addDiaryMemoryPreviewEntry}
                            className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500 active:scale-95 disabled:opacity-50"
                        >
                            新增
                        </button>
                    </div>
                    <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                        {diaryMemoryPreview.entries.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
                                暂无日记碎片，可以新增一条，或跳过记忆保存。
                            </div>
                        ) : diaryMemoryPreview.entries.map((entry, index) => (
                            <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">碎片 {index + 1}</span>
                                    <button
                                        type="button"
                                        disabled={isDiaryMemorySaving}
                                        onClick={() => removeDiaryMemoryPreviewEntry(entry.id)}
                                        className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-red-400 disabled:opacity-50"
                                    >
                                        删除
                                    </button>
                                </div>
                                <div className="grid grid-cols-[1fr_72px] gap-2">
                                    <input
                                        value={entry.title}
                                        disabled={isDiaryMemorySaving}
                                        onChange={e => updateDiaryMemoryPreviewEntry(entry.id, { title: e.target.value })}
                                        placeholder="标题"
                                        className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                                    />
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={entry.importance}
                                        disabled={isDiaryMemorySaving}
                                        onChange={e => updateDiaryMemoryPreviewEntry(entry.id, { importance: parseDiaryMemoryImportance(e.target.value) })}
                                        className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-center text-xs font-bold text-slate-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                                    />
                                </div>
                                <textarea
                                    value={renderDateDiaryMemoryTemplate(entry.content, char.name, userProfile.name)}
                                    disabled={isDiaryMemorySaving}
                                    onChange={e => updateDiaryMemoryPreviewEntry(entry.id, { content: toDateDiaryMemoryTemplate(e.target.value, char.name, userProfile.name) })}
                                    rows={5}
                                    placeholder={`我记得 ${userProfile.name} ...`}
                                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                                />
                                <input
                                    value={entry.emotionalJourney ? renderDateDiaryMemoryTemplate(entry.emotionalJourney, char.name, userProfile.name) : ''}
                                    disabled={isDiaryMemorySaving}
                                    onChange={e => updateDiaryMemoryPreviewEntry(entry.id, { emotionalJourney: toDateDiaryMemoryTemplate(e.target.value, char.name, userProfile.name) })}
                                    placeholder="当时的感受，例如：舍不得、克制、心动"
                                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>
        );
    };

    const renderSummarySettingsModal = () => (
        <Modal
            isOpen={showSummarySettings}
            title="总结设置"
            onClose={() => setShowSummarySettings(false)}
            footer={
                <>
                    <button onClick={() => setShowSummarySettings(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-500 font-bold">取消</button>
                    <button onClick={saveSummarySettings} className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl">保存</button>
                </>
            }
        >
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-relaxed text-slate-400">只影响见面总结生成，不会改动立绘、场景等其他见面设置。</p>
                    <button
                        onClick={restoreDefaultSummarySettings}
                        className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500 active:scale-95"
                    >
                        恢复默认
                    </button>
                </div>
                <textarea
                    value={summaryPromptDraft}
                    onChange={e => setSummaryPromptDraft(e.target.value)}
                    rows={9}
                    className="w-full resize-y rounded-2xl border border-slate-100 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-700 outline-none focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-100"
                />
                <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-400">
                    可用变量: <span className="font-mono text-slate-500">${'{charName}'}</span> <span className="font-mono text-slate-500">${'{userName}'}</span> <span className="font-mono text-slate-500">${'{time}'}</span> <span className="font-mono text-slate-500">${'{messages}'}</span>
                </div>
            </div>
        </Modal>
    );

    // Improved Time Gap Logic
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是你们的初次互动。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const currentHour = new Date().getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;

        if (diffMins < 5) return '';
        if (diffMins < 60) return `[系统提示: 距离上次互动: ${diffMins} 分钟。]`;
        if (diffHours < 6) {
            if (isNight) return `[系统提示: 距离上次互动: ${diffHours} 小时。现在是深夜/清晨。]`;
            return `[系统提示: 距离上次互动: ${diffHours} 小时。]`;
        }
        if (diffHours < 24) return `[系统提示: 距离上次互动: ${diffHours} 小时。]`;
        const days = Math.floor(diffHours / 24);
        return `[系统提示: 距离上次互动: ${days} 天。]`;
    };

    // --- Resume / Start Logic ---
    const handleCharClick = (c: CharacterProfile) => {
        if (c.savedDateState) {
            setPendingSessionCharId(c.id);
        } else {
            startPeek(c);
        }
    };

    const handleResumeSession = () => {
        if (!pendingSessionCharId) return;
        const c = characters.find(ch => ch.id === pendingSessionCharId);
        if (!c || !c.savedDateState) {
            addToast('存档已丢失', 'error');
            setPendingSessionCharId(null);
            return;
        }
        setActiveCharacterId(c.id);
        setForceFreshSession(false);
        setMode('session');
        setPendingSessionCharId(null);
        addToast('已恢复上次进度', 'success');
    };

    const handleStartNewSession = () => {
        if (!pendingSessionCharId) return;
        const c = characters.find(ch => ch.id === pendingSessionCharId);
        if (!c) {
            setPendingSessionCharId(null);
            return;
        }
        updateCharacter(c.id, { savedDateState: undefined });
        setForceFreshSession(true);
        startPeek(c);
        setPendingSessionCharId(null);
    };

    // --- 关键修复: 进入 Session 时立即归档开场白 ---
    const handleEnterSession = async () => {
        if (!char) return;

        // 1. 如果有开场白且未保存，立即保存到数据库
        // 这确保了 user 发送第一句话时，AI 能在历史记录里读到这个开场
        // UPDATE: 添加 isOpening 标记，用于区分新会话
        if (peekStatus && !hasSavedOpening) {
            try {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'text',
                    content: peekStatus,
                    metadata: { source: 'date', isOpening: true, thinking: peekThinking || undefined }
                });
                setHasSavedOpening(true);
            } catch (e) {
                console.error("Failed to save opening", e);
            }
        }

        // 2. 切换模式并刷新数据
        setMode('session');
        await loadDateMessages();
    };

    // --- Peek (Generation) Logic ---
    const startPeek = async (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        setForceFreshSession(true);
        setMode('peek');
        setPeekLoading(true);
        setPeekStatus('');
        setHasSavedOpening(false);

        try {
            const msgs = (await DB.getMessagesByCharId(c.id)).filter(isDateModeContextMessage);
            const limit = c.contextLimit || 500;
            const peekLimit = Math.min(limit, 50);
            const lastMsg = msgs[msgs.length - 1];
            const gapHint = getTimeGapHint(lastMsg?.timestamp);

            const recentMsgs = msgs.slice(-peekLimit).map(m => {
                const content = m.type === 'image' ? '[User sent an image]' : m.content;
                return `${m.role}: ${content}`;
            }).join('\n');

            const timeStr = `${virtualTime.day} ${formatTime()}`;

            // Build system prompt: dreamweaver + identity intro + core context
            let peekSystemPrompt = buildDatePreamble(c.name, userProfile.name);
            peekSystemPrompt += ContextBuilder.buildCoreContext(c, userProfile, false);

            // Force separator to signal new scene
            const contextSeparator = gapHint ? `\n\n--- [TIME SKIP: ${gapHint}] ---\n\n` : `\n\n--- [NEW SCENE START] ---\n\n`;

            const peekInstructions = `
### 场景：感知 (Sense Presence)
当前时间: ${timeStr}
时间上下文: ${gapHint}

### 任务
你现在并不在和${userProfile.name}直接对话。${userProfile.name}正在悄悄靠近你所在的地点。
请用**第三人称**描写一段话。
描述：${c.name} 此时此刻正在做什么？周围环境是怎样的？状态如何？

### 逻辑检查
1. **上下文连贯性**: 参考 [最近记录]，但**必须**注意 [TIME SKIP]。如果是很久没见，不要接着上一次的话题聊，而是开启新场景。
2. **状态一致性**: ${gapHint.includes('很久') ? '因为很久没见，可能在发呆、忙碌或者有点落寞。' : '根据之前的聊天状态决定。'}
3. **描写风格**: 电影感，沉浸式，细节丰富。不要输出任何前缀，直接输出描写内容。`;

            const response = await fetchDateChatCompletion(apiConfig, {
                    model: apiConfig.model,
                    messages: [
                        { role: "system", content: peekSystemPrompt },
                        { role: "user", content: `[最近记录 (Previous Context)]:${recentMsgs}${contextSeparator}${peekInstructions}\n\n(Start sensing...)` }
                    ],
                    temperature: 0.85
                },
                '见面入场前状态感知',
                c.id,
                undefined,
                true,
            );

            if (!response.ok) throw new Error('Failed to sense presence');
            const data = await safeResponseJson(response);
            const rawPeek = data.choices[0].message.content;
            const peekExtracted = extractThinking(rawPeek);
            setPeekStatus(peekExtracted.content);
            setPeekThinking(peekExtracted.thinking || '');

        } catch (e: any) {
            setPeekStatus(`(无法感知状态: ${e.message})`);
        } finally {
            setPeekLoading(false);
        }
    };

    // --- Session API Logic ---
    const handleSendMessage = async (text: string, directorHint?: string): Promise<{ content: string; whispers: InnerWhisper[] }> => {
        if (!char) throw new Error("No char");

        // 1. Save User Msg
        const userMessageId = await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: text, metadata: { source: 'date' } });

        // 2. Prepare Context
        // Re-fetch messages. Since we saved the opening in handleEnterSession, 
        // 'allMsgs' will now correctly contain: [History..., Opening, UserMsg]
        const allMsgs = await DB.getMessagesByCharId(char.id);

        // Update local state for display
        const dateFiltered = allMsgs.filter(isDateDialogueMessage).sort((a, b) => a.timestamp - b.timestamp);
        setDateMessages(dateFiltered);

        const limit = char.contextLimit || 500;
        const visibleHistory = allMsgs.filter(isDateModeContextMessage);

        // Construct History for AI
        // We exclude the very last message (UserMsg we just sent) from history array 
        // because we'll pass it as the explicit user prompt "content".
        // BUT, we must ensure the Opening (Assistant) is included in history.
        const historyMsgs = visibleHistory.slice(-limit, -1).map(m => ({
            role: m.role,
            content: m.type === 'image' ? '[User sent an image]' : stripTranslationTags(m.content)
        }));

        // ====== Build full immersive theater system prompt ======
        let systemPrompt = buildDatePreamble(char.name, userProfile.name);
        systemPrompt += ContextBuilder.buildCoreContext(char, userProfile);
        systemPrompt += buildDateSummaryMemoryPrompt(allMsgs);
        const REQUIRED_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'shy'];
        const dateEmotions = [...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])];
        const userPov = char.datePerspective || 'second';
        const charPov = char.dateCharPerspective || 'third';
        systemPrompt += buildTheaterScene(char.name, userProfile.name, dateEmotions, userPov, charPov, undefined, char.dateOutputWordCount, char.dateWritingStyle);
        systemPrompt += buildDateTail(char.name, userProfile.name, userPov, charPov);

        const response = await fetchDateChatCompletion(apiConfig, {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...historyMsgs,
                    { role: 'user', content: `${text}\n\n(System Note: 严格遵守沉浸剧场格式。每一行都要以 [emotion] 开头，根据内容逐行切换情绪标签。叙述人称严格遵守当前视角设定。${directorHint ? `\n<director_note>${directorHint}</director_note>` : ''}${dateTranslationEnabled ? `\n[Reminder: 双语模式已开启。规则：
• 每一行仍然必须以 [emotion] 开头，<翻译> 标签只能出现在 [emotion] 后面，不能放在行首。
• 只有${char.name}的「台词/说的话」用${dateTranslateSourceLang}写，并写成 [emotion]<翻译><原文>${dateTranslateSourceLang}台词</原文><译文>${dateTranslateTargetLang}译文</译文></翻译>。
• 叙述、动作描写、心理活动、环境描写 → 保持中文不变，不用 <翻译> 标签。
• <原文> 和 <译文> 内不要再写 [emotion] 标签。
示例：
[happy]<翻译><原文>「おはよう！今日はいい天気だね」</原文><译文>「早上好！今天天气真好呢」</译文></翻译>
[shy] 她的脸颊微微泛红，视线移向了窗外。]` : ''})` }
                ],
                temperature: char.dateTemperature ?? 0.85,
                max_tokens: 8192,
            },
            directorHint ? '见面导演提示回复' : '见面聊天回复',
            char.id,
            userMessageId,
            true,
        );

        if (!response.ok) throw new Error('API Error');
        const data = await safeResponseJson(response);
        const rawContent = data.choices[0].message.content;
        const extracted = extractThinking(rawContent);
        // Extract inner whispers from the cleaned content
        const whisperResult = extractInnerWhispers(extracted.content);
        const content = whisperResult.content;

        // 3. Save AI Response — DB stores only 原文 (translation tags stripped)
        // but we return the full content (with XML) for real-time bilingual rendering in DateSession
        const contentForDb = stripTranslationTags(content);
        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: contentForDb, metadata: { source: 'date', thinking: extracted.thinking } });

        // Refresh local state
        const freshMsgs = await DB.getMessagesByCharId(char.id);
        setDateMessages(freshMsgs.filter(isDateDialogueMessage).sort((a, b) => a.timestamp - b.timestamp));
        void maybeTriggerAutoSummary(freshMsgs);

        return { content, whispers: whisperResult.whispers };
    };

    const handleReroll = async (): Promise<{ content: string; whispers: InnerWhisper[] }> => {
        if (!char || dateMessages.length === 0) throw new Error("No context");

        const lastMsg = dateMessages[dateMessages.length - 1];
        if (lastMsg.role !== 'assistant') throw new Error("Cannot reroll user message");

        // 1. Find the user input that triggered it
        // Note: filter out the last AI msg from context without deleting it yet.
        const allMsgs = await DB.getMessagesByCharId(char.id);
        const validMsgs = allMsgs.filter(m => m.id !== lastMsg.id && isDateModeContextMessage(m));
        const validDateMsgs = validMsgs.filter(isDateDialogueMessage).sort((a, b) => a.timestamp - b.timestamp);
        const lastUserMsg = [...validDateMsgs].reverse().find(m => m.role === 'user');

        if (!lastUserMsg || lastUserMsg.role !== 'user') throw new Error("Context lost");

        // 2. Call API logic
        const limit = char.contextLimit || 500;
        const historyMsgs = validMsgs.slice(-limit, -1).map(m => ({
            role: m.role,
            content: m.type === 'image' ? '[User sent an image]' : stripTranslationTags(m.content)
        }));

        // ====== Build full immersive theater system prompt (reroll) ======
        let systemPrompt = buildDatePreamble(char.name, userProfile.name);
        systemPrompt += ContextBuilder.buildCoreContext(char, userProfile);
        systemPrompt += buildDateSummaryMemoryPrompt(allMsgs);
        const REQUIRED_EMOTIONS_R = ['normal', 'happy', 'angry', 'sad', 'shy'];
        const dateEmotionsR = [...REQUIRED_EMOTIONS_R, ...(char.customDateSprites || [])];
        const userPovR = char.datePerspective || 'second';
        const charPovR = char.dateCharPerspective || 'third';
        systemPrompt += buildTheaterScene(char.name, userProfile.name, dateEmotionsR, userPovR, charPovR, undefined, char.dateOutputWordCount, char.dateWritingStyle);
        systemPrompt += buildDateTail(char.name, userProfile.name, userPovR, charPovR);

        const response = await fetchDateChatCompletion(apiConfig, {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...historyMsgs,
                    { role: 'user', content: `${lastUserMsg.content}\n\n(System Note: Reroll. 用不同的角度重写。严格遵守沉浸剧场格式、当前叙述人称。${dateTranslationEnabled ? `\n[Reminder: 双语模式已开启。每一行仍必须以 [emotion] 开头。只有${char.name}的台词用${dateTranslateSourceLang}写成 [emotion]<翻译><原文>...</原文><译文>...</译文></翻译>；叙述/动作/心理描写保持中文不变，不用 <翻译>。]` : ''})` }
                ],
                temperature: Math.min((char.dateTemperature ?? 0.85) + 0.05, 2.0),
                max_tokens: 8192,
            },
            '见面回复重掷',
            char.id,
            lastUserMsg.id,
            true,
        );

        if (!response.ok) throw new Error('API Error');
        const data = await safeResponseJson(response);
        const rawContent = data.choices[0].message.content;
        const extracted = extractThinking(rawContent);
        // Also strip inner whispers on reroll (same as normal send)
        const whisperResult = extractInnerWhispers(extracted.content);
        const content = whisperResult.content;

        // Save AI Response — DB stores only 原文 (translation stripped), return raw for real-time rendering
        const contentForDbR = stripTranslationTags(content);
        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: contentForDbR, metadata: { source: 'date', thinking: extracted.thinking } });

        // 3. Now safely delete the old AI message since the new one is saved
        await DB.deleteMessage(lastMsg.id);

        // Sync
        const freshMsgs = await DB.getMessagesByCharId(char.id);
        setDateMessages(freshMsgs.filter(isDateDialogueMessage).sort((a, b) => a.timestamp - b.timestamp));

        return { content, whispers: whisperResult.whispers };
    };

    // --- Editing & Deletion ---
    const handleDeleteMessage = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        if (mode === 'history') {
            await loadHistorySessions(msg.charId);
            addToast('已删除该条记录', 'success');
            return;
        }
        setDateMessages(prev => prev.filter(m => m.id !== msg.id));
    };

    const confirmEditMessage = async () => {
        if (!editTargetMsg) return;
        const targetMsg = editTargetMsg;
        const nextContent = editContent;
        await DB.updateMessage(targetMsg.id, nextContent);
        if (mode === 'history') {
            await loadHistorySessions(targetMsg.charId);
        } else {
            setDateMessages(prev => prev.map(m => m.id === targetMsg.id ? { ...m, content: nextContent } : m));
        }
        closeEditModal();
        addToast('已保存修改', 'success');
    };

    const handleDeleteHistorySession = async (session: DateHistorySession) => {
        if (!char) return;
        const sessionMessageIds = Array.from(new Set([...session.rawMsgs, ...session.summaries, ...session.bridges].map(msg => msg.id)));
        if (sessionMessageIds.length === 0) return;
        if (!window.confirm(`删除这次见面记录？共 ${sessionMessageIds.length} 条消息会被移除。`)) return;
        await DB.deleteMessages(sessionMessageIds);
        await loadHistorySessions(char.id);
        addToast('已删除本次见面记录', 'success');
    };

    const handleForkHistorySession = async (session: DateHistorySession) => {
        if (!char) return;
        if (char.savedDateState) {
            const confirmed = window.confirm('当前有未结束的见面进度。复制旧记录会放弃这份未结束进度，并开启一条新的见面；已有历史记录不受影响。要继续吗？');
            if (!confirmed) return;
        }

        const forkedAt = Date.now();
        const openingContent = buildDateForkOpeningText({
            charName: char.name,
            userName: userProfile.name,
        });
        const openingId = await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content: openingContent,
            timestamp: forkedAt,
            metadata: {
                source: 'date',
                isOpening: true,
                forkedFromSessionStartMsgId: session.startMsgId,
                forkedAt,
            },
        });
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: buildDateForkBridgeContent({
                session,
                charName: char.name,
                userName: userProfile.name,
            }),
            timestamp: forkedAt + 1,
            metadata: {
                source: 'date',
                hiddenFromUser: true,
                isDateContextBridge: true,
                bridgeType: 'fork',
                sessionStartMsgId: openingId,
                forkedFromSessionStartMsgId: session.startMsgId,
                forkedFromMessageIds: session.rawMsgs.map(m => m.id),
            },
        });

        updateCharacter(char.id, { savedDateState: undefined });
        setForceFreshSession(true);
        setPeekStatus(openingContent);
        setPeekThinking('');
        setHasSavedOpening(true);
        setPendingAutoSummary(null);
        setActiveSummaryDraft(null);
        await loadDateMessages();
        setMode('session');
        addToast('已复制为新的见面', 'success');
    };

    const onExitSession = async (finalState: DateState, syncMode: DateExitSyncMode) => {
        if (!char) return;
        if (syncMode === 'none') {
            await cleanSessionBridges();
            finishExitSession(finalState);
            return;
        }
        if (syncMode === 'raw') { await saveRawBridgeAndExit(finalState); return; }
        // syncMode === 'summary'
        // Generate a comprehensive exit summary (auto-summaries + unsummarized messages)
        if (pendingAutoSummary) {
            await saveSummaryDraft({ ...pendingAutoSummary, fromPendingAuto: true, exitState: finalState });
        }
        const draft = await generateExitSummaryDraft();
        if (!draft) { addToast('未同步总结，仅保存进度', 'info'); finishExitSession(finalState); return; }
        setActiveSummaryDraft({ ...draft, bridgeOnSave: true, exitState: finalState });
    };

    const openHistory = async (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        await loadHistorySessions(c.id);
        setMode('history');
    };

    // --- Render ---

    if (mode === 'select' || !char) {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-light">
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 bg-white sticky top-0 z-10">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-slate-700">选择见面对象</span>
                    <div className="w-8"></div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleCharClick(c)} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-95 transition-transform flex flex-col items-center gap-3 relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); openHistory(c); }}
                                className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors z-20 active:scale-90"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                            </button>
                            <img src={c.avatar} className="w-16 h-16 rounded-full object-cover" />
                            <span className="font-bold text-slate-700">{c.name}</span>
                            {c.savedDateState && <div className="absolute top-2 left-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" title="有存档"></div>}
                        </div>
                    ))}
                </div>
                <Modal isOpen={!!pendingSessionCharId} title="发现进度" onClose={() => setPendingSessionCharId(null)} footer={<div className="flex gap-3 w-full"><button onClick={handleStartNewSession} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">新的见面</button><button onClick={handleResumeSession} className="flex-1 py-3 bg-green-500 text-white rounded-2xl font-bold shadow-lg shadow-green-200">继续上次</button></div>}>
                    <div className="text-center text-slate-500 text-sm py-4">检测到 {pendingChar?.name} 有未结束的见面。<br /><span className="text-xs text-slate-400 mt-2 block">(存档时间: {pendingChar?.savedDateState?.timestamp ? new Date(pendingChar.savedDateState.timestamp).toLocaleString() : 'Unknown'})</span></div>
                </Modal>
            </div>
        );
    }

    if (mode === 'history') {
        return (
            <>
                <div className="h-full w-full bg-slate-50 flex flex-col font-light">
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 bg-white sticky top-0 z-10">
                    <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-slate-100"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg></button>
                    <span className="font-bold text-slate-700">见面记录</span>
                    <div className="w-8"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
                    {historySessions.length === 0 ? <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2"><span className="text-4xl opacity-50">📖</span><span className="text-xs">暂无见面记录</span></div> : historySessions.map((session, idx) => (
                        <div key={idx} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{session.date}</span><span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{session.msgs.length} 句</span></div>
                            <div className="p-4 space-y-4">
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => handleForkHistorySession(session)}
                                        className="px-2.5 py-1 text-[11px] font-medium text-pink-500 bg-pink-50 rounded-full hover:bg-pink-100 transition-colors"
                                    >
                                        复制为新见面
                                    </button>
                                    <button
                                        onClick={() => handleDeleteHistorySession(session)}
                                        className="px-2.5 py-1 text-[11px] font-medium text-red-500 bg-red-50 rounded-full hover:bg-red-100 transition-colors"
                                    >
                                        删除本次
                                    </button>
                                </div>
                                {session.msgs.map(m => {
                                    const text = (m.content || '').replace(/\[.*?\]/g, '').trim();
                                    return (
                                        <React.Fragment key={m.id}>
                                            <div className={`mb-1 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`flex gap-1 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                                    <button
                                                        onClick={() => openEditModal(m)}
                                                        className="px-2 py-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteMessage(m)}
                                                        className="px-2 py-1 text-[11px] font-medium text-red-500 bg-red-50 rounded-full hover:bg-red-100 transition-colors"
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                        <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}><div className={`max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-slate-500 text-right italic' : 'text-slate-800'}`}>{m.role === 'user' ? <span className="bg-slate-100 px-3 py-2 rounded-xl rounded-tr-none inline-block">{text}</span> : <span>{text || '(无内容)'}</span>}</div></div>
                                        </React.Fragment>
                                    );
                                })}
                                {session.bridges.length > 0 && (
                                    <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
                                        <span className="font-bold text-emerald-700">{getBridgeStatusLabel(session.bridges)}</span>
                                        <span className="text-[11px] text-emerald-500">
                                            {Array.from(new Set(session.bridges.map(getBridgeTypeLabel))).join(' / ')}
                                        </span>
                                    </div>
                                )}
                                {session.summaries.length > 0 && (
                                    <div className="border-t border-slate-100 pt-3">
                                        <button
                                            onClick={() => setExpandedSummarySessions(prev => {
                                                const next = new Set(prev);
                                                if (next.has(session.startMsgId)) next.delete(session.startMsgId);
                                                else next.add(session.startMsgId);
                                                return next;
                                            })}
                                            className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500"
                                        >
                                            <span>📋 总结 ({session.summaries.length})</span>
                                            <span>{expandedSummarySessions.has(session.startMsgId) ? '▾' : '▸'}</span>
                                        </button>
                                        {expandedSummarySessions.has(session.startMsgId) && (
                                            <div className="mt-3 space-y-3">
                                                {session.summaries.map(summary => (
                                                    <div key={summary.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                                                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                            {summary.metadata?.summaryType === 'auto' ? '自动总结' : '手动总结'}
                                                        </div>
                                                        <div className="text-xs leading-relaxed text-slate-700">
                                                            {renderMarkdown(summary.content)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                </div>
                {renderEditModal()}
            </>
        );
    }

    if (mode === 'peek') {
        return (
            <div className="h-full w-full bg-black relative flex flex-col font-sans overflow-hidden">
                <div className="pt-24 flex flex-col items-center z-10 shrink-0">
                    <div className="text-xs font-mono text-neutral-500 mb-2 tracking-[0.2em] font-medium">{virtualTime.day.toUpperCase()} {formatTime()}</div>
                    <h2 className="text-4xl font-light text-white tracking-[0.3em] uppercase">{char.name}</h2>
                </div>
                {peekLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center -mt-20 z-10"><div className="w-12 h-[1px] bg-neutral-800 mb-12"></div><div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-white to-transparent animate-pulse mb-6"></div><p className="text-sm font-light text-neutral-500 italic tracking-widest">正在感知...</p></div>
                )}
                {!peekLoading && peekStatus && (
                    <div className="flex-1 min-h-0 flex flex-col px-8 pb-10 z-10 animate-fade-in">
                        <div className="flex-1 overflow-y-auto no-scrollbar mb-8 mask-image-gradient pt-8"><div className="min-h-full flex flex-col justify-center"><p className="text-neutral-300 text-[15px] leading-8 tracking-wide text-justify font-light select-none whitespace-pre-wrap">{peekStatus}</p></div></div>
                        <div className="shrink-0 flex flex-col items-center gap-6">
                            <div className="w-full flex gap-3">
                                {/* 修改这里：调用 handleEnterSession 确保开场白被保存 */}
                                <button onClick={handleEnterSession} className="flex-1 h-14 bg-white text-black rounded-full font-bold tracking-[0.1em] text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95 transition-transform hover:bg-neutral-200">走过去 (Approach)</button>
                                <button onClick={() => startPeek(char)} className="w-14 h-14 bg-neutral-800 text-white rounded-full flex items-center justify-center border border-neutral-700 shadow-lg active:scale-90 transition-transform"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg></button>
                            </div>
                            <div className="flex flex-col items-center gap-3 text-[10px] text-neutral-600 font-medium tracking-wider"><button onClick={() => { setPreviousMode('peek'); setMode('settings'); }} className="hover:text-neutral-400 transition-colors">布置场景 / 设定立绘</button><button onClick={handleBack} className="hover:text-neutral-400 transition-colors">悄悄离开</button></div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (mode === 'settings') {
        return <DateSettings char={char} onBack={() => setMode(previousMode)} />;
    }

    if (mode === 'session') {
        return (
            <>
                <DateSession
                    char={char}
                    userProfile={userProfile}
                    messages={dateMessages}
                    peekStatus={peekStatus}
                    initialState={forceFreshSession ? undefined : char.savedDateState}
                    onSendMessage={handleSendMessage}
                    onReroll={handleReroll}
                    onExit={onExitSession}
                    onEditMessage={openEditModal}
                    onDeleteMessage={handleDeleteMessage}
                    isSummaryGenerating={isSummaryGenerating}
                    hasPendingSummary={!!pendingAutoSummary}
                    canManualSummary={canManualSummary}
                    canAutoSummary={canAutoSummary}
                    summaryDisabledReason={summaryDisabledReason}
                    onRequestSummary={requestManualSummary}
                    onReviewPendingSummary={() => pendingAutoSummary && setActiveSummaryDraft({ ...pendingAutoSummary, fromPendingAuto: true })}
                    onDiscardPendingSummary={discardPendingAutoSummary}
                    onToggleAutoSummary={(enabled) => updateCharacter(char.id, { dateSummaryAutoEnabled: enabled })}
                    onToggleAutoHideSummary={async (enabled) => {
                        updateCharacter(char.id, { dateSummaryAutoHideEnabled: enabled });
                        if (enabled) {
                            await compressExistingDateSummaries();
                            addToast('已开启压缩旧记录', 'success');
                        }
                    }}
                    onChangeThreshold={(threshold) => updateCharacter(char.id, { dateSummaryAutoThreshold: threshold })}
                    onOpenSummarySettings={openSummarySettings}
                    wordCount={char.dateOutputWordCount}
                    writingStyle={char.dateWritingStyle}
                    onChangeWordCount={(count) => updateCharacter(char.id, { dateOutputWordCount: count })}
                    onChangeWritingStyle={(style) => updateCharacter(char.id, { dateWritingStyle: style })}
                    temperature={char.dateTemperature}
                    onChangeTemperature={(temp) => updateCharacter(char.id, { dateTemperature: temp })}
                    translationEnabled={dateTranslationEnabled}
                    translateSourceLang={dateTranslateSourceLang}
                    translateTargetLang={dateTranslateTargetLang}
                    onToggleTranslation={setDateTranslationEnabled}
                    onSetTranslateSourceLang={setDateTranslateSourceLang}
                    onSetTranslateTargetLang={setDateTranslateTargetLang}
                />

                {/* Global Message Edit Modal for Session Mode */}
                <Modal isOpen={isEditModalOpen} title="编辑内容" onClose={() => setIsEditModalOpen(false)} footer={<><button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={confirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed" />
                </Modal>
                {renderSummaryModal()}
                {renderDiaryMemoryPreviewModal()}
                {renderSummarySettingsModal()}
            </>
        );
    }

    return null;
};

export default DateApp;
