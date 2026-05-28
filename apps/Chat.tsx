import React,{ useState,useEffect,useRef,useLayoutEffect,useMemo,useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Message,MessageType,MemoryFragment,Emoji,EmojiCategory,AppID,YesterdayNewspaperPeriodType,YesterdayNewspaperRecord,type ManualPhotoGenerationOptions,type PhotoDirectorResult,type PhotoHintTrigger,type PhotoMeta,type PhotoStylePreset,type SavedVibeEncoding,type SavedVibeReference,type VibeReferenceInput } from '../types';
import { processImage } from '../utils/file';
import { safeResponseJson } from '../utils/safeApi';
import { parseBilingual } from '../utils/chatParser';
import { XhsMcpClient,normalizeNote } from '../utils/xhsMcpClient';
import { unlockAudio } from './voicecall/unlockAudio';
import MessageItem from '../components/chat/MessageItem';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import { DEFAULT_ARCHIVE_PROMPTS } from '../constants/archivePrompts';
import { THINKING_CHAIN_UI_ENABLED } from '../constants';
import ChatHeader from '../components/chat/ChatHeader';
import ChatInputArea from '../components/chat/ChatInputArea';
import ChatModals from '../components/chat/ChatModals';
import {
    YesterdayNewspaperDeliveryStack,
    YesterdayNewspaperModal,
} from '../components/chat/newspaper/YesterdayNewspaper';
import Modal from '../components/os/Modal';
import { useChatAI } from '../hooks/useChatAI';
import { useVoiceTts } from '../hooks/useVoiceTts';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { CloudStt,SttNotConfiguredError } from '../utils/cloudStt';
import { haptic } from '../utils/haptics';
import { withCharacterTtsVoice } from '../utils/characterTts';
import { getEffectiveHistoryStartMessageId,isAfterHistoryStart } from '../utils/historyStart';
import { shouldHideLifeStreamLikeMessage } from '../utils/lifeStreamVisibility';
import {
  BackendAgentManager,
  AGENT_MESSAGE_SAVED_EVENT_NAME,
  type AgentMessageSavedEventDetail,
} from '../utils/autonomousAgent';
import {
  ensureAgentTodayLife,
  fetchAgentTodaySchedule,
  saveAgentScheduleRevision,
  TODAY_SCHEDULE_UPDATED_EVENT_NAME,
  type AgentApiConfig,
  type AgentTodayScheduleState,
} from '../utils/agentBackendClient';
import {
    buildManualPhotoPrompt,
    buildPhotoContextSummary,
    buildPhotoPromptFromDirector,
    createPhotoMeta,
    generatePhotoImage,
    getCompatiblePhotoStylePresets,
    isImageGenerationConfigured,
    NO_PHOTO_STYLE_PRESET,
    NO_PHOTO_STYLE_PRESET_ID,
    resolvePhotoStylePreset,
    runManualPhotoDirector,
    runPhotoDirector,
    shouldIncludeUserAppearanceForPhoto,
} from '../utils/photoGeneration';
import { DEFAULT_IMAGE_GENERATION_CONFIG, selectSecondaryApiConfig } from '../utils/runtimeConfig';
import {
    buildSavedVibeFromImage,
    buildVibeInputFromSaved,
    getSavedVibeEncoding,
    parseNaiv4VibeFile,
} from '../utils/vibeReferences';
import { prepareGeneratedImageStorage } from '../utils/generatedImageStorage';
import type { SecondaryFullContextOptions } from '../utils/mindSnapshotExtractor';
import { buildLifeProfileContextSnapshot } from '../utils/lifeProfileContextSnapshot';
import { formatMemoryArchiveLine,selectMessagesForMemoryArchive } from '../utils/archiveMessageSelector';
import {
    getCalendarDisplayLabels,
    loadCalendarContextForCharacter,
    type CalendarContext,
} from '../utils/calendarContext';
import {
    ensureYesterdayNewspaper,
    getCurrentNewspaperPeriods,
    getCurrentYesterdayNewspaper,
    markCurrentYesterdayNewspaperOpened,
} from '../utils/yesterdayNewspaper';

const DATE_WORLDLINE_ORB_ENABLED: boolean = false;
const DateWorldlineOrb = DATE_WORLDLINE_ORB_ENABLED
    ? React.lazy(() => import('../components/chat/DateWorldlineOrb'))
    : null;

function toAgentApiConfig(value: unknown): AgentApiConfig | undefined {
    const record = value as Partial<AgentApiConfig> | undefined;
    if (!record?.baseUrl || !record.apiKey || !record.model) return undefined;
    return {
        baseUrl: record.baseUrl,
        apiKey: record.apiKey,
        model: record.model,
    };
}

function isMainChatVisibleMessage(message: Message): boolean {
    if (message.metadata?.hiddenFromUser) return false;
    const source = message.metadata?.source;
    return source !== 'date' && source !== 'theater';
}

const CHAT_HISTORY_RAW_WINDOW_MAX = 1500;
const EMPTY_PHOTO_STYLE_PRESETS: PhotoStylePreset[] = [];

function compareMessageDisplayOrder(a: Message, b: Message): number {
    const timestampDelta = (a.timestamp || 0) - (b.timestamp || 0);
    if (timestampDelta !== 0) return timestampDelta;
    return a.id - b.id;
}

