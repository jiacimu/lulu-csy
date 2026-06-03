import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowCounterClockwise,
    BookOpenText,
    Check,
    FloppyDisk,
    PaperPlaneTilt,
    Sparkle,
    UserCircle,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type {
    CharacterProfile,
    NianNianInputBeat,
    NianNianSession,
    NianNianWorldBible,
} from '../../types';
import { DB } from '../../utils/db';
import {
    appendNianNianRawMessage,
    applyNianNianStatusPatch,
    buildNianNianTurnPlan,
    createEmptyWorldBible,
    createNianNianId,
    createNianNianSession,
    formatNianNianUserInput,
    parseNianNianStatusBlock,
    sanitizeNianNianInputBeats,
} from '../../utils/niannianEngine';
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

function buildWorldBible(draft: SetupDraft): NianNianWorldBible {
    return {
        ...createEmptyWorldBible(),
        theme: draft.theme.trim(),
        tone: draft.tone.trim(),
        charIdentity: draft.charIdentity.trim(),
        protagonistIdentity: draft.protagonistIdentity.trim(),
        opening: draft.opening.trim(),
        customPrompt: draft.customPrompt.trim(),
        statusSchema: [],
        eventWeights: {},
    };
}

function visibleLatestAssistant(session: NianNianSession): string {
    const latest = [...session.rawBuffer].reverse().find(item => item.role === 'assistant' || item.role === 'director');
    return latest?.content || session.currentStep.sceneText || session.world.opening || 'TODO(人工)：开场情境待填写。';
}

