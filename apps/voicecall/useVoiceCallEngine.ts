/**
 * useVoiceCallEngine.ts — 语音通话实时管线引擎
 *
 * 编排 VAD → STT → LLM → TTS 全流程。
 * 仅在通话 active 状态使用，完全独立于聊天系统。
 *
 * 架构：
 *   1. Silero VAD 检测用户说话 → onSpeechEnd 拿到音频切片
 *   2. 硅基流动 STT 高速识别（~0.5s）
 *   3. LLM 流式输出 + 标点截断 → 每句话立刻送 TTS
 *   4. MiniMax WebSocket TTS 流式返回 PCM → ring-buffer 连续播放
 *   5. 打断 (Barge-in)：VAD 检测到用户说话 → 停播 + 中止 LLM/TTS
 *
 * 依赖：
 *   - @ricky0123/vad-web (MicVAD)
 *   - utils/cloudStt.ts (CloudStt.transcribe)
 *   - utils/minimaxTtsWs.ts (MinimaxTtsWs)
 *   - voiceCallLlm.ts (VoiceCallLlm)
 *   - voiceCallAudioPlayer.ts (VoiceCallAudioPlayer) — PCM 版
 */

import { useState,useRef,useCallback,useEffect } from 'react';
import type { SttConfig } from '../../types/stt';
import type { TtsConfig } from '../../types/tts';
import type { CharacterProfile,UserProfile,Message } from '../../types';
import { CloudStt } from '../../utils/cloudStt';
import { MinimaxTtsWs } from '../../utils/minimaxTtsWs';
import { VoiceCallLlm,VoiceCallLlmConfig } from './voiceCallLlm';
import { VoiceCallAudioPlayer } from './voiceCallAudioPlayer';
import {
    sanitizeVoiceCallAssistantText,
    splitVoiceCallForeignSentence,
} from './voiceCallTextSanitizer';
import type { VoiceCallMode } from './voiceCallTypes';
import { VectorMemoryRetriever } from '../../utils/vectorMemoryRetriever';
import { DB } from '../../utils/db';
import { pcmChunksToWavBlob } from './pcmToWav';
import { getCharacterVoiceIdNotExistMessage,isVoiceIdNotExistError } from '../../utils/characterTts';
import {
    buildVoiceCallRecentContextMessages,
    buildVoiceCallRecentContextTranscript,
    type VoiceCallRecentContextMessage,
} from './voiceCallRecentContext';
import {
    getVoiceCallRuntimeProfile,
    VOICE_CALL_DEFAULT_SAMPLE_RATE,
    type VoiceCallInputMode,
} from './voiceCallRuntime';

// ─── 类型 ──────────────────────────────────────────────────────────────

export type EngineState = 'idle' | 'listening' | 'processing' | 'speaking';
type VoiceCallTranscriptSource = 'voice' | 'text';
type VoiceCallForeignLangConfig = { sourceLang: string; targetLang: string };

export interface VoiceCallSubtitleEntry {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    translation?: string;
    source?: VoiceCallTranscriptSource;
}

export interface VoiceCallQueuedSentence {
    spokenText: string;
    translationText: string;
}

export interface UseVoiceCallEngineOptions {
    /** 完整角色档案 */
    char: CharacterProfile;
    /** 用户档案（主要用于印象中的用户名） */
    userProfile: UserProfile;
    /** TTS 配置 */
    ttsConfig: TtsConfig;
    /** STT 配置 */
    sttConfig: SttConfig;
    /** LLM 配置 */
    apiConfig: { baseUrl: string; apiKey: string; model: string; useGeminiJailbreak?: boolean };
    /** 是否静音（静音时 VAD 检测到语音后丢弃，不走 STT） */
    isMuted: boolean;
    /** AI 播放状态变化回调 → 驱动父级的 isSpeaking 状态 */
    onAISpeakingChange: (speaking: boolean) => void;
    /** 错误提示 */
    onError?: (msg: string) => void;
    /** LLM 正在重试 */
    onRetrying?: () => void;
    /** 通话模式 */
    callMode?: VoiceCallMode;
    /** 引擎启动后 AI 自动说开场白（incoming / outgoing 均可使用） */
    isIncoming?: boolean;
    // ─── 来电理由 (Call Reason) ───
    callReason?: string;
    // ─── 外语模式 (Foreign Language) ───
    foreignLang?: VoiceCallForeignLangConfig;
    // ─── 向量记忆 (Vector Memory) ───
    embeddingApiKey?: string;
}

export interface UseVoiceCallEngineReturn {
    startEngine: (gated?: boolean) => Promise<void>;
    stopEngine: () => void;
    /** 开闸：释放闸门期间缓冲的音频并开始播放 */
    releaseGate: () => void;
    /** 上次通话的对话历史（通话结束后由 stopEngine 填充） */
    lastCallHistory: React.MutableRefObject<{ role: string; content: string; audioBlob?: Blob }[]>;
    sendTextMessage: (text: string) => void;
    engineState: EngineState;
    isUserSpeaking: boolean;
    transcript: string;
    aiResponse: string;
    /** TTS 合成失败，已降级为纯文字展示 */
    ttsDegraded: boolean;
    /** 当前 transcript 来源 */
    transcriptSource: VoiceCallTranscriptSource;
    /** 是否处于 iOS/Safari 省内存档位 */
    lowMemoryMode: boolean;
    /** 当前输入模式；省内存或 VAD 初始化失败时为 text-only */
    voiceInputMode: VoiceCallInputMode;
    // ─── 通话质量反馈 ───
    /** STT 返回空结果，提示用户"没听清" */
    sttEmptyHint: boolean;
    // ─── 外语模式 (Foreign Language) ───
    /** 当前 AI 回复的翻译文本（外语模式下从 [[翻译:...]] 提取） */
    aiTranslation: string;
    /** 当前通话内最近字幕记录，用于页面内回溯 */
    subtitleHistory: VoiceCallSubtitleEntry[];
    // ─── 音量控制 ───
    volume: number;
    setVolume: (v: number) => void;
}

// ─── 通话专用 TTS 采样率 ─────────────────────────────────────────────

// ─── Float32Array → WAV Blob ──────────────────────────────────────────

