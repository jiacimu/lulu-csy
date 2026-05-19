import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BellRinging,
    Check,
    Heart,
    Phone,
    Sparkle,
    UserCircle,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { AppID, type APIConfig, type CharacterProfile } from '../../types';
import type {
    CharacterState,
    ChoicePoint,
    LoveShowScene as LoveShowSceneModel,
    LoveShowUserImpression,
    SeasonState,
} from '../../types/loveshow';
import {
    createSceneFromChoice,
    createSeason,
    evaluateCharacterState,
    generateDirectorMission,
    generateNextChoicePoint,
    generateSceneSummary,
    resolveChoice,
    updateImpression,
    type ApiConfig,
} from '../../utils/loveshowEngine';
import {
    createInitialCharacterState,
    createInitialImpression,
    getActiveSeason,
    getAllCharacterStates,
    getImpression,
    getMemoryCards,
    getMissions,
    saveCharacterState,
    saveImpression,
    saveMemoryCard,
    saveMissions,
    saveSeason,
    setActiveSeasonId,
} from '../../utils/db/loveshowStore';
import { buildLoveShowPreamble, buildSceneContext } from '../../utils/loveshowPrompts';
import { selectSecondaryApiConfig } from '../../utils/runtimeConfig';
import { hasCompleteApiConfig } from '../../utils/apiValidation';
import { extractContent, safeResponseJson } from '../../utils/safeApi';
import LoveShowScene, { type LoveShowTurn } from './LoveShowScene';
import './loveshow.css';

interface LoveShowUiSnapshot {
    choice: ChoicePoint | null;
    scene: LoveShowSceneModel;
    transcript: LoveShowTurn[];
    completedChoiceIds: string[];
    hasUnreadPhone: boolean;
    updatedAt: number;
}

const SNAPSHOT_PREFIX = 'loveshow_ui_';
const CHOICE_HISTORY_PREFIX = 'loveshow_choice_history_';

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage can fail in private browsing; LoveShow should still render.
    }
}

function makeTurn(role: LoveShowTurn['role'], content: string): LoveShowTurn {
    return {
        id: createId(`turn_${role}`),
        role,
        content,
        createdAt: Date.now(),
    };
}

function getCharacterName(characters: CharacterProfile[], id: string): string {
    return characters.find(char => char.id === id)?.name || id;
}

function selectPhaseOneCharacter(
    characters: CharacterProfile[],
    activeCharacterId?: string | null,
): CharacterProfile | null {
    if (characters.length === 0) return null;
    return characters.find(char => char.id === activeCharacterId) || characters[0];
}

function getBestSubApi(): ApiConfig | null {
    const secondary = selectSecondaryApiConfig();
    return hasCompleteApiConfig(secondary) ? secondary : null;
}

function createWaitingScene(season: SeasonState, charId: string): LoveShowSceneModel {
    return {
        id: createId('scene_waiting'),
        dayNumber: season.day,
        locationId: 'living_room',
        locationName: '合宿屋客厅',
        characterIds: [charId],
        atmosphere: '节目组正在布置下一段互动，空气里有一点被镜头看见的紧张感',
        status: 'active',
    };
}

/** Fallback opening — used when main API is unavailable */
function buildFallbackOpening(scene: LoveShowSceneModel, characterName: string): string {
    return `*镜头从${scene.locationName}的门口推入，灯光已经亮起。${characterName}抬头看向你，像是刚刚才意识到你也在这里。*\n${characterName}：「你来了。刚才节目组说今天会有新的安排，我还有点没反应过来。」`;
}

/** Build a hidden instruction for the AI to open or transition a scene */
function buildOpeningInstruction(
    scene: LoveShowSceneModel,
    characterName: string,
    userName: string,
    choiceContext?: string,
): string {
    const parts: string[] = [];
    parts.push(`现在场景切换到了「${scene.locationName}」。${scene.atmosphere}`);
    if (choiceContext) {
        parts.push(`刚刚发生了：${choiceContext}`);
    }
    parts.push(`请以${characterName}的身份开始这个场景。用自然的文本描写环境和${characterName}的状态，和${userName}互动。写 3-5 句话，留出对话空间让${userName}回应。`);
    return parts.join('\n');
}

