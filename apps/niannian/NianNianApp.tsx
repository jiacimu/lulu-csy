import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowCounterClockwise,
    BookOpenText,
    PaperPlaneTilt,
    Sparkle,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type {
    APIConfig,
    CharacterProfile,
    DisplayItem,
    NianNianChoiceOption,
    NianNianInputBeat,
    NianNianModelRequest,
    NianNianRawMessage,
    NianNianSession,
    NianNianWorldBible,
    PlayerSegment,
} from '../../types';
import { DB } from '../../utils/db';
import {
    appendNianNianRawMessage,
    applyNianNianAssistantOutput,
    applyNianNianCompressionOutput,
    applyNianNianDirectorOutput,
    buildNianNianPlayerSegments,
    buildNianNianCompressionRequest,
    buildNianNianModelRequest,
    buildNianNianTurnPlan,
    createEmptyWorldBible,
    createNianNianId,
    createNianNianSession,
    formatNianNianUserInput,
    parseBeats,
    parsePlayerSegments,
    resolveNianNianMaxCompletionTokens,
    sanitizeNianNianInputBeats,
    weave,
} from '../../utils/niannianEngine';
import {
    DEFAULT_NIANNIAN_WORLD_PACK_URL,
    loadNianNianWorldBibleFromMarkdown,
} from '../../utils/niannianWorldPackage';
import {
    resolveNianNianSceneVisual,
    type NianNianSceneVisual,
} from '../../utils/niannianSceneVisuals';
import { extractContent, safeResponseJson } from '../../utils/safeApi';
import { selectSecondaryApiConfig } from '../../utils/runtimeConfig';
import './niannian.css';

interface SetupDraft {
    charId: string;
    theme: string;
    tone: string;
    charIdentity: string;
    protagonistIdentity: string;
    opening: string;
    customPrompt: string;
}

type DialogueSide = 'left' | 'right' | 'none';
type DialogueKind = 'narrator' | 'user' | 'character';
type TurnPhase = 'dialogue' | 'choice';

interface FateBookItem {
    label: string;
    value: string | number;
}

interface FateBookSection {
    key: string;
    seal: string;
    title: string;
    items: FateBookItem[];
}

interface DialogueFrame {
    key: string;
    kind: DialogueKind;
    side: DialogueSide;
    speakerName: string;
    speakerColor: string;
    avatarUrl?: string;
    text: string;
}

interface PlaybackUnit {
    key: string;
    kind: DialogueKind;
    text: string;
}

interface PendingTurnReplay {
    selectedOption?: NianNianChoiceOption | null;
    content: string;
    beats: Array<NianNianInputBeat & { id: string }>;
}

interface TurnErrorState {
    stage: string;
    title: string;
    message: string;
    details: string;
    retry: PendingTurnReplay;
    createdAt: number;
}

const createInputBeat = (kind: NianNianInputBeat['kind']): NianNianInputBeat & { id: string } => ({
    id: createNianNianId('nn_beat'),
    kind,
    text: '',
});

function makeSetupDraft(activeCharacterId: string | null | undefined, userName: string): SetupDraft {
    return {
        charId: activeCharacterId || '',
        theme: '',
        tone: '',
        charIdentity: '',
        protagonistIdentity: userName || '',
        opening: '',
        customPrompt: '',
    };
}

function resolveCharacter(characters: CharacterProfile[], charId: string): CharacterProfile | null {
    return characters.find(char => char.id === charId) || characters[0] || null;
}

function buildWorldBible(draft: SetupDraft, baseWorld?: NianNianWorldBible | null): NianNianWorldBible {
    const fallbackWorld = baseWorld || createEmptyWorldBible();
    return {
        ...createEmptyWorldBible(),
        ...fallbackWorld,
        theme: draft.theme.trim() || fallbackWorld.theme,
        tone: draft.tone.trim() || fallbackWorld.tone,
        charIdentity: draft.charIdentity.trim() || fallbackWorld.charIdentity,
        protagonistIdentity: draft.protagonistIdentity.trim() || fallbackWorld.protagonistIdentity,
        opening: draft.opening.trim() || fallbackWorld.opening,
        customPrompt: draft.customPrompt.trim() || fallbackWorld.customPrompt,
        statusSchema: fallbackWorld.statusSchema || [],
        eventWeights: fallbackWorld.eventWeights || {},
        worldStyle: fallbackWorld.worldStyle,
        seedStatus: fallbackWorld.seedStatus,
        openingStep: fallbackWorld.openingStep,
        hiddenVarsSeed: fallbackWorld.hiddenVarsSeed,
    };
}

function getMessagePlayerSegments(message: NianNianRawMessage): PlayerSegment[] {
    const storedSegments = (message.playerSegments || [])
        .map(segment => ({
            ...segment,
            text: segment.text.trim(),
        }))
        .filter(segment => segment.text.length > 0);
    if (storedSegments.length > 0) return storedSegments;

    const parsedSegments = parsePlayerSegments(message.content);
    if (parsedSegments.length > 0) return parsedSegments;

    if (message.beats?.length) {
        return buildNianNianPlayerSegments({ beats: message.beats });
    }

    const fallbackText = message.content.trim();
    return fallbackText
        ? [{ kind: 'player', anchor: '台词', text: fallbackText }]
        : [];
}