function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataLength = samples.length * (bitsPerSample / 8);
    const headerLength = 44;
    const buffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * 构建通话专用 TTS 配置：覆盖格式为 PCM，采样率 24kHz。
 * 不修改全局 TtsConfig，保持聊天 TTS 的 mp3 设置不变。
 */
const VOICE_CALL_TTS_LANGUAGE_BOOST_MAP: Record<string, string> = {
    '中文': 'Chinese',
    'Chinese': 'Chinese',
    '普通话': 'Chinese',
    'English': 'English',
    '英语': 'English',
    '日本語': 'Japanese',
    '日本语': 'Japanese',
    '日语': 'Japanese',
    '日文': 'Japanese',
    'Japanese': 'Japanese',
    '한국어': 'Korean',
    '韩语': 'Korean',
    'Korean': 'Korean',
    'Français': 'French',
    '法语': 'French',
    'French': 'French',
    'Español': 'Spanish',
    '西班牙语': 'Spanish',
    'Spanish': 'Spanish',
};

function resolveVoiceCallLanguageBoost(foreignLang?: VoiceCallForeignLangConfig): string | undefined {
    const sourceLang = foreignLang?.sourceLang?.trim();
    return sourceLang ? VOICE_CALL_TTS_LANGUAGE_BOOST_MAP[sourceLang] : undefined;
}

export function buildVoiceCallTtsConfig(
    base: TtsConfig,
    foreignLang?: VoiceCallForeignLangConfig,
    sampleRate: number = VOICE_CALL_DEFAULT_SAMPLE_RATE,
): TtsConfig {
    const languageBoost = resolveVoiceCallLanguageBoost(foreignLang);
    return {
        ...base,
        ...(languageBoost ? { languageBoost } : {}),
        audioSetting: {
            ...base.audioSetting,
            format: 'pcm' as const,
            audio_sample_rate: sampleRate,
        },
    };
}

export function buildVoiceCallQueuedSentence(sentence: string): VoiceCallQueuedSentence | null {
    const parsed = splitVoiceCallForeignSentence(sentence);
    const spokenText = sanitizeVoiceCallAssistantText(parsed.spokenText);

    if (!spokenText) {
        return null;
    }

    return {
        spokenText,
        translationText: parsed.translationText,
    };
}

export function getVoiceCallPlaybackSentence(
    queue: VoiceCallQueuedSentence[],
    index: number,
): VoiceCallQueuedSentence | null {
    return index >= 0 && index < queue.length ? queue[index] : null;
}