/** Build a brief context string describing what the user chose */
function buildChoiceContextString(
    choice: ChoicePoint,
    characters: CharacterProfile[],
    selectedOptionId?: string,
    freeInput?: string,
): string {
    const selectedName = selectedOptionId ? getCharacterName(characters, selectedOptionId) : '';
    switch (choice.type) {
        case 'group_event': return '破冰之夜开始了，所有嘉宾在客厅集合';
        case 'date_card': return `用户把今天的约会券给了${selectedName}`;
        case 'sms_target': return `用户选择给${selectedName}发匿名短信`;
        case 'sms_content': return `用户发送的匿名短信内容：「${freeInput || '...'}」`;
        case 'daily_mission': return '用户接受了导演密令';
        case 'location_visit': return `用户来到了${selectedName || '合宿屋某处'}`;
        case 'observatory': return `用户在观察室偷看${selectedName}的独白`;
        default: return '用户做出了一个选择';
    }
}

function formatTranscript(turns: LoveShowTurn[], userName: string): string {
    return turns
        .map(turn => turn.role === 'user' ? `${userName}：${turn.content}` : turn.content)
        .join('\n');
}

function normalizeApiConfig(config: APIConfig): ApiConfig | null {
    return hasCompleteApiConfig(config) ? config : null;
}