function getDisplayKind(item: DisplayItem): DialogueKind {
    if (item.kind === 'player') return 'user';
    return item.type === '话' ? 'character' : 'narrator';
}

function buildPlaybackUnit(item: DisplayItem, key: string): PlaybackUnit | null {
    const text = item.text.trim();
    if (!text) return null;
    return {
        key,
        kind: getDisplayKind(item),
        text,
    };
}

function buildNarratorItem(text: string): DisplayItem {
    return {
        kind: 'beat',
        type: '白',
        anchor: '收',
        text,
    };
}

function buildPlaybackUnits(session: NianNianSession): PlaybackUnit[] {
    const units: PlaybackUnit[] = [];
    const pushDisplayItems = (baseKey: string, items: DisplayItem[]) => {
        items.forEach((item, index) => {
            const unit = buildPlaybackUnit(item, `${baseKey}:${index}`);
            if (unit) units.push(unit);
        });
    };

    const lastUserIndex = session.rawBuffer.map(item => item.role).lastIndexOf('user');
    if (lastUserIndex >= 0) {
        const userMessage = session.rawBuffer[lastUserIndex];
        const playerSegments = userMessage ? getMessagePlayerSegments(userMessage) : [];
        const visibleAfterUser = session.rawBuffer
            .slice(lastUserIndex + 1)
            .filter(item => item.role === 'assistant' || item.role === 'director');

        if (visibleAfterUser.length > 0) {
            for (const item of visibleAfterUser) {
                if (item.role === 'assistant') {
                    const beats = item.assistantBeats?.length
                        ? item.assistantBeats
                        : parseBeats(item.content);
                    pushDisplayItems(item.id, units.length === 0 ? weave(playerSegments, beats) : beats.map((beat): DisplayItem => ({
                        kind: 'beat',
                        type: beat.type,
                        anchor: beat.anchor,
                        text: beat.text,
                    })));
                    continue;
                }

                pushDisplayItems(item.id, [buildNarratorItem(item.content)]);
            }

            if (units.length > 0) return units;
        }

        if (userMessage) pushDisplayItems(userMessage.id, playerSegments);
        if (units.length > 0) return units;
    }

    pushDisplayItems(session.currentStep.id, [
        buildNarratorItem(session.currentStep.sceneText || session.world.opening || 'TODO(人工)：开场情境待填写。'),
    ]);
    return units.length > 0 ? units : [{
        key: 'empty',
        kind: 'narrator',
        text: '',
    }];
}

function getSceneBg(session: NianNianSession | null): NianNianSceneVisual {
    if (!session) {
        return resolveNianNianSceneVisual({ category: '灯市夜' });
    }

    const statusScene = session.status.scene as Record<string, any>;
    const explicit = statusScene.sceneCategory || statusScene.场景类目 || (session.status as any).sceneCategory;

    return resolveNianNianSceneVisual({
        category: typeof explicit === 'string' ? explicit : undefined,
        location: session.status.scene.地点,
        situation: session.status.scene.情境,
    });
}

function hasNianNianApiConfig(config?: Partial<APIConfig> | null): config is APIConfig {
    return Boolean(config?.baseUrl && config.apiKey && config.model);
}

function buildNianNianCharacterContext(char: CharacterProfile | null): Record<string, string> | undefined {
    if (!char) return undefined;
    return {
        name: char.name || '',
        description: char.description || '',
        systemPrompt: char.systemPrompt || '',
        worldview: char.worldview || '',
    };
}

function formatReputation(value: number): string {
    const label = value >= 90
        ? '名满一方'
        : value >= 70
            ? '颇有清名'
            : value >= 40
                ? '清白人家'
                : value >= 0
                    ? '平常名声'
                    : value >= -40
                        ? '名声有损'
                        : value >= -80
                            ? '受人非议'
                            : '声名狼藉';
    return `${value} · ${label}`;
}

async function runNianNianModelRequest(
    apiConfig: APIConfig,
    request: NianNianModelRequest,
): Promise<string> {
    const url = `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: request.messages,
            max_tokens: resolveNianNianMaxCompletionTokens(apiConfig.model, request.max_tokens),
            temperature: apiConfig.temperature ?? 0.8,
            stream: false,
        }),
    });
    const data = await safeResponseJson(response);
    if (!response.ok) {
        const message = data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`;
        throw new Error(`API 请求失败: ${response.status} ${response.statusText || ''}\n${message}`);
    }

    const content = extractContent(data);
    if (!content) {
        throw new Error(`API 响应缺少 choices[0].message.content\n${JSON.stringify(data, null, 2).slice(0, 4000)}`);
    }
    return content;
}