function matchesCharacterId(character: { id: string; charInstanceId?: string }, id?: string | null): boolean {
    if (!id) return false;
    return character.id === id || character.charInstanceId === id;
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function getImageReplySummary(message: Message): string {
    const metadata = message.metadata || {};
    const photoMeta = metadata.photoMeta || {};
    const director = photoMeta.directorResult || {};
    return readString(metadata.visualSummary)
        || readString(metadata.caption)
        || readString(metadata.description)
        || readString(metadata.ocrText)
        || readString(photoMeta.continuity_summary)
        || readString(director.caption)
        || readString(director.scene_zh);
}

function getReplyPreviewText(message: Message): string {
    if (message.type === 'image') {
        return '[图片]';
    }
    if (message.type === 'emoji') return '[表情]';
    if (message.type === 'voice') {
        const sourceText = readString(message.metadata?.sourceText) || readString(message.content);
        return sourceText ? `[语音] ${sourceText}` : '[语音]';
    }
    return message.content;
}

function buildReplyToPayload(message: Message, assistantName: string): NonNullable<Message['replyTo']> {
    const imageSummary = message.type === 'image' ? getImageReplySummary(message) : '';
    const imageUrl = message.type === 'image'
        ? readString(message.metadata?.thumbnailUrl) || readString(message.content)
        : undefined;

    return {
        id: message.id,
        content: getReplyPreviewText(message),
        name: message.role === 'user' ? '我' : assistantName,
        type: message.type,
        thumbnailUrl: message.type === 'image' ? readString(message.metadata?.thumbnailUrl) || undefined : undefined,
        imageUrl,
        visualSummary: imageSummary || undefined,
    };
}

function getDisplayableMainChatMessages(
    messages: Message[],
    options: {
        hideBeforeMessageId?: number;
        hideSystemLogs?: boolean;
    },
): Message[] {
    const historyStartMessageId = getEffectiveHistoryStartMessageId(messages, options.hideBeforeMessageId);
    return messages
        .filter(isMainChatVisibleMessage)
        .filter(m => (m.type as string) !== 'health_signal')
        .filter(m => !shouldHideLifeStreamLikeMessage(m))
        .filter(m => isAfterHistoryStart(m, historyStartMessageId))
        .filter(m => {
            if (m.metadata?.source === 'story_phone') return true;
            if (options.hideSystemLogs && m.role === 'system' && m.type !== 'call_log') return false;
            return true;
        });
}

type ScopedAgentTodayScheduleState = AgentTodayScheduleState & {
    charId: string;
};

const chatTodayScheduleEnabledKey = (charId: string) => `chat_today_schedule_enabled_${charId}`;
const chatNewspaperEnabledKey = (charId: string) => `chat_private_newspaper_enabled_${charId}`;

const readChatFeatureToggle = (key: string) => {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

const writeChatFeatureToggle = (key: string, value: boolean) => {
    try {
        localStorage.setItem(key, value ? 'true' : 'false');
    } catch {
        // localStorage may be unavailable in private contexts; keep runtime state working.
    }
};

const Chat: React.FC = () => {
    const { characters, activeCharacterId, setActiveCharacterId, updateCharacter, apiConfig, closeApp, openApp, appParams, customThemes, removeCustomTheme, addToast, userProfile, updateUserProfile, lastMsgTimestamp, groups, clearUnread, realtimeConfig, ttsConfig, sttConfig, imageGenerationConfig, photoStylePresets, isDataLoaded } = useOS();
    const [messages, setMessages] = useState<Message[]>([]);
    const [hasMoreHistory, setHasMoreHistory] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [todayLifeSyncText, setTodayLifeSyncText] = useState('');
    const [todayLifeSyncTone, setTodayLifeSyncTone] = useState<'soft' | 'ready'>('soft');
    const [todaySchedule, setTodaySchedule] = useState<ScopedAgentTodayScheduleState | null>(null);
    const [calendarContext, setCalendarContext] = useState<CalendarContext | null>(null);
    const [isTodayScheduleOpen, setIsTodayScheduleOpen] = useState(false);
    const [isTodayScheduleLoading, setIsTodayScheduleLoading] = useState(false);
    const [showManualScheduleForm, setShowManualScheduleForm] = useState(false);
    const [manualScheduleSaving, setManualScheduleSaving] = useState(false);
    const [isTodayScheduleEntryHidden, setIsTodayScheduleEntryHidden] = useState(false);
    const [todayScheduleFeatureEnabled, setTodayScheduleFeatureEnabled] = useState(() => (
        activeCharacterId ? readChatFeatureToggle(chatTodayScheduleEnabledKey(activeCharacterId)) : false
    ));
    const [newspaperFeatureEnabled, setNewspaperFeatureEnabled] = useState(() => (
        activeCharacterId ? readChatFeatureToggle(chatNewspaperEnabledKey(activeCharacterId)) : false
    ));
    const [yesterdayNewspaperRecords, setYesterdayNewspaperRecords] = useState<YesterdayNewspaperRecord[]>([]);
    const [activeNewspaperRecordId, setActiveNewspaperRecordId] = useState<string | null>(null);
    const [isYesterdayNewspaperOpen, setIsYesterdayNewspaperOpen] = useState(false);
    const [manualScheduleDraft, setManualScheduleDraft] = useState({
        startTime: '',
        endTime: '',
        timeHint: '',
        title: '',
        description: '',
        reason: '',
        innerVoice: '',
    });
    const [visibleCount, setVisibleCount] = useState(30);
    const [input, setInput] = useState('');
    const [showPanel, setShowPanel] = useState<'none' | 'actions' | 'emojis' | 'chars'>('none');

    // Emoji State
    const [emojis, setEmojis] = useState<Emoji[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('default');
    const [newCategoryName, setNewCategoryName] = useState('');

    const scrollRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const lastMsgIdRef = useRef<number | null>(null);
    const scrollThrottleRef = useRef(0);
    const visibleCountRef = useRef(30);
    const activeCharIdRef = useRef(activeCharacterId);
    const currentChatCharIdRef = useRef<string | undefined>(activeCharacterId || undefined);
    const consumedTargetRef = useRef('');
    const pendingTargetScrollRef = useRef(false);
    const messagesRef = useRef<Message[]>(messages);
    const pendingGeneratedImageMessagesRef = useRef<Map<number, Message>>(new Map());
    const todayLifeEnsureSeqRef = useRef(0);
    const todayScheduleRequestSeqRef = useRef(0);
    const todayLifeSlowTimerRef = useRef<number | null>(null);
    const todayLifeHideTimerRef = useRef<number | null>(null);
    const lastTodayLifeEnsureKeyRef = useRef('');
    const yesterdayNewspaperSeqRef = useRef(0);
    const draftPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDraftPersistRef = useRef<{ key: string; value: string } | null>(null);
    const openingStoryPhoneMsgIdsRef = useRef<Set<number>>(new Set());
    const photoHintHandlerRef = useRef<((payload: PhotoHintTrigger) => void) | null>(null);
    const manualPhotoInFlightRef = useRef(false);
    const autoPhotoInFlightRef = useRef<Set<string>>(new Set());
    messagesRef.current = messages;

    // Reply Logic
    const [replyTarget, setReplyTarget] = useState<Message | null>(null);

    const [modalType, setModalType] = useState<'none' | 'transfer' | 'emoji-import' | 'chat-settings' | 'manual-photo' | 'message-options' | 'edit-message' | 'delete-emoji' | 'delete-category' | 'add-category' | 'history-manager' | 'archive-settings' | 'prompt-editor' | 'category-options' | 'category-visibility'>('none');
    const [allHistoryMessages, setAllHistoryMessages] = useState<Message[]>([]);
    const [transferAmt, setTransferAmt] = useState('');
    const [emojiImportText, setEmojiImportText] = useState('');
    const [settingsContextLimit, setSettingsContextLimit] = useState(500);
    const [settingsHideSysLogs, setSettingsHideSysLogs] = useState(false);
    const [preserveContext, setPreserveContext] = useState(true);
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<Emoji | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<EmojiCategory | null>(null); // For deletion modal
    const [editContent, setEditContent] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [transferActionMsg, setTransferActionMsg] = useState<Message | null>(null);
    const [manualPhotoGenerating, setManualPhotoGenerating] = useState(false);
    const [savedVibeReferences, setSavedVibeReferences] = useState<SavedVibeReference[]>([]);

    // Archive Prompts State
    const [archivePrompts, setArchivePrompts] = useState<{ id: string, name: string, content: string }[]>(DEFAULT_ARCHIVE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');
    const [editingPrompt, setEditingPrompt] = useState<{ id: string, name: string, content: string } | null>(null);

    // --- Multi-Select State ---
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

    // --- Soul Reflection State ---
    const [showSoulReflectionPanel, setShowSoulReflectionPanel] = useState(false);
    const [soulReflectionFeedback, setSoulReflectionFeedback] = useState('');
    const [isSoulReflecting, setIsSoulReflecting] = useState(false);
    const [soulReflectionResult, setSoulReflectionResult] = useState<{ reflection: string; anchors: string; mirrorSnippets: string[] } | null>(null);

    // --- Translation State (per-character toggle, global language settings) ---
    const [translationEnabled, setTranslationEnabled] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [translateSourceLang, setTranslateSourceLang] = useState(() => {
        return localStorage.getItem('chat_translate_source_lang') || '日本語';
    });
    const [translateTargetLang, setTranslateTargetLang] = useState(() => {
        return localStorage.getItem('chat_translate_lang') || '中文';
    });
    // Which messages are currently showing "译" version (toggle state only, no API calls)
    const [showingTargetIds, setShowingTargetIds] = useState<Set<number>>(new Set());

    // --- Timestamp State (per-character, theme can force-enable) ---
    const [showTimestampSetting, setShowTimestampSetting] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_show_timestamp_${activeCharacterId}`) || 'false'); } catch { return false; }
    });

    // --- Voice TTS State ---
    const { playingMsgId, loadingMsgIds, playVoice, stopVoice, synthesizeForMessage } = useVoiceTts();
    const [autoTts, setAutoTts] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_auto_tts_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [autoCall, setAutoCall] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_auto_call_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [autoShareSong, setAutoShareSong] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_auto_share_song_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [injectPlaybackContext, setInjectPlaybackContext] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_inject_playback_context_${activeCharacterId}`) || 'false'); } catch { return false; }
    });

    // --- Voice Recording (STT) ---
    const voiceRecorder = useVoiceRecorder();
    const [sttProcessing, setSttProcessing] = useState(false);
    // --- Voice transcript expansion (inline "转文字") ---
    const [expandedVoiceTextIds, setExpandedVoiceTextIds] = useState<Set<number>>(new Set());

    // --- Rerank Trial Key Exhaustion ---
    const [showRerankUpgradeModal, setShowRerankUpgradeModal] = useState(false);
    const [rerankUpgradeStep, setRerankUpgradeStep] = useState<1 | 2>(1); // 1 = first confirm, 2 = second confirm

    // 录音错误可视化 — 移动端 title 属性不显示，需要 toast
    useEffect(() => {
        if (voiceRecorder.error) {
            addToast(voiceRecorder.error, 'error');
        }
    }, [voiceRecorder.error]);

    const matchedChar = activeCharacterId
        ? characters.find(c => matchesCharacterId(c, activeCharacterId))
        : undefined;
    const char = matchedChar || (isDataLoaded ? characters[0] : undefined);
    currentChatCharIdRef.current = char?.id;
    const currentThemeId = char?.bubbleStyle || 'default';
    const effectiveImageGenerationConfig = imageGenerationConfig || DEFAULT_IMAGE_GENERATION_CONFIG;
    const effectivePhotoStylePresets = photoStylePresets || EMPTY_PHOTO_STYLE_PRESETS;
    const activePhotoStylePresets = useMemo(() => {
        const compatibleStyles = getCompatiblePhotoStylePresets(effectivePhotoStylePresets, effectiveImageGenerationConfig.activeProvider)
            .filter(style => style.id !== NO_PHOTO_STYLE_PRESET_ID);
        return [NO_PHOTO_STYLE_PRESET, ...compatibleStyles];
    }, [effectivePhotoStylePresets, effectiveImageGenerationConfig.activeProvider]);
    const refreshSavedVibeReferences = useCallback(async () => {
        const vibes = await DB.getSavedVibeReferences();
        setSavedVibeReferences(vibes);
    }, []);

    useEffect(() => {
        if (!isDataLoaded) return;
        void refreshSavedVibeReferences().catch(error => console.warn('[Vibe] failed to load saved references:', error));
    }, [isDataLoaded, refreshSavedVibeReferences]);

    const activeTheme = useMemo(() => customThemes.find(t => t.id === currentThemeId) || PRESET_THEMES[currentThemeId] || PRESET_THEMES.default, [currentThemeId, customThemes]);
    const characterTtsConfig = useMemo(
        () => ttsConfig && char ? withCharacterTtsVoice(ttsConfig, char) : ttsConfig,
        [ttsConfig, char?.id, char?.ttsVoiceId],
    );
    const handleOpenStoryPhone = useCallback((sourceMessage: Message) => {
        if (!char?.id || !sourceMessage?.id) return;
        if (sourceMessage.metadata?.storyPhoneConsumed || openingStoryPhoneMsgIdsRef.current.has(sourceMessage.id)) return;

        openingStoryPhoneMsgIdsRef.current.add(sourceMessage.id);
        const metadataUpdates = {
            storyPhoneConsumed: true,
            storyPhoneConsumedAt: Date.now(),
        };

        setMessages(prev => prev.map(message => (
            message.id === sourceMessage.id
                ? { ...message, metadata: { ...(message.metadata || {}), ...metadataUpdates } }
                : message
        )));

        DB.updateMessageMetadata(sourceMessage.id, metadataUpdates)
            .then(() => {
                openApp(AppID.StoryPhone, {
                    targetCharId: char.id,
                    returnApp: AppID.Chat,
                    sourceMessageId: sourceMessage.id,
                });
            })
            .catch(error => {
                console.error('[StoryPhone] consume marker failed:', error);
                openingStoryPhoneMsgIdsRef.current.delete(sourceMessage.id);
                setMessages(prev => prev.map(message => {
                    if (message.id !== sourceMessage.id) return message;
                    const metadata = { ...(message.metadata || {}) };
                    delete metadata.storyPhoneConsumed;
                    delete metadata.storyPhoneConsumedAt;
                    return { ...message, metadata };
                }));
                addToast('查手机入口标记失败，请再试一次', 'error');
            });
    }, [char?.id, openApp, addToast]);

    const clearTodayLifeTimers = useCallback(() => {
        if (todayLifeSlowTimerRef.current !== null) {
            window.clearTimeout(todayLifeSlowTimerRef.current);
            todayLifeSlowTimerRef.current = null;
        }
        if (todayLifeHideTimerRef.current !== null) {
            window.clearTimeout(todayLifeHideTimerRef.current);
            todayLifeHideTimerRef.current = null;
        }
    }, []);

    const buildTodayLifeContextSnapshot = useCallback(async () => {
        if (!char) return null;
        const baseSnapshot = await buildLifeProfileContextSnapshot(char, userProfile.name);
        const recentMessages = messagesRef.current
            .filter(message => message.role === 'user' || message.role === 'assistant')
            .slice(-14)
            .map(message => ({
                id: message.id,
                role: message.role,
                content: (message.content || '').slice(0, 1200),
                timestamp: message.timestamp,
            }));
        return {
            ...baseSnapshot,
            recentMessages,
        };
    }, [char, userProfile.name]);

    const refreshCalendarContext = useCallback(async () => {
        if (!char?.id || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) {
            setCalendarContext(null);
            return;
        }
        const charIdAtStart = char.id;
        const result = await loadCalendarContextForCharacter(charIdAtStart);
        if (currentChatCharIdRef.current !== charIdAtStart) return;
        setCalendarContext(result);
    }, [char?.id]);

    const refreshTodaySchedule = useCallback(async (visible = false) => {
        if (!char || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) return;
        const charIdAtStart = char.id;
        const requestSeq = todayScheduleRequestSeqRef.current + 1;
        todayScheduleRequestSeqRef.current = requestSeq;
        void refreshCalendarContext();
        if (visible) setIsTodayScheduleLoading(true);
        try {
            const result = await fetchAgentTodaySchedule(charIdAtStart);
            if (currentChatCharIdRef.current !== charIdAtStart || todayScheduleRequestSeqRef.current !== requestSeq) return;
            setTodaySchedule({ ...result, charId: charIdAtStart });
        } catch (error) {
            if (currentChatCharIdRef.current !== charIdAtStart || todayScheduleRequestSeqRef.current !== requestSeq) return;
            if (visible) {
                addToast('今日行程暂时没有接上，可以稍后再看。', 'info');
            } else {
                console.warn('[Chat] Today schedule fetch failed:', error instanceof Error ? error.message : error);
            }
        } finally {
            if (visible && currentChatCharIdRef.current === charIdAtStart) {
                setIsTodayScheduleLoading(false);
            }
        }
    }, [addToast, char, refreshCalendarContext]);

    const handleOpenTodaySchedule = useCallback(() => {
        if (!char?.id || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) return;
        setIsTodayScheduleOpen(true);
        void refreshTodaySchedule(true);
    }, [char?.id, refreshTodaySchedule]);

    const handleSaveManualSchedule = useCallback(async () => {
        if (!char) return;
        const charIdAtStart = char.id;
        const title = manualScheduleDraft.title.trim();
        const description = manualScheduleDraft.description.trim();
        const timeHint = manualScheduleDraft.timeHint.trim() || '稍后';
        if (!title && !description) {
            addToast('先写一点这段行程的内容。', 'info');
            return;
        }

        setManualScheduleSaving(true);
        try {
            const contextSnapshot = await buildTodayLifeContextSnapshot();
            const result = await saveAgentScheduleRevision(charIdAtStart, {
                changeType: 'insert',
                newSchedule: {
                    startTime: manualScheduleDraft.startTime.trim() || undefined,
                    endTime: manualScheduleDraft.endTime.trim() || undefined,
                    timeHint,
                    title: title || '新的安排',
                    description: description || title,
                    mode: 'loose',
                },
                reason: manualScheduleDraft.reason.trim() || '由你手动写入今日行程。',
                innerVoice: manualScheduleDraft.innerVoice.trim(),
            }, contextSnapshot || undefined);
            if (currentChatCharIdRef.current !== charIdAtStart) return;
            setTodaySchedule({ ...result, charId: charIdAtStart });
            setShowManualScheduleForm(false);
            setManualScheduleDraft({ startTime: '', endTime: '', timeHint: '', title: '', description: '', reason: '', innerVoice: '' });
            addToast('今日行程已写入。', 'success');
        } catch (error) {
            addToast('这段行程暂时没能写入，可以稍后再试。', 'info');
            console.warn('[Chat] Manual schedule revision failed:', error instanceof Error ? error.message : error);
        } finally {
            setManualScheduleSaving(false);
        }
    }, [addToast, buildTodayLifeContextSnapshot, char, manualScheduleDraft]);

    const syncTodayLife = useCallback(async (visible: boolean) => {
        if (!char || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) return;
        const charIdAtStart = char.id;
        const recentKey = messagesRef.current
            .filter(message => message.role === 'user' || message.role === 'assistant')
            .slice(-8)
            .map(message => `${message.id}:${message.timestamp}`)
            .join('|');
        const requestKey = `${charIdAtStart}:${recentKey}`;
        if (!visible && lastTodayLifeEnsureKeyRef.current === requestKey) return;
        lastTodayLifeEnsureKeyRef.current = requestKey;

        let seq = todayLifeEnsureSeqRef.current;
        if (visible) {
            seq = todayLifeEnsureSeqRef.current + 1;
            todayLifeEnsureSeqRef.current = seq;
            clearTodayLifeTimers();
            setTodayLifeSyncTone('soft');
            setTodayLifeSyncText('正在靠近 ta 今天的此刻...');
            todayLifeSlowTimerRef.current = window.setTimeout(() => {
                if (todayLifeEnsureSeqRef.current === seq) {
                    setTodayLifeSyncText('今日行程还在整理，你可以先和 ta 说话。');
                }
            }, 3000);
        }

        try {
            const contextSnapshot = await buildTodayLifeContextSnapshot();
            if (currentChatCharIdRef.current !== charIdAtStart) return;
            if (!contextSnapshot) return;
            const result = await ensureAgentTodayLife(charIdAtStart, contextSnapshot, {
                mainApiConfig: toAgentApiConfig(apiConfig),
            });
            if (currentChatCharIdRef.current !== charIdAtStart) return;
            if (visible) {
                if (todayLifeEnsureSeqRef.current !== seq) return;
                clearTodayLifeTimers();
                const isReady = result.status === 'ready';
                setTodayLifeSyncTone(isReady ? 'ready' : 'soft');
                setTodayLifeSyncText(isReady ? '今日行程已同步' : '今日行程暂时没有接上，可以稍后再看。');
                todayLifeHideTimerRef.current = window.setTimeout(() => {
                    if (todayLifeEnsureSeqRef.current === seq) {
                        setTodayLifeSyncText('');
                    }
                }, 2600);
            }
            if (result.status === 'ready') {
                void refreshTodaySchedule(false);
            }
        } catch (error) {
            if (visible && todayLifeEnsureSeqRef.current === seq) {
                clearTodayLifeTimers();
                setTodayLifeSyncTone('soft');
                setTodayLifeSyncText('今天的生活状态会先轻轻接上。');
                todayLifeHideTimerRef.current = window.setTimeout(() => {
                    if (todayLifeEnsureSeqRef.current === seq) {
                        setTodayLifeSyncText('');
                    }
                }, 2600);
            }
            if (!visible) {
                console.warn('[Chat] Today life sync failed:', error instanceof Error ? error.message : error);
            }
        }
    }, [apiConfig, buildTodayLifeContextSnapshot, char, clearTodayLifeTimers, refreshTodaySchedule]);

    const activeNewspaperRecord = useMemo(
        () => yesterdayNewspaperRecords.find(record => record.id === activeNewspaperRecordId) || null,
        [activeNewspaperRecordId, yesterdayNewspaperRecords],
    );
    const isYesterdayNewspaperGenerating = useMemo(
        () => yesterdayNewspaperRecords.some(record => record.status === 'generating'),
        [yesterdayNewspaperRecords],
    );

    const refreshYesterdayNewspaper = useCallback(async (
        forceRegenerate = false,
        targetPeriod?: YesterdayNewspaperPeriodType,
    ) => {
        if (!isDataLoaded || !char || !readChatFeatureToggle(chatNewspaperEnabledKey(char.id))) return;
        const charIdAtStart = char.id;
        const requestSeq = yesterdayNewspaperSeqRef.current + 1;
        yesterdayNewspaperSeqRef.current = requestSeq;
        const allPeriods = getCurrentNewspaperPeriods();
        const periods = targetPeriod
            ? allPeriods.filter(period => period.periodType === targetPeriod)
            : allPeriods.filter(period => period.periodType === 'daily');
        const periodOrder = new Map(allPeriods.map((period, index) => [period.periodType, index]));
        const mergeRecords = (records: YesterdayNewspaperRecord[]) => {
            setYesterdayNewspaperRecords(prev => {
                const map = new Map<YesterdayNewspaperPeriodType, YesterdayNewspaperRecord>();
                prev
                    .filter(record => record.charId === charIdAtStart)
                    .forEach(record => map.set(record.periodType || 'daily', record));
                records.forEach(record => map.set(record.periodType || 'daily', record));
                return Array.from(map.values())
                    .sort((a, b) => (periodOrder.get(a.periodType || 'daily') ?? 99) - (periodOrder.get(b.periodType || 'daily') ?? 99));
            });
        };
        const createPendingRecord = (period: typeof periods[number]): YesterdayNewspaperRecord => ({
            id: `pending-${charIdAtStart}-${period.periodType}-${period.date}`,
            ownerUserId: '',
            charId: charIdAtStart,
            date: period.date,
            periodType: period.periodType,
            status: 'generating',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        try {
            const existingRecords = await Promise.all(
                periods.map(period => getCurrentYesterdayNewspaper(charIdAtStart, period.periodType)),
            );
            if (currentChatCharIdRef.current !== charIdAtStart || yesterdayNewspaperSeqRef.current !== requestSeq) return;

            const initialRecords = periods.map((period, index) => {
                const existing = existingRecords[index];
                if (existing && !forceRegenerate) return existing;
                return createPendingRecord(period);
            });
            mergeRecords(initialRecords);

            const usableApiConfig = apiConfig?.baseUrl && apiConfig?.model ? apiConfig : null;
            for (const period of periods) {
                const existing = existingRecords.find(record => (record?.periodType || 'daily') === period.periodType);
                if (existing && !forceRegenerate && existing.status === 'failed') {
                    continue;
                }
                const record = await ensureYesterdayNewspaper({
                    char,
                    userProfile,
                    apiConfig: usableApiConfig,
                    forceRegenerate,
                    periodType: period.periodType,
                });
                if (currentChatCharIdRef.current !== charIdAtStart || yesterdayNewspaperSeqRef.current !== requestSeq) return;
                mergeRecords([record]);
            }
        } catch (error) {
            if (currentChatCharIdRef.current !== charIdAtStart || yesterdayNewspaperSeqRef.current !== requestSeq) return;
            console.warn('[Chat] Yesterday newspaper failed:', error instanceof Error ? error.message : error);
            mergeRecords(periods.map(period => ({
                ...createPendingRecord(period),
                status: 'failed',
                error: error instanceof Error ? error.message : '昨日来信生成失败',
                updatedAt: Date.now(),
            })));
        }
    }, [
        apiConfig?.apiKey,
        apiConfig?.baseUrl,
        apiConfig?.model,
        char?.id,
        isDataLoaded,
        userProfile.avatar,
        userProfile.bio,
        userProfile.name,
    ]);

    const handleOpenYesterdayNewspaper = useCallback((record: YesterdayNewspaperRecord) => {
        if (!char?.id || !record.content) return;
        setActiveNewspaperRecordId(record.id);
        setIsYesterdayNewspaperOpen(true);
        markCurrentYesterdayNewspaperOpened(char.id, record.periodType || 'daily')
            .then(updated => {
                if (updated && currentChatCharIdRef.current === char.id) {
                    setYesterdayNewspaperRecords(prev => prev.map(item => item.id === record.id ? updated : item));
                }
            })
            .catch(error => {
                console.warn('[Chat] Failed to mark newspaper opened:', error instanceof Error ? error.message : error);
            });
    }, [char?.id]);

    const handleRetryYesterdayNewspaper = useCallback((record: YesterdayNewspaperRecord) => {
        void refreshYesterdayNewspaper(true, record.periodType || 'daily');
    }, [refreshYesterdayNewspaper]);

    const handleRefreshActiveNewspaper = useCallback(() => {
        if (!activeNewspaperRecord) return;
        setIsYesterdayNewspaperOpen(false);
        void refreshYesterdayNewspaper(true, activeNewspaperRecord.periodType || 'daily');
    }, [activeNewspaperRecord, refreshYesterdayNewspaper]);

    const handleGenerateNewspaperPeriod = useCallback((periodType: YesterdayNewspaperPeriodType) => {
        if (!newspaperFeatureEnabled || isYesterdayNewspaperGenerating) return;
        void refreshYesterdayNewspaper(true, periodType);
    }, [isYesterdayNewspaperGenerating, newspaperFeatureEnabled, refreshYesterdayNewspaper]);

    const handleToggleTodayScheduleFeature = useCallback(() => {
        if (!char?.id) return;
        const next = !todayScheduleFeatureEnabled;
        writeChatFeatureToggle(chatTodayScheduleEnabledKey(char.id), next);
        setTodayScheduleFeatureEnabled(next);

        if (next) {
            localStorage.setItem(`chat_today_schedule_entry_hidden_${char.id}`, 'false');
            setIsTodayScheduleEntryHidden(false);
            return;
        }

        todayLifeEnsureSeqRef.current += 1;
        todayScheduleRequestSeqRef.current += 1;
        lastTodayLifeEnsureKeyRef.current = '';
        clearTodayLifeTimers();
        setTodayLifeSyncText('');
        setTodaySchedule(null);
        setCalendarContext(null);
        setIsTodayScheduleOpen(false);
        setIsTodayScheduleLoading(false);
        setShowManualScheduleForm(false);
        setIsTodayScheduleEntryHidden(false);
    }, [char?.id, clearTodayLifeTimers, todayScheduleFeatureEnabled]);

    const handleToggleNewspaperFeature = useCallback(() => {
        if (!char?.id) return;
        const next = !newspaperFeatureEnabled;
        writeChatFeatureToggle(chatNewspaperEnabledKey(char.id), next);
        setNewspaperFeatureEnabled(next);

        if (next) return;

        yesterdayNewspaperSeqRef.current += 1;
        setYesterdayNewspaperRecords([]);
        setActiveNewspaperRecordId(null);
        setIsYesterdayNewspaperOpen(false);
    }, [char?.id, newspaperFeatureEnabled]);

    useEffect(() => {
        if (!isDataLoaded || !char) return;
        if (!todayScheduleFeatureEnabled || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) return;
        const timer = window.setTimeout(() => {
            syncTodayLife(true);
        }, 500);
        return () => window.clearTimeout(timer);
    }, [char?.id, isDataLoaded, syncTodayLife, todayScheduleFeatureEnabled]);

    useEffect(() => {
        yesterdayNewspaperSeqRef.current += 1;
        setIsYesterdayNewspaperOpen(false);
        setActiveNewspaperRecordId(null);
        if (!isDataLoaded || !char || !newspaperFeatureEnabled || !readChatFeatureToggle(chatNewspaperEnabledKey(char.id))) {
            setYesterdayNewspaperRecords([]);
            return;
        }
        setYesterdayNewspaperRecords([]);
        const timer = window.setTimeout(() => {
            void refreshYesterdayNewspaper(false);
        }, 650);
        return () => window.clearTimeout(timer);
    }, [char?.id, isDataLoaded, newspaperFeatureEnabled, refreshYesterdayNewspaper]);

    useEffect(() => {
        todayLifeEnsureSeqRef.current += 1;
        todayScheduleRequestSeqRef.current += 1;
        lastTodayLifeEnsureKeyRef.current = '';
        clearTodayLifeTimers();
        setTodayLifeSyncText('');
        setTodaySchedule(null);
        setIsTodayScheduleLoading(false);
        setShowManualScheduleForm(false);
        if (!char) {
            setIsTodayScheduleEntryHidden(false);
            setTodayScheduleFeatureEnabled(false);
            setNewspaperFeatureEnabled(false);
            setCalendarContext(null);
            return;
        }
        const nextTodayScheduleEnabled = readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id));
        const nextNewspaperEnabled = readChatFeatureToggle(chatNewspaperEnabledKey(char.id));
        setTodayScheduleFeatureEnabled(nextTodayScheduleEnabled);
        setNewspaperFeatureEnabled(nextNewspaperEnabled);
        setIsTodayScheduleEntryHidden(nextTodayScheduleEnabled && localStorage.getItem(`chat_today_schedule_entry_hidden_${char.id}`) === 'true');
    }, [char?.id, clearTodayLifeTimers]);

    useEffect(() => {
        if (!isDataLoaded || !char || !todayScheduleFeatureEnabled || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) {
            setCalendarContext(null);
            return;
        }
        void refreshCalendarContext();
    }, [char?.id, isDataLoaded, refreshCalendarContext, todayScheduleFeatureEnabled]);

    useEffect(() => {
        if (!isDataLoaded || !char || !todayScheduleFeatureEnabled || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) {
            setTodaySchedule(null);
            return;
        }
        const timer = window.setTimeout(() => {
            void refreshTodaySchedule(false);
        }, 900);
        return () => window.clearTimeout(timer);
    }, [char?.id, isDataLoaded, refreshTodaySchedule, todayScheduleFeatureEnabled]);

    useEffect(() => {
        const handleScheduleUpdated = (event: Event) => {
            if (!char?.id || !todayScheduleFeatureEnabled || !readChatFeatureToggle(chatTodayScheduleEnabledKey(char.id))) return;
            const detail = (event as CustomEvent<{ charId?: string }>).detail;
            if (detail?.charId && detail.charId !== char?.id) return;
            void refreshTodaySchedule(false);
        };
        window.addEventListener(TODAY_SCHEDULE_UPDATED_EVENT_NAME, handleScheduleUpdated);
        return () => {
            window.removeEventListener(TODAY_SCHEDULE_UPDATED_EVENT_NAME, handleScheduleUpdated);
        };
    }, [char?.id, refreshTodaySchedule, todayScheduleFeatureEnabled]);

    useEffect(() => () => {
        todayLifeEnsureSeqRef.current += 1;
        clearTodayLifeTimers();
    }, [clearTodayLifeTimers]);

    useEffect(() => {
        if (!isDataLoaded || characters.length === 0) return;

        if (!activeCharacterId || !characters.some(candidate => matchesCharacterId(candidate, activeCharacterId))) {
            setActiveCharacterId(characters[0].id);
        }
    }, [isDataLoaded, characters, activeCharacterId, setActiveCharacterId]);

    // Timestamp: theme can force-enable (e.g. WeChat), otherwise per-character user setting
    const isTimestampForced = !!activeTheme.showTimestamp;
    const effectiveShowTimestamp = isTimestampForced || showTimestampSetting;
    const timestampInterval = activeTheme.timestampIntervalMs ?? 180000; // default 3 minutes

    const draftKey = `chat_draft_${activeCharacterId}`;
    const sendTextInFlightRef = useRef(false);

    // AI-visible categories: only those allowed for the active character (excludes __user__-only categories)
    const aiVisibleCategories = useMemo(() => categories.filter(cat => {
        if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) return true;
        return cat.allowedCharacterIds.includes(activeCharacterId);
    }), [categories, activeCharacterId]);

    // User-visible categories: also includes categories marked with __user__
    const userVisibleCategories = useMemo(() => categories.filter(cat => {
        if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) return true;
        return cat.allowedCharacterIds.includes(activeCharacterId) || cat.allowedCharacterIds.includes('__user__');
    }), [categories, activeCharacterId]);

    const aiVisibleEmojis = useMemo(() => {
        const hiddenIds = new Set(categories.filter(c => !aiVisibleCategories.some(vc => vc.id === c.id)).map(c => c.id));
        if (hiddenIds.size === 0) return emojis;
        return emojis.filter(e => !e.categoryId || !hiddenIds.has(e.categoryId));
    }, [emojis, categories, aiVisibleCategories]);

    // --- Initialize Hook ---
    const { isTyping, recallStatus, searchStatus, diaryStatus, weiboStatus, lastTokenUsage, tokenBreakdown, setLastTokenUsage, triggerAI, retryMindSnapshot } = useChatAI({
        char,
        userProfile,
        apiConfig,
        groups,
        emojis: aiVisibleEmojis,
        categories: aiVisibleCategories,
        addToast,
        setMessages,
        realtimeConfig,
        translationConfig: translationEnabled
            ? { enabled: true, sourceLang: translateSourceLang, targetLang: translateTargetLang }
            : undefined,
        autoVoice: autoTts,
        onVoiceMessageSaved: autoTts && characterTtsConfig?.apiKey ? (msgId: number, text: string) => {
            // Fire-and-forget synthesis; synthesizeForMessage now updates metadata internally
            // before removing loading state, preventing the race condition.
            synthesizeForMessage(msgId, text, characterTtsConfig, undefined, {
                reason: '自动语音 TTS 合成',
                conversationId: char?.id,
                messageId: msgId,
                userInitiated: false,
            }).then(async (result) => {
                if (result) {
                    // Metadata (duration, hasAudio) already updated by synthesizeForMessage.
                    // Just reload messages to refresh the UI from DB.
                    await reloadMessages(visibleCountRef.current);
                }
            }).catch(err => console.error('[AutoTTS] synthesis failed:', err));
        } : undefined,
        autoCall,
        onIncomingCall: autoCall ? (mode: string, callReason: string) => {
            console.log(`📞 [IncomingCall] Triggering VoiceCall app with mode: ${mode}`);
            unlockAudio(); // 提前解锁音频（来电是程序触发，无用户手势，需要预解锁）
            openApp(AppID.VoiceCall, { direction: 'incoming', mode, callReason });
        } : undefined,
        autoShareSong,
        injectPlaybackContext,
        autoPhoto: !!char?.autoPhotoEnabled,
        onPhotoHint: (payload) => photoHintHandlerRef.current?.(payload),
        onMoodUpdate: (charId: string, moodState: any, statusCardData?: any) => {
            const updates: any = { moodState };
            if (statusCardData) updates.lastStatusCard = statusCardData;
            updateCharacter(charId, updates);
        },
    });

    // --- Autonomous Agent: incoming call event bridge ---
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail?.charId || detail.charId !== activeCharacterId) return;
            console.log(`🤖📞 [Agent] Autonomous call triggered (reason: ${detail.reason || 'N/A'})`);
            unlockAudio();
            openApp(AppID.VoiceCall, { direction: 'incoming', mode: 'normal', callReason: detail.reason || '' });
        };
        window.addEventListener('autonomous-call', handler);
        return () => window.removeEventListener('autonomous-call', handler);
    }, [activeCharacterId, openApp]);

    // --- Rerank Trial Key Exhaustion Event Listener ---
    useEffect(() => {
        const handler = () => {
            console.log('🧠 [Chat] Rerank trial exhausted event received');
            setRerankUpgradeStep(1);
            setShowRerankUpgradeModal(true);
        };
        window.addEventListener('rerank-trial-exhausted', handler);
        return () => window.removeEventListener('rerank-trial-exhausted', handler);
    }, []);

    // --- Translation: pure frontend toggle (no API calls, bilingual data is already in message content) ---
    const handleTranslateToggle = useCallback((msgId: number) => {
        setShowingTargetIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const loadEmojiData = async () => {
        await DB.initializeEmojiData();
        const [es, cats] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
        setEmojis(es);
        setCategories(cats);
        if (activeCategory !== 'default' && !cats.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    };

    // How many messages to load per batch (initial load + each "load more" click)
    const LOAD_BATCH_SIZE = 30;

    const mergePendingGeneratedImageMessages = useCallback((baseMessages: Message[]) => {
        const pendingMessages = Array.from(pendingGeneratedImageMessagesRef.current.values());
        if (pendingMessages.length === 0) return baseMessages;

        const currentContentCharId = currentChatCharIdRef.current;
        const existingIds = new Set(baseMessages.map(message => message.id));
        let mergedMessages = baseMessages;

        for (const pendingMessage of pendingMessages) {
            if (existingIds.has(pendingMessage.id)) {
                const persistedMessage = baseMessages.find(message => message.id === pendingMessage.id);
                if (persistedMessage?.metadata?.status === 'ready') {
                    pendingGeneratedImageMessagesRef.current.delete(pendingMessage.id);
                }
                continue;
            }
            const baseHasSameCharacter = baseMessages.some(message => message.charId === pendingMessage.charId);
            if (currentContentCharId && pendingMessage.charId !== currentContentCharId && !baseHasSameCharacter) continue;
            if (mergedMessages === baseMessages) mergedMessages = [...baseMessages];
            mergedMessages.push(pendingMessage);
            existingIds.add(pendingMessage.id);
        }

        if (mergedMessages === baseMessages) return baseMessages;
        return mergedMessages.sort(compareMessageDisplayOrder);
    }, []);

    const upsertGeneratedImageMessage = useCallback((imageMessage: Message, replacedMessageId?: number) => {
        if (replacedMessageId && replacedMessageId !== imageMessage.id) {
            pendingGeneratedImageMessagesRef.current.delete(replacedMessageId);
        }
        pendingGeneratedImageMessagesRef.current.set(imageMessage.id, imageMessage);
        setMessages(prev => {
            const baseMessages = replacedMessageId && replacedMessageId !== imageMessage.id
                ? prev.filter(message => message.id !== replacedMessageId)
                : prev;
            const next = baseMessages.some(message => message.id === imageMessage.id)
                ? baseMessages.map(message => (
                    message.id === imageMessage.id
                        ? {
                            ...message,
                            ...imageMessage,
                            metadata: {
                                ...(message.metadata || {}),
                                ...(imageMessage.metadata || {}),
                            },
                        }
                        : message
                )).sort(compareMessageDisplayOrder)
                : [...baseMessages, imageMessage].sort(compareMessageDisplayOrder);
            messagesRef.current = next;
            return next;
        });
    }, []);

    const removeGeneratedImageMessage = useCallback((messageId: number) => {
        pendingGeneratedImageMessagesRef.current.delete(messageId);
        setMessages(prev => {
            const next = prev.filter(message => message.id !== messageId);
            messagesRef.current = next;
            return next;
        });
    }, []);

    const reloadMessages = useCallback(async (requestedVisibleCount: number) => {
        if (!activeCharacterId) return;

        const charIdAtStart = activeCharacterId;
        try {
            setIsHistoryLoading(true);
            let rawLimit = Math.max(requestedVisibleCount, LOAD_BATCH_SIZE);
            let recentWindow = await DB.getRecentMessageWindow(activeCharacterId, rawLimit);
            let visibleCandidateCount = getDisplayableMainChatMessages(recentWindow.messages, {
                hideBeforeMessageId: char?.hideBeforeMessageId,
                hideSystemLogs: char?.hideSystemLogs,
            }).length;

            while (
                recentWindow.hasMore
                && visibleCandidateCount < requestedVisibleCount
                && rawLimit < CHAT_HISTORY_RAW_WINDOW_MAX
            ) {
                rawLimit = Math.min(CHAT_HISTORY_RAW_WINDOW_MAX, Math.max(rawLimit + LOAD_BATCH_SIZE, rawLimit * 2));
                recentWindow = await DB.getRecentMessageWindow(activeCharacterId, rawLimit);
                visibleCandidateCount = getDisplayableMainChatMessages(recentWindow.messages, {
                    hideBeforeMessageId: char?.hideBeforeMessageId,
                    hideSystemLogs: char?.hideSystemLogs,
                }).length;
            }

            if (recentWindow.hasMore && visibleCandidateCount < requestedVisibleCount) {
                recentWindow = {
                    messages: await DB.getMessagesByCharId(activeCharacterId),
                    hasMore: false,
                };
            }

            // Guard against stale async results: if the user switched characters
            // while the DB query was in flight, discard this result.
            if (activeCharIdRef.current !== charIdAtStart) return;

            setHasMoreHistory(recentWindow.hasMore);
            const nextMessages = mergePendingGeneratedImageMessages(recentWindow.messages);
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
        } catch (error) {
            if (activeCharIdRef.current !== charIdAtStart) return;
            console.error('[Chat] Failed to load recent messages:', error);
            setMessages([]);
            setHasMoreHistory(false);
        } finally {
            if (activeCharIdRef.current === charIdAtStart) {
                setIsHistoryLoading(false);
            }
        }
    }, [activeCharacterId, char?.hideBeforeMessageId, char?.hideSystemLogs, mergePendingGeneratedImageMessages]);

    useEffect(() => {
        const rawTargetMessageId = appParams?.targetMessageId;
        const targetMessageId = typeof rawTargetMessageId === 'number'
            ? rawTargetMessageId
            : Number(rawTargetMessageId);
        const targetCharId = typeof appParams?.targetCharId === 'string'
            ? appParams.targetCharId.trim()
            : '';

        if ((!targetCharId && !Number.isFinite(targetMessageId)) || (!targetCharId && targetMessageId <= 0)) return;

        const targetRequestId = typeof appParams?.targetRequestId === 'string'
            ? appParams.targetRequestId
            : '';
        const targetKey = `${targetCharId || activeCharacterId || ''}:${Number.isFinite(targetMessageId) ? targetMessageId : ''}:${targetRequestId}`;
        if (consumedTargetRef.current === targetKey) return;

        if (targetCharId && !characters.some(candidate => candidate.id === targetCharId)) {
            if (!isDataLoaded) return;
            consumedTargetRef.current = targetKey;
            addToast('没有找到这条记忆对应的角色', 'error');
            return;
        }

        if (targetCharId && activeCharacterId !== targetCharId) {
            setActiveCharacterId(targetCharId);
            return;
        }

        if (!activeCharacterId || !Number.isFinite(targetMessageId) || targetMessageId <= 0) return;

        let cancelled = false;
        consumedTargetRef.current = targetKey;

        const locateMessage = async () => {
            try {
                const allMessages = await DB.getMessagesByCharId(activeCharacterId);
                const targetIndex = allMessages.findIndex(message => message.id === targetMessageId);
                if (cancelled) return;

                if (targetIndex < 0) {
                    addToast('没有找到这条记忆对应的聊天记录', 'error');
                    setIsHistoryLoading(false);
                    return;
                }

                const requiredVisibleCount = Math.max(
                    LOAD_BATCH_SIZE,
                    allMessages.length - targetIndex + 3,
                );
                pendingTargetScrollRef.current = true;
                visibleCountRef.current = requiredVisibleCount;
                setVisibleCount(requiredVisibleCount);
                await reloadMessages(requiredVisibleCount);
                if (cancelled) return;
                setHighlightedMessageId(targetMessageId);
            } catch (error) {
                if (!cancelled) {
                    console.error('[Chat] Failed to locate target message:', error);
                    addToast('定位聊天记录失败', 'error');
                    setIsHistoryLoading(false);
                }
            }
        };

        void locateMessage();

        return () => {
            cancelled = true;
        };
    }, [
        activeCharacterId,
        addToast,
        appParams?.targetCharId,
        appParams?.targetMessageId,
        appParams?.targetRequestId,
        characters,
        isDataLoaded,
        reloadMessages,
        setActiveCharacterId,
    ]);

    useEffect(() => {
        if (activeCharacterId) {
            const rawTargetMessageId = appParams?.targetMessageId;
            const targetMessageId = typeof rawTargetMessageId === 'number'
                ? rawTargetMessageId
                : Number(rawTargetMessageId);
            const targetCharId = typeof appParams?.targetCharId === 'string'
                ? appParams.targetCharId.trim()
                : '';
            const hasTargetForActiveChar = Number.isFinite(targetMessageId)
                && targetMessageId > 0
                && (!targetCharId || targetCharId === activeCharacterId);

            // Update ref BEFORE any async work so stale reloadMessages calls
            // from a previous character can detect the switch and bail out.
            activeCharIdRef.current = activeCharacterId;
            setIsHistoryLoading(true);
            setMessages([]);
            setHasMoreHistory(false);

            if (!hasTargetForActiveChar) {
                reloadMessages(LOAD_BATCH_SIZE);
            }
            loadEmojiData();
            const savedDraft = localStorage.getItem(draftKey);
            setInput(savedDraft || '');
            if (char) {
                setSettingsContextLimit(char.contextLimit || 500);
                setSettingsHideSysLogs(char.hideSystemLogs || false);
                clearUnread(char.id);
            }
            // Per-character translation toggle
            try {
                setTranslationEnabled(JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'));
            } catch { setTranslationEnabled(false); }
            if (!hasTargetForActiveChar) {
                setVisibleCount(30);
                visibleCountRef.current = 30;
                pendingTargetScrollRef.current = false;
                setHighlightedMessageId(null);
            }
            lastMsgIdRef.current = null;
            scrollThrottleRef.current = 0;
            setLastTokenUsage(null);
            setReplyTarget(null);
            setSelectionMode(false);
            setSelectedMsgIds(new Set());
            setShowingTargetIds(new Set());
            // Per-character timestamp toggle
            try {
                setShowTimestampSetting(JSON.parse(localStorage.getItem(`chat_show_timestamp_${activeCharacterId}`) || 'false'));
            } catch { setShowTimestampSetting(false); }
            // Per-character auto TTS toggle
            try {
                setAutoTts(JSON.parse(localStorage.getItem(`chat_auto_tts_${activeCharacterId}`) || 'false'));
            } catch { setAutoTts(false); }
            // Per-character auto call toggle
            try {
                setAutoCall(JSON.parse(localStorage.getItem(`chat_auto_call_${activeCharacterId}`) || 'false'));
            } catch { setAutoCall(false); }
            // Per-character auto share song toggle
            try {
                setAutoShareSong(JSON.parse(localStorage.getItem(`chat_auto_share_song_${activeCharacterId}`) || 'false'));
            } catch { setAutoShareSong(false); }
            // Per-character playback context toggle
            try {
                setInjectPlaybackContext(JSON.parse(localStorage.getItem(`chat_inject_playback_context_${activeCharacterId}`) || 'false'));
            } catch { setInjectPlaybackContext(false); }
        }
    }, [activeCharacterId, appParams?.targetCharId, appParams?.targetMessageId, appParams?.targetRequestId, reloadMessages]);

    useEffect(() => {
        if (activeCharacterId) {
            const rawTargetMessageId = appParams?.targetMessageId;
            const targetMessageId = typeof rawTargetMessageId === 'number'
                ? rawTargetMessageId
                : Number(rawTargetMessageId);
            const targetCharId = typeof appParams?.targetCharId === 'string'
                ? appParams.targetCharId.trim()
                : '';
            const hasTargetForActiveChar = Number.isFinite(targetMessageId)
                && targetMessageId > 0
                && (!targetCharId || targetCharId === activeCharacterId);
            if (hasTargetForActiveChar && pendingTargetScrollRef.current) return;

            reloadMessages(visibleCountRef.current);
        }
    }, [activeCharacterId, appParams?.targetCharId, appParams?.targetMessageId, appParams?.targetRequestId, reloadMessages]);

    // Load all messages when history-manager modal opens
    useEffect(() => {
        if (modalType === 'history-manager' && activeCharacterId) {
            DB.getMessagesByCharId(activeCharacterId).then(allMsgs => {
                const filtered = allMsgs
                    .filter(isMainChatVisibleMessage)
                    .filter(m => (m.type as string) !== 'health_signal')
                    .filter(m => !shouldHideLifeStreamLikeMessage(m))
                    .filter(m => !(char?.hideSystemLogs && m.role === 'system'));
                setAllHistoryMessages(filtered);
            });
        }
    }, [modalType, activeCharacterId, char?.hideSystemLogs]);

    useEffect(() => {
        const savedPrompts = localStorage.getItem('chat_archive_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
                setArchivePrompts(merged);
            } catch (e) { }
        }
        const savedId = localStorage.getItem('chat_active_archive_prompt_id');
        if (savedId && archivePrompts.some(p => p.id === savedId)) setSelectedPromptId(savedId);
    }, []);

    useEffect(() => {
        if (activeCharacterId && lastMsgTimestamp > 0) {
            reloadMessages(visibleCountRef.current);
            clearUnread(activeCharacterId);
        }
    }, [lastMsgTimestamp, activeCharacterId, reloadMessages, clearUnread]);

    useEffect(() => {
        if (!activeCharacterId) return;

        const handleAgentMessageSaved = (event: Event) => {
            const detail = (event as CustomEvent<AgentMessageSavedEventDetail>).detail;
            if (!detail || detail.charId !== activeCharacterId) return;

            void reloadMessages(visibleCountRef.current);
            clearUnread(activeCharacterId);
        };

        window.addEventListener(AGENT_MESSAGE_SAVED_EVENT_NAME, handleAgentMessageSaved);
        return () => window.removeEventListener(AGENT_MESSAGE_SAVED_EVENT_NAME, handleAgentMessageSaved);
    }, [activeCharacterId, reloadMessages, clearUnread]);

    useEffect(() => {
        visibleCountRef.current = visibleCount;
    }, [visibleCount]);

    const persistDraftNow = useCallback((key: string, value: string) => {
        if (value.trim()) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    }, []);

    const clearPendingDraftPersist = useCallback(() => {
        if (draftPersistTimerRef.current) {
            clearTimeout(draftPersistTimerRef.current);
            draftPersistTimerRef.current = null;
        }
        pendingDraftPersistRef.current = null;
    }, []);

    useEffect(() => () => {
        if (draftPersistTimerRef.current) {
            clearTimeout(draftPersistTimerRef.current);
            draftPersistTimerRef.current = null;
        }
        const pendingDraft = pendingDraftPersistRef.current;
        if (pendingDraft) {
            persistDraftNow(pendingDraft.key, pendingDraft.value);
            pendingDraftPersistRef.current = null;
        }
    }, [persistDraftNow]);

    const handleInputChange = (val: string) => {
        setInput(val);
        if (draftPersistTimerRef.current) {
            clearTimeout(draftPersistTimerRef.current);
        }
        pendingDraftPersistRef.current = { key: draftKey, value: val };
        draftPersistTimerRef.current = setTimeout(() => {
            const pendingDraft = pendingDraftPersistRef.current;
            if (pendingDraft) persistDraftNow(pendingDraft.key, pendingDraft.value);
            pendingDraftPersistRef.current = null;
            draftPersistTimerRef.current = null;
        }, 350);
    };

    useLayoutEffect(() => {
        if (!scrollRef.current || selectionMode) return;
        const currentLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
        if (pendingTargetScrollRef.current || highlightedMessageId) {
            lastMsgIdRef.current = currentLastId;
            return;
        }
        // Only auto-scroll when a new message is appended (ID changes),
        // not when loading older history or updating existing messages in-place
        if (currentLastId !== lastMsgIdRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            lastMsgIdRef.current = currentLastId;
        }
    }, [messages, activeCharacterId, selectionMode, highlightedMessageId]);

    useEffect(() => {
        if (isTyping && scrollRef.current && !selectionMode) {
            const now = Date.now();
            if (now - scrollThrottleRef.current > 150) {
                scrollThrottleRef.current = now;
                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }
        }
    }, [messages, isTyping, recallStatus, searchStatus, diaryStatus, weiboStatus, selectionMode]);

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    // --- Actions ---

    const handleSendText = async (customContent?: string, customType?: MessageType, metadata?: any) => {
        if (!char || (!input.trim() && !customContent)) return;
        const isPlainTextSend = !customContent && !customType;
        if (isPlainTextSend && sendTextInFlightRef.current) return;
        if (isPlainTextSend) sendTextInFlightRef.current = true;
        const text = customContent || input.trim();
        const type = customType || 'text';
        const timestamp = Date.now();
        const optimisticId = -timestamp;

        if (!customContent) {
            setInput('');
            clearPendingDraftPersist();
            localStorage.removeItem(draftKey);
        }
        setShowPanel('none');

        if (type === 'image') {
            const recentChat = messages.slice(-10).map(m => {
                const sender = m.role === 'user' ? userProfile.name : char.name;
                return `${sender}: ${m.content.substring(0, 100)}`;
            });
            await DB.saveGalleryImage({
                id: `img-${Date.now()}-${Math.random()}`,
                charId: char.id,
                url: text,
                timestamp: Date.now(),
                savedDate: new Date().toISOString().split('T')[0],
                chatContext: recentChat
            });
            addToast('图片已保存至相册', 'info');
        }

        const msgPayload: any = { charId: char.id, role: 'user', type, content: text, metadata };

        if (replyTarget) {
            msgPayload.replyTo = buildReplyToPayload(replyTarget, char.name);
            setReplyTarget(null);
        }

        const optimisticMessage: Message = {
            id: optimisticId,
            charId: char.id,
            role: 'user',
            type,
            content: text,
            timestamp,
            metadata,
            replyTo: msgPayload.replyTo,
        };
        setMessages(prev => {
            const next = [...prev, optimisticMessage];
            messagesRef.current = next;
            return next;
        });

        let savedMessageId: number;
        try {
            savedMessageId = await DB.saveMessage({ ...msgPayload, timestamp });
        } catch (error) {
            console.error('[Chat] Failed to save outgoing message:', error);
            setMessages(prev => {
                const next = prev.filter(m => m.id !== optimisticId);
                messagesRef.current = next;
                return next;
            });
            addToast('消息发送失败，请重试', 'error');
            if (isPlainTextSend) sendTextInFlightRef.current = false;
            return;
        }
        setMessages(prev => {
            const next = prev.map(m => m.id === optimisticId ? { ...m, id: savedMessageId } : m);
            messagesRef.current = next;
            return next;
        });
        haptic.medium();

        // Notify backend agent that user replied (resets consecutiveIgnored)
        BackendAgentManager.notifyUserReplied(char.id).catch(() => {});
        void BackendAgentManager.refreshCharacterContext(char.id, char);

        // Detect XHS link in user text and create xhs_card via MCP
        if (type === 'text') {
            const xhsUrlMatch = text.match(/xiaohongshu\.com\/(?:discovery\/item|explore)\/([a-f0-9]{24})/);
            const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl;
            if (xhsUrlMatch && mcpUrl && realtimeConfig?.xhsMcpConfig?.enabled) {
                const noteUrl = `https://www.xiaohongshu.com/explore/${xhsUrlMatch[1]}`;
                try {
                    const result = await XhsMcpClient.getNoteDetail(mcpUrl, noteUrl);
                    if (result.success && result.data) {
                        const note = normalizeNote(result.data);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'user',
                            type: 'xhs_card',
                            content: note.title || '小红书笔记',
                            metadata: { xhsNote: note }
                        });
                    }
                } catch (e) {
                    console.warn('XHS link fetch via MCP failed:', e);
                }
            }
        }

        window.setTimeout(() => {
            void reloadMessages(visibleCountRef.current);
        }, 0);

        // Manual trigger only: Removed auto triggerAI call
        if (isPlainTextSend) sendTextInFlightRef.current = false;
    };

    const handleReroll = async () => {
        const rerollableMessages = messages.filter(isMainChatVisibleMessage);
        if (isTyping || rerollableMessages.length === 0) return;

        const lastMsg = rerollableMessages[rerollableMessages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        const toDeleteIds: number[] = [];
        let index = rerollableMessages.length - 1;
        while (index >= 0 && rerollableMessages[index].role === 'assistant') {
            toDeleteIds.push(rerollableMessages[index].id);
            index--;
        }

        if (toDeleteIds.length === 0) return;

        await DB.deleteMessages(toDeleteIds);
        const newHistory = rerollableMessages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        triggerAI(newHistory);
    };

    const handleWorldlineStartDiscussion = useCallback(() => {
        if (!char) return;
        const transientPrompt = [
            '刚才吱吱吱提醒我们要商量 520 约会地点。',
            '请你保持自己的人设和当前关系，像普通聊天里顺势接话一样，主动问我想去哪里约会。',
            '你可以自然给出 1-2 个符合你性格和我们关系的地点选择。',
            '只回复角色会对我说的话。不要提系统、AI、功能、提示词，也不要解释这个提醒。',
        ].join('\n');

        void triggerAI(messagesRef.current, { transientUserPrompt: transientPrompt });
    }, [char, triggerAI]);

    const handleWorldlineLaunch = useCallback(() => {
        if (!char) return;
        openApp(AppID.Theater, {
            source: '520WorldlineOrb',
            charId: char.id,
            startNewTimeline: true,
        });
    }, [char, openApp]);

    const handleImageSelect = async (file: File) => {
        try {
            const base64 = await processImage(file, { maxWidth: 600, quality: 0.6, forceJpeg: true });
            setShowPanel('none');
            await handleSendText(base64, 'image');
        } catch (err: any) {
            addToast(err.message || '图片处理失败', 'error');
        }
    };

    const saveGeneratedPhoto = useCallback(async (
        charId: string,
        dataUrl: string,
        photoMeta: PhotoMeta,
        caption?: string,
        writeContinuity = false,
        pendingMessageId?: number,
    ) => {
        const timestamp = Date.now();
        const imageId = `photo-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
        const contentCharId = await DB.resolveCharacterContentId(charId);
        const imageStorage = await prepareGeneratedImageStorage(imageId, dataUrl);
        const messageTimestamp = pendingMessageId
            ? pendingGeneratedImageMessagesRef.current.get(pendingMessageId)?.timestamp || timestamp
            : timestamp;
        const visualSummary = buildPhotoContextSummary(photoMeta, caption);
        const imageMetadata = {
            caption,
            imageId,
            status: 'ready',
            thumbnailUrl: imageStorage.thumbnailUrl,
            originalAssetId: imageStorage.originalAssetId,
            visualSummary,
            photoMeta,
            source: photoMeta.source,
        };
        let imageMessageId = pendingMessageId || 0;
        let replacedMessageId: number | undefined;

        if (pendingMessageId) {
            try {
                await DB.updateMessage(pendingMessageId, imageStorage.displayUrl);
                await DB.updateMessageMetadata(pendingMessageId, imageMetadata);
            } catch (error) {
                console.warn('[Photo] Failed to update pending image message, saving a new image message:', error);
                replacedMessageId = pendingMessageId;
                imageMessageId = 0;
            }
        }

        if (!imageMessageId) {
            imageMessageId = await DB.saveMessage({
                charId: contentCharId,
                role: 'assistant',
                type: 'image',
                content: imageStorage.displayUrl,
                timestamp: messageTimestamp,
                metadata: imageMetadata,
            });
        }

        const activeCharForContext = characters.find(c => c.id === contentCharId) || char;
        const recentChat = messagesRef.current.slice(-10).map(m => {
            const sender = m.role === 'user' ? userProfile.name : (activeCharForContext?.name || '角色');
            const content = m.type === 'image' ? '[图片]' : m.content.substring(0, 100);
            return `${sender}: ${content}`;
        });

        await DB.saveGalleryImage({
            id: imageId,
            charId: contentCharId,
            url: imageStorage.displayUrl,
            timestamp,
            savedDate: new Date(timestamp).toISOString().split('T')[0],
            chatContext: recentChat,
            thumbnailUrl: imageStorage.thumbnailUrl,
            originalAssetId: imageStorage.originalAssetId,
            visualSummary,
            photoMeta,
        });

        const activeContentCharId = activeCharacterId
            ? await DB.resolveCharacterContentId(activeCharacterId)
            : undefined;
        const renderedContentCharId = currentChatCharIdRef.current
            ? await DB.resolveCharacterContentId(currentChatCharIdRef.current)
            : undefined;
        const isCurrentChatPhoto = contentCharId === activeContentCharId
            || contentCharId === renderedContentCharId;

        if (isCurrentChatPhoto) {
            const imageMessage: Message = {
                id: imageMessageId,
                charId: contentCharId,
                role: 'assistant',
                type: 'image',
                content: imageStorage.displayUrl,
                timestamp: messageTimestamp,
                metadata: imageMetadata,
            };
            upsertGeneratedImageMessage(imageMessage, replacedMessageId);
            [0, 250, 1000].forEach(delay => {
                window.setTimeout(() => {
                    void reloadMessages(visibleCountRef.current);
                }, delay);
            });
        }

        if (writeContinuity && photoMeta.continuity_summary) {
            try {
                await DB.saveMessage({
                    charId: contentCharId,
                    role: 'system',
                    type: 'system',
                    content: [
                        '[照片事件]',
                        caption ? `caption: ${caption}` : '',
                        `连续性: ${photoMeta.continuity_summary}`,
                    ].filter(Boolean).join('\n'),
                    metadata: {
                        hiddenFromUser: true,
                        source: 'photo_continuity',
                        photoMeta,
                        sourceMessageId: imageMessageId,
                    },
                });
            } catch (error) {
                console.warn('[Photo] Failed to save continuity event after image delivery:', error);
            }
        }
    }, [activeCharacterId, characters, char, reloadMessages, upsertGeneratedImageMessage, userProfile.name]);

    const buildDefaultVibeReferencesForChar = useCallback((targetChar?: { defaultVibeReferenceIds?: string[] }): VibeReferenceInput[] => {
        const ids = (targetChar?.defaultVibeReferenceIds || []).slice(0, 3);
        return ids
            .map(id => savedVibeReferences.find(vibe => vibe.id === id))
            .filter((vibe): vibe is SavedVibeReference => Boolean(vibe))
            .map(buildVibeInputFromSaved);
    }, [savedVibeReferences]);

    const createPendingGeneratedImageMessage = useCallback(async (
        charId: string,
        photoMeta: PhotoMeta,
        caption?: string,
    ): Promise<number> => {
        const timestamp = Date.now();
        const contentCharId = await DB.resolveCharacterContentId(charId);
        const pendingMetadata = {
            caption,
            status: 'generating',
            source: photoMeta.source,
            photoMeta,
            photoHint: photoMeta.photoHint,
        };
        const pendingMessageId = await DB.saveMessage({
            charId: contentCharId,
            role: 'assistant',
            type: 'image',
            content: '',
            timestamp,
            metadata: pendingMetadata,
        });

        const activeContentCharId = activeCharacterId
            ? await DB.resolveCharacterContentId(activeCharacterId)
            : undefined;
        const renderedContentCharId = currentChatCharIdRef.current
            ? await DB.resolveCharacterContentId(currentChatCharIdRef.current)
            : undefined;
        const isCurrentChatPhoto = contentCharId === activeContentCharId
            || contentCharId === renderedContentCharId;

        if (isCurrentChatPhoto) {
            upsertGeneratedImageMessage({
                id: pendingMessageId,
                charId: contentCharId,
                role: 'assistant',
                type: 'image',
                content: '',
                timestamp,
                metadata: pendingMetadata,
            });
        }

        return pendingMessageId;
    }, [activeCharacterId, upsertGeneratedImageMessage]);

    const prepareVibeReferencesForGeneration = useCallback((
        references: VibeReferenceInput[] | undefined,
        meta: PhotoMeta,
    ): VibeReferenceInput[] => {
        if (effectiveImageGenerationConfig.activeProvider !== 'novelai') return [];
        const model = meta.naiModel || meta.model;
        return (references || []).slice(0, 3).map(reference => {
            const saved = reference.savedVibeId
                ? savedVibeReferences.find(vibe => vibe.id === reference.savedVibeId)
                : undefined;
            const informationExtracted = reference.informationExtracted
                || saved?.defaultInformationExtracted
                || 0.6;
            const cached = saved ? getSavedVibeEncoding(saved, model, informationExtracted) : undefined;
            return {
                ...reference,
                name: reference.name || saved?.name || 'Vibe 参考图',
                previewUrl: reference.previewUrl || saved?.previewUrl,
                imageDataUrl: reference.imageDataUrl || saved?.imageDataUrl,
                encodedReference: reference.encodedReference || cached?.encodedReference,
                strength: reference.strength || saved?.defaultStrength || 0.6,
                informationExtracted,
            };
        });
    }, [effectiveImageGenerationConfig.activeProvider, savedVibeReferences]);

    const handleVibeReferenceEncoded = useCallback(async (
        reference: VibeReferenceInput,
        encoding: SavedVibeEncoding,
    ) => {
        if (!reference.savedVibeId) return;
        await DB.upsertSavedVibeEncoding(reference.savedVibeId, encoding);
        await refreshSavedVibeReferences();
    }, [refreshSavedVibeReferences]);

    const handleSaveVibeReference = useCallback(async (reference: VibeReferenceInput): Promise<SavedVibeReference> => {
        const saved = buildSavedVibeFromImage(reference);
        await DB.saveSavedVibeReference(saved);
        await refreshSavedVibeReferences();
        return saved;
    }, [refreshSavedVibeReferences]);

    const handleImportVibeFile = useCallback(async (file: File): Promise<SavedVibeReference> => {
        const saved = await parseNaiv4VibeFile(file);
        await DB.saveSavedVibeReference(saved);
        await refreshSavedVibeReferences();
        return saved;
    }, [refreshSavedVibeReferences]);

    const handleRenameSavedVibe = useCallback(async (id: string, name: string) => {
        await DB.renameSavedVibeReference(id, name);
        await refreshSavedVibeReferences();
    }, [refreshSavedVibeReferences]);

    const handleDeleteSavedVibe = useCallback(async (id: string) => {
        await DB.deleteSavedVibeReference(id);
        if (char?.defaultVibeReferenceIds?.includes(id)) {
            updateCharacter(char.id, {
                defaultVibeReferenceIds: char.defaultVibeReferenceIds.filter(vibeId => vibeId !== id),
            });
        }
        await refreshSavedVibeReferences();
    }, [char, refreshSavedVibeReferences, updateCharacter]);

    const handleClearSavedVibeCache = useCallback(async (id: string) => {
        await DB.clearSavedVibeReferenceCache(id);
        await refreshSavedVibeReferences();
    }, [refreshSavedVibeReferences]);

    const handleToggleDefaultVibeReference = useCallback((vibeId: string) => {
        if (!char) return;
        const current = char.defaultVibeReferenceIds || [];
        const next = current.includes(vibeId)
            ? current.filter(id => id !== vibeId)
            : current.length >= 3
                ? current
                : [...current, vibeId];
        if (next === current) {
            addToast('角色默认 Vibe 最多选择 3 个', 'error');
            return;
        }
        updateCharacter(char.id, { defaultVibeReferenceIds: next });
    }, [addToast, char, updateCharacter]);

    const handleManualPhotoGenerate = useCallback(async (
        prompt: string,
        stylePresetId?: string,
        vibeReferences?: VibeReferenceInput[],
        options?: ManualPhotoGenerationOptions,
    ) => {
        if (!char) return;
        if (!isImageGenerationConfigured(effectiveImageGenerationConfig)) {
            addToast('请先在设置里配置当前生图供应商', 'error');
            return;
        }
        const cleanPrompt = prompt.trim();
        if (!cleanPrompt) {
            addToast('请先写一点想生成的画面', 'info');
            return;
        }
        if (manualPhotoInFlightRef.current) {
            addToast('图片还在生成中，请稍等一下', 'info');
            return;
        }

        manualPhotoInFlightRef.current = true;
        setManualPhotoGenerating(true);
        try {
            const manualMode = options?.mode || 'direct';
            const includeAppearance = options?.useAppearance !== false;
            const includeUserAppearance = includeAppearance && options?.useUserAppearance === true;
            const optionAppearanceTags = typeof options?.appearanceTags === 'string' ? options.appearanceTags : undefined;
            const optionAppearanceNegativeTags = typeof options?.appearanceNegativeTags === 'string' ? options.appearanceNegativeTags : undefined;
            const optionUserAppearanceTags = typeof options?.userAppearanceTags === 'string' ? options.userAppearanceTags : undefined;
            const optionUserAppearanceNegativeTags = typeof options?.userAppearanceNegativeTags === 'string' ? options.userAppearanceNegativeTags : undefined;
            const optionAppearancePrompt = typeof options?.appearancePrompt === 'string' ? options.appearancePrompt : undefined;
            const optionUserAppearancePrompt = typeof options?.userAppearancePrompt === 'string' ? options.userAppearancePrompt : undefined;
            const isNaiProvider = effectiveImageGenerationConfig.activeProvider === 'novelai';
            const appearanceTags = includeAppearance && isNaiProvider ? (optionAppearanceTags ?? char.naiAppearanceTags ?? '').trim() : '';
            const appearanceNegativeTags = includeAppearance && isNaiProvider ? (optionAppearanceNegativeTags ?? char.naiAppearanceNegativeTags ?? '').trim() : '';
            const userAppearanceTags = includeUserAppearance && isNaiProvider ? (optionUserAppearanceTags ?? userProfile.naiAppearanceTags ?? '').trim() : '';
            const userAppearanceNegativeTags = includeUserAppearance && isNaiProvider ? (optionUserAppearanceNegativeTags ?? userProfile.naiAppearanceNegativeTags ?? '').trim() : '';
            const appearancePrompt = includeAppearance ? (optionAppearancePrompt ?? char.photoAppearancePrompt ?? '').trim() : '';
            const userAppearancePrompt = includeUserAppearance ? (optionUserAppearancePrompt ?? userProfile.photoAppearancePrompt ?? '').trim() : '';
            const style = resolvePhotoStylePreset(stylePresetId, activePhotoStylePresets, char, effectiveImageGenerationConfig.activeProvider, {
                allowUnboundRequested: Boolean(stylePresetId),
            });
            const seed = Math.floor(Math.random() * 9999999999);
            let directorResult: PhotoDirectorResult | undefined;
            let prompts: ReturnType<typeof buildManualPhotoPrompt>;

            if (manualMode === 'story') {
                const secondaryConfig = selectSecondaryApiConfig();
                if (!secondaryConfig?.baseUrl || !secondaryConfig.apiKey || !secondaryConfig.model) {
                    addToast('剧情模式需要先配置副 API', 'error');
                    return;
                }

                const gallery = await DB.getGalleryImages(char.id);
                const recentPhotoMetas = gallery
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .map(item => item.photoMeta)
                    .filter((meta): meta is PhotoMeta => Boolean(meta))
                    .slice(-8);

                const director = await runManualPhotoDirector({
                    apiConfig: secondaryConfig,
                    char,
                    userProfile,
                    currentMsgs: messagesRef.current,
                    userPrompt: cleanPrompt,
                    stylePresets: activePhotoStylePresets,
                    recentPhotoMetas,
                    providerType: effectiveImageGenerationConfig.activeProvider,
                    appearanceTags,
                    appearanceNegativeTags,
                    userAppearanceTags,
                    userAppearanceNegativeTags,
                    appearancePrompt,
                    userAppearancePrompt,
                });
                if (!director) {
                    throw new Error('剧情模式没有返回可用生图结果');
                }

                const hasDirectorScene = effectiveImageGenerationConfig.activeProvider === 'openai-compatible'
                    ? Boolean(director.scene_zh.trim())
                    : Boolean(
                        director.scene_zh.trim()
                        || director.subject_tags?.trim()
                        || director.pose_tags?.trim()
                        || director.scene_tags?.trim()
                        || director.clothing_tags?.trim()
                        || director.expression_tags?.trim()
                        || director.camera_tags?.trim()
                        || director.mood_tags?.trim()
                    );
                if (!hasDirectorScene) {
                    throw new Error('剧情模式没有返回可用画面内容');
                }

                directorResult = {
                    ...director,
                    shouldGeneratePhoto: true,
                    stylePresetId: style.id,
                };
                prompts = buildPhotoPromptFromDirector(directorResult, undefined, style, effectiveImageGenerationConfig, {
                    appearanceTags,
                    appearanceNegativeTags,
                    userAppearanceTags,
                    userAppearanceNegativeTags,
                    appearancePrompt,
                    userAppearancePrompt,
                    includeAppearance,
                    includeUserAppearance,
                });
            } else {
                prompts = buildManualPhotoPrompt(cleanPrompt, style, effectiveImageGenerationConfig, {
                    appearanceTags,
                    appearanceNegativeTags,
                    userAppearanceTags,
                    userAppearanceNegativeTags,
                    appearancePrompt,
                    userAppearancePrompt,
                    includeAppearance,
                    includeUserAppearance,
                });
            }

            const meta = createPhotoMeta('manual', effectiveImageGenerationConfig, style, prompts, seed, directorResult);
            const selectedVibes = vibeReferences && vibeReferences.length > 0
                ? vibeReferences
                : buildDefaultVibeReferencesForChar(char);
            const result = await generatePhotoImage(effectiveImageGenerationConfig, meta, {
                vibeReferences: prepareVibeReferencesForGeneration(selectedVibes, meta),
                onVibeReferenceEncoded: handleVibeReferenceEncoded,
            });
            await saveGeneratedPhoto(char.id, result.dataUrl, meta, directorResult?.caption || cleanPrompt, false);
            setShowPanel('none');
            setModalType('none');
            addToast('图片已发送并保存到相册', 'success');
        } catch (error: any) {
            console.error('[ManualPhoto] failed:', error);
            addToast(error?.message || '生图失败', 'error');
        } finally {
            manualPhotoInFlightRef.current = false;
            setManualPhotoGenerating(false);
        }
    }, [activePhotoStylePresets, addToast, buildDefaultVibeReferencesForChar, char, effectiveImageGenerationConfig, handleVibeReferenceEncoded, prepareVibeReferencesForGeneration, saveGeneratedPhoto, userProfile]);

    const handlePhotoHint = useCallback((payload: PhotoHintTrigger) => {
        if (!payload?.char?.id || !payload.hint) return;
        if (!payload.char.autoPhotoEnabled) return;
        if (!isImageGenerationConfigured(effectiveImageGenerationConfig)) {
            addToast('主动发照片已触发，但当前生图供应商还没有配置完整', 'error');
            return;
        }

        const autoPhotoKey = [
            payload.char.id,
            payload.sourceMessageId || 'no-source',
            payload.hint.anchor_text,
            payload.hint.share_intent,
        ].join('|');
        if (autoPhotoInFlightRef.current.has(autoPhotoKey)) {
            console.warn('[AutoPhoto] Duplicate photo job skipped:', autoPhotoKey);
            return;
        }
        autoPhotoInFlightRef.current.add(autoPhotoKey);

        window.setTimeout(() => {
            (async () => {
                let pendingImageMessageId: number | undefined;
                try {
                    const secondaryConfig = selectSecondaryApiConfig();
                    if (!secondaryConfig?.apiKey) {
                        addToast('主动发照片需要先配置副 API', 'error');
                        return;
                    }

                    const gallery = await DB.getGalleryImages(payload.char.id);
                    const recentPhotoMetas = gallery
                        .sort((a, b) => a.timestamp - b.timestamp)
                        .map(item => item.photoMeta)
                        .filter((meta): meta is PhotoMeta => Boolean(meta))
                        .slice(-8);
                    const isNaiProvider = effectiveImageGenerationConfig.activeProvider === 'novelai';
                    const hintIncludesUser = shouldIncludeUserAppearanceForPhoto(undefined, payload.aiReply, payload.hint);

                    const director = await runPhotoDirector({
                        apiConfig: secondaryConfig,
                        char: payload.char,
                        userProfile: payload.userProfile,
                        currentMsgs: payload.currentMsgs,
                        aiReply: payload.aiReply,
                        thinking: payload.thinking,
                        hint: payload.hint,
                        stylePresets: effectivePhotoStylePresets,
                        recentPhotoMetas,
                        providerType: effectiveImageGenerationConfig.activeProvider,
                        appearanceTags: isNaiProvider ? payload.char.naiAppearanceTags : '',
                        appearanceNegativeTags: isNaiProvider ? payload.char.naiAppearanceNegativeTags : '',
                        userAppearanceTags: isNaiProvider && hintIncludesUser ? payload.userProfile.naiAppearanceTags : '',
                        userAppearanceNegativeTags: isNaiProvider && hintIncludesUser ? payload.userProfile.naiAppearanceNegativeTags : '',
                        appearancePrompt: payload.char.photoAppearancePrompt,
                        userAppearancePrompt: hintIncludesUser ? payload.userProfile.photoAppearancePrompt : '',
                        contextOptions: payload.contextOptions as SecondaryFullContextOptions | undefined,
                    });
                    if (!director) {
                        throw new Error('Photo Director 没有返回可用导演结果，已停止生图');
                    }
                    if (!director.shouldGeneratePhoto && payload.hint.strength < 0.85) return;

                    const hasDirectorScene = effectiveImageGenerationConfig.activeProvider === 'openai-compatible'
                        ? Boolean(director.scene_zh.trim())
                        : Boolean(
                            director.scene_zh.trim()
                            || director.subject_tags?.trim()
                            || director.pose_tags?.trim()
                            || director.scene_tags?.trim()
                            || director.clothing_tags?.trim()
                        );
                    if (!hasDirectorScene) {
                        console.warn('[AutoPhoto] Photo Director returned no usable scene; generation stopped.', director);
                        throw new Error('Photo Director 没有返回可用画面内容，已停止生图');
                    }

                    const finalDirector: PhotoDirectorResult = {
                        ...director,
                        shouldGeneratePhoto: true,
                    };
                    const style = resolvePhotoStylePreset(finalDirector.stylePresetId, effectivePhotoStylePresets, payload.char, effectiveImageGenerationConfig.activeProvider);
                    const includeAppearance = true;
                    const includeUserAppearance = shouldIncludeUserAppearanceForPhoto(finalDirector, payload.aiReply, payload.hint);
                    const prompts = buildPhotoPromptFromDirector(finalDirector, payload.hint, style, effectiveImageGenerationConfig, {
                        appearanceTags: isNaiProvider ? payload.char.naiAppearanceTags : '',
                        appearanceNegativeTags: isNaiProvider ? payload.char.naiAppearanceNegativeTags : '',
                        userAppearanceTags: isNaiProvider && includeUserAppearance ? payload.userProfile.naiAppearanceTags : '',
                        userAppearanceNegativeTags: isNaiProvider && includeUserAppearance ? payload.userProfile.naiAppearanceNegativeTags : '',
                        appearancePrompt: payload.char.photoAppearancePrompt,
                        userAppearancePrompt: includeUserAppearance ? payload.userProfile.photoAppearancePrompt : '',
                        includeAppearance,
                        includeUserAppearance,
                    });
                    const seed = Math.floor(Math.random() * 9999999999);
                    const meta = createPhotoMeta('chat_auto', effectiveImageGenerationConfig, style, prompts, seed, finalDirector, payload.hint);
                    console.groupCollapsed('[AutoPhoto] generation payload');
                    console.info('provider:', effectiveImageGenerationConfig.activeProvider);
                    console.info('director:', finalDirector);
                    console.info('style:', style);
                    console.info('positivePrompt:', prompts.positivePrompt);
                    console.info('negativePrompt:', prompts.negativePrompt);
                    console.info('finalPrompt:', prompts.finalPrompt);
                    console.info('photoMeta:', meta);
                    console.groupEnd();
                    const defaultVibes = buildDefaultVibeReferencesForChar(payload.char);
                    pendingImageMessageId = await createPendingGeneratedImageMessage(payload.char.id, meta, finalDirector.caption);
                    const result = await generatePhotoImage(effectiveImageGenerationConfig, meta, {
                        vibeReferences: prepareVibeReferencesForGeneration(defaultVibes, meta),
                        onVibeReferenceEncoded: handleVibeReferenceEncoded,
                    });
                    await saveGeneratedPhoto(payload.char.id, result.dataUrl, meta, finalDirector.caption, true, pendingImageMessageId);
                    addToast(`${payload.char.name}发来了一张照片`, 'success');
                } catch (error: any) {
                    console.error('[AutoPhoto] failed:', error);
                    if (pendingImageMessageId) {
                        removeGeneratedImageMessage(pendingImageMessageId);
                        await DB.deleteMessage(pendingImageMessageId)
                            .catch(deleteError => console.warn('[AutoPhoto] failed to delete pending image message:', deleteError));
                    }
                    await DB.saveMessage({
                        charId: payload.char.id,
                        role: 'system',
                        type: 'system',
                        content: `[照片发送失败]\n${payload.char.name}刚才尝试发送一张照片，但图片没有成功送达。下一轮不要声称已经发过照片，也不要责怪用户看不到；如果用户还想要，可以重新尝试。`,
                        metadata: {
                            hiddenFromUser: true,
                            source: 'photo_delivery_failed',
                            photoHint: payload.hint,
                            errorMessage: error?.message || String(error || 'unknown'),
                        },
                    }).catch(saveError => console.warn('[AutoPhoto] failed to save failure event:', saveError));
                    addToast(error?.message || '主动发照片失败', 'error');
                } finally {
                    autoPhotoInFlightRef.current.delete(autoPhotoKey);
                }
            })();
        }, 0);
    }, [addToast, buildDefaultVibeReferencesForChar, createPendingGeneratedImageMessage, effectiveImageGenerationConfig, effectivePhotoStylePresets, handleVibeReferenceEncoded, prepareVibeReferencesForGeneration, removeGeneratedImageMessage, saveGeneratedPhoto]);
    photoHintHandlerRef.current = handlePhotoHint;

    const handlePanelAction = (type: string, payload?: any) => {
        switch (type) {
            case 'transfer': setModalType('transfer'); break;
            case 'manual-photo': setModalType('manual-photo'); break;
            case 'poke': handleSendText('[戳一戳]', 'interaction'); break;
            case 'archive': setModalType('archive-settings'); break;
            case 'settings': setModalType('chat-settings'); break;
            case 'emoji-import': setModalType('emoji-import'); break;
            case 'send-emoji': if (payload) handleSendText(payload.url, 'emoji', { name: payload.name, categoryId: payload.categoryId }); break;
            case 'delete-emoji-req': setSelectedEmoji(payload); setModalType('delete-emoji'); break;
            case 'add-category': setModalType('add-category'); break;
            case 'select-category': setActiveCategory(payload); break;
            case 'category-options': setSelectedCategory(payload); setModalType('category-options'); break;
            case 'delete-category-req': setSelectedCategory(payload); setModalType('delete-category'); break;
            case 'edit-theme':
                if (payload) {
                    window.sessionStorage.setItem('themeMakerEditId', payload);
                    openApp(AppID.ThemeMaker);
                }
                break;
            case 'voice-call': unlockAudio(); openApp(AppID.VoiceCall, { direction: 'outgoing' }); break;
        }
    };

    const handleSoulReflection = async () => {
        if (!char || !apiConfig.apiKey || selectedMsgIds.size === 0) return;
        if (!soulReflectionFeedback.trim()) {
            addToast('请先写点什么', 'info');
            return;
        }

        const selectedIds = new Set(selectedMsgIds);
        const selectedMessages = messages.filter(m => selectedIds.has(m.id));
        if (selectedMessages.length === 0) return;

        setIsSoulReflecting(true);

        try {
            const { generateSoulReflection } = await import('../utils/soulReflection');

            const result = await generateSoulReflection({
                selectedMessages,
                userFeedback: soulReflectionFeedback,
                char,
                userProfile,
                recentContext: messages.slice(-20),
            }, apiConfig);

            const mirrorSnippetsList = selectedMessages
                .filter(m => m.role === 'assistant')
                .slice(0, 5)
                .map(m => m.content.substring(0, 30));

            const mirrorSnippets = mirrorSnippetsList.join('||');

            const modelContent = result.anchors
                ? `${result.reflection}\n\n${result.anchors}`
                : result.reflection;

            await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'soul_reflection',
                content: modelContent,
                metadata: {
                    source: 'soul_reflection',
                    displayReflection: result.reflection,
                    mirrorSnippets,
                    anchors: result.anchors,
                    selectedMsgIds: Array.from(selectedIds),
                    userFeedback: soulReflectionFeedback,
                    hiddenFromUser: true,
                },
            });

            // Show result panel instead of inserting into chat flow
            setSoulReflectionResult({
                reflection: result.reflection,
                anchors: result.anchors,
                mirrorSnippets: mirrorSnippetsList,
            });
            setSoulReflectionFeedback('');
            setSelectionMode(false);
            setSelectedMsgIds(new Set());
        } catch (err: any) {
            addToast(err.message || '回神失败', 'error');
        } finally {
            setIsSoulReflecting(false);
        }
    };

    // --- Modal Handlers ---

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) {
            addToast('请输入分类名称', 'error');
            return;
        }
        const newCat = { id: `cat-${Date.now()}`, name: newCategoryName.trim() };
        await DB.saveEmojiCategory(newCat);
        await loadEmojiData();
        setActiveCategory(newCat.id);
        setModalType('none');
        setNewCategoryName('');
        addToast('分类创建成功', 'success');
    };

    const handleImportEmoji = async () => {
        if (!emojiImportText.trim()) return;
        const lines = emojiImportText.split('\n');
        const targetCatId = activeCategory === 'default' ? undefined : activeCategory;

        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const url = parts.slice(1).join('--').trim();
                if (name && url) {
                    await DB.saveEmoji(name, url, targetCatId);
                }
            }
        }
        await loadEmojiData();
        setModalType('none');
        setEmojiImportText('');
        addToast('表情包导入成功', 'success');
    };

    const handleDeleteCategory = async () => {
        if (!selectedCategory) return;
        await DB.deleteEmojiCategory(selectedCategory.id);
        await loadEmojiData();
        setActiveCategory('default');
        setModalType('none');
        setSelectedCategory(null);
        addToast('分类及包含表情已删除', 'success');
    };

    const handleSaveCategoryVisibility = async (categoryId: string, allowedCharacterIds: string[] | undefined) => {
        const cat = categories.find(c => c.id === categoryId);
        if (!cat) return;
        await DB.saveEmojiCategory({ ...cat, allowedCharacterIds });
        await loadEmojiData();
        setSelectedCategory(null);
        const userCount = allowedCharacterIds?.filter(id => id !== '__user__').length ?? 0;
        const includesUser = allowedCharacterIds?.includes('__user__');
        const label = !allowedCharacterIds ? '已设为所有人可见' : includesUser && userCount === 0 ? '已设为仅用户可见' : `已设置 ${(includesUser ? userCount + 1 : userCount)} 个可见`;
        addToast(label, 'success');
    };

    const handleSavePrompt = () => {
        if (!editingPrompt || !editingPrompt.name.trim() || !editingPrompt.content.trim()) {
            addToast('请填写完整', 'error');
            return;
        }
        setArchivePrompts(prev => {
            let next;
            if (prev.some(p => p.id === editingPrompt.id)) {
                next = prev.map(p => p.id === editingPrompt.id ? editingPrompt : p);
            } else {
                next = [...prev, editingPrompt];
            }
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        setSelectedPromptId(editingPrompt.id);
        setModalType('archive-settings');
        setEditingPrompt(null);
    };

    const handleDeletePrompt = (id: string) => {
        if (id.startsWith('preset_')) {
            addToast('默认预设不可删除', 'error');
            return;
        }
        setArchivePrompts(prev => {
            const next = prev.filter(p => p.id !== id);
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        if (selectedPromptId === id) setSelectedPromptId('preset_rational');
        addToast('预设已删除', 'success');
    };

    const createNewPrompt = () => {
        setEditingPrompt({ id: `custom_${Date.now()}`, name: '新预设', content: DEFAULT_ARCHIVE_PROMPTS[0].content });
        setModalType('prompt-editor');
    };

    const editSelectedPrompt = () => {
        const p = archivePrompts.find(a => a.id === selectedPromptId);
        if (!p) return;
        if (p.id.startsWith('preset_')) {
            setEditingPrompt({ id: `custom_${Date.now()}`, name: `${p.name} (Copy)`, content: p.content });
        } else {
            setEditingPrompt({ ...p });
        }
        setModalType('prompt-editor');
    };

    const handleBgUpload = async (file: File) => {
        if (!char) {
            addToast('角色资料同步中，请稍后再试', 'error');
            return;
        }
        try {
            const dataUrl = await processImage(file, { skipCompression: true });
            updateCharacter(char.id, { chatBackground: dataUrl });
            addToast('聊天背景已更新', 'success');
        } catch (err: any) {
            addToast(err.message, 'error');
        }
    };

    const saveSettings = () => {
        if (!char) {
            addToast('角色资料同步中，请稍后再试', 'error');
            return;
        }
        updateCharacter(char.id, {
            contextLimit: settingsContextLimit,
            hideSystemLogs: settingsHideSysLogs
        });
        setModalType('none');
        addToast('设置已保存', 'success');
    };

    const handleToggleBoundPhotoStyle = (styleId: string) => {
        if (!char) return;
        const allIds = activePhotoStylePresets.map(style => style.id);
        const current = new Set(
            char.boundPhotoStylePresetIds && char.boundPhotoStylePresetIds.length > 0
                ? char.boundPhotoStylePresetIds
                : allIds,
        );
        if (current.has(styleId)) current.delete(styleId);
        else current.add(styleId);
        if (current.size === 0) {
            addToast('至少保留一个可用风格', 'info');
            return;
        }
        const nextIds = current.size === allIds.length ? undefined : Array.from(current);
        const updates: any = { boundPhotoStylePresetIds: nextIds };
        if (char.defaultPhotoStylePresetId && nextIds && !nextIds.includes(char.defaultPhotoStylePresetId)) {
            updates.defaultPhotoStylePresetId = nextIds.find(id => id !== NO_PHOTO_STYLE_PRESET_ID) || nextIds[0];
        }
        updateCharacter(char.id, updates);
    };

    const handleSaveNaiAppearance = useCallback((
        tags: string,
        negativeTags: string,
        appearancePrompt?: string,
        userTags?: string,
        userNegativeTags?: string,
        userAppearancePrompt?: string,
    ) => {
        if (!char) return;
        updateCharacter(char.id, {
            naiAppearanceTags: tags.trim() || undefined,
            naiAppearanceNegativeTags: negativeTags.trim() || undefined,
            photoAppearancePrompt: appearancePrompt?.trim() || undefined,
        });
        updateUserProfile({
            naiAppearanceTags: userTags?.trim() || undefined,
            naiAppearanceNegativeTags: userNegativeTags?.trim() || undefined,
            photoAppearancePrompt: userAppearancePrompt?.trim() || undefined,
        });
        addToast('锁脸设定已保存', 'success');
    }, [addToast, char, updateCharacter, updateUserProfile]);

    const handleClearHistory = async () => {
        if (!char) return;
        if (preserveContext) {
            const allMessages = await DB.getMessagesByCharId(char.id);
            const toKeep = allMessages.slice(-10);
            const toKeepIds = new Set(toKeep.map(m => m.id));
            const toDelete = allMessages.filter(m => !toKeepIds.has(m.id));
            if (toDelete.length === 0) {
                addToast('消息太少，无需清理', 'info');
                return;
            }
            await DB.deleteMessages(toDelete.map(m => m.id));
            setMessages(toKeep);
            setHasMoreHistory(false);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            addToast(`已清理 ${toDelete.length} 条历史，保留最近10条`, 'success');
        } else {
            await DB.clearMessages(char.id);
            setMessages([]);
            setHasMoreHistory(false);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            addToast('已清空', 'success');
        }
        setModalType('none');
    };

    const handleSetHistoryStart = (messageId: number | undefined) => {
        if (!char) {
            addToast('角色资料同步中，请稍后再试', 'error');
            return;
        }
        updateCharacter(char.id, { hideBeforeMessageId: messageId });
        setModalType('none');
        addToast(messageId ? '已隐藏历史消息' : '已恢复全部历史记录', 'success');
    };

    const handleFullArchive = async () => {
        if (!apiConfig.apiKey || !char) {
            addToast('请先配置 API Key', 'error');
            return;
        }
        const allMessages = selectMessagesForMemoryArchive(await DB.getMessagesByCharId(char.id));
        const historyStartMessageId = getEffectiveHistoryStartMessageId(allMessages, char.hideBeforeMessageId);
        const msgsByDate: Record<string, Message[]> = {};
        allMessages
            .filter(m => isAfterHistoryStart(m, historyStartMessageId))
            .forEach(m => {
                const d = new Date(m.timestamp);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
                msgsByDate[dateStr].push(m);
            });

        const datesToProcess = Object.keys(msgsByDate).sort();
        if (datesToProcess.length === 0) {
            addToast('聊天记录为空，无法归档', 'info');
            return;
        }

        setIsSummarizing(true);
        setShowPanel('none');
        setModalType('none');

        try {
            let processedCount = 0;
            const newMemories: MemoryFragment[] = [];
            const templateObj = archivePrompts.find(p => p.id === selectedPromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
            const template = templateObj.content;

            for (const dateStr of datesToProcess) {
                const dayMsgs = msgsByDate[dateStr];
                const rawLog = dayMsgs.map(m => formatMemoryArchiveLine(m, {
                    charName: char.name,
                    userName: userProfile.name,
                    imageLabel: '[Image]',
                    formatEmoji: false,
                    formatTime,
                })).join('\n');

                let prompt = template;
                prompt = prompt.replace(/\$\{dateStr\}/g, dateStr);
                prompt = prompt.replace(/\$\{char\.name\}/g, char.name);
                prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
                prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.5,
                        max_tokens: 8000
                    })
                });

                if (!response.ok) throw new Error(`API Error on ${dateStr}`);
                const data = await safeResponseJson(response);
                let summary = data.choices?.[0]?.message?.content || '';
                summary = summary.trim().replace(/^["']|["']$/g, '');

                if (summary) {
                    newMemories.push({ id: `mem-${Date.now()}`, date: dateStr, summary: summary, mood: 'archive' });
                    processedCount++;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const finalMemories = [...(char.memories || []), ...newMemories];
            updateCharacter(char.id, { memories: finalMemories });
            addToast(`成功归档 ${processedCount} 天`, 'success');

        } catch (e: any) {
            addToast(`归档中断: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
        }
    };

    // --- Message Management ---
    const handleDeleteMessage = async () => {
        if (!selectedMessage) return;
        // P7: Clean up voice audio blob from IDB if this is a voice message
        if (selectedMessage.type === 'voice') {
            await DB.deleteVoiceAudio(selectedMessage.id);
        }
        await DB.deleteMessage(selectedMessage.id);
        setMessages(prev => prev.filter(m => m.id !== selectedMessage.id));

        // 清理由于此条消息引发的心理状态残留
        if (char && char.moodState && typeof char.moodState === 'object') {
            updateCharacter(char.id, { 
                moodState: { 
                    ...(char.moodState as any), 
                    innerVoice: '', 
                    surfaceEmotion: '平静' 
                } 
            });
        }

        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除 (心境已复位)', 'success');
    };

    const confirmEditMessage = async () => {
        if (!selectedMessage) return;
        await DB.updateMessage(selectedMessage.id, editContent);
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, content: editContent } : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已修改', 'success');
    };

    const handleReplyMessage = () => {
        if (!selectedMessage) return;
        setReplyTarget({
            ...selectedMessage,
            metadata: {
                ...selectedMessage.metadata,
                senderName: selectedMessage.role === 'user' ? '我' : (char?.name || '角色'),
            }
        });
        setModalType('none');
        setSelectedMessage(null);
    };

    const handleCopyMessage = () => {
        if (!selectedMessage) return;
        navigator.clipboard.writeText(selectedMessage.content);
        setModalType('none');
        setSelectedMessage(null);
        addToast('已复制到剪贴板', 'success');
    };

    // --- Voice: Read Aloud (in-place conversion: text → voice) ---
    const handleReadAloud = useCallback(async () => {
        if (!selectedMessage || !characterTtsConfig?.apiKey) {
            addToast('请先在设置中配置 TTS', 'error');
            setModalType('none');
            return;
        }
        const msg = selectedMessage;
        setModalType('none');
        setSelectedMessage(null);

        console.log('[ReadAloud] Starting TTS for msg:', msg.id, 'text:', msg.content.slice(0, 50));

        // For bilingual messages: TTS synthesizes only the original text (langA),
        // but sourceText keeps the full bilingual content for "转文字" display
        const { langA: ttsText } = parseBilingual(msg.content);

        // 1. Convert the original message from text → voice in-place
        await DB.updateMessageType(msg.id, 'voice', {
            sourceText: msg.content, // Full content (with bilingual marker) for transcript
            hasAudio: false,
            duration: 0,
            source: 'read-aloud',
        });

        // 2. Start synthesis (uses original text only, not translated)
        const synthesisPromise = synthesizeForMessage(msg.id, ttsText, characterTtsConfig, undefined, {
            reason: '手动朗读 TTS 合成',
            conversationId: char?.id,
            messageId: msg.id,
            userInitiated: true,
        });

        // 3. Reload messages to show voice bubble at the original position
        await reloadMessages(visibleCountRef.current);

        // 4. Wait for synthesis to complete
        try {
            const result = await synthesisPromise;
            if (result) {
                // sourceText already set above; synthesizeForMessage already set duration + hasAudio
                await reloadMessages(visibleCountRef.current);
                addToast('语音合成完成', 'success');
            } else {
                // Synthesis returned null (e.g. aborted) — revert to text
                await DB.updateMessageType(msg.id, 'text');
                await reloadMessages(visibleCountRef.current);
                addToast('TTS 合成失败（结果为空），已恢复文字', 'error');
            }
        } catch (err: any) {
            console.error('[ReadAloud] TTS error:', err);
            // Revert message back to text on failure
            await DB.updateMessageType(msg.id, 'text');
            await DB.deleteVoiceAudio(msg.id); // Clean up any partial audio
            await reloadMessages(visibleCountRef.current);
            addToast(`TTS 合成失败: ${err?.message || err}，已恢复文字`, 'error');
        }
    }, [selectedMessage, characterTtsConfig, synthesizeForMessage, reloadMessages]);

    // --- Voice: Convert to Text (toggle inline transcript) ---
    const handleVoiceToText = useCallback(() => {
        if (!selectedMessage || selectedMessage.type !== 'voice') return;
        const msgId = selectedMessage.id;
        setExpandedVoiceTextIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
        setModalType('none');
        setSelectedMessage(null);
    }, [selectedMessage]);

    const toggleVoiceText = useCallback((msgId: number) => {
        setExpandedVoiceTextIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    // --- Voice: Download Audio ---
    const handleDownloadVoice = useCallback(async () => {
        if (!selectedMessage || selectedMessage.type !== 'voice') return;
        const msgId = selectedMessage.id;
        setModalType('none');
        setSelectedMessage(null);

        const blob = await DB.getVoiceAudio(msgId);
        if (!blob) {
            addToast('音频文件不存在', 'error');
            return;
        }

        const filename = `voice_${char?.name || 'character'}_${new Date().toISOString().slice(0, 10)}_${msgId}.mp3`;

        // Try navigator.share first (works on mobile PWA)
        if (navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file] });
                    return;
                }
            } catch (err: any) {
                // User cancelled share or not supported — fall through to download
                if (err?.name === 'AbortError') return;
            }
        }

        // Fallback: create <a> download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('语音已保存', 'success');
    }, [selectedMessage, char, addToast]);

    const handleDeleteEmoji = async () => {
        if (!selectedEmoji) return;
        await DB.deleteEmoji(selectedEmoji.name);
        await loadEmojiData();
        setModalType('none');
        setSelectedEmoji(null);
        addToast('表情包已删除', 'success');
    };

    // --- Batch Selection ---
    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const toggleMessageSelection = useCallback((id: number) => {
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Memoized callbacks for MessageItem to avoid busting React.memo
    const handleMessageLongPress = useCallback((msg: Message) => {
        setSelectedMessage(msg);
        setModalType('message-options');
    }, []);

    // --- Transfer Action ---
    const handleTransferAction = useCallback((msg: Message) => {
        setTransferActionMsg(msg);
    }, []);

    // --- Voice Retry (stable ref to avoid busting React.memo on every render) ---
    const handleRetryVoice = useMemo(() => {
        if (!characterTtsConfig?.apiKey) return undefined;
        return (msgId: number) => {
            const msg = messagesRef.current.find(m => m.id === msgId);
            if (!msg || !characterTtsConfig) return;
            let text = msg.metadata?.sourceText || msg.content;
            // Strip <语音>/<語音> XML tags for compat messages (原版导入的 text 消息含标签)
            const xmlVoiceMatch = text.match(/^[\s]*<[语語]音>([\s\S]+?)<\/[语語]音>[\s]*$/);
            if (xmlVoiceMatch) text = xmlVoiceMatch[1].trim();
            synthesizeForMessage(msgId, text, characterTtsConfig, undefined, {
                reason: 'TTS 失败重试',
                conversationId: char?.id,
                messageId: msgId,
                retryCount: 1,
                userInitiated: true,
            }).then(async (result) => {
                if (result) {
                    await reloadMessages(visibleCountRef.current);
                    addToast('语音合成完成', 'success');
                }
            }).catch(err => {
                console.error('[RetryVoice] synthesis failed:', err);
                addToast(`重试合成失败: ${err?.message || err}`, 'error');
            });
        };
    }, [characterTtsConfig, synthesizeForMessage, reloadMessages, addToast]);

    const handleTransferStatusUpdate = async (status: 'accepted' | 'returned') => {
        if (!transferActionMsg || !char) return;
        await DB.updateMessageMetadata(transferActionMsg.id, { status });
        // Update local state immediately
        setMessages(prev => prev.map(m => m.id === transferActionMsg.id ? { ...m, metadata: { ...m.metadata, status } } : m));
        setTransferActionMsg(null);
        const isFromUser = transferActionMsg.role === 'user';
        const amt = transferActionMsg.metadata?.amount || '?';
        if (status === 'accepted') {
            addToast(isFromUser ? `${char.name} 已收取 ¥${amt}` : `你已收取 ¥${amt}`, 'success');
        } else {
            addToast(isFromUser ? `${char.name} 已退还 ¥${amt}` : `你已退还 ¥${amt}`, 'info');
        }
    };

    const handleBatchDelete = async () => {
        if (selectedMsgIds.size === 0) return;
        const deleteCount = selectedMsgIds.size;
        // P7: Clean up voice audio blobs for any voice messages being deleted
        const voiceMsgIds = messages.filter(m => selectedMsgIds.has(m.id) && m.type === 'voice').map(m => m.id);
        for (const vid of voiceMsgIds) {
            await DB.deleteVoiceAudio(vid);
        }
        await DB.deleteMessages(Array.from(selectedMsgIds));
        setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)));
        addToast(`已删除 ${deleteCount} 条消息`, 'success');
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
    };

    // --- Forward Chat Records ---
    const [showForwardModal, setShowForwardModal] = useState(false);

    const handleForwardSelected = () => {
        if (selectedMsgIds.size === 0) return;
        setShowForwardModal(true);
    };

    const handleForwardToCharacter = async (targetCharId: string) => {
        if (!char) return;
        const selectedMsgs = messages
            .filter(m => selectedMsgIds.has(m.id))
            .sort((a, b) => a.id - b.id);

        if (selectedMsgs.length === 0) return;

        // Build preview text (first few messages)
        const previewLines = selectedMsgs.slice(0, 4).map(m => {
            const sender = m.role === 'user' ? userProfile.name : char.name;
            const text = m.type === 'text' ? m.content.slice(0, 30)
                : m.type === 'voice' ? (() => {
                    const dur = m.metadata?.duration ? `${m.metadata.duration}″` : '';
                    const src = m.metadata?.sourceText?.slice(0, 20);
                    return src ? `语音${dur}: "${src}"` : `语音${dur || ''}`;
                })()
                    : m.type === 'image' ? '[图片]'
                        : m.type === 'emoji' ? '[表情]'
                            : `[${m.type}]`;
            return `${sender}: ${text}`;
        });
        if (selectedMsgs.length > 4) previewLines.push(`... 共 ${selectedMsgs.length} 条消息`);

        const forwardData = {
            fromUserName: userProfile.name,
            fromCharName: char.name,
            count: selectedMsgs.length,
            preview: previewLines,
            messages: selectedMsgs.map(m => ({
                role: m.role,
                type: m.type,
                content: m.content,
                metadata: m.metadata,
                timestamp: m.timestamp || Date.now()
            }))
        };

        // Save forward card to target character's chat
        await DB.saveMessage({
            charId: targetCharId,
            role: 'user',
            type: 'chat_forward' as MessageType,
            content: JSON.stringify(forwardData),
        });

        // Also save a copy in the current chat so the user can see what they forwarded
        const targetChar = characters.find(c => c.id === targetCharId);
        if (char.id !== targetCharId) {
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text' as MessageType,
                content: `[转发了 ${selectedMsgs.length} 条聊天记录给 ${targetChar?.name || ''}]`,
            });
            // Refresh messages to show the forwarding system message
            reloadMessages(visibleCountRef.current);
        }

        addToast(`已转发 ${selectedMsgs.length} 条记录给 ${targetChar?.name || ''}`, 'success');
        setShowForwardModal(false);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
    };

    const displayMessages = useMemo(() => {
        return getDisplayableMainChatMessages(messages, {
            hideBeforeMessageId: char?.hideBeforeMessageId,
            hideSystemLogs: char?.hideSystemLogs,
        }).slice(-visibleCount);
    }, [messages, char?.hideBeforeMessageId, char?.hideSystemLogs, visibleCount]);

    useEffect(() => {
        if (!highlightedMessageId) return;

        const frame = window.requestAnimationFrame(() => {
            const target = messageRefs.current[highlightedMessageId];
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            pendingTargetScrollRef.current = false;
        });

        const clearTimer = window.setTimeout(() => {
            setHighlightedMessageId(current => current === highlightedMessageId ? null : current);
        }, 2600);

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(clearTimer);
        };
    }, [displayMessages, highlightedMessageId]);

    const canReroll = !isTyping && displayMessages.length > 0 && displayMessages[displayMessages.length - 1].role === 'assistant';

    const lastAssistantId = useMemo(() => {
        for (let i = displayMessages.length - 1; i >= 0; i -= 1) {
            if (displayMessages[i].role === 'assistant') return displayMessages[i].id;
        }
        return null;
    }, [displayMessages]);

    const scopedTodaySchedule = todaySchedule?.charId === char?.id ? todaySchedule : null;
    const todayScheduleItems = scopedTodaySchedule?.effectiveItems || [];
    const todayScheduleRevisionCount = scopedTodaySchedule?.revisions?.length || 0;
    const todayScheduleUserLabel = userProfile.name?.trim() || '你';
    const formatTodayScheduleText = (value?: string | null) => {
        if (!value) return '';
        return value
            .replace(/\buser\b/gi, todayScheduleUserLabel)
            .replace(/用户/g, todayScheduleUserLabel);
    };
    const todayCalendarLabels = calendarContext?.todayLabels || [];
    const { visibleLabels: visibleTodayCalendarLabels, hiddenCount: hiddenTodayCalendarLabelCount } = getCalendarDisplayLabels(todayCalendarLabels);
    const todayScheduleBadgeText = scopedTodaySchedule?.status === 'failed'
        ? '未接上'
        : todayScheduleRevisionCount > 0
            ? `${todayScheduleRevisionCount} 处改写`
            : todayScheduleItems.length > 0
                ? `${todayScheduleItems.length} 段`
                : '待同步';

    // Reset active category if it becomes invisible for the current character
    useEffect(() => {
        if (activeCategory !== 'default' && userVisibleCategories.length > 0 && !userVisibleCategories.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    }, [userVisibleCategories, activeCategory]);

    // Build a set of hidden category IDs for quick lookup (user panel perspective)
    const hiddenCategoryIds = useMemo(() => {
        const visible = new Set(userVisibleCategories.map(c => c.id));
        return new Set(categories.filter(c => !visible.has(c.id)).map(c => c.id));
    }, [categories, userVisibleCategories]);

    // Memoize filtered emojis for ChatInputArea
    const filteredEmojis = useMemo(() => emojis.filter(e => {
        // Exclude emojis from hidden categories
        if (e.categoryId && hiddenCategoryIds.has(e.categoryId)) return false;
        if (activeCategory === 'default') return !e.categoryId || e.categoryId === 'default';
        return e.categoryId === activeCategory;
    }), [emojis, activeCategory, hiddenCategoryIds]);

    // All visible emojis (cross-category) for auto-suggest while typing
    const allVisibleEmojis = useMemo(() => emojis.filter(e => {
        if (e.categoryId && hiddenCategoryIds.has(e.categoryId)) return false;
        return true;
    }), [emojis, hiddenCategoryIds]);

    // Memoize ChatInputArea callbacks
    const handleSendCallback = useCallback(() => handleSendText(), [char, input, replyTarget]);
    const handleCharSelectCallback = useCallback((id: string) => { setActiveCharacterId(id); setShowPanel('none'); }, []);

    // --- Voice Recording → STT → AI Handler ---
    const handleVoiceRecordMessage = useCallback(async (blob: Blob, duration: number) => {
        if (!char) return;
        haptic.medium();

        try {
            // 1. Save user voice message (visual bubble) immediately
            const voiceMsgId = await DB.saveMessage({
                charId: char.id,
                role: 'user',
                type: 'voice',
                content: '', // will be filled with transcribed text
                metadata: {
                    duration,
                    source: 'user-recording',
                    hasAudio: true,
                    sttStatus: 'pending',
                    transcribedText: '',
                },
            });

            // 2. Save audio blob to IDB
            await DB.saveVoiceAudio(voiceMsgId, blob);

            // 3. Update UI immediately — user sees their voice bubble
            await reloadMessages(visibleCountRef.current);

            setSttProcessing(true);

            // 4. Run Whisper STT in background (with 15s timeout)
            let transcribedText = '';
            let sttFailed = false;

            try {
                const result = await CloudStt.transcribe(blob, sttConfig, 15000);
                transcribedText = result.text;

                // 如果 SenseVoice 返回了情绪标签，写入 metadata
                if (result.emotion) {
                    await DB.updateMessageMetadata(voiceMsgId, { emotion: result.emotion });
                }
            } catch (sttErr: any) {
                console.error('🎤 [STT] Transcription failed:', sttErr);
                sttFailed = true;

                // 未配置 Key — 给用户明确提示
                if (sttErr instanceof SttNotConfiguredError) {
                    addToast('请先在设置中配置语音识别 API Key', 'error');
                } else {
                    // 显示具体错误原因，帮助用户排查
                    const reason = sttErr?.message || String(sttErr);
                    addToast(`语音识别失败: ${reason.slice(0, 150)}`, 'error');
                }
            }

            setSttProcessing(false);

            if (transcribedText.trim()) {
                // ✅ STT 成功 — 正常流程
                await DB.updateMessage(voiceMsgId, transcribedText);
                await DB.updateMessageMetadata(voiceMsgId, { sttStatus: 'done', transcribedText });
            } else {
                // ❌ STT 失败或识别为空 — fallback：告诉 AI 用户发了语音但没法识别
                await DB.updateMessage(voiceMsgId, `[语音消息 ${duration}秒]`);
                await DB.updateMessageMetadata(voiceMsgId, {
                    sttStatus: sttFailed ? 'failed' : 'empty',
                    transcribedText: '',
                });
            }

            // 5. Refresh UI — 不自动触发 AI（与文字消息一致，用户点按钮手动触发）
            await reloadMessages(visibleCountRef.current);
            BackendAgentManager.notifyUserReplied(char.id).catch(() => {});
            void BackendAgentManager.refreshCharacterContext(char.id, char);
        } catch (err) {
            console.error('🎤 [VoiceRecord] Error:', err);
            addToast('语音消息发送失败', 'error');
            setSttProcessing(false);
        }
    }, [char, addToast, reloadMessages, sttConfig]);

    if (!char) {
        return (
            <div className="flex h-full flex-col items-center justify-center bg-slate-100 px-6 text-center text-slate-600">
                <div className="mb-3 h-12 w-12 animate-pulse rounded-full bg-white shadow-sm" />
                <h2 className="text-base font-semibold text-slate-700">角色资料同步中</h2>
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-500">
                    刚刚的人设改动还在切换到聊天页，等角色信息就绪后会自动进入对话。
                </p>
                <button
                    onClick={closeApp}
                    className="mt-5 rounded-full bg-slate-800 px-4 py-2 text-xs font-medium text-white transition-transform active:scale-95"
                >
                    返回桌面
                </button>
            </div>
        );
    }

    const activeCharName = char.name || '';

    return (
        <div
            className={`sully-chat-container flex flex-col h-full bg-[#f1f5f9] overflow-hidden relative font-sans transition-[background-image] duration-500 theme-${activeTheme.baseThemeId || activeTheme.id}`}
            style={{
                backgroundImage: char.chatBackground ? `url(${char.chatBackground})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
        >
            {activeTheme.customCss && <style>{activeTheme.customCss}</style>}

            <ChatModals
                modalType={modalType} setModalType={setModalType}
                transferAmt={transferAmt} setTransferAmt={setTransferAmt}
                emojiImportText={emojiImportText} setEmojiImportText={setEmojiImportText}
                settingsContextLimit={settingsContextLimit} setSettingsContextLimit={setSettingsContextLimit}
                settingsHideSysLogs={settingsHideSysLogs} setSettingsHideSysLogs={setSettingsHideSysLogs}
                preserveContext={preserveContext} setPreserveContext={setPreserveContext}
                editContent={editContent} setEditContent={setEditContent}
                archivePrompts={archivePrompts} selectedPromptId={selectedPromptId} setSelectedPromptId={setSelectedPromptId}
                editingPrompt={editingPrompt} setEditingPrompt={setEditingPrompt} isSummarizing={isSummarizing}
                selectedMessage={selectedMessage} selectedEmoji={selectedEmoji} activeCharacter={char} userProfile={userProfile} messages={messages}
                allHistoryMessages={allHistoryMessages}

                newCategoryName={newCategoryName} setNewCategoryName={setNewCategoryName} onAddCategory={handleAddCategory}
                selectedCategory={selectedCategory}

                onTransfer={() => {
                    const amt = parseFloat(transferAmt);
                    if (!transferAmt || isNaN(amt) || amt <= 0) { addToast('请输入有效金额', 'error'); return; }
                    handleSendText(`[转账]`, 'transfer', { amount: amt.toFixed(2), status: 'pending' });
                    setTransferAmt('');
                    setModalType('none');
                }}
                onImportEmoji={handleImportEmoji}
                onSaveSettings={saveSettings} onBgUpload={handleBgUpload} onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                onClearHistory={handleClearHistory} onArchive={handleFullArchive}
                onCreatePrompt={createNewPrompt} onEditPrompt={editSelectedPrompt} onSavePrompt={handleSavePrompt} onDeletePrompt={handleDeletePrompt}
                onSetHistoryStart={handleSetHistoryStart} onEnterSelectionMode={handleEnterSelectionMode}
                onCloseMessageOptions={() => { setModalType('none'); setSelectedMessage(null); }}
                onReplyMessage={handleReplyMessage} onEditMessageStart={() => { if (selectedMessage) { setEditContent(selectedMessage.content); setModalType('edit-message'); } }}
                onConfirmEditMessage={confirmEditMessage} onDeleteMessage={handleDeleteMessage} onCopyMessage={handleCopyMessage} onDeleteEmoji={handleDeleteEmoji} onDeleteCategory={handleDeleteCategory}
                allCharacters={characters} onSaveCategoryVisibility={handleSaveCategoryVisibility}
                translationEnabled={translationEnabled}
                onToggleTranslation={() => { const next = !translationEnabled; setTranslationEnabled(next); localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next)); if (!next) { setShowingTargetIds(new Set()); } }}
                translateSourceLang={translateSourceLang}
                translateTargetLang={translateTargetLang}
                onSetTranslateSourceLang={(lang: string) => { setTranslateSourceLang(lang); localStorage.setItem('chat_translate_source_lang', lang); setShowingTargetIds(new Set()); }}
                onSetTranslateLang={(lang: string) => { setTranslateTargetLang(lang); localStorage.setItem('chat_translate_lang', lang); setShowingTargetIds(new Set()); }}
                xhsEnabled={!!char.xhsEnabled}
                onToggleXhs={() => updateCharacter(char.id, { xhsEnabled: !char.xhsEnabled })}
                showTimestampSetting={isTimestampForced || showTimestampSetting}
                isTimestampForced={isTimestampForced}
                onToggleTimestamp={() => {
                    if (isTimestampForced) return;
                    const next = !showTimestampSetting;
                    setShowTimestampSetting(next);
                    localStorage.setItem(`chat_show_timestamp_${activeCharacterId}`, JSON.stringify(next));
                }}
                onReadAloud={characterTtsConfig?.apiKey ? handleReadAloud : undefined}
                onVoiceToText={handleVoiceToText}
                onDownloadVoice={handleDownloadVoice}
                autoTts={autoTts}
                onToggleAutoTts={() => {
                    if (!autoTts && !ttsConfig?.apiKey) {
                        addToast('请先在全局设置中配置 TTS API Key', 'error');
                        return;
                    }
                    const next = !autoTts;
                    setAutoTts(next);
                    localStorage.setItem(`chat_auto_tts_${activeCharacterId}`, JSON.stringify(next));
                }}
                autoCall={autoCall}
                onToggleAutoCall={() => {
                    const next = !autoCall;
                    setAutoCall(next);
                    localStorage.setItem(`chat_auto_call_${activeCharacterId}`, JSON.stringify(next));
                }}
                autoShareSong={autoShareSong}
                onToggleAutoShareSong={() => {
                    const next = !autoShareSong;
                    setAutoShareSong(next);
                    localStorage.setItem(`chat_auto_share_song_${activeCharacterId}`, JSON.stringify(next));
                }}
                injectPlaybackContext={injectPlaybackContext}
                onToggleInjectPlaybackContext={() => {
                    const next = !injectPlaybackContext;
                    setInjectPlaybackContext(next);
                    localStorage.setItem(`chat_inject_playback_context_${activeCharacterId}`, JSON.stringify(next));
                }}
                statusBarMode={char.statusBarMode || 'classic'}
                onStatusBarModeChange={(mode: string) => {
                    updateCharacter(char.id, { statusBarMode: mode as any });
                }}
                customStatusTemplates={char.customStatusTemplates}
                onSaveCustomTemplate={(tpl) => {
                    const { _setActiveOnly, ...templateToSave } = tpl;
                    if (_setActiveOnly) {
                        updateCharacter(char.id, {
                            activeCustomTemplateId: tpl.id,
                            statusBarMode: 'custom',
                        });
                    } else {
                        const currentTemplates = char.customStatusTemplates || [];
                        const hasExistingTemplate = currentTemplates.some(existing => existing.id === templateToSave.id);
                        const nextTemplates = hasExistingTemplate
                            ? currentTemplates.map(existing => (
                                existing.id === templateToSave.id
                                    ? { ...existing, ...templateToSave }
                                    : existing
                            ))
                            : [...currentTemplates, templateToSave];

                        updateCharacter(char.id, {
                            customStatusTemplates: nextTemplates,
                            activeCustomTemplateId: templateToSave.id,
                            statusBarMode: 'custom',
                        });
                        addToast('自定义方案已保存', 'success');
                    }
                }}
                showThinking={THINKING_CHAIN_UI_ENABLED && char.showThinking !== false}
                onToggleShowThinking={THINKING_CHAIN_UI_ENABLED ? () => updateCharacter(char.id, { showThinking: char.showThinking === false ? true : false }) : undefined}
                newspaperEnabled={newspaperFeatureEnabled}
                onToggleNewspaper={handleToggleNewspaperFeature}
                newspaperGenerating={isYesterdayNewspaperGenerating}
                onGenerateNewspaperPeriod={handleGenerateNewspaperPeriod}
                todayScheduleEnabled={todayScheduleFeatureEnabled}
                onToggleTodaySchedule={handleToggleTodayScheduleFeature}
                photoStylePresets={activePhotoStylePresets}
                photoConfigReady={isImageGenerationConfigured(effectiveImageGenerationConfig)}
                manualPhotoGenerating={manualPhotoGenerating}
                imageProviderType={effectiveImageGenerationConfig.activeProvider}
                savedVibeReferences={savedVibeReferences}
                onManualPhotoGenerate={handleManualPhotoGenerate}
                onSaveVibeReference={handleSaveVibeReference}
                onImportVibeFile={handleImportVibeFile}
                onRenameSavedVibe={handleRenameSavedVibe}
                onDeleteSavedVibe={handleDeleteSavedVibe}
                onClearSavedVibeCache={handleClearSavedVibeCache}
                onToggleManualPhoto={() => updateCharacter(char.id, { manualPhotoEnabled: !char.manualPhotoEnabled })}
                onToggleAutoPhoto={() => updateCharacter(char.id, { autoPhotoEnabled: !char.autoPhotoEnabled })}
                onSetDefaultPhotoStyle={(styleId: string) => {
                    const boundIds = char.boundPhotoStylePresetIds && char.boundPhotoStylePresetIds.length > 0
                        ? Array.from(new Set([...char.boundPhotoStylePresetIds, styleId]))
                        : undefined;
                    updateCharacter(char.id, { defaultPhotoStylePresetId: styleId, boundPhotoStylePresetIds: boundIds });
                }}
                onToggleBoundPhotoStyle={handleToggleBoundPhotoStyle}
                onToggleDefaultVibeReference={handleToggleDefaultVibeReference}
                onSaveNaiAppearance={handleSaveNaiAppearance}
            />

            <ChatHeader
                selectionMode={selectionMode}
                selectedCount={selectedMsgIds.size}
                onCancelSelection={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); }}
                activeCharacter={char}
                isTyping={isTyping}
                isSummarizing={isSummarizing}
                lastTokenUsage={lastTokenUsage}
                tokenBreakdown={tokenBreakdown}
                onClose={closeApp}
                onTriggerAI={() => triggerAI(messages)}
                onShowCharsPanel={() => setShowPanel('chars')}
                onCallPress={() => { unlockAudio(); openApp(AppID.VoiceCall, { direction: 'outgoing' }); }}
            />

            {!selectionMode && todayScheduleFeatureEnabled && !isTodayScheduleEntryHidden && (
                <div className="pointer-events-none absolute right-3 top-[calc(6rem+0.75rem)] z-20 flex justify-end">
                    <div className="font-schedule-serif pointer-events-auto inline-flex max-w-[82vw] items-center gap-1 overflow-hidden rounded-full border border-[#eadfd2]/80 bg-[#fffaf2]/80 shadow-[0_10px_28px_rgba(80,62,44,0.08)] backdrop-blur-md">
                        <button
                            type="button"
                            onClick={handleOpenTodaySchedule}
                            className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-transform active:scale-[0.98]"
                        >
                            <span className="font-sans shrink-0 text-[10px] font-semibold tracking-[0.22em] text-[#c98b84]">TODAY</span>
                            <span className="truncate text-[13px] font-normal tracking-[0.04em] text-[#5f5047]">今日行程</span>
                            <span className="font-sans shrink-0 rounded-full bg-[#342722] px-2.5 py-1 text-[10px] font-medium text-white shadow-sm">
                                {todayScheduleBadgeText}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.setItem(`chat_today_schedule_entry_hidden_${char.id}`, 'true');
                                setIsTodayScheduleEntryHidden(true);
                            }}
                            className="font-sans mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#b8a99d] shadow-sm active:scale-95"
                            aria-label="隐藏今日行程入口"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {!selectionMode && todayScheduleFeatureEnabled && isTodayScheduleEntryHidden && (
                <div className="pointer-events-none absolute right-3 top-[calc(6rem+0.75rem)] z-20 flex justify-end">
                    <button
                        type="button"
                        onClick={() => {
                            localStorage.setItem(`chat_today_schedule_entry_hidden_${char.id}`, 'false');
                            setIsTodayScheduleEntryHidden(false);
                            handleOpenTodaySchedule();
                        }}
                        className="font-schedule-serif pointer-events-auto rounded-full border border-[#eadfd2]/80 bg-[#fffaf2]/80 px-3 py-1.5 text-[12px] tracking-[0.04em] text-[#5f5047] shadow-sm backdrop-blur-md active:scale-95"
                    >
                        今日行程
                    </button>
                </div>
            )}

            {DATE_WORLDLINE_ORB_ENABLED && DateWorldlineOrb && !selectionMode && (
                <React.Suspense fallback={null}>
                    <DateWorldlineOrb
                        charId={char.id}
                        charName={char.name}
                        userName={userProfile.name}
                        isBusy={isTyping}
                        onStartDiscussion={handleWorldlineStartDiscussion}
                        onLaunch={handleWorldlineLaunch}
                    />
                </React.Suspense>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto pt-6 pb-6 no-scrollbar" style={{ backgroundImage: activeTheme.type === 'custom' && activeTheme.user.backgroundImage ? 'none' : undefined }}>
                {hasMoreHistory && (
                    <div className="flex justify-center mb-6">
                        <button onClick={async () => {
                            const nextVisibleCount = visibleCount + LOAD_BATCH_SIZE;
                            visibleCountRef.current = nextVisibleCount;
                            setVisibleCount(nextVisibleCount);
                            await reloadMessages(nextVisibleCount);
                        }} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors">
                            {visibleCount > LOAD_BATCH_SIZE ? '继续加载历史消息' : '加载历史消息'}
                        </button>
                    </div>
                )}

                {isHistoryLoading && displayMessages.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-slate-400">
                        正在载入最近的聊天记录...
                    </div>
                )}

                {todayScheduleFeatureEnabled && todayLifeSyncText && (
                    <div className="mx-auto mb-5 flex w-fit max-w-[82%] items-center gap-2 rounded-full border border-white/60 bg-white/65 px-3.5 py-2 text-[11px] text-slate-500 shadow-sm backdrop-blur-md">
                        <span className={`h-1.5 w-1.5 rounded-full ${todayLifeSyncTone === 'ready' ? 'bg-emerald-300' : 'bg-slate-300'}`} />
                        <span>{todayLifeSyncText}</span>
                    </div>
                )}

                {!selectionMode && newspaperFeatureEnabled && yesterdayNewspaperRecords.length > 0 && (
                    <YesterdayNewspaperDeliveryStack
                        records={yesterdayNewspaperRecords}
                        onOpen={handleOpenYesterdayNewspaper}
                        onRetry={handleRetryYesterdayNewspaper}
                    />
                )}

                {displayMessages.map((m, i) => {
                    const prevRole = i > 0 ? displayMessages[i - 1].role : null;
                    const nextRole = i < displayMessages.length - 1 ? displayMessages[i + 1].role : null;
                    const prevMsg = i > 0 ? displayMessages[i - 1] : null;
                    const showTs = effectiveShowTimestamp && (!prevMsg || (m.timestamp - prevMsg.timestamp) >= timestampInterval);
                    // Inner voice: only show on the last assistant message
                    const isLastAssistant = m.role === 'assistant' && m.id === lastAssistantId;
                    const statusMode = char.statusBarMode || 'classic';
                    const hasStatusCardMode = statusMode === 'creative' || statusMode === 'custom' || statusMode === 'freeform';
                    return (
                        <div
                            key={m.id || i}
                            ref={(node) => { messageRefs.current[m.id] = node; }}
                            data-chat-message-id={m.id}
                            className={`rounded-2xl transition-[background-color,box-shadow] duration-500 ${
                                highlightedMessageId === m.id
                                    ? 'bg-amber-100/30 shadow-[0_0_0_2px_rgba(251,191,36,0.72),0_12px_28px_rgba(251,191,36,0.18)]'
                                    : ''
                            }`}
                        >
                            <MessageItem
                                msg={m}
                                isFirstInGroup={prevRole !== m.role}
                                isLastInGroup={nextRole !== m.role}
                                activeTheme={activeTheme}
                                charAvatar={char.avatar}
                                charName={activeCharName}
                                userAvatar={userProfile.avatar}
                                onLongPress={handleMessageLongPress}
                                selectionMode={selectionMode}
                                isSelected={selectedMsgIds.has(m.id)}
                                onToggleSelect={toggleMessageSelection}
                                translationEnabled={translationEnabled && m.type === 'text' && m.role === 'assistant'}
                                isShowingTarget={showingTargetIds.has(m.id)}
                                onTranslateToggle={handleTranslateToggle}
                                onTransferAction={handleTransferAction}
                                showTimestamp={showTs}
                                timestampValue={m.timestamp}
                                onPlayVoice={playVoice}
                                onStopVoice={stopVoice}
                                onRetryVoice={handleRetryVoice}
                                playingMsgId={playingMsgId}
                                loadingMsgIds={loadingMsgIds}
                                isVoiceTextExpanded={expandedVoiceTextIds.has(m.id)}
                                onToggleVoiceText={toggleVoiceText}
                                innerVoice={isLastAssistant && statusMode === 'classic' ? (char.moodState as any)?.innerVoice : undefined}
                                statusCardData={isLastAssistant && hasStatusCardMode ? char.lastStatusCard : undefined}
                                onRetryInnerVoice={isLastAssistant && statusMode !== 'off' && statusMode !== 'story_phone' ? retryMindSnapshot : undefined}
                                onOpenStoryPhone={isLastAssistant && statusMode === 'story_phone' && !m.metadata?.storyPhoneConsumed ? handleOpenStoryPhone : undefined}
                                showThinking={THINKING_CHAIN_UI_ENABLED && char.showThinking !== false}
                            />
                        </div>
                    );
                })}

                {(isTyping || recallStatus || searchStatus || diaryStatus || weiboStatus) && !selectionMode && (
                    <div className="flex items-start gap-2.5 px-3 mb-4 animate-fade-in">
                        <img src={char.avatar} className="w-9 h-9 rounded-[4px] object-cover bg-slate-200" />
                        <div className="sully-typing-bubble bg-white px-3 py-2 rounded-lg shadow-sm relative">
                            {/* Typing indicator tail */}
                            {!activeTheme.ai.hideTail && (
                                <svg className="sully-typing-tail absolute top-[12px] -left-[5.5px] w-[6px] h-[10px] pointer-events-none" style={{ fill: '#ffffff' }}><polygon points="6,0 0,5 6,10" /></svg>
                            )}
                            {searchStatus ? (
                                <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    🔍 {searchStatus}
                                </div>
                            ) : recallStatus ? (
                                <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {recallStatus}
                                </div>
                            ) : weiboStatus ? (
                                <div className="flex items-center gap-2 text-xs text-orange-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    📱 {weiboStatus}
                                </div>
                            ) : diaryStatus ? (
                                <div className="flex items-center gap-2 text-xs text-amber-600 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    📖 {diaryStatus}
                                </div>
                            ) : (
                                <div className="flex gap-1"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="relative z-40">
                {replyTarget && (
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <div className="flex items-center gap-2 truncate"><span className="font-bold text-slate-700">正在回复:</span><span className="truncate max-w-[200px]">{getReplyPreviewText(replyTarget)}</span></div>
                        <button onClick={() => setReplyTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">×</button>
                    </div>
                )}

                <ChatInputArea
                    input={input} setInput={handleInputChange}
                    isTyping={isTyping} selectionMode={selectionMode}
                    showPanel={showPanel} setShowPanel={setShowPanel}
                    onSend={handleSendCallback}
                    onDeleteSelected={handleBatchDelete}
                    onForwardSelected={handleForwardSelected}
                    onSoulReflection={() => setShowSoulReflectionPanel(true)}
                    charName={activeCharName}
                    selectedCount={selectedMsgIds.size}
                    emojis={filteredEmojis}
                    allVisibleEmojis={allVisibleEmojis}
                    characters={characters} activeCharacterId={activeCharacterId}
                    onCharSelect={handleCharSelectCallback}
                    customThemes={customThemes} onUpdateTheme={(id) => updateCharacter(char.id, { bubbleStyle: id })}
                    onRemoveTheme={removeCustomTheme} activeThemeId={currentThemeId}
                    onPanelAction={handlePanelAction}
                    onImageSelect={handleImageSelect}
                    manualPhotoEnabled={!!char.manualPhotoEnabled}
                    isSummarizing={isSummarizing}
                    categories={userVisibleCategories}
                    activeCategory={activeCategory}
                    onReroll={handleReroll}
                    canReroll={canReroll}
                    onVoiceMessage={handleVoiceRecordMessage}
                    voiceRecorderState={sttProcessing ? 'processing' : voiceRecorder.state}
                    voiceRecordingDuration={voiceRecorder.duration}
                    onStartRecording={voiceRecorder.startRecording}
                    onStopRecording={voiceRecorder.stopRecording}
                    onCancelRecording={voiceRecorder.cancelRecording}
                    voiceRecorderError={voiceRecorder.error}
                    isVoiceProcessing={sttProcessing}
                    analyserNode={voiceRecorder.analyserNode}
                    isSpeaking={voiceRecorder.isSpeaking}
                />
            </div>

            {newspaperFeatureEnabled && isYesterdayNewspaperOpen && activeNewspaperRecord?.content && (
                <YesterdayNewspaperModal
                    report={activeNewspaperRecord.content}
                    charName={activeCharName}
                    userName={userProfile.name || '你'}
                    onClose={() => setIsYesterdayNewspaperOpen(false)}
                    onRefresh={handleRefreshActiveNewspaper}
                    isRefreshing={isYesterdayNewspaperGenerating}
                    onSaved={() => addToast('小报原图已保存', 'success')}
                    onSaveFailed={() => addToast('小报导出失败，可以稍后再试', 'error')}
                />
            )}

            {todayScheduleFeatureEnabled && isTodayScheduleOpen && (
                <div className="fixed inset-0 z-[96] flex items-end justify-center bg-[#211918]/35 px-0 pb-[calc(var(--safe-bottom)+8px)] pt-[calc(var(--safe-top)+12px)] backdrop-blur-sm sm:items-center sm:p-4">
                    <div className="font-schedule-serif flex max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-20px)] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-[#f0e7dc] bg-[#fbf7ef] shadow-[0_24px_80px_rgba(42,28,22,0.24)] sm:max-h-[86vh] sm:rounded-[28px]">
                        <div className="flex shrink-0 items-start justify-between border-b border-[#eadfd2] bg-[#fffbf5]/70 px-5 py-4">
                            <div>
                                <div className="font-sans text-[10px] font-semibold tracking-[0.3em] text-[#c98b84]">TODAY</div>
                                <h3 className="mt-1 text-xl font-normal tracking-[0.05em] text-[#3f342f]">今日行程</h3>
                                <p className="mt-1 text-[13px] leading-relaxed text-[#8a7a70]">
                                    按时间查看 ta 今天原本的安排；聊天里真的改变了计划时，会在这里划去旧行程，写入新的走向。
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsTodayScheduleOpen(false)}
                                className="font-sans ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#b8a99d] shadow-sm active:scale-95"
                                aria-label="关闭今日行程"
                            >
                                ×
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[calc(1.5rem+var(--safe-bottom))] no-scrollbar overscroll-contain">
                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => void refreshTodaySchedule(true)}
                                    className="font-sans rounded-full border border-[#e5d8ca] bg-white px-3 py-1.5 text-xs text-[#6f6259] shadow-sm active:scale-95"
                                >
                                    {isTodayScheduleLoading ? '同步中...' : '重新同步'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowManualScheduleForm(value => !value)}
                                    className="font-sans rounded-full bg-[#342722] px-3 py-1.5 text-xs text-white shadow-sm active:scale-95"
                                >
                                    手动写入
                                </button>
                                {(scopedTodaySchedule?.localDate || calendarContext?.localDate) && (
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] tracking-[0.03em] text-[#9a8d82] shadow-sm">
                                            {scopedTodaySchedule?.localDate || calendarContext?.localDate}
                                        </span>
                                        {visibleTodayCalendarLabels.map(label => (
                                            <span
                                                key={`${label.kind}-${label.id}`}
                                                className="max-w-[9rem] truncate rounded-full border border-[#f0d5cc] bg-[#fff4f0] px-2.5 py-1 text-[11px] tracking-[0.03em] text-[#c47770] shadow-sm"
                                                title={label.title}
                                            >
                                                {label.title}
                                            </span>
                                        ))}
                                        {hiddenTodayCalendarLabelCount > 0 && (
                                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] tracking-[0.03em] text-[#b0968b] shadow-sm">
                                                +{hiddenTodayCalendarLabelCount}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {showManualScheduleForm && (
                                <div className="font-sans mb-4 rounded-[22px] border border-[#eadfd2] bg-white/80 p-4 shadow-sm">
                                    <div className="mb-3 text-sm font-semibold text-slate-700">手动写入一段变化</div>
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                value={manualScheduleDraft.startTime}
                                                onChange={event => setManualScheduleDraft(prev => ({ ...prev, startTime: event.target.value }))}
                                                placeholder="开始 18:30"
                                                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                            />
                                            <input
                                                value={manualScheduleDraft.endTime}
                                                onChange={event => setManualScheduleDraft(prev => ({ ...prev, endTime: event.target.value }))}
                                                placeholder="结束 20:00"
                                                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                            />
                                        </div>
                                        <input
                                            value={manualScheduleDraft.timeHint}
                                            onChange={event => setManualScheduleDraft(prev => ({ ...prev, timeHint: event.target.value }))}
                                            placeholder="时间段，例如：今晚 / 傍晚 / 下班后"
                                            className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                        />
                                        <input
                                            value={manualScheduleDraft.title}
                                            onChange={event => setManualScheduleDraft(prev => ({ ...prev, title: event.target.value }))}
                                            placeholder="新安排标题"
                                            className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                        />
                                        <textarea
                                            value={manualScheduleDraft.description}
                                            onChange={event => setManualScheduleDraft(prev => ({ ...prev, description: event.target.value }))}
                                            placeholder="这段安排具体发生了什么"
                                            rows={3}
                                            className="w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                        />
                                        <input
                                            value={manualScheduleDraft.reason}
                                            onChange={event => setManualScheduleDraft(prev => ({ ...prev, reason: event.target.value }))}
                                            placeholder={`原因，例如：刚才答应见面 / 临时改口 / ${todayScheduleUserLabel}需要照顾`}
                                            className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                        />
                                        <textarea
                                            value={manualScheduleDraft.innerVoice}
                                            onChange={event => setManualScheduleDraft(prev => ({ ...prev, innerVoice: event.target.value }))}
                                            placeholder="角色心声，可不填"
                                            rows={2}
                                            className="w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-rose-200"
                                        />
                                    </div>
                                    <div className="mt-3 flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowManualScheduleForm(false)}
                                            className="rounded-full px-3 py-1.5 text-xs text-slate-500"
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            disabled={manualScheduleSaving}
                                            onClick={handleSaveManualSchedule}
                                            className="rounded-full bg-rose-400 px-4 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-50"
                                        >
                                            {manualScheduleSaving ? '写入中...' : '保存'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {todayScheduleItems.length === 0 ? (
                                <div className="rounded-[22px] border border-dashed border-[#dccfc2] bg-white/70 px-4 py-8 text-center text-[15px] leading-relaxed tracking-[0.03em] text-[#9a8d82]">
                                    {isTodayScheduleLoading
                                        ? '正在靠近 ta 今天的行程...'
                                        : scopedTodaySchedule?.visibleMessage || '今天的行程还没有稳定内容，可以先聊天，或稍后再打开看看。'}
                                </div>
                            ) : (
                                <div className="overflow-hidden rounded-[22px] border border-[#eadfd2] bg-[#fffdf8]/90 shadow-[0_12px_30px_rgba(80,62,44,0.06)]">
                                    <div className="grid grid-cols-[88px_minmax(0,1fr)] border-b border-[#eadfd2] bg-[#f5efe7] px-4 py-2 font-sans text-[10px] font-semibold tracking-[0.16em] text-[#9a8d82] sm:grid-cols-[112px_minmax(0,1fr)_82px]">
                                        <div>时间</div>
                                        <div>安排</div>
                                        <div className="hidden text-right sm:block">状态</div>
                                    </div>
                                    {todayScheduleItems.map((item, index) => {
                                        const startTimeLabel = item.startTime || item.timeHint || '时间待定';
                                        const endTimeLabel = item.endTime || (item.startTime ? item.timeHint : '');
                                        const statusLabel = item.cancelled
                                            ? '已划去'
                                            : item.kind === 'revision'
                                                ? '改写后'
                                                : '原安排';
                                        const statusClass = item.cancelled
                                            ? 'bg-[#f5f1eb] text-[#a79a8f]'
                                            : item.kind === 'revision'
                                                ? 'bg-[#fff1ee] text-[#c47770]'
                                                : 'bg-[#f3ece3] text-[#7b6f65]';
                                        const rowToneClass = item.cancelled
                                            ? 'opacity-70'
                                            : item.kind === 'revision'
                                                ? 'bg-[#fff8f6]'
                                                : 'bg-[#fffdf8]';

                                        return (
                                            <div
                                                key={item.id}
                                                className={`grid grid-cols-[88px_minmax(0,1fr)] border-b border-[#efe4d8] px-4 py-4 last:border-b-0 sm:grid-cols-[112px_minmax(0,1fr)_82px] ${rowToneClass}`}
                                            >
                                                <div className="relative pr-4">
                                                    <div className={`font-sans text-[12px] font-semibold tabular-nums leading-tight ${item.cancelled ? 'text-[#a79a8f]' : 'text-[#4d413a]'}`}>
                                                        {startTimeLabel}
                                                    </div>
                                                    {endTimeLabel && endTimeLabel !== startTimeLabel && (
                                                        <div className="mt-1 font-sans text-[10px] tabular-nums text-[#b2a59a]">
                                                            至 {endTimeLabel}
                                                        </div>
                                                    )}
                                                    <div className={`absolute right-2 top-5 h-2 w-2 rounded-full border border-white ${item.cancelled ? 'bg-[#c8baae]' : item.kind === 'revision' ? 'bg-[#d98a82]' : 'bg-[#8f7f72]'}`} />
                                                    {index < todayScheduleItems.length - 1 && (
                                                        <div className="absolute right-[11px] top-8 bottom-[-18px] w-px bg-[#e3d8cc]" />
                                                    )}
                                                </div>

                                                <div className="min-w-0 pr-0 sm:pr-4">
                                                    <div className="mb-2 flex flex-wrap items-center gap-2 sm:hidden">
                                                        <span className={`font-sans rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClass}`}>
                                                            {statusLabel}
                                                        </span>
                                                    </div>
                                                    <div className={`text-[17px] font-normal leading-snug tracking-[0.04em] text-[#3f342f] ${item.cancelled ? 'line-through decoration-[#a79a8f] decoration-2' : ''}`}>
                                                        {formatTodayScheduleText(item.title)}
                                                    </div>
                                                    <p className={`mt-2 text-[14px] leading-relaxed tracking-[0.02em] text-[#6f6259] ${item.cancelled ? 'line-through decoration-[#c8baae]' : ''}`}>
                                                        {formatTodayScheduleText(item.description)}
                                                    </p>
                                                    {item.place && (
                                                        <p className="mt-2 font-sans text-[11px] text-[#9a8d82]">地点：{formatTodayScheduleText(item.place)}</p>
                                                    )}
                                                    {(item.reason || item.innerVoice) && (
                                                        <div className="mt-3 border-l border-[#e7d9cc] pl-3 text-[12px] leading-relaxed tracking-[0.02em] text-[#827469]">
                                                            {item.reason && <p><span className="font-sans text-[10px] font-semibold text-[#b0968b]">变更原因：</span>{formatTodayScheduleText(item.reason)}</p>}
                                                            {item.innerVoice && <p className="mt-1 text-[#c47770]"><span className="font-sans text-[10px] font-semibold text-[#b0968b]">心声：</span>{formatTodayScheduleText(item.innerVoice)}</p>}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="hidden justify-self-end sm:block">
                                                    <span className={`font-sans rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClass}`}>
                                                        {statusLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Soul Reflection — Immersive Black Panel ═══ */}
            {showSoulReflectionPanel && (
                <div className="fixed inset-0 z-[100] bg-black flex flex-col font-sans overflow-hidden animate-fade-in">
                    {/* Close button */}
                    {!isSoulReflecting && (
                        <button
                            onClick={() => { setShowSoulReflectionPanel(false); setSoulReflectionResult(null); }}
                            className="absolute top-6 right-6 z-20 w-10 h-10 flex items-center justify-center rounded-full border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors active:scale-90"
                        >
                            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M6.75 6.75l10.5 10.5M17.25 6.75l-10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        </button>
                    )}

                    {soulReflectionResult ? (
                        /* ═══ Result View ═══ */
                        <div className="flex-1 flex flex-col items-center overflow-hidden">
                            {/* Header */}
                            <div className="pt-20 flex flex-col items-center shrink-0">
                                <div className="w-8 h-[1px] bg-neutral-800 mb-8" />
                                <div className="w-[1px] h-8 bg-gradient-to-b from-transparent via-neutral-500 to-transparent mb-4" />
                                <p className="text-[11px] font-light text-neutral-600 tracking-[0.3em] uppercase">回神</p>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-h-0 w-full max-w-lg px-8 py-8 overflow-y-auto no-scrollbar">
                                {/* Mirror snippets */}
                                {soulReflectionResult.mirrorSnippets.length > 0 && (
                                    <div className="mb-8">
                                        <div className="w-5 h-[1px] bg-neutral-700 mb-4" />
                                        <div className="space-y-2 pl-4 border-l border-neutral-800">
                                            {soulReflectionResult.mirrorSnippets.map((s, i) => (
                                                <p key={i} className="text-[12px] text-neutral-600 italic leading-relaxed font-light">
                                                    "{s}{s.length >= 28 ? '...' : '"'}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Divider */}
                                {soulReflectionResult.mirrorSnippets.length > 0 && (
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className="flex-1 h-[1px] bg-neutral-800" />
                                        <div className="w-1 h-1 rounded-full bg-neutral-700" />
                                        <div className="flex-1 h-[1px] bg-neutral-800" />
                                    </div>
                                )}

                                {/* Reflection text */}
                                <div className="text-[15px] text-neutral-300 leading-[2.0] tracking-wide font-light whitespace-pre-wrap">
                                    {soulReflectionResult.reflection}
                                </div>

                                {/* Anchors */}
                                {soulReflectionResult.anchors && (
                                    <div className="mt-10">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-3 h-[1px] bg-neutral-600" />
                                            <span className="text-[10px] text-neutral-600 tracking-[0.2em] uppercase font-medium">Anchors</span>
                                            <div className="flex-1 h-[1px] bg-neutral-800" />
                                        </div>
                                        <div className="text-[13px] text-neutral-500 leading-[1.9] whitespace-pre-wrap font-light">
                                            {soulReflectionResult.anchors}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Bottom close hint */}
                            <div className="shrink-0 pb-10 pt-4 flex flex-col items-center gap-3">
                                <div className="w-[1px] h-6 bg-gradient-to-b from-neutral-700 to-transparent" />
                                <button
                                    onClick={() => { setShowSoulReflectionPanel(false); setSoulReflectionResult(null); }}
                                    className="text-[11px] text-neutral-600 tracking-[0.15em] font-light hover:text-neutral-400 transition-colors active:scale-95"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* ═══ Input View ═══ */
                        <div className="flex-1 flex flex-col items-center justify-center px-8">
                            {isSoulReflecting ? (
                                /* Loading state */
                                <div className="flex flex-col items-center">
                                    <div className="w-12 h-[1px] bg-neutral-800 mb-12" />
                                    <div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-white to-transparent animate-pulse mb-6" />
                                    <p className="text-sm font-light text-neutral-500 italic tracking-widest">正在回神...</p>
                                </div>
                            ) : (
                                /* Input form */
                                <div className="w-full max-w-sm flex flex-col items-center">
                                    {/* Title area */}
                                    <div className="mb-10 flex flex-col items-center">
                                        <div className="w-8 h-[1px] bg-neutral-800 mb-8" />
                                        <div className="w-[1px] h-8 bg-gradient-to-b from-transparent via-neutral-500 to-transparent mb-4" />
                                        <p className="text-[11px] font-light text-neutral-600 tracking-[0.3em] uppercase">回神</p>
                                    </div>

                                    {/* Selected count */}
                                    <p className="text-[11px] text-neutral-600 mb-6 tracking-wide">
                                        已选中 {selectedMsgIds.size} 条消息
                                    </p>

                                    {/* Feedback input */}
                                    <textarea
                                        value={soulReflectionFeedback}
                                        onChange={e => setSoulReflectionFeedback(e.target.value)}
                                        placeholder={activeCharName ? `和${activeCharName}说...` : '写下你的感受...'}
                                        className="w-full h-32 bg-transparent border border-neutral-800 rounded-none px-4 py-3 text-[14px] text-neutral-300 placeholder-neutral-700 resize-none focus:outline-none focus:border-neutral-600 transition-colors font-light tracking-wide leading-relaxed"
                                        autoFocus
                                    />

                                    {/* Submit button */}
                                    <button
                                        onClick={handleSoulReflection}
                                        disabled={!soulReflectionFeedback.trim()}
                                        className="w-full mt-6 py-3.5 border border-neutral-700 text-neutral-400 font-light text-[13px] tracking-[0.15em] transition-all active:scale-[0.97] disabled:opacity-20 disabled:scale-100 hover:border-neutral-500 hover:text-neutral-300"
                                    >
                                        回神
                                    </button>

                                    {/* Cancel */}
                                    <button
                                        onClick={() => setShowSoulReflectionPanel(false)}
                                        className="mt-4 text-[11px] text-neutral-700 tracking-[0.1em] hover:text-neutral-500 transition-colors"
                                    >
                                        取消
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Forward Modal */}
            <Modal isOpen={showForwardModal} title="转发聊天记录" onClose={() => setShowForwardModal(false)}>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    <p className="text-xs text-slate-400 mb-3">选择要转发给的角色 (已选 {selectedMsgIds.size} 条消息)</p>
                    {characters.filter(c => c.id !== activeCharacterId).map(c => (
                        <button
                            key={c.id}
                            onClick={() => handleForwardToCharacter(c.id)}
                            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-[0.98] transition-all border border-slate-100"
                        >
                            <img src={c.avatar} className="w-10 h-10 rounded-xl object-cover" />
                            <div className="flex-1 text-left">
                                <div className="font-bold text-sm text-slate-700">{c.name}</div>
                                <div className="text-[10px] text-slate-400 truncate">{c.description}</div>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                        </button>
                    ))}
                    {characters.filter(c => c.id !== activeCharacterId).length === 0 && (
                        <div className="text-center text-xs text-slate-400 py-8">没有其他角色可以转发</div>
                    )}
                </div>
            </Modal>

            {/* Transfer Action Modal */}
            <Modal isOpen={!!transferActionMsg} title="转账详情" onClose={() => setTransferActionMsg(null)}>
                {transferActionMsg && (
                    <div className="flex flex-col items-center gap-4 py-2">
                        <div className="w-14 h-14 rounded-full bg-[#f3883b]/10 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f3883b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-slate-800">¥{transferActionMsg.metadata?.amount || '0.00'}</div>
                            <div className="text-xs text-slate-400 mt-1">
                                {transferActionMsg.role === 'user' ? `你转账给${char.name}` : `${char.name}转账给你`}
                            </div>
                        </div>
                        <div className="w-full space-y-2 mt-2">
                            {transferActionMsg.role === 'user' ? (
                                /* User sent this transfer — only allow withdraw */
                                <button
                                    onClick={() => handleTransferStatusUpdate('returned')}
                                    className="w-full py-3 bg-slate-100 text-slate-600 font-medium rounded-2xl active:scale-[0.98] transition-transform"
                                >
                                    撤回转账
                                </button>
                            ) : (
                                /* AI sent this transfer — allow accept or return */
                                <>
                                    <button
                                        onClick={() => handleTransferStatusUpdate('accepted')}
                                        className="w-full py-3 bg-[#07c160] text-white font-bold rounded-2xl active:scale-[0.98] transition-transform shadow-sm"
                                    >
                                        确认收款
                                    </button>
                                    <button
                                        onClick={() => handleTransferStatusUpdate('returned')}
                                        className="w-full py-3 bg-slate-100 text-slate-600 font-medium rounded-2xl active:scale-[0.98] transition-transform"
                                    >
                                        退还
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            {/* Rerank Trial Key Exhaustion — Upgrade Confirmation Modal */}
            <Modal
                isOpen={showRerankUpgradeModal}
                title={rerankUpgradeStep === 1 ? 'Rerank 免费额度已用完' : '⚠️ 再次确认'}
                onClose={() => setShowRerankUpgradeModal(false)}
            >
                {rerankUpgradeStep === 1 ? (
                    <div className="space-y-4 py-2">
                        <div className="flex items-center justify-center">
                            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-amber-600">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                                </svg>
                            </div>
                        </div>
                        <p className="text-sm text-slate-600 text-center leading-relaxed">
                            本月的 <b>Rerank 免费额度</b>（1,000 次）已用完。
                        </p>
                        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                            <p className="text-xs text-slate-500 font-bold">💰 付费 Rerank 费用参考：</p>
                            <ul className="text-xs text-slate-500 space-y-1 pl-2">
                                <li>• 每次 Rerank 约 <b className="text-amber-600">¥0.014</b>（$0.002）</li>
                                <li>• 按每天 200 条消息估算 → 约 <b className="text-amber-600">¥86/月</b></li>
                            </ul>
                        </div>
                        <p className="text-xs text-slate-400 text-center">
                            不付费也能正常使用，只是检索精度略有降低。
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    // Dismiss until end of month
                                    const now = new Date();
                                    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
                                    localStorage.setItem('rerank_dismissed_until', String(endOfMonth));
                                    setShowRerankUpgradeModal(false);
                                    addToast('已降级为纯向量检索，本月不再提示', 'info');
                                }}
                                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-all text-sm"
                            >
                                暂不，免费就好
                            </button>
                            <button
                                onClick={() => setRerankUpgradeStep(2)}
                                className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold rounded-2xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all text-sm"
                            >
                                我要付费
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 py-2">
                        <div className="flex items-center justify-center">
                            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-red-500">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                                </svg>
                            </div>
                        </div>
                        <p className="text-sm text-slate-700 text-center font-bold">
                            确认开启付费 Rerank？
                        </p>
                        <div className="bg-red-50 border border-red-200/60 rounded-2xl p-4">
                            <p className="text-xs text-red-600 leading-relaxed text-center">
                                开启后，Rerank 将使用你的 <b>Production Key</b> 按量计费。<br />
                                每次调用约 <b>¥0.014</b>，每月约 <b>¥86</b>（按 200 条/天估算）。<br />
                                你可以随时在「设置 → 向量记忆引擎」关闭付费模式。
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRerankUpgradeStep(1)}
                                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-all text-sm"
                            >
                                返回
                            </button>
                            <button
                                onClick={() => {
                                    localStorage.setItem('cohere_rerank_use_paid', 'true');
                                    setShowRerankUpgradeModal(false);
                                    addToast('已开启 Rerank 付费模式，使用 Production Key', 'success');
                                }}
                                className="flex-1 py-3 bg-gradient-to-r from-red-500 to-rose-500 text-white font-bold rounded-2xl shadow-lg shadow-red-500/20 active:scale-95 transition-all text-sm"
                            >
                                确认付费
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Chat;