const LoveShowApp: React.FC = () => {
    const {
        activeCharacterId,
        addToast,
        apiConfig,
        characters,
        closeApp,
        openApp,
        userProfile,
    } = useOS();

    const targetCharacter = useMemo(
        () => selectPhaseOneCharacter(characters, activeCharacterId),
        [activeCharacterId, characters],
    );
    const userName = userProfile?.name?.trim() || '你';

    const [season, setSeason] = useState<SeasonState | null>(null);
    const [choice, setChoice] = useState<ChoicePoint | null>(null);
    const [scene, setScene] = useState<LoveShowSceneModel | null>(null);
    const [transcript, setTranscript] = useState<LoveShowTurn[]>([]);
    const [completedChoiceIds, setCompletedChoiceIds] = useState<string[]>([]);
    const [charState, setCharState] = useState<CharacterState | null>(null);
    const [impression, setImpression] = useState<LoveShowUserImpression | null>(null);
    const [phoneOpen, setPhoneOpen] = useState(false);
    const [hasUnreadPhone, setHasUnreadPhone] = useState(true);
    const [selectedChoiceId, setSelectedChoiceId] = useState('');
    const [freeChoiceInput, setFreeChoiceInput] = useState('');
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isClosingScene, setIsClosingScene] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingRetry, setPendingRetry] = useState(false);
    const [lastSummary, setLastSummary] = useState<string | null>(null);
    const [needsOpening, setNeedsOpening] = useState(false);

    const sceneSummaries = useMemo(
        () => season ? getMemoryCards(season.seasonId).map(card => card.description) : [],
        [season?.seasonId, lastSummary],
    );

    const resolveNextChoice = useCallback((nextSeason: SeasonState, history: string[]) => {
        const states = getAllCharacterStates(nextSeason.seasonId);
        return generateNextChoicePoint(nextSeason, states, history);
    }, []);

    useEffect(() => {
        if (!targetCharacter) {
            setSeason(null);
            setChoice(null);
            setScene(null);
            setTranscript([]);
            setCharState(null);
            setImpression(null);
            return;
        }

        let nextSeason = getActiveSeason();
        if (!nextSeason || !nextSeason.charIds.includes(targetCharacter.id)) {
            nextSeason = createSeason([targetCharacter.id]);
            saveSeason(nextSeason);
            setActiveSeasonId(nextSeason.seasonId);
        } else {
            nextSeason = { ...nextSeason, lastActiveAt: Date.now() };
            saveSeason(nextSeason);
        }

        let nextState = getAllCharacterStates(nextSeason.seasonId).find(state => state.characterId === targetCharacter.id);
        if (!nextState) {
            nextState = createInitialCharacterState(targetCharacter.id);
            saveCharacterState(nextSeason.seasonId, nextState);
        }

        let nextImpression = getImpression(nextSeason.seasonId, targetCharacter.id);
        if (!nextImpression) {
            nextImpression = createInitialImpression(targetCharacter.id);
            saveImpression(nextSeason.seasonId, nextImpression);
        }

        const history = readJson<string[]>(CHOICE_HISTORY_PREFIX + nextSeason.seasonId, []);
        const snapshot = readJson<LoveShowUiSnapshot | null>(SNAPSHOT_PREFIX + nextSeason.seasonId, null);

        if (snapshot?.choice && snapshot?.scene && Array.isArray(snapshot.transcript)) {
            setChoice(snapshot.choice);
            setScene(snapshot.scene);
            setTranscript(snapshot.transcript);
            setCompletedChoiceIds(snapshot.completedChoiceIds || history);
            setHasUnreadPhone(snapshot.hasUnreadPhone);
        } else {
            const nextChoice = resolveNextChoice(nextSeason, history);
            const autoScene = nextChoice.type === 'group_event'
                ? { ...createSceneFromChoice(nextSeason, nextChoice), status: 'active' as const }
                : createWaitingScene(nextSeason, targetCharacter.id);

            setChoice(nextChoice);
            setScene(autoScene);
            setTranscript([]);  // Start empty, AI will generate the opening
            setCompletedChoiceIds(history);
            setHasUnreadPhone(true);
            setNeedsOpening(true);  // Trigger AI opening in a separate effect
        }

        setSeason(nextSeason);
        setCharState(nextState);
        setImpression(nextImpression);
    }, [resolveNextChoice, targetCharacter]);

    useEffect(() => {
        if (!choice) return;
        setSelectedChoiceId(choice.options?.[0]?.id || '');
        setFreeChoiceInput('');
    }, [choice?.id]);

    useEffect(() => {
        if (!season || !scene) return;
        const snapshot: LoveShowUiSnapshot = {
            choice,
            scene,
            transcript,
            completedChoiceIds,
            hasUnreadPhone,
            updatedAt: Date.now(),
        };
        writeJson(SNAPSHOT_PREFIX + season.seasonId, snapshot);
        writeJson(CHOICE_HISTORY_PREFIX + season.seasonId, completedChoiceIds);
    }, [choice, completedChoiceIds, hasUnreadPhone, scene, season, transcript]);

    const callMainApi = useCallback(async (
        turnsForPrompt: LoveShowTurn[],
        sceneOverride?: LoveShowSceneModel,
    ): Promise<string> => {
        if (!targetCharacter || !season || !charState) {
            throw new Error('LoveShow scene is not ready');
        }
        const currentScene = sceneOverride || scene;
        if (!currentScene) {
            throw new Error('LoveShow scene is not ready');
        }

        const mainApi = normalizeApiConfig(apiConfig);
        if (!mainApi) {
            throw new Error('请先在设置里配置主 API');
        }

        const systemPrompt = [
            targetCharacter.systemPrompt,
            buildLoveShowPreamble(targetCharacter.name, userName, season, charState, impression),
            buildSceneContext(currentScene, sceneSummaries),
            '只扮演你自己和必要的节目环境，不要替用户做选择。',
        ].filter(Boolean).join('\n\n');

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt },
            ...turnsForPrompt.slice(-14).map(turn => ({
                role: turn.role === 'user' ? 'user' as const : 'assistant' as const,
                content: turn.role === 'user' ? `${userName}：${turn.content}` : turn.content,
            })),
        ];

        const response = await fetch(`${mainApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${mainApi.apiKey}`,
            },
            body: JSON.stringify({
                model: mainApi.model,
                messages,
                temperature: targetCharacter.dateTemperature ?? 0.85,
            }),
        });

        if (!response.ok) {
            throw new Error(`主 API 请求失败：${response.status} ${response.statusText}`);
        }

        const data = await safeResponseJson(response);
        const content = extractContent(data);
        if (!content) throw new Error('主 API 没有返回有效文本');
        return content;
    }, [apiConfig, charState, impression, scene, sceneSummaries, season, targetCharacter, userName]);

    const requestAssistantReply = useCallback(async (turnsForPrompt: LoveShowTurn[]) => {
        setIsSending(true);
        setError(null);
        setPendingRetry(false);
        try {
            const reply = await callMainApi(turnsForPrompt);
            setTranscript(prev => [...prev, makeTurn('assistant', reply)]);
        } catch (err) {
            const message = err instanceof Error ? err.message : '发送失败';
            setError(message);
            setPendingRetry(true);
            addToast?.(message, 'error');
        } finally {
            setIsSending(false);
        }
    }, [addToast, callMainApi]);

    /** Call main API to generate an AI scene opening (or react to a choice) */
    const requestAISceneOpening = useCallback(async (
        targetScene: LoveShowSceneModel,
        choiceContext?: string,
    ) => {
        if (!targetCharacter) return;
        setIsSending(true);
        setError(null);
        try {
            const instruction = buildOpeningInstruction(
                targetScene,
                targetCharacter.name,
                userName,
                choiceContext,
            );
            // Send as a hidden user instruction — AI responds in character
            const instructionTurn = makeTurn('user', instruction);
            const reply = await callMainApi([instructionTurn], targetScene);
            setTranscript(prev => [...prev, makeTurn('assistant', reply)]);
        } catch {
            // Fallback to hardcoded opening if API fails
            const fallback = buildFallbackOpening(targetScene, targetCharacter.name);
            setTranscript(prev => [...prev, makeTurn('assistant', fallback)]);
        } finally {
            setIsSending(false);
        }
    }, [callMainApi, targetCharacter, userName]);

    // Trigger AI scene opening when needed (after state is settled)
    useEffect(() => {
        if (!needsOpening || !scene || !season || !charState || !targetCharacter || isSending) return;
        setNeedsOpening(false);
        void requestAISceneOpening(scene);
    }, [needsOpening, scene, season, charState, targetCharacter, isSending, requestAISceneOpening]);


    const handleSend = useCallback(() => {
        const text = input.trim();
        if (!text || isSending) return;

        const userTurn = makeTurn('user', text);
        const nextTranscript = [...transcript, userTurn];
        setTranscript(nextTranscript);
        setInput('');
        void requestAssistantReply(nextTranscript);
    }, [input, isSending, requestAssistantReply, transcript]);

    const handleRetry = useCallback(() => {
        if (!pendingRetry || isSending) return;
        void requestAssistantReply(transcript);
    }, [isSending, pendingRetry, requestAssistantReply, transcript]);

    const maybeSaveMission = useCallback(async (nextSeason: SeasonState, selectedOption?: string) => {
        if (!choice || choice.type !== 'daily_mission' || selectedOption === 'reject') return;
        const existing = getMissions(nextSeason.seasonId);
        if (existing.some(mission => mission.dayNumber === nextSeason.day)) return;

        const charNames = nextSeason.charIds.map(id => getCharacterName(characters, id));
        const fallback = {
            id: createId('mission'),
            dayNumber: nextSeason.day,
            description: `找机会和${charNames[0] || '一位嘉宾'}单独说一句真心话`,
            reward: '解锁一次观察室视角',
            completed: false,
        };

        const subApi = getBestSubApi();
        if (!subApi) {
            saveMissions(nextSeason.seasonId, [...existing, fallback]);
            return;
        }

        try {
            const mission = await generateDirectorMission(
                subApi,
                nextSeason.day,
                charNames,
                sceneSummaries.slice(-3).join('；') || '第一天刚刚开始',
            );
            saveMissions(nextSeason.seasonId, [...existing, mission]);
        } catch {
            saveMissions(nextSeason.seasonId, [...existing, fallback]);
        }
    }, [characters, choice, sceneSummaries]);

    const handleChoiceSubmit = useCallback(() => {
        if (!season || !choice) return;

        const selected = choice.options?.length ? selectedChoiceId : undefined;
        if (choice.options?.length && !selected) {
            setError('请先选择一个选项');
            return;
        }
        if (choice.freeInput && choice.mandatory && !freeChoiceInput.trim()) {
            setError('这次需要写下你的选择');
            return;
        }

        const nextHistory = Array.from(new Set([...completedChoiceIds, choice.id]));
        const nextSeason = resolveChoice(season, choice.id, selected, freeChoiceInput.trim());
        const nextScene = {
            ...createSceneFromChoice(nextSeason, choice, selected),
            status: 'active' as const,
        };

        // Build context string describing the choice for AI
        const choiceContext = buildChoiceContextString(
            choice, characters, selected, freeChoiceInput.trim(),
        );

        saveSeason(nextSeason);
        writeJson(CHOICE_HISTORY_PREFIX + nextSeason.seasonId, nextHistory);
        void maybeSaveMission(nextSeason, selected);

        setSeason(nextSeason);
        setCompletedChoiceIds(nextHistory);
        setScene(nextScene);
        // Don't reset transcript — keep conversation continuous.
        // Don't generate next choice yet — wait until scene completes.
        setChoice(null);
        setPhoneOpen(false);
        setError(null);

        // Call AI to react to the choice within the current scene
        void requestAISceneOpening(nextScene, choiceContext);
    }, [
        characters,
        choice,
        completedChoiceIds,
        freeChoiceInput,
        maybeSaveMission,
        requestAISceneOpening,
        season,
        selectedChoiceId,
    ]);

    const handleCompleteScene = useCallback(async () => {
        if (!season || !scene || !targetCharacter || !charState || !impression || transcript.length === 0) return;

        setIsClosingScene(true);
        setError(null);
        const rawDialogue = formatTranscript(transcript, userName);
        const subApi = getBestSubApi();
        let summary = `${targetCharacter.name}和${userName}在${scene.locationName}完成了一段节目互动`;

        try {
            if (subApi) {
                summary = await generateSceneSummary(subApi, targetCharacter.name, userName, rawDialogue);
            }

            saveMemoryCard(season.seasonId, {
                sceneId: scene.id,
                dayNumber: season.day,
                description: summary,
                characters: scene.characterIds,
                timestamp: Date.now(),
            });

            let nextState = charState;
            let nextImpression = impression;

            if (subApi) {
                try {
                    nextState = await evaluateCharacterState(
                        subApi,
                        targetCharacter.name,
                        userName,
                        summary,
                        charState,
                    );
                    nextImpression = await updateImpression(
                        subApi,
                        targetCharacter.name,
                        userName,
                        summary,
                        impression,
                    );
                } catch {
                    nextState = {
                        ...charState,
                        affection: Math.min(100, charState.affection + 2),
                        lastUpdatedScene: summary.slice(0, 50),
                    };
                }
            } else {
                nextState = {
                    ...charState,
                    affection: Math.min(100, charState.affection + 2),
                    mood: '心动',
                    innerThought: charState.innerThought || '她在镜头前的样子，比想象中更真实。',
                    lastUpdatedScene: summary.slice(0, 50),
                };
            }

            saveCharacterState(season.seasonId, nextState);
            saveImpression(season.seasonId, nextImpression);

            setCharState(nextState);
            setImpression(nextImpression);
            setLastSummary(summary);

            // ── Transition to next scene ──
            // Generate next choice and set up new scene
            const nextChoice = resolveNextChoice(season, completedChoiceIds);
            const nextScene = createWaitingScene(season, targetCharacter.id);

            setScene(nextScene);
            setChoice(nextChoice);
            setTranscript([]);  // Clear for new scene
            setHasUnreadPhone(true);
            setNeedsOpening(true);  // Trigger AI opening for new scene

            addToast?.('场景已收束，幕后状态已更新', 'success');
        } catch (err) {
            const message = err instanceof Error ? err.message : '场景收束失败';
            setError(message);
            addToast?.(message, 'error');
        } finally {
            setIsClosingScene(false);
        }
    }, [addToast, charState, completedChoiceIds, impression, resolveNextChoice, scene, season, targetCharacter, transcript, userName]);

    const currentOptions = choice?.options || [];

    if (!targetCharacter) {
        return (
            <div className="ls-app ls-empty-app">
                <div className="ls-empty-panel">
                    <Heart size={34} weight="fill" />
                    <h1>恋综还缺一位嘉宾</h1>
                    <p>先在角色库里准备一个角色，LoveShow Phase 1 会用第一位角色启动单人恋综线。</p>
                    <div className="ls-empty-actions">
                        <button type="button" onClick={() => openApp?.(AppID.Character)} className="ls-primary-action">
                            <UserCircle size={18} weight="bold" />
                            去角色库
                        </button>
                        <button type="button" onClick={closeApp} className="ls-secondary-action">
                            <X size={18} weight="bold" />
                            退出
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="ls-app">
            <div className="ls-topbar">
                <button type="button" onClick={closeApp} className="ls-topbar-btn" aria-label="退出恋综" title="退出">
                    <X size={18} weight="bold" />
                </button>
                <div className="ls-brand">
                    <span>LoveShow</span>
                    <strong>恋综</strong>
                </div>
                <div className="ls-status-pill">
                    <Heart size={15} weight="fill" />
                    {charState ? `${charState.affection}/100` : '--'}
                </div>
            </div>

            {scene && (
                <LoveShowScene
                    scene={scene}
                    characters={characters}
                    turns={transcript}
                    inputValue={input}
                    isSending={isSending}
                    isClosingScene={isClosingScene}
                    error={error}
                    canRetry={pendingRetry}
                    onInputChange={setInput}
                    onSend={handleSend}
                    onRetry={handleRetry}
                    onCompleteScene={handleCompleteScene}
                />
            )}

            <aside className="ls-state-rail" aria-label="LoveShow backstage state">
                <div>
                    <span>当前嘉宾</span>
                    <strong>{targetCharacter.name}</strong>
                </div>
                <div>
                    <span>心情</span>
                    <strong>{charState?.mood || '期待'}</strong>
                </div>
                <div>
                    <span>回忆</span>
                    <strong>{sceneSummaries.length}</strong>
                </div>
            </aside>

            <button
                type="button"
                className="ls-phone-fab"
                onClick={() => {
                    setPhoneOpen(true);
                    setHasUnreadPhone(false);
                }}
                aria-label="打开小手机"
                title="打开小手机"
            >
                <Phone size={24} weight="fill" />
                {hasUnreadPhone && <span className="ls-phone-dot" />}
            </button>

            {phoneOpen && (
                <div className="ls-phone-layer" role="dialog" aria-modal="true" aria-label="小手机">
                    <button className="ls-phone-backdrop" type="button" onClick={() => setPhoneOpen(false)} aria-label="关闭小手机" />
                    <section className="ls-phone-drawer">
                        <header className="ls-phone-header">
                            <div>
                                <span>小手机</span>
                                <h2>节目组通知</h2>
                            </div>
                            <button type="button" onClick={() => setPhoneOpen(false)} aria-label="关闭">
                                <X size={18} weight="bold" />
                            </button>
                        </header>

                        <div className="ls-phone-tabs" role="tablist" aria-label="LoveShow phone tabs">
                            <button type="button" className="is-active">
                                <BellRinging size={16} weight="bold" />
                                通知
                            </button>
                        </div>

                        <div className="ls-notice-panel">
                            <div className="ls-notice-icon">
                                <Sparkle size={18} weight="fill" />
                            </div>
                            <div className="ls-notice-copy">
                                <span>{choice?.mandatory ? '必须响应' : '可稍后处理'}</span>
                                <p>{choice?.prompt || '节目组暂时没有新通知。'}</p>
                            </div>
                        </div>

                        {currentOptions.length > 0 && (
                            <div className="ls-choice-list">
                                {currentOptions.map(option => {
                                    const label = getCharacterName(characters, option.id);
                                    return (
                                        <label key={option.id} className={`ls-choice-option ${selectedChoiceId === option.id ? 'is-selected' : ''}`}>
                                            <input
                                                type="radio"
                                                name="loveshow-choice"
                                                value={option.id}
                                                checked={selectedChoiceId === option.id}
                                                onChange={() => setSelectedChoiceId(option.id)}
                                            />
                                            <span>
                                                <strong>{label === option.id ? option.label : label}</strong>
                                                {option.hint && <em>{option.hint}</em>}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {choice?.freeInput && (
                            <textarea
                                className="ls-choice-free-input"
                                value={freeChoiceInput}
                                onChange={(event) => setFreeChoiceInput(event.target.value)}
                                placeholder="写下你的回应..."
                                aria-label="自由回应"
                            />
                        )}

                        <div className="ls-phone-actions">
                            {!choice?.mandatory && (
                                <button type="button" className="ls-secondary-action" onClick={() => setPhoneOpen(false)}>
                                    稍后
                                </button>
                            )}
                            {choice && (
                                <button type="button" className="ls-primary-action" onClick={handleChoiceSubmit}>
                                    <Check size={17} weight="bold" />
                                    {currentOptions.length > 0 || choice?.freeInput ? '提交选择' : '确认参加'}
                                </button>
                            )}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
};

export default LoveShowApp;