function makeInitials(name: string): string {
    return (name || '你').trim().slice(0, 2);
}

function formatFateValue(value: unknown): string | number {
    if (value === null || value === undefined || value === '') return '未载';
    if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '无';
    return typeof value === 'number' ? value : String(value);
}

function cloneInputBeats(beats: Array<NianNianInputBeat & { id?: string }>): Array<NianNianInputBeat & { id: string }> {
    return beats.map(beat => ({
        id: beat.id || createNianNianId('nn_beat'),
        kind: beat.kind,
        text: beat.text,
    }));
}

function summarizeApiConfig(config: Partial<APIConfig> | null | undefined, label: string): string {
    return [
        `${label} API 配置检查:`,
        `baseUrl: ${config?.baseUrl ? config.baseUrl : '未填写'}`,
        `apiKey: ${config?.apiKey ? '已填写' : '未填写'}`,
        `model: ${config?.model || '未填写'}`,
    ].join('\n');
}

function describeUnknownError(error: unknown): { message: string; details: string } {
    if (error instanceof Error) {
        return {
            message: error.message || '未知错误',
            details: [error.message, error.stack].filter(Boolean).join('\n\n'),
        };
    }

    if (typeof error === 'string') {
        return { message: error, details: error };
    }

    try {
        const details = JSON.stringify(error, null, 2);
        return { message: details.slice(0, 180) || '未知错误', details };
    } catch {
        return { message: '未知错误', details: String(error) };
    }
}