const NianNianApp: React.FC = () => {
    const { activeCharacterId, addToast, characters, closeApp, userProfile } = useOS();
    const userName = userProfile?.name?.trim() || '你';
    const [sessions, setSessions] = useState<NianNianSession[]>([]);
    const [session, setSession] = useState<NianNianSession | null>(null);
    const [setupDraft, setSetupDraft] = useState<SetupDraft>(() => makeSetupDraft(activeCharacterId, userName));
    const [inputBeats, setInputBeats] = useState<Array<NianNianInputBeat & { id: string }>>(() => [
        createInputBeat('speech'),
        createInputBeat('action'),
    ]);
    const [selectedOptionId, setSelectedOptionId] = useState('');
    const [statusDraft, setStatusDraft] = useState('');
    const [isLoadingSessions, setIsLoadingSessions] = useState(true);

    const selectedCharacter = useMemo(
        () => resolveCharacter(characters, setupDraft.charId),
        [characters, setupDraft.charId],
    );
    const activeOption = session?.currentStep.options.find(option => option.id === selectedOptionId) || null;
    const sendableBeats = useMemo(() => sanitizeNianNianInputBeats(inputBeats), [inputBeats]);

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

    useEffect(() => {
        if (session?.currentStep.options.some(option => option.id === selectedOptionId)) return;
        setSelectedOptionId(session?.currentStep.options[0]?.id || '');
    }, [selectedOptionId, session?.currentStep.id, session?.currentStep.options]);

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
            world: buildWorldBible(setupDraft),
        });
        await persistSession(nextSession);
        addToast?.('念念浮生副本已创建', 'success');
    };

    const handleSelectSession = (nextSession: NianNianSession) => {
        setSession(nextSession);
        setSelectedOptionId(nextSession.currentStep.options[0]?.id || '');
    };

    const updateBeat = (id: string, patch: Partial<NianNianInputBeat>) => {
        setInputBeats(prev => prev.map(beat => (beat.id === id ? { ...beat, ...patch } : beat)));
    };

    const removeBeat = (id: string) => {
        setInputBeats(prev => {
            if (prev.length <= 1) return prev.map(beat => (beat.id === id ? { ...beat, text: '' } : beat));
            return prev.filter(beat => beat.id !== id);
        });
    };

    const handleSubmitTurn = async () => {
        if (!session) return;
        const content = formatNianNianUserInput({
            beats: inputBeats,
            selectedOption: activeOption,
        });
        if (!content) {
            addToast?.('请先写动作、台词，或选择一个节点选项', 'error');
            return;
        }
        const turnPlan = buildNianNianTurnPlan(session, content);

        const userMessage = {
            id: createNianNianId('nn_user'),
            role: 'user' as const,
            content,
            beats: sendableBeats,
            choiceId: activeOption?.id,
            createdAt: Date.now(),
        };
        const placeholderReply = {
            id: createNianNianId('nn_system'),
            role: 'system' as const,
            content: turnPlan.compressionRequest
                ? 'TODO(人工)：触发冻段压缩接口，后台生成 FrozenSegment。'
                : 'TODO(人工)：这里接主模型演出与状态块；当前为骨架记录。',
            createdAt: Date.now(),
        };
        const afterUser = appendNianNianRawMessage(session, userMessage);
        const nextSession = appendNianNianRawMessage({
            ...afterUser,
            director: {
                ...afterUser.director,
                turn: afterUser.director.turn + 1,
            },
            currentStep: turnPlan.fallbackStep,
            updatedAt: Date.now(),
        }, placeholderReply);

        setInputBeats([createInputBeat('speech'), createInputBeat('action')]);
        setSelectedOptionId(nextSession.currentStep.options[0]?.id || '');
        await persistSession(nextSession);
    };

    const handleApplyStatusBlock = async () => {
        if (!session) return;
        const parsed = parseNianNianStatusBlock(statusDraft);
        if (!parsed) {
            addToast?.('没有解析到有效状态块', 'error');
            return;
        }
        const nextSession = {
            ...session,
            status: applyNianNianStatusPatch(session.status, parsed.statusPatch, session.world.statusSchema),
            updatedAt: Date.now(),
        };
        await persistSession(nextSession);
        setStatusDraft('');
        addToast?.('状态块已应用', 'success');
    };

    const handleNewSession = () => {
        setSession(null);
        setSetupDraft(makeSetupDraft(activeCharacterId, userName));
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
                    <strong>自包含前世副本</strong>
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
                                <p>世界观、提示词、数值和美术均留给人工填写。</p>
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
                <main className="nn-stage">
                    <section className="nn-vn">
                        <div className="nn-vn-bg" />
                        <div className="nn-character-standee">
                            {characters.find(char => char.id === session.charId)?.avatar ? (
                                <img src={characters.find(char => char.id === session.charId)?.avatar} alt="" />
                            ) : (
                                <UserCircle size={92} weight="thin" />
                            )}
                            <span>{session.world.charIdentity || 'TODO(人工)：前世身份'}</span>
                        </div>
                        <div className="nn-dialogue">
                            <div className="nn-dialogue-name">{session.charName}</div>
                            <p>{visibleLatestAssistant(session)}</p>
                        </div>
                    </section>

                    <aside className="nn-status">
                        <div><span>阶段</span><strong>{session.director.stage}</strong></div>
                        <div><span>回合</span><strong>{session.director.turn}</strong></div>
                        <div><span>好感</span><strong>{session.status.ta.好感}</strong></div>
                        <div><span>暧昧</span><strong>{session.status.ta.暧昧度}</strong></div>
                        <div><span>地点</span><strong>{session.status.scene.地点 || '未定'}</strong></div>
                        <div><span>神态</span><strong>{session.status.ta.神态}</strong></div>
                    </aside>

                    <section className="nn-composer" aria-label="念念浮生输入区">
                        {session.currentStep.options.length > 0 && (
                            <div className="nn-options">
                                {session.currentStep.options.map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={selectedOptionId === option.id ? 'is-selected' : ''}
                                        onClick={() => setSelectedOptionId(option.id)}
                                    >
                                        <Check size={14} weight="bold" />
                                        <span>{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="nn-beat-list">
                            {inputBeats.map(beat => (
                                <div key={beat.id} className={`nn-beat-card is-${beat.kind}`}>
                                    <div className="nn-beat-head">
                                        <div className="nn-kind-toggle" role="group" aria-label="输入段落类型">
                                            <button type="button" className={beat.kind === 'speech' ? 'is-active' : ''} onClick={() => updateBeat(beat.id, { kind: 'speech' })}>台词</button>
                                            <button type="button" className={beat.kind === 'action' ? 'is-active' : ''} onClick={() => updateBeat(beat.id, { kind: 'action' })}>动作</button>
                                        </div>
                                        <button type="button" onClick={() => removeBeat(beat.id)} aria-label="删除输入段落" title="删除">×</button>
                                    </div>
                                    <textarea
                                        value={beat.text}
                                        onChange={event => updateBeat(beat.id, { text: event.target.value })}
                                        placeholder={beat.kind === 'speech' ? '写要说的话...' : '写动作、停顿或神态...'}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="nn-composer-actions">
                            <button type="button" onClick={() => setInputBeats(prev => [...prev, createInputBeat('speech')])}>+ 台词</button>
                            <button type="button" onClick={() => setInputBeats(prev => [...prev, createInputBeat('action')])}>+ 动作</button>
                            <button type="button" className="nn-send-btn" onClick={handleSubmitTurn} disabled={!activeOption && sendableBeats.length === 0} aria-label="发送回合">
                                <PaperPlaneTilt size={18} weight="fill" />
                            </button>
                        </div>
                    </section>

                    <details className="nn-debug">
                        <summary>状态块解析接口</summary>
                        <textarea
                            value={statusDraft}
                            onChange={event => setStatusDraft(event.target.value)}
                            placeholder={'<<<STATUS>>>\n{ "ta": { "好感_delta": 1 } }\n<<<END>>>'}
                        />
                        <button type="button" onClick={handleApplyStatusBlock}>
                            <FloppyDisk size={16} weight="bold" />
                            应用状态块
                        </button>
                    </details>
                </main>
            )}
        </div>
    );
};

export default NianNianApp;