function buildVoiceCallRetrievalMessages(
    recentContextMessages: VoiceCallRecentContextMessage[],
    history: Array<{ role: string; content: string }>,
    charId: string,
    extraUserText?: string,
): Message[] {
    const liveHistoryMessages = history
        .filter((entry): entry is { role: 'user' | 'assistant'; content: string } => (
            (entry.role === 'user' || entry.role === 'assistant') && !!entry.content?.trim()
        ))
        .map((entry, index, all) => ({
            id: recentContextMessages.length + index,
            role: entry.role,
            content: entry.content,
            type: 'text' as const,
            timestamp: Date.now() - (all.length - index) * 1000,
            charId,
        }));

    const combined = [
        ...recentContextMessages,
        ...liveHistoryMessages,
    ];

    if (extraUserText?.trim()) {
        combined.push({
            id: combined.length,
            role: 'user',
            content: extraUserText.trim(),
            type: 'text',
            timestamp: Date.now(),
            charId,
        });
    }

    return combined;
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useVoiceCallEngine(options: UseVoiceCallEngineOptions): UseVoiceCallEngineReturn {
    const runtimeProfileRef = useRef(getVoiceCallRuntimeProfile());
    const runtimeProfile = runtimeProfileRef.current;
    const [engineState, setEngineState] = useState<EngineState>('idle');
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [aiResponse, setAiResponse] = useState('');
    const [ttsDegraded, setTtsDegraded] = useState(false);
    const [transcriptSource, setTranscriptSource] = useState<VoiceCallTranscriptSource>('voice');
    const [voiceInputMode, setVoiceInputMode] = useState<VoiceCallInputMode>(runtimeProfile.voiceInputMode);
    // ─── 外语模式 (Foreign Language) ───
    const [aiTranslation, setAiTranslation] = useState('');
    const [subtitleHistory, setSubtitleHistory] = useState<VoiceCallSubtitleEntry[]>([]);
    // ─── 通话质量反馈 ───
    const [sttEmptyHint, setSttEmptyHint] = useState(false);
    const sttEmptyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // ─── 音量控制 ───
    const [volume, setVolumeState] = useState(1);
    const setVolume = useCallback((v: number) => {
        const clamped = Math.max(0, Math.min(1, v));
        setVolumeState(clamped);
        playerRef.current?.setVolume(clamped);
    }, []);

    // Refs — 存活于整个引擎生命周期
    const streamRef = useRef<MediaStream | null>(null);
    const vadRef = useRef<any>(null);
    const llmRef = useRef<VoiceCallLlm | null>(null);
    const ttsWsRef = useRef<MinimaxTtsWs | null>(null);
    const playerRef = useRef<VoiceCallAudioPlayer | null>(null);
    const engineActiveRef = useRef(false);
    // TTS 是否可用（apiKey + groupId 都配置了才可用，否则纯文字降级模式）
    const ttsAvailableRef = useRef(true);

    // 用 ref 跟踪最新 options 值（在 VAD 回调中使用）
    const optionsRef = useRef(options);
    optionsRef.current = options;

    // ── 静音切换副作用：清空音频缓冲 + 重置录音状态 ──
    // 修复：用户说话中按静音 → isUserSpeaking 卡死；debounce 窗口内按静音 → 音频泄漏到 STT
    useEffect(() => {
        if (options.isMuted) {
            // 取消待发送的 STT 任务（debounce timer 可能还在跑）
            if (sttDebounceTimerRef.current) {
                clearTimeout(sttDebounceTimerRef.current);
                sttDebounceTimerRef.current = null;
            }
            pendingAudioSegmentsRef.current = [];
            // 强制重置"录音中"（防止 onSpeechStart 已触发但 onSpeechEnd 被静音守卫跳过）
            setIsUserSpeaking(false);
        }
    }, [options.isMuted]);
    const engineStateRef = useRef<EngineState>('idle');

    // 打断保护：忽略一段时间内的 VAD 检测（AEC 尾音）
    const ignoreUntilRef = useRef(0);

    // ── Generation counter：防止打断后旧 pipeline 的回调继续执行 ──
    const generationRef = useRef(0);

    // ── 闸门模式（响铃预热）──
    const gatedRef = useRef(false);

    // ── 音频缓存：收集每轮 AI 的 TTS PCM 数据用于日后回听 ──
    const turnAudioChunksRef = useRef<Uint8Array[]>([]);
    const turnAudioBlobsRef = useRef<Map<number, Blob>>(new Map());
    const recentContextMessagesRef = useRef<VoiceCallRecentContextMessage[]>([]);
    const subtitleIdRef = useRef(0);

    const pushSubtitle = useCallback((entry: Omit<VoiceCallSubtitleEntry, 'id'>) => {
        const text = entry.text.trim();
        const translation = entry.translation?.trim();
        if (!text) return;

        setSubtitleHistory(prev => [
            ...prev,
            {
                ...entry,
                id: ++subtitleIdRef.current,
                text,
                ...(translation ? { translation } : {}),
            },
        ].slice(-40));
    }, []);

    // ── 语音拼接模式：缓冲用户连续语音段 + 去抖定时器 ──
    const pendingAudioSegmentsRef = useRef<Float32Array[]>([]);
    const sttDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const STT_DEBOUNCE_MS = 250; // VAD 300ms redemption + 250ms 去抖（从 400ms 压缩，加速 TTFV）


    // ─── 核心处理：用户消息（文字）→ LLM → TTS 管线 ─────────────────────

    const processUserMessage = useCallback(async (
        text: string,
        source: VoiceCallTranscriptSource | 'system' = 'voice',
    ) => {
        const opts = optionsRef.current;

        if (!engineActiveRef.current) return;

        // Fix C: processUserMessage 自己递增 gen，确保每次调用都是独立 generation
        const gen = ++generationRef.current;

        try {
            setEngineState('processing');
            engineStateRef.current = 'processing';
            // 系统内部触发词（如 AI 来电开场白）不显示在界面上
            const isSystemMessage = source === 'system' || text.startsWith('[系统：');
            setTranscript(isSystemMessage ? '' : text);
            if (!isSystemMessage) {
                setTranscriptSource(source);
                pushSubtitle({ role: 'user', text, source });
            }
            setAiResponse('');
            // 仅 TTS 可用时才重置 ttsDegraded，避免纯文字模式下每轮闪烁
            if (ttsAvailableRef.current) {
                setTtsDegraded(false);
            }
            // ─── 清空本轮音频缓存 ───
            turnAudioChunksRef.current = [];
            // ─── 外语模式 (Foreign Language): 重置翻译 ───
            setAiTranslation('');

            // ─── 向量记忆并行检索（不阻塞 LLM，跳过系统内部消息） ───
            // 来电开场白的向量检索在 startEngine 中已阻塞完成，此处仅用于后续对话轮次
            if (
                opts.embeddingApiKey &&
                opts.char.vectorMemoryEnabled &&
                llmRef.current &&
                !text.startsWith('[系统：')
            ) {
                const llmForRetrieval = llmRef.current;
                const history = llmForRetrieval.getHistory();
                const msgs = buildVoiceCallRetrievalMessages(
                    recentContextMessagesRef.current,
                    history,
                    opts.char.id,
                );
                // fire-and-forget：与 LLM 并行执行，结果到达后注入（影响后续句子）
                VectorMemoryRetriever.retrieve(
                    opts.char.id, opts.char.name, opts.userProfile.name, msgs, opts.embeddingApiKey, opts.apiConfig, opts.char.moodState as any,
                ).then(memBlock => {
                    if (memBlock && gen === generationRef.current && llmRef.current) {
                        llmRef.current.setVectorMemoryBlock(memBlock);
                        console.log(`[🧠 VoiceCall] Vector memory injected (parallel): ${memBlock.length} chars`);
                    }
                }).catch(err => {
                    console.warn('[🧠 VoiceCall] Vector retrieval failed (non-fatal):', err);
                });
            }

            // ──── LLM + TTS ────
            setEngineState('speaking');
            engineStateRef.current = 'speaking';
            // 闸门期间压制 isSpeaking（音频还没播出来）
            if (!gatedRef.current) {
                opts.onAISpeakingChange(true);
            }

            const player = playerRef.current;
            const llm = llmRef.current;

            if (!player || !llm) {
                console.error('[Engine] Missing module refs');
                setEngineState('listening');
                engineStateRef.current = 'listening';
                opts.onAISpeakingChange(false);
                return;
            }

            player.init();

            player.onPlaybackEnd = () => {
                if (gen === generationRef.current && engineActiveRef.current) {
                    console.log('[Engine] AI finished speaking, back to listening');
                    // ── 打包本轮 PCM → WAV Blob 存入缓存（以 gen 作为精确 key）──
                    if (runtimeProfileRef.current.persistAssistantAudio && turnAudioChunksRef.current.length > 0) {
                        try {
                            const wavBlob = pcmChunksToWavBlob(
                                turnAudioChunksRef.current,
                                runtimeProfileRef.current.ttsSampleRate,
                            );
                            turnAudioBlobsRef.current.set(gen, wavBlob);
                            console.log(`[Engine] Turn audio cached (gen=${gen}): ${(wavBlob.size / 1024).toFixed(1)}KB`);
                        } catch (e) {
                            console.warn('[Engine] Failed to cache turn audio:', e);
                        }
                        turnAudioChunksRef.current = [];
                    }
                    opts.onAISpeakingChange(false);
                    setEngineState('listening');
                    engineStateRef.current = 'listening';
                }
            };

            const vcTtsConfig = buildVoiceCallTtsConfig(
                opts.ttsConfig,
                opts.foreignLang,
                runtimeProfileRef.current.ttsSampleRate,
            );

            let ttsReady = false;
            let ttsConnectFailed = false;
            let reconnectAttempted = false;  // 防止无限重连
            // ── 降级句子队列：一句一句显示 ──
            const degradedSentenceQueue: VoiceCallQueuedSentence[] = [];
            let degradedDisplaying = false;  // 是否正在显示某句

            /** 显示下一句降级文字 */
            const showNextDegradedSentence = () => {
                if (gen !== generationRef.current) return;
                if (degradedSentenceQueue.length === 0) {
                    degradedDisplaying = false;
                    // 队列空且 LLM 完成 → 切换到 listening
                    if (llmComplete && engineActiveRef.current) {
                        setEngineState('listening');
                        engineStateRef.current = 'listening';
                    }
                    return;
                }
                degradedDisplaying = true;
                const sentence = degradedSentenceQueue.shift()!;
                setAiResponse(sentence.spokenText);
                setAiTranslation(sentence.translationText);
                pushSubtitle({
                    role: 'assistant',
                    text: sentence.spokenText,
                    translation: sentence.translationText,
                });
                // 显示时长：按字数计算，模拟阅读节奏
                const displayMs = Math.max(2000, Math.min(6000, sentence.spokenText.length * 120));
                setTimeout(() => {
                    showNextDegradedSentence();
                }, displayMs);
            };

            /** 入队一句降级文字 */
            const enqueueDegradedSentence = (sentence: VoiceCallQueuedSentence) => {
                degradedSentenceQueue.push(sentence);
                if (!degradedDisplaying) {
                    showNextDegradedSentence();
                }
            };
            let sentSentCount = 0;           // 已成功发送给 TTS 的句子数
            const pendingSentences: VoiceCallQueuedSentence[] = [];
            const sentenceQueue: VoiceCallQueuedSentence[] = [];

            let ttsTaskFinished = false;
            let llmComplete = false;
            let isFinalCount = 0;

            const tryMarkTtsFinished = () => {
                if (gen !== generationRef.current) return;
                if (llmComplete && isFinalCount >= sentenceQueue.length && ttsTaskFinished) {
                    playerRef.current?.markTtsFinished();
                }
            };

            player.onSentenceStart = (idx) => {
                if (gen !== generationRef.current) return;
                const sentence = getVoiceCallPlaybackSentence(sentenceQueue, idx);
                if (sentence) {
                    setAiResponse(sentence.spokenText);
                    setAiTranslation(sentence.translationText);
                    pushSubtitle({
                        role: 'assistant',
                        text: sentence.spokenText,
                        translation: sentence.translationText,
                    });
                }
            };

            // ─── TTS 回调（提取为具名函数，重连时复用） ───

            const handleAudioChunk = (chunk: { audio: Uint8Array; isFinal: boolean }) => {
                if (gen !== generationRef.current) return;
                if (chunk.audio.length > 0) {
                    playerRef.current?.enqueue(chunk.audio);
                    // ── 收集原始 PCM 用于通话录音缓存 ──
                    if (runtimeProfileRef.current.persistAssistantAudio) {
                        turnAudioChunksRef.current.push(new Uint8Array(chunk.audio));
                    }
                }
                if (chunk.isFinal) {
                    isFinalCount++;
                    playerRef.current?.markSentenceEnd();
                    tryMarkTtsFinished();
                }
            };

            /** 降级剩余句子为纯文字（重连失败或首次连接失败时共用） */
            const degradeRemainingToText = () => {
                ttsConnectFailed = true;
                setTtsDegraded(true);
                opts.onAISpeakingChange(false);
                setEngineState('processing');
                engineStateRef.current = 'processing';
                // 把尚未完成播放的句子逐句入队显示
                for (const s of sentenceQueue.slice(isFinalCount)) {
                    enqueueDegradedSentence(s);
                }
            };

            /** 尝试 TTS mid-turn 重连（最多 1 次） */
            const attemptTtsReconnect = async () => {
                console.log(`[Engine] TTS mid-turn disconnect (${isFinalCount}/${sentSentCount} done). Attempting reconnection...`);
                ttsReady = false;
                ttsTaskFinished = false;

                try {
                    const newWs = new MinimaxTtsWs({
                        onAudioChunk: handleAudioChunk,
                        onTaskFinished: handleTtsTaskFinished,
                    });
                    ttsWs = newWs;
                    ttsWsRef.current = newWs;

                    await newWs.connect(vcTtsConfig);
                    await newWs.start(vcTtsConfig);
                    if (gen !== generationRef.current) { newWs.close(); return; }

                    ttsReady = true;
                    console.log('[Engine] TTS reconnected successfully');

                    // 重发未完成的句子（从 isFinalCount 位置开始）
                    for (let i = isFinalCount; i < sentenceQueue.length; i++) {
                        newWs.sendText(sentenceQueue[i].spokenText);
                        sentSentCount++;
                    }
                    // 刷空重连期间到达的新句子
                    for (const s of pendingSentences) {
                        newWs.sendText(s.spokenText);
                        sentSentCount++;
                    }
                    pendingSentences.length = 0;

                    if (llmComplete) {
                        newWs.finish().catch(() => {});
                        tryMarkTtsFinished();
                    }
                } catch (err) {
                    console.error('[Engine] TTS reconnection failed, degrading to text:', err);
                    if (isVoiceIdNotExistError(err)) {
                        opts.onError?.(getCharacterVoiceIdNotExistMessage(vcTtsConfig.voiceSetting.voice_id));
                    }
                    degradeRemainingToText();
                }
            };

            const handleTtsTaskFinished = () => {
                if (gen !== generationRef.current) return;
                ttsTaskFinished = true;

                // 检查是否有未完成的句子 → mid-turn 断连
                const hasUnfinished = sentSentCount > 0 && isFinalCount < sentSentCount;
                if (hasUnfinished && !reconnectAttempted && engineActiveRef.current) {
                    reconnectAttempted = true;
                    attemptTtsReconnect();
                    return;
                }

                tryMarkTtsFinished();
            };

            // ─── TTS 不可用：直接走纯文字降级路径，跳过所有 WS 操作 ───
            if (!ttsAvailableRef.current) {
                setTtsDegraded(true);
                opts.onAISpeakingChange(false);
                setEngineState('processing');
                engineStateRef.current = 'processing';

                await llm.chat(text, {
                    onSentence: (sentence) => {
                        if (gen !== generationRef.current || !engineActiveRef.current) return;
                        const queuedSentence = buildVoiceCallQueuedSentence(sentence);
                        if (!queuedSentence) {
                            return;
                        }
                        console.log(`[Engine] LLM sentence (text-only): "${queuedSentence.spokenText}"${queuedSentence.translationText ? ` (翻译: ${queuedSentence.translationText})` : ''}`);
                        sentenceQueue.push(queuedSentence);
                        enqueueDegradedSentence(queuedSentence);
                    },
                    onComplete: (full) => {
                        if (gen !== generationRef.current) return;
                        console.log(`[Engine] LLM complete (text-only): "${full.slice(0, 80)}..."`);
                        llmComplete = true;
                        if (!degradedDisplaying && degradedSentenceQueue.length === 0 && engineActiveRef.current) {
                            opts.onAISpeakingChange(false);
                            setEngineState('listening');
                            engineStateRef.current = 'listening';
                        }
                    },
                    onError: (errMsg) => {
                        if (gen !== generationRef.current) return;
                        console.error('[Engine] LLM error (text-only):', errMsg);
                        opts.onError?.(errMsg);
                        opts.onAISpeakingChange(false);
                        setEngineState('listening');
                        engineStateRef.current = 'listening';
                    },
                    onRetrying: () => {
                        if (gen !== generationRef.current) return;
                        opts.onRetrying?.();
                    },
                }, { turnId: gen });
                return;
            }

            let ttsWs = new MinimaxTtsWs({
                onAudioChunk: handleAudioChunk,
                onTaskFinished: handleTtsTaskFinished,
            });
            ttsWsRef.current = ttsWs;

            // ─── TTS 预连接：与 LLM 并行启动握手，消除首句等待 ───
            // 注意：这段异步逻辑不 await，让它和 llm.chat 并行跑
            (async () => {
                try {
                    await ttsWs.connect(vcTtsConfig);
                    await ttsWs.start(vcTtsConfig);
                    if (gen !== generationRef.current) { ttsWs.close(); return; }

                    ttsReady = true;
                    console.log('[Engine] TTS pre-connect ready');

                    // 连接期间 LLM 可能已产出句子 → 刷空 pendingSentences
                    for (const s of pendingSentences) {
                        ttsWs.sendText(s.spokenText);
                        sentSentCount++;
                    }
                    pendingSentences.length = 0;

                    // 极端情况：LLM 已完成但 TTS 预连接才刚好完成
                    if (llmComplete) {
                        ttsWs.finish().catch(() => {});
                        tryMarkTtsFinished();
                    }
                } catch (err) {
                    console.error('[Engine] TTS pre-connect failed, degrading to text:', err);
                    if (isVoiceIdNotExistError(err)) {
                        opts.onError?.(getCharacterVoiceIdNotExistMessage(vcTtsConfig.voiceSetting.voice_id));
                    }
                    degradeRemainingToText();
                }
            })();

            await llm.chat(text, {
                onSentence: async (sentence) => {
                    if (gen !== generationRef.current || !engineActiveRef.current) return;

                    const queuedSentence = buildVoiceCallQueuedSentence(sentence);
                    if (!queuedSentence) {
                        console.warn(`[Engine] Dropped voice-call meta narration: "${sentence}"`);
                        return;
                    }

                    console.log(`[Engine] LLM sentence: "${queuedSentence.spokenText}"${queuedSentence.translationText ? ` (翻译: ${queuedSentence.translationText})` : ''}`);
                    sentenceQueue.push(queuedSentence);

                    // TTS 已失败 → 降级为逐句文字展示
                    if (ttsConnectFailed) {
                        enqueueDegradedSentence(queuedSentence);
                        return;
                    }

                    // TTS 预连接已完成 → 直接发送
                    if (ttsReady) {
                        try { ttsWs.sendText(queuedSentence.spokenText); sentSentCount++; } catch (err) {
                            console.error('[Engine] TTS sendText error:', err);
                        }
                    } else {
                        // 预连接尚未完成 → 缓冲，连接成功后自动 flush
                        pendingSentences.push(queuedSentence);
                    }
                },
                onComplete: (full) => {
                    if (gen !== generationRef.current) return;
                    console.log(`[Engine] LLM complete: "${full.slice(0, 80)}..."`);
                    llmComplete = true;
                    if (ttsReady) {
                        ttsWs.finish().catch(() => { });
                        tryMarkTtsFinished();
                    } else if (ttsConnectFailed) {
                        // 降级路径：LLM 完成，等句子队列自然播完后自动切 listening
                        // （showNextDegradedSentence 里会检查 llmComplete）
                        if (!degradedDisplaying && degradedSentenceQueue.length === 0 && engineActiveRef.current) {
                            setEngineState('listening');
                            engineStateRef.current = 'listening';
                        }
                    } else {
                        // TTS 连接中但 LLM 已完成（极端情况）
                        player.markTtsFinished();
                        if (!player.isPlaying && engineActiveRef.current) {
                            opts.onAISpeakingChange(false);
                            setEngineState('listening');
                            engineStateRef.current = 'listening';
                        }
                    }
                },
                onError: (errMsg) => {
                    if (gen !== generationRef.current) return;
                    console.error('[Engine] LLM error:', errMsg);
                    opts.onError?.(errMsg);
                    ttsWs.close();
                    player.stop();
                    opts.onAISpeakingChange(false);
                    setEngineState('listening');
                    engineStateRef.current = 'listening';
                },
                onRetrying: () => {
                    if (gen !== generationRef.current) return;
                    console.log('[Engine] LLM retrying...');
                    opts.onRetrying?.();
                },
            }, { turnId: gen });
        } catch (err: any) {
            if (gen !== generationRef.current) return;
            console.error('[Engine] Pipeline error:', err);
            opts.onError?.(err.message || '处理出错');
            setEngineState('listening');
            engineStateRef.current = 'listening';
            optionsRef.current.onAISpeakingChange(false);
        }
    }, [pushSubtitle]);

    // ─── STT 入口：VAD 音频 → STT → processUserMessage ───────────────────

    const processConcatenatedAudio = useCallback(async (audio: Float32Array, sampleRate: number) => {
        const opts = optionsRef.current;
        if (!engineActiveRef.current) return;

        // Fix C: gen 由 processUserMessage 统一管理，此处不再递增
        const gen = generationRef.current;

        try {
            setEngineState('processing');
            engineStateRef.current = 'processing';
            setTranscript('');
            setAiResponse('');
            console.log(`[Engine] STT: processing ${(audio.length / sampleRate).toFixed(1)}s of audio`);

            const wavBlob = float32ToWavBlob(audio, sampleRate);
            const sttResult = await CloudStt.transcribe(wavBlob, opts.sttConfig);
            const text = sttResult.text?.trim();

            if (gen !== generationRef.current || !engineActiveRef.current) {
                console.log('[Engine] STT result discarded (generation mismatch)');
                return;
            }

            if (!text) {
                console.log('[Engine] STT returned empty text, showing hint');
                // 显示"没听清"提示
                if (sttEmptyHintTimerRef.current) clearTimeout(sttEmptyHintTimerRef.current);
                setSttEmptyHint(true);
                sttEmptyHintTimerRef.current = setTimeout(() => {
                    setSttEmptyHint(false);
                    sttEmptyHintTimerRef.current = null;
                }, 2500);
                setEngineState('listening');
                engineStateRef.current = 'listening';
                return;
            }

            console.log(`[Engine] STT result: "${text}"`);
            await processUserMessage(text, 'voice');
        } catch (err: any) {
            if (gen !== generationRef.current) return;
            console.error('[Engine] STT error:', err);
            opts.onError?.(err.message || '语音识别出错');
            setEngineState('listening');
            engineStateRef.current = 'listening';
            optionsRef.current.onAISpeakingChange(false);
        }
    }, [processUserMessage]);

    // ─── 打断逻辑 ────────────────────────────────────────────────

    /**
     * stopCurrentTurn — 轻量打断（文字输入用）
     * 不设置 AEC 延迟，不影响 VAD 检测
     */
    const stopCurrentTurn = useCallback(() => {
        generationRef.current++;
        pendingAudioSegmentsRef.current = [];
        if (sttDebounceTimerRef.current) {
            clearTimeout(sttDebounceTimerRef.current);
            sttDebounceTimerRef.current = null;
        }
        playerRef.current?.stop();
        ttsWsRef.current?.close();
        ttsWsRef.current = null;
        llmRef.current?.abort();
        optionsRef.current.onAISpeakingChange(false);
        setEngineState('listening');
        engineStateRef.current = 'listening';
    }, []);

    /** handleBargeIn — VAD 打断（含 AEC 保护延迟） */
    const handleBargeIn = useCallback(() => {
        console.log('[Engine] Barge-in! Stopping AI playback');
        const opts = optionsRef.current;

        generationRef.current++;

        pendingAudioSegmentsRef.current = [];
        if (sttDebounceTimerRef.current) {
            clearTimeout(sttDebounceTimerRef.current);
            sttDebounceTimerRef.current = null;
        }

        playerRef.current?.stop();
        ttsWsRef.current?.close();
        ttsWsRef.current = null;
        llmRef.current?.abort();

        // AEC 保护（250ms 平衡回声抑制与响应速度）
        ignoreUntilRef.current = Date.now() + 250;

        opts.onAISpeakingChange(false);
        setEngineState('listening');
        engineStateRef.current = 'listening';
    }, []);

    /**
     * sendTextMessage — 文字输入入口
     * 跳过 VAD/STT，直接进入 LLM→TTS 管线
     */
    const sendTextMessage = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed || !engineActiveRef.current) return;
        console.log(`[Engine] sendTextMessage: "${trimmed}"`);
        if (engineStateRef.current === 'speaking' || engineStateRef.current === 'processing') {
            // 轻量打断（内部会 ++generationRef）
            stopCurrentTurn();
        }
        // Fix C: gen 由 processUserMessage 内部递增，此处不再手动递增
        processUserMessage(trimmed, 'text');
    }, [stopCurrentTurn, processUserMessage]);


    // ─── 启动引擎 ──────────────────────────────────────────────────

    const startEngine = useCallback(async (gated: boolean = false) => {
        if (engineActiveRef.current) return;

        const opts = optionsRef.current;

        // 检查配置：TTS 不可用时进入纯文字降级模式（不阻断引擎启动）
        const ttsAvailable = !!(opts.ttsConfig.apiKey?.trim() && opts.ttsConfig.groupId?.trim());
        ttsAvailableRef.current = ttsAvailable;
        if (!ttsAvailable) {
            console.log('[Engine] TTS not configured — starting in text-only degraded mode');
        }
        if (!opts.apiConfig.baseUrl) {
            opts.onError?.('LLM API 未配置，请在设置中配置');
            return;
        }

        console.log('[Engine] Starting voice call engine...');
        engineActiveRef.current = true;
        generationRef.current = 0;
        subtitleIdRef.current = 0;
        setSubtitleHistory([]);
        setAiTranslation('');
        setVoiceInputMode(runtimeProfileRef.current.voiceInputMode);
        turnAudioChunksRef.current = [];
        turnAudioBlobsRef.current = new Map();
        pendingAudioSegmentsRef.current = [];
        lastCallHistoryRef.current = [];
        recentContextMessagesRef.current = [];

        try {
            const runtime = runtimeProfileRef.current;
            const recentContextLimit = runtime.recentContextLimit;
            const recentContextPromise = DB.getRecentMessagesByCharId(opts.char.id, recentContextLimit)
                .then((messages) => buildVoiceCallRecentContextMessages(messages, {
                    limit: recentContextLimit,
                    hideBeforeMessageId: opts.char.hideBeforeMessageId,
                }))
                .catch((error) => {
                    console.warn('[VoiceCall] Failed to load recent chat context:', error);
                    return [] as VoiceCallRecentContextMessage[];
                });

            // 1. 获取麦克风（所有平台均尝试，失败则自动降级为文字输入）
            let stream: MediaStream | null = null;
            let nextVoiceInputMode = runtime.voiceInputMode;
            if (runtime.voiceInputMode === 'voice') {
                try {
                    if (!navigator.mediaDevices?.getUserMedia) {
                        throw new Error('当前浏览器不支持麦克风输入');
                    }
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            sampleRate: 16000,
                        },
                    });
                    streamRef.current = stream;
                } catch (error) {
                    console.warn('[Engine] Microphone unavailable, falling back to text input:', error);
                    nextVoiceInputMode = 'text-only';
                    setVoiceInputMode('text-only');
                }
            } else {
                console.log('[Engine] Low-memory runtime: skipping microphone and VAD initialization');
                setVoiceInputMode('text-only');
            }

            const recentContextMessages = await recentContextPromise;
            recentContextMessagesRef.current = recentContextMessages;
            const recentChatContext = buildVoiceCallRecentContextTranscript(
                recentContextMessages,
                opts.userProfile.name,
                opts.char.name,
            );
            console.log(`[VoiceCall] Loaded ${recentContextMessages.length} recent chat messages for call context`);

            // 2. 初始化 LLM
            console.log(`[Engine] startEngine: opts.callMode=${opts.callMode ?? 'undefined'}`);
            const llmConfig: VoiceCallLlmConfig = {
                baseUrl: opts.apiConfig.baseUrl,
                apiKey: opts.apiConfig.apiKey,
                model: opts.apiConfig.model,
                useGeminiJailbreak: opts.apiConfig.useGeminiJailbreak,
                callMode: opts.callMode,
                isIncoming: opts.isIncoming,
                // ─── 外语模式 (Foreign Language) ───
                foreignLang: opts.foreignLang,
                // ─── 向量记忆 (Vector Memory) ───
                embeddingApiKey: opts.embeddingApiKey,
                vectorMemoryEnabled: opts.char.vectorMemoryEnabled,
                vectorMemoryMode: opts.char.vectorMemoryMode,
                charId: opts.char.id,
                // ─── 来电理由 (Call Reason) ───
                callReason: opts.callReason,
                // ─── 通话前最近聊天上下文 ───
                recentChatContext,
            };
            llmRef.current = new VoiceCallLlm(llmConfig, opts.char, opts.userProfile);

            // 3. 初始化 PCM 音频播放器（采样率与通话 TTS 配置一致）
            playerRef.current = new VoiceCallAudioPlayer({
                sampleRate: runtime.ttsSampleRate,
            });
            playerRef.current.init();

            // ── 闸门模式：dialing 预热时锁定播放 ──
            if (gated) {
                gatedRef.current = true;
                playerRef.current.setGated(true);
                console.log('[Engine] Gated mode: audio will buffer until gate release');
            }

            // 4. TTS WebSocket 实例在每轮 handleVoiceEnd 里按需创建
            //    这里不预创建，避免闲置超时

            // 5. 初始化 VAD
            if (stream && nextVoiceInputMode === 'voice') {
                try {
                    const { MicVAD } = await import('@ricky0123/vad-web');
                    const vad = await MicVAD.new({
                        model: 'v5',
                        getStream: async () => stream,
                        pauseStream: async () => { /* no-op */ },
                        resumeStream: async () => stream,
                        onnxWASMBasePath: '/vad/onnx/',
                        baseAssetPath: '/vad/',
                        positiveSpeechThreshold: 0.6,
                        negativeSpeechThreshold: 0.3,
                        redemptionMs: 300,
                        startOnLoad: false,
                        onSpeechStart: () => {
                            // 静音时忽略 VAD 检测 — 不设录音状态、不触发 barge-in
                            if (optionsRef.current.isMuted) return;
                            // 闸门期间忽略 VAD（响铃时环境噪音不应打断缓冲的开场白）
                            if (gatedRef.current) return;
                            console.log('[Engine] VAD: speech start');
                            setIsUserSpeaking(true);
                            // 打断检查
                            if (engineStateRef.current === 'speaking') {
                                handleBargeIn();
                            }
                        },
                        onSpeechEnd: (audio: Float32Array) => {
                            // 静音时忽略 VAD 结束 — 丢弃音频，不走 STT
                            if (optionsRef.current.isMuted) return;
                            // 闸门期间忽略 VAD
                            if (gatedRef.current) return;
                            console.log('[Engine] VAD: speech end');
                            setIsUserSpeaking(false);

                            // ── 拼接模式：push 片段 + 重置去抖定时器 ──
                            if (!engineActiveRef.current) return;
                            if (Date.now() < ignoreUntilRef.current) return;

                            // 过短片段过滤
                            if (audio.length < 16000 * 0.3) {
                                console.log('[Engine] Voice segment too short, ignoring');
                                return;
                            }

                            pendingAudioSegmentsRef.current.push(audio);
                            console.log(`[Engine] Buffered segment ${pendingAudioSegmentsRef.current.length} (${(audio.length / 16000).toFixed(1)}s)`);

                            // 重置去抖定时器
                            if (sttDebounceTimerRef.current) {
                                clearTimeout(sttDebounceTimerRef.current);
                            }
                            sttDebounceTimerRef.current = setTimeout(() => {
                                sttDebounceTimerRef.current = null;
                                const segments = pendingAudioSegmentsRef.current;
                                pendingAudioSegmentsRef.current = [];

                                if (segments.length === 0) return;

                                // 拼接所有音频段
                                let totalLen = 0;
                                for (const seg of segments) totalLen += seg.length;
                                const concatenated = new Float32Array(totalLen);
                                let offset = 0;
                                for (const seg of segments) {
                                    concatenated.set(seg, offset);
                                    offset += seg.length;
                                }

                                console.log(`[Engine] Concat ${segments.length} segment(s) → ${(totalLen / 16000).toFixed(1)}s total`);
                                processConcatenatedAudio(concatenated, 16000);
                            }, STT_DEBOUNCE_MS);
                        },
                    });

                    vadRef.current = vad;
                    vad.start();
                    setVoiceInputMode('voice');
                } catch (error) {
                    console.warn('[Engine] VAD unavailable, falling back to text input:', error);
                    try { stream.getTracks().forEach(t => t.stop()); } catch { }
                    if (streamRef.current === stream) {
                        streamRef.current = null;
                    }
                    setIsUserSpeaking(false);
                    setVoiceInputMode('text-only');
                }
            } else {
                setVoiceInputMode('text-only');
            }

            setEngineState('listening');
            engineStateRef.current = 'listening';
            console.log('[Engine] Voice call engine started successfully');

            // ── 开场白触发（来电带向量检索，去电简单招呼）──
            console.log(`[Engine] Triggering AI opening greeting (isIncoming=${!!opts.isIncoming})`);
            setTimeout(async () => {
                if (!engineActiveRef.current) return;

                // ── 来电（AI 主叫）：用 callReason 做向量记忆检索 ──
                if (opts.embeddingApiKey && opts.char.vectorMemoryEnabled && llmRef.current) {
                    try {
                        const history = llmRef.current.getHistory();
                        const msgs = buildVoiceCallRetrievalMessages(
                            recentContextMessagesRef.current,
                            history,
                            opts.char.id,
                            opts.callReason,
                        );
                        const memBlock = await VectorMemoryRetriever.retrieve(
                            opts.char.id,
                            opts.char.name,
                            opts.userProfile.name,
                            msgs,
                            opts.embeddingApiKey,
                            opts.apiConfig,
                            opts.char.moodState as any,
                        );
                        if (memBlock && engineActiveRef.current && llmRef.current) {
                            llmRef.current.setVectorMemoryBlock(memBlock);
                            console.log(`[🧠 VoiceCall] Opening vector memory injected: ${memBlock.length} chars`);
                        }
                    } catch (err) {
                        console.warn('[🧠 VoiceCall] Opening vector retrieval failed (non-fatal):', err);
                    }
                }

                if (engineActiveRef.current) {
                    processUserMessage('[系统：电话接通，请说开场白]', 'system');
                }
            }, 300);
        } catch (err: any) {
            console.error('[Engine] Failed to start:', err);
            engineActiveRef.current = false;
            try { vadRef.current?.destroy?.(); } catch { }
            vadRef.current = null;
            playerRef.current?.destroy();
            playerRef.current = null;
            ttsWsRef.current?.close();
            ttsWsRef.current = null;
            llmRef.current?.abort();
            llmRef.current = null;
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            opts.onError?.(err.message || '语音引擎启动失败');
            setEngineState('idle');
            engineStateRef.current = 'idle';
        }
    }, [processConcatenatedAudio, handleBargeIn, processUserMessage]);

    // ─── 停止引擎 ──────────────────────────────────────────────────

    /** 上次通话的对话历史（通话结束后由 stopEngine 填充，assistant 消息携带 audioBlob） */
    const lastCallHistoryRef = useRef<{ role: string; content: string; audioBlob?: Blob }[]>([]);

    const stopEngine = useCallback(() => {
        console.log('[Engine] Stopping voice call engine...');
        engineActiveRef.current = false;
        // 保存当前 gen（最后一轮的 turnId），再递增
        const lastGen = generationRef.current;
        generationRef.current++;

        // ── 打包最后一轮未完成的 PCM（如果用户在 AI 说话中途挂断）──
        if (runtimeProfileRef.current.persistAssistantAudio && turnAudioChunksRef.current.length > 0) {
            try {
                const wavBlob = pcmChunksToWavBlob(
                    turnAudioChunksRef.current,
                    runtimeProfileRef.current.ttsSampleRate,
                );
                turnAudioBlobsRef.current.set(lastGen, wavBlob);
                console.log(`[Engine] Final turn audio cached (gen=${lastGen}): ${(wavBlob.size / 1024).toFixed(1)}KB`);
            } catch (e) {
                console.warn('[Engine] Failed to cache final turn audio:', e);
            }
            turnAudioChunksRef.current = [];
        }

        // 清空语音拼接缓冲 + 取消去抖定时器
        pendingAudioSegmentsRef.current = [];
        if (sttDebounceTimerRef.current) {
            clearTimeout(sttDebounceTimerRef.current);
            sttDebounceTimerRef.current = null;
        }

        // 停止 VAD
        if (vadRef.current) {
            try { vadRef.current.destroy(); } catch { }
            vadRef.current = null;
        }

        // 停止音频播放
        playerRef.current?.destroy();
        playerRef.current = null;

        // 关闭 TTS WebSocket
        ttsWsRef.current?.close();
        ttsWsRef.current = null;

        // 提取对话历史（必须在 abort/清理 llm 之前）
        const rawHistory = llmRef.current?.getHistory() ?? [];

        // ── 将缓存的 WAV Blob 按 turnId 精确映射到 assistant 消息上 ──
        const audioBlobMap = turnAudioBlobsRef.current;
        let blobCount = 0;
        lastCallHistoryRef.current = rawHistory.map(h => {
            if (h.role === 'assistant' && h.turnId !== undefined) {
                const blob = audioBlobMap.get(h.turnId);
                if (blob) blobCount++;
                return { role: h.role, content: h.content, audioBlob: blob };
            }
            return { role: h.role, content: h.content };
        });
        turnAudioBlobsRef.current = new Map();
        recentContextMessagesRef.current = [];
        console.log(`[Engine] Call history: ${rawHistory.length} turns, ${blobCount} audio blobs attached (map size was ${audioBlobMap.size})`);

        // 中止 LLM
        llmRef.current?.abort();
        llmRef.current = null;

        // 释放麦克风
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }

        setEngineState('idle');
        engineStateRef.current = 'idle';
        setIsUserSpeaking(false);
        setVoiceInputMode(runtimeProfileRef.current.voiceInputMode);
        console.log('[Engine] Voice call engine stopped');
    }, []);

    // 组件卸载时自动清理
    useEffect(() => {
        return () => {
            if (engineActiveRef.current) {
                engineActiveRef.current = false;
                generationRef.current++;
                vadRef.current?.destroy?.();
                playerRef.current?.destroy();
                ttsWsRef.current?.close();
                llmRef.current?.abort();
                streamRef.current?.getTracks().forEach(t => t.stop());
                vadRef.current = null;
                playerRef.current = null;
                ttsWsRef.current = null;
                llmRef.current = null;
                streamRef.current = null;
            }
        };
    }, []);

    // ── 开闸：释放闸门期间缓冲的音频 ──
    const releaseGate = useCallback(() => {
        if (!gatedRef.current) return;
        console.log('[Engine] Releasing playback gate');
        gatedRef.current = false;
        const player = playerRef.current;
        if (player) {
            player.releaseGate();
            // 如果有缓冲内容，触发 speaking 状态
            if (player.isPlaying) {
                optionsRef.current.onAISpeakingChange(true);
            }
        }
    }, []);

    return {
        startEngine,
        stopEngine,
        releaseGate,
        lastCallHistory: lastCallHistoryRef,
        sendTextMessage,
        engineState,
        isUserSpeaking,
        transcript,
        aiResponse,
        ttsDegraded,
        transcriptSource,
        lowMemoryMode: runtimeProfile.lowMemoryMode,
        voiceInputMode,
        // ─── 通话质量反馈 ───
        sttEmptyHint,
        // ─── 外语模式 (Foreign Language) ───
        aiTranslation,
        subtitleHistory,
        // ─── 音量控制 ───
        volume,
        setVolume,
    };
}