const NianNianApp: React.FC = () => {
    const { activeCharacterId, addToast, apiConfig, characters, closeApp, userProfile } = useOS();
    const userName = userProfile?.name?.trim() || '你';
    const [sessions, setSessions] = useState<NianNianSession[]>([]);
    const [session, setSession] = useState<NianNianSession | null>(null);
    const [setupDraft, setSetupDraft] = useState<SetupDraft>(() => makeSetupDraft(activeCharacterId, userName));
    const [inputBeats, setInputBeats] = useState<Array<NianNianInputBeat & { id: string }>>(() => [
        createInputBeat('speech'),
        createInputBeat('action'),
    ]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [worldPackage, setWorldPackage] = useState<NianNianWorldBible | null>(null);
    const [statusExpanded, setStatusExpanded] = useState(false);
    const [activeFatePageKey, setActiveFatePageKey] = useState<string | null>(null);
    const [playbackIndex, setPlaybackIndex] = useState(0);
    const [phase, setPhase] = useState<TurnPhase>('dialogue');
    const [choiceReviewOpen, setChoiceReviewOpen] = useState(false);
    const [isSubmittingTurn, setIsSubmittingTurn] = useState(false);
    const [turnError, setTurnError] = useState<TurnErrorState | null>(null);

    const selectedCharacter = useMemo(
        () => resolveCharacter(characters, setupDraft.charId),
        [characters, setupDraft.charId],
    );
    const sessionCharacter = session ? resolveCharacter(characters, session.charId) : null;
    const sendableBeats = useMemo(() => sanitizeNianNianInputBeats(inputBeats), [inputBeats]);

    useEffect(() => {
        let cancelled = false;
        const loadWorldPackage = async () => {
            try {
                const world = await loadNianNianWorldBibleFromMarkdown(DEFAULT_NIANNIAN_WORLD_PACK_URL);
                if (cancelled) return;
                setWorldPackage(world);
                setSetupDraft(prev => ({
                    ...prev,
                    theme: prev.theme || world.theme,
                    tone: prev.tone || world.tone,
                    charIdentity: prev.charIdentity || world.charIdentity,
                    protagonistIdentity:
                        prev.protagonistIdentity && prev.protagonistIdentity !== userName
                            ? prev.protagonistIdentity
                            : world.protagonistIdentity || prev.protagonistIdentity,
                    opening: prev.opening || world.opening,
                }));
            } catch (err) {
                if (!cancelled) console.warn('[NianNian] failed to load world package', err);
            }
        };

        void loadWorldPackage();
        return () => {
            cancelled = true;
        };
    }, [userName]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoadingSessions(true);
            try {
                const allSessions = await DB.getAllNianNianSessions();
                if (cancelled) return;
                setSessions(allSessions);
                const activeCharSession = activeCharacterId
                    ? allSessions.find(item => item.charId === activeCharacterId)
                    : allSessions[0];
                setSession(activeCharSession || null);
            } catch (err) {
                console.warn('[NianNian] failed to load sessions', err);
            } finally {
                if (!cancelled) setIsLoadingSessions(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [activeCharacterId]);

    useEffect(() => {
        if (setupDraft.charId || characters.length === 0) return;
        setSetupDraft(prev => ({
            ...prev,
            charId: activeCharacterId || characters[0].id,
        }));
    }, [activeCharacterId, characters, setupDraft.charId]);

    const playbackUnits = useMemo(
        () => session ? buildPlaybackUnits(session) : [],
        [session],
    );
    const playbackSignature = playbackUnits.map(unit => unit.key).join('|');

    useEffect(() => {
        setPlaybackIndex(0);
        setPhase('dialogue');
        setChoiceReviewOpen(false);
    }, [playbackSignature]);

    const lastDialogueIndex = Math.max(0, playbackUnits.length - 1);
    const currentUnit = playbackUnits[Math.min(playbackIndex, lastDialogueIndex)];
    const showDecisionControls = Boolean(session && phase === 'choice' && !choiceReviewOpen && !isSubmittingTurn && !turnError);
    const canAdvanceDialogue = Boolean(session && phase === 'dialogue' && !isSubmittingTurn);
    const frameKind = currentUnit?.kind || 'narrator';
    const dialogueFrame: DialogueFrame | null = session ? {
        key: currentUnit?.key || 'empty',
        kind: frameKind,
        side: frameKind === 'user' ? 'right' : frameKind === 'character' ? 'left' : 'none',
        speakerName: frameKind === 'user' ? userName : frameKind === 'character' ? session.charName : '旁白',
        speakerColor: frameKind === 'user' ? '#5f82b5' : frameKind === 'character' ? '#b56e76' : '#8f7b70',
        avatarUrl: frameKind === 'user' ? userProfile?.avatar : sessionCharacter?.avatar,
        text: currentUnit?.text || '',
    } : null;
    const showDialogueCard = Boolean(dialogueFrame && !isSubmittingTurn && !turnError && (phase === 'dialogue' || choiceReviewOpen));
    const showLoadingCard = Boolean(session && isSubmittingTurn);
    const showErrorCard = Boolean(session && turnError && !isSubmittingTurn);
    const sceneBg = getSceneBg(session);
    const fateBookSections: FateBookSection[] = session ? [
        {
            key: 'moment',
            seal: '景',
            title: '此刻',
            items: [
                { label: '阶段', value: session.director.stage },
                { label: '回合', value: `第 ${session.director.turn} 回合` },
                { label: '时辰', value: formatFateValue(session.status.scene.时辰) },
                { label: '地点', value: formatFateValue(session.status.scene.地点) },
                { label: '场景', value: sceneBg.label },
                { label: '情境', value: formatFateValue(session.status.scene.情境) },
            ],
        },
        {
            key: 'ta',
            seal: '他',
            title: '其人',
            items: [
                { label: '好感', value: session.status.ta.好感 },
                { label: '暧昧', value: session.status.ta.暧昧度 },
                { label: '心情', value: formatFateValue(session.status.ta.心情) },
                { label: '心声', value: formatFateValue(session.status.ta.心声) },
            ],
        },
        {
            key: 'me',
            seal: '我',
            title: '我身',
            items: [
                { label: '身份', value: formatFateValue(session.status.me.身份) },
                { label: '银两', value: session.status.me.银两 },
                { label: '体力', value: session.status.me.体力 },
                { label: '名声', value: formatReputation(session.status.me.名声) },
            ],
        },
        {
            key: 'world',
            seal: '世',
            title: '世局',
            items: [
                ...Object.entries(session.status.worldExtra || {}).map(([label, value]) => ({
                    label,
                    value: formatFateValue(value),
                })),
                {
                    label: '在场旁人',
                    value: session.status.npcsOnScene.length > 0
                        ? session.status.npcsOnScene.map(npc => `${npc.name}${npc.mood ? ` · ${npc.mood}` : ''}`).join('、')
                        : '无',
                },
            ],
        },
    ] : [];
    const activeFateSection =
        fateBookSections.find(section => section.key === activeFatePageKey) || fateBookSections[0] || null;

    const persistSession = async (nextSession: NianNianSession) => {
        setSession(nextSession);
        setSessions(prev => {
            const without = prev.filter(item => item.id !== nextSession.id);
            return [nextSession, ...without].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        });
        await DB.saveNianNianSession(nextSession);
    };

    const handleStartSession = async () => {
        const char = selectedCharacter;
        if (!char) {
            addToast?.('请先创建或选择一个角色', 'error');
            return;
        }
        const nextSession = createNianNianSession({
            charId: char.id,
            charName: char.name,
            userName,
            world: buildWorldBible(setupDraft, worldPackage),
        });
        setStatusExpanded(false);
        setActiveFatePageKey(null);
        setPhase('dialogue');
        setChoiceReviewOpen(false);
        setTurnError(null);
        await persistSession(nextSession);
        addToast?.('念念浮生副本已创建', 'success');
    };

    const handleSelectSession = (nextSession: NianNianSession) => {
        setStatusExpanded(false);
        setActiveFatePageKey(null);
        setPhase('dialogue');
        setChoiceReviewOpen(false);
        setTurnError(null);
        setSession(nextSession);
    };

    const updateInputBeat = (id: string, patch: Partial<NianNianInputBeat>) => {
        setInputBeats(prev => prev.map(beat => (beat.id === id ? { ...beat, ...patch } : beat)));
    };

    const addInputBeat = (kind: NianNianInputBeat['kind']) => {
        setInputBeats(prev => [...prev, createInputBeat(kind)]);
    };

    const removeInputBeat = (id: string) => {
        setInputBeats(prev => {
            if (prev.length <= 1) return prev.map(beat => (beat.id === id ? { ...beat, text: '' } : beat));
            return prev.filter(beat => beat.id !== id);
        });
    };

    const handleInputBeatKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void handleSubmitTurn();
        }
    };

    const handleAdvanceDialogue = () => {
        if (!session) return;
        if (phase === 'choice') {
            if (choiceReviewOpen) setChoiceReviewOpen(false);
            return;
        }
        if (playbackIndex < lastDialogueIndex) {
            const nextIndex = Math.min(playbackIndex + 1, lastDialogueIndex);
            setPlaybackIndex(nextIndex);
            if (nextIndex >= lastDialogueIndex) {
                setPhase('choice');
                setChoiceReviewOpen(false);
            }
            return;
        }

        setPhase('choice');
        setChoiceReviewOpen(false);
    };

    const handleDialogueWheel = (event: React.WheelEvent<HTMLElement>) => {
        if (!canAdvanceDialogue || Math.abs(event.deltaY) < 24) return;
        event.preventDefault();
        handleAdvanceDialogue();
    };

    const handleSubmitTurn = async (
        selectedOption?: NianNianChoiceOption | null,
        replay?: PendingTurnReplay,
    ) => {
        if (!session || isSubmittingTurn) return;
        const optionForTurn = replay ? replay.selectedOption || null : selectedOption || null;
        const beats = replay ? replay.beats : selectedOption ? [] : inputBeats;
        const content = replay?.content || formatNianNianUserInput({
            beats,
            selectedOption: optionForTurn,
        });
        if (!content) {
            addToast?.('请先写动作、台词，或选择一个节点选项', 'error');
            return;
        }
        const retry: PendingTurnReplay = replay || {
            selectedOption: optionForTurn,
            content,
            beats: cloneInputBeats(beats),
        };
        let failureStage = '准备请求';
        let failureTitle = '回合发送失败';

        setTurnError(null);
        setIsSubmittingTurn(true);
        setPhase('dialogue');
        setPlaybackIndex(0);
        setChoiceReviewOpen(false);
        const characterContext = buildNianNianCharacterContext(sessionCharacter);
        const turnPlan = buildNianNianTurnPlan(session, content, optionForTurn, characterContext);
        const sanitizedBeats = sanitizeNianNianInputBeats(beats);
        const playerSegments = buildNianNianPlayerSegments({
            beats: sanitizedBeats,
            selectedOption: optionForTurn,
        });

        const userMessage = {
            id: createNianNianId('nn_user'),
            role: 'user' as const,
            content,
            beats: optionForTurn ? [] : sanitizedBeats,
            playerSegments,
            choiceId: optionForTurn?.id,
            createdAt: Date.now(),
        };
        const afterUser = appendNianNianRawMessage(session, userMessage);
        const baseSession: NianNianSession = {
            ...afterUser,
            director: {
                ...afterUser.director,
                turn: afterUser.director.turn + 1,
            },
            currentStep: turnPlan.fallbackStep,
            updatedAt: Date.now(),
        };
        let nextSession: NianNianSession = baseSession;
        let hasMainReply = false;

        try {
            failureStage = '主模型配置';
            failureTitle = '主模型 API 未配置完整';
            if (!hasNianNianApiConfig(apiConfig)) {
                throw new Error(summarizeApiConfig(apiConfig, '主模型'));
            }

            failureStage = '主模型请求';
            failureTitle = '主模型请求失败';
            const rawMain = await runNianNianModelRequest(apiConfig, turnPlan.mainRequest);
            const appliedMain = applyNianNianAssistantOutput(baseSession, rawMain, Date.now());
            if (!appliedMain.parsedStatus) {
                failureStage = '主模型状态块解析';
                failureTitle = '主模型缺少可解析的 <<<STATUS>>> 状态块';
                throw new Error(`主模型返回必须包含按行状态块。\n\n原始返回预览:\n${rawMain.slice(0, 4000)}`);
            }
            nextSession = appliedMain.session;
            hasMainReply = true;

            const directorApiConfig = selectSecondaryApiConfig() || apiConfig;
            failureStage = '天意配置';
            failureTitle = '天意 API 未配置完整';
            if (!hasNianNianApiConfig(directorApiConfig)) {
                throw new Error(summarizeApiConfig(directorApiConfig, '天意'));
            }

            if (hasMainReply) {
                failureStage = '天意请求';
                failureTitle = '天意导演请求失败';
                const directorRequest = buildNianNianModelRequest({
                    session: nextSession,
                    lane: 'director',
                    purpose: 'event_landing',
                    payload: {
                        userInput: content,
                        selectedOption: optionForTurn,
                        fallbackStep: turnPlan.fallbackStep,
                    },
                });
                const rawDirector = await runNianNianModelRequest(directorApiConfig, directorRequest);
                const applied = applyNianNianDirectorOutput(nextSession, rawDirector, {
                    fallbackStep: turnPlan.fallbackStep,
                    now: Date.now(),
                });
                if (!applied.parsed) {
                    failureStage = '天意格式解析';
                    failureTitle = '天意输出格式无法解析';
                    throw new Error(`天意必须输出 <<<SCENE>>> / <<<OPTIONS>>> / <<<DIRECTOR>>> / <<<END>>>。\n\n原始返回预览:\n${rawDirector.slice(0, 4000)}`);
                }
                nextSession = applied.session;
            }

            if (hasNianNianApiConfig(directorApiConfig)) {
                const compressionRequest = buildNianNianCompressionRequest(nextSession);
                if (compressionRequest) {
                    failureStage = '压缩请求';
                    failureTitle = '压缩请求失败';
                    const rawCompression = await runNianNianModelRequest(directorApiConfig, compressionRequest);
                    const appliedCompression = applyNianNianCompressionOutput(nextSession, rawCompression, {
                        now: Date.now(),
                    });
                    if (!appliedCompression.parsed) {
                        failureStage = '压缩格式解析';
                        failureTitle = '压缩输出格式无法解析';
                        throw new Error(`压缩必须输出 <<<SEGMENT>>> / <<<END>>>。\n\n原始返回预览:\n${rawCompression.slice(0, 4000)}`);
                    }
                    nextSession = appliedCompression.session;
                }
            }

            setInputBeats([createInputBeat('speech'), createInputBeat('action')]);
            setPhase('dialogue');
            setPlaybackIndex(0);
            setChoiceReviewOpen(false);
            failureStage = '本地保存';
            failureTitle = '回合已生成但保存失败';
            await persistSession(nextSession);
        } catch (err) {
            const described = describeUnknownError(err);
            setTurnError({
                stage: failureStage,
                title: failureTitle,
                message: described.message,
                details: [
                    `失败阶段: ${failureStage}`,
                    `玩家输入:\n${content}`,
                    `错误详情:\n${described.details}`,
                ].join('\n\n'),
                retry,
                createdAt: Date.now(),
            });
            setPhase('choice');
            setChoiceReviewOpen(false);
        } finally {
            setIsSubmittingTurn(false);
        }
    };

    const handleRetryTurn = () => {
        if (!turnError) return;
        void handleSubmitTurn(turnError.retry.selectedOption, turnError.retry);
    };

    const handleReturnToEdit = () => {
        if (turnError && !turnError.retry.selectedOption) {
            setInputBeats(cloneInputBeats(turnError.retry.beats));
        }
        setTurnError(null);
        setPhase('choice');
        setChoiceReviewOpen(false);
    };

    const handleNewSession = () => {
        setSession(null);
        setStatusExpanded(false);
        setActiveFatePageKey(null);
        setPhase('dialogue');
        setChoiceReviewOpen(false);
        setTurnError(null);
        setSetupDraft(makeSetupDraft(activeCharacterId, userName));
    };

    const handleToggleFateBook = () => {
        setActiveFatePageKey(null);
        setStatusExpanded(expanded => !expanded);
    };

    if (isLoadingSessions) {
        return (
            <div className="nn-app nn-loading">
                <Sparkle size={24} weight="fill" />
                <span>正在打开念念浮生...</span>
            </div>
        );
    }

    return (
        <div className="nn-app">
            <header className="nn-topbar">
                <button type="button" className="nn-icon-btn" onClick={closeApp} aria-label="退出念念浮生" title="退出">
                    <X size={18} weight="bold" />
                </button>
                <div className="nn-brand">
                    <span>念念浮生</span>
                </div>
                <button type="button" className="nn-icon-btn" onClick={handleNewSession} aria-label="新建副本" title="新建副本">
                    <ArrowCounterClockwise size={18} weight="bold" />
                </button>
            </header>

            {!session ? (
                <main className="nn-setup">
                    <section className="nn-setup-panel">
                        <div className="nn-section-title">
                            <BookOpenText size={18} weight="bold" />
                            <div>
                                <h1>副本初始化</h1>
                                <p>世界包、开场和状态种子会在这里装入。</p>
                            </div>
                        </div>

                        <label>
                            <span>选择角色</span>
                            <select
                                value={setupDraft.charId}
                                onChange={event => setSetupDraft(prev => ({ ...prev, charId: event.target.value }))}
                            >
                                {characters.map(char => (
                                    <option key={char.id} value={char.id}>{char.name}</option>
                                ))}
                            </select>
                        </label>

                        <div className="nn-setup-grid">
                            <label>
                                <span>题材 theme</span>
                                <input value={setupDraft.theme} onChange={event => setSetupDraft(prev => ({ ...prev, theme: event.target.value }))} placeholder="TODO(人工)" />
                            </label>
                            <label>
                                <span>基调 tone</span>
                                <input value={setupDraft.tone} onChange={event => setSetupDraft(prev => ({ ...prev, tone: event.target.value }))} placeholder="TODO(人工)" />
                            </label>
                            <label>
                                <span>角色前世身份</span>
                                <input value={setupDraft.charIdentity} onChange={event => setSetupDraft(prev => ({ ...prev, charIdentity: event.target.value }))} placeholder="TODO(人工)" />
                            </label>
                            <label>
                                <span>主角身份</span>
                                <input value={setupDraft.protagonistIdentity} onChange={event => setSetupDraft(prev => ({ ...prev, protagonistIdentity: event.target.value }))} placeholder="TODO(人工)" />
                            </label>
                        </div>

                        <label>
                            <span>开场情境</span>
                            <textarea value={setupDraft.opening} onChange={event => setSetupDraft(prev => ({ ...prev, opening: event.target.value }))} placeholder="TODO(人工)：开场情境接口" />
                        </label>

                        <label>
                            <span>自定义提示词接口</span>
                            <textarea value={setupDraft.customPrompt} onChange={event => setSetupDraft(prev => ({ ...prev, customPrompt: event.target.value }))} placeholder="TODO(人工)：主/副模型提示词由人工后续打磨" />
                        </label>

                        <button type="button" className="nn-primary-btn" onClick={handleStartSession}>
                            <Sparkle size={18} weight="fill" />
                            初始化 Session
                        </button>
                    </section>

                    {sessions.length > 0 && (
                        <section className="nn-session-list">
                            <h2>已有副本</h2>
                            {sessions.map(item => (
                                <button key={item.id} type="button" onClick={() => handleSelectSession(item)}>
                                    <strong>{item.charName}</strong>
                                    <span>{item.world.theme || '未设题材'} · {item.director.stage} · 第 {item.director.turn} 回合</span>
                                </button>
                            ))}
                        </section>
                    )}
                </main>
            ) : (
                <main
                    className="nn-stage"
                    style={{
                        '--nn-bg-a': sceneBg.a,
                        '--nn-bg-b': sceneBg.b,
                        '--nn-bg-c': sceneBg.c,
                        '--nn-scene-image': `url("${sceneBg.imageUrl}")`,
                    } as React.CSSProperties}
                >
                    <button
                        type="button"
                        className="nn-scene"
                        onClick={handleAdvanceDialogue}
                        onWheel={handleDialogueWheel}
                        aria-label={phase === 'dialogue' ? '推进对白' : choiceReviewOpen ? '返回选项' : '场景背景'}
                    >
                        <span className="nn-scene-label">{sceneBg.label}</span>
                    </button>

                    {phase === 'choice' && !choiceReviewOpen && (
                        <button
                            type="button"
                            className="nn-choice-review-hotspot"
                            onClick={() => setChoiceReviewOpen(true)}
                            aria-label="回看对白"
                        />
                    )}

                    <section
                        className={`nn-vn-layer is-${phase}${choiceReviewOpen ? ' is-reviewing' : ''}`}
                        aria-label="念念浮生对白区"
                    >
                        {showDecisionControls && session.currentStep.options.length > 0 && (
                            <div className="nn-options">
                                {session.currentStep.options.map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => void handleSubmitTurn(option)}
                                        disabled={isSubmittingTurn}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {showLoadingCard && (
                            <div className="nn-dialogue-card is-narrator is-loading" role="status" aria-live="polite">
                                <div className="nn-dialogue-copy">
                                    <p>正在续写这一回合...</p>
                                </div>
                                <span className="nn-loading-dots" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                            </div>
                        )}

                        {showErrorCard && turnError && (
                            <div className="nn-error-card" role="alert" aria-live="assertive">
                                <header>
                                    <span>{turnError.stage}</span>
                                    <strong>{turnError.title}</strong>
                                </header>
                                <p>{turnError.message}</p>
                                <details>
                                    <summary>查看详细错误</summary>
                                    <pre>{turnError.details}</pre>
                                </details>
                                <div className="nn-error-actions">
                                    <button type="button" className="nn-error-retry" onClick={handleRetryTurn}>
                                        重试本回合
                                    </button>
                                    <button type="button" className="nn-error-edit" onClick={handleReturnToEdit}>
                                        返回修改
                                    </button>
                                </div>
                            </div>
                        )}

                        {showDialogueCard && dialogueFrame && (
                            <div
                                className={`nn-dialogue-card is-${dialogueFrame.kind} is-${dialogueFrame.side}`}
                                onClick={handleAdvanceDialogue}
                                onWheel={handleDialogueWheel}
                                role="button"
                                tabIndex={0}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        handleAdvanceDialogue();
                                    }
                                }}
                            >
                                {dialogueFrame.side !== 'none' && (
                                    <div className="nn-dialogue-speaker">
                                        <div className="nn-dialogue-avatar" aria-hidden="true">
                                            {dialogueFrame.avatarUrl ? (
                                                <img src={dialogueFrame.avatarUrl} alt="" />
                                            ) : (
                                                <span>{makeInitials(dialogueFrame.speakerName)}</span>
                                            )}
                                        </div>
                                        <div className="nn-dialogue-name" style={{ color: dialogueFrame.speakerColor }}>
                                            {dialogueFrame.speakerName}
                                        </div>
                                    </div>
                                )}
                                <div className="nn-dialogue-copy">
                                    <p>{dialogueFrame.text}</p>
                                </div>
                                {canAdvanceDialogue && <span className="nn-continue" aria-hidden="true">▾</span>}
                            </div>
                        )}

                        {showDecisionControls && (
                            <section className="nn-input-panel" aria-label="念念浮生输入区">
                                <div className="nn-beat-list">
                                    {inputBeats.map(beat => (
                                        <div key={beat.id} className={`nn-beat-card is-${beat.kind}`}>
                                            <div className="nn-beat-head">
                                                <div className="nn-beat-toggle" role="group" aria-label="段落类型">
                                                    <button
                                                        type="button"
                                                        className={beat.kind === 'speech' ? 'is-active' : ''}
                                                        onClick={() => updateInputBeat(beat.id, { kind: 'speech' })}
                                                    >
                                                        台词
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={beat.kind === 'action' ? 'is-active' : ''}
                                                        onClick={() => updateInputBeat(beat.id, { kind: 'action' })}
                                                    >
                                                        动作
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="nn-beat-remove"
                                                    onClick={() => removeInputBeat(beat.id)}
                                                    aria-label={inputBeats.length > 1 ? '删除段落' : '清空段落'}
                                                    title={inputBeats.length > 1 ? '删除段落' : '清空段落'}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                            <div className="nn-beat-input-shell">
                                                {beat.kind === 'speech' && <span className="nn-beat-quote is-open">“</span>}
                                                <textarea
                                                    value={beat.text}
                                                    onChange={event => updateInputBeat(beat.id, { text: event.target.value })}
                                                    onKeyDown={handleInputBeatKeyDown}
                                                    placeholder={beat.kind === 'speech' ? '写一句要说的话...' : '写一个动作、停顿或神态...'}
                                                />
                                                {beat.kind === 'speech' && <span className="nn-beat-quote is-close">”</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="nn-input-actions">
                                    <div className="nn-beat-add">
                                        <button type="button" onClick={() => addInputBeat('speech')}>+ 台词</button>
                                        <button type="button" onClick={() => addInputBeat('action')}>+ 动作</button>
                                    </div>
                                    <button
                                        type="button"
                                        className="nn-send-btn"
                                        onClick={() => void handleSubmitTurn()}
                                        disabled={sendableBeats.length === 0 || isSubmittingTurn}
                                        aria-label="发送回合"
                                        title="发送回合"
                                    >
                                        <PaperPlaneTilt size={18} weight="fill" />
                                    </button>
                                </div>
                            </section>
                        )}
                    </section>

                    <button
                        type="button"
                        className={`nn-status-orb ${statusExpanded ? 'is-expanded' : ''}`}
                        onClick={handleToggleFateBook}
                        aria-expanded={statusExpanded}
                        aria-label={statusExpanded ? '合上天机之书' : '展开天机之书'}
                    >
                        <BookOpenText size={18} weight="duotone" />
                        <span>天机</span>
                        <strong>{statusExpanded ? '合卷' : session.status.ta.好感}</strong>
                    </button>

                    {statusExpanded && (
                        <aside className="nn-status-panel nn-fate-book" aria-label="天机之书">
                            <div className="nn-fate-spine" aria-hidden="true" />
                            <div className="nn-fate-pages">
                                <header className="nn-fate-head">
                                    <span>天机之书</span>
                                </header>
                                <div className="nn-fate-layout">
                                    <nav className="nn-fate-tabs" aria-label="天机之书目录">
                                        {fateBookSections.map((section, index) => (
                                            <button
                                                type="button"
                                                className={`nn-fate-tab ${activeFateSection?.key === section.key ? 'is-active' : ''}`}
                                                key={section.key}
                                                onClick={() => setActiveFatePageKey(section.key)}
                                                aria-pressed={activeFateSection?.key === section.key}
                                                aria-label={`翻到${section.title}`}
                                                title={`${section.title} · 第 ${index + 1} 页`}
                                            >
                                                <span className="nn-fate-seal">{section.seal}</span>
                                            </button>
                                        ))}
                                    </nav>
                                    {activeFateSection && (
                                        <section className="nn-fate-section is-active-page">
                                            <header>
                                                <span className="nn-fate-seal">{activeFateSection.seal}</span>
                                                <h3>{activeFateSection.title}</h3>
                                            </header>
                                            <dl>
                                                {activeFateSection.items.map(item => (
                                                    <div className="nn-fate-row" key={`${activeFateSection.key}-${item.label}`}>
                                                        <dt>{item.label}</dt>
                                                        <dd>{item.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </section>
                                    )}
                                </div>
                            </div>
                        </aside>
                    )}

                </main>
            )}
        </div>
    );
};

export default NianNianApp;
