
import React,{ useState,useEffect,useRef,useLayoutEffect,useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { useVirtualTime } from '../context/VirtualTimeContext';
import { DB } from '../utils/db';
import { Message,GroupProfile,CharacterProfile,MessageType,MemoryFragment,EmojiCategory } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { ChatPrompts } from '../utils/chatPrompts';
import { ChatParser } from '../utils/chatParser';
import { processImage } from '../utils/file';
import { DEFAULT_ARCHIVE_PROMPTS } from '../constants/archivePrompts';
import { formatMessageForContext,shouldIncludeMessageInContext } from '../utils/messageContext';
import { extractThinking,safeThinkingFallbackReply,selectThinkingForDisplay } from '../utils/thinkingExtractor';
import { isDeepSeekMode } from '../utils/deepseekPrompts';
import {
    DEFAULT_CHAT_TEMPERATURE,
    getEmbeddingConfig,
    getSecondaryApiPoolWithStatus,
    markSecondaryApiConfigFailure,
    markSecondaryApiConfigSuccess,
    normalizeChatTemperature,
    selectSecondaryApiConfig,
} from '../utils/runtimeConfig';
import { fetchStreamingChatCompletion } from '../hooks/useChatAI';
import { queueGroupMemorySummaries } from '../utils/groupChatMemory';
import { refreshGroupChatHandoffBridge } from '../utils/groupChatHandoffBridge';
import {
    buildGroupLiveRoleplayApiOptions,
    getGroupLiveApiFingerprint,
    getReadySecondaryApiPoolEntries,
    GROUP_CHAT_MAX_TOKENS,
    GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE,
    readGroupLiveRoleplayApiSelection,
    reserveDistinctSecondaryRoleplayApis,
    resolveGroupLiveRoleplayApiConfig,
    writeGroupLiveRoleplayApiSelection,
    type GroupLiveRoleplayApiResolution,
} from '../utils/groupChatApiSelection';
import {
    buildGroupLiveScenePrompt,
    buildGroupPerspectiveMessages,
    buildGroupSpeakerDirectorPrompt,
    extractGroupLiveText,
    parseGroupSpeakerWaves,
    sortGroupLogMessages,
    type GroupLiveContextMode,
} from '../utils/groupChatPerspective';
import {
    buildGroupDirectorUserContent,
    getGroupDirectorActionContent,
    getGroupMemberCharacters,
    isAttachableGroupDirectorImageUrl,
    parseGroupDirectorActions,
    resolveGroupDirectorMemberId,
    type GroupDirectorImageAttachment,
} from '../utils/groupChatDirector';

// 复用 Chat.tsx 的高颜值样式逻辑，但针对群聊微调

const GROUP_LIVE_AUTONOMOUS_ENABLED_KEY = 'groupchat_live_autonomous_enabled';
const GROUP_LIVE_AUTONOMOUS_ROUND_LIMIT_KEY = 'groupchat_live_autonomous_round_limit';
const GROUP_LIVE_AUTONOMOUS_DELAY_KEY = 'groupchat_live_autonomous_delay_seconds';
const GROUP_LIVE_COGNITION_KEY_PREFIX = 'groupchat_live_cognition';
const GROUP_CHAT_CONTEXT_LIMIT_KEY = 'groupchat_context_limit';
const GROUP_CHAT_CONTEXT_MIN = 20;
const GROUP_CHAT_CONTEXT_MAX = 5000;
const GROUP_CHAT_CONTEXT_DEFAULT = 30;

function getGroupLiveCognitionKey(groupId: string, speakerId: string, targetId: string): string {
    return `${GROUP_LIVE_COGNITION_KEY_PREFIX}_${groupId}_${speakerId}_${targetId}`;
}

function getGroupContextLimitKey(groupId: string): string {
    return `${GROUP_CHAT_CONTEXT_LIMIT_KEY}_${groupId}`;
}

const GROUP_LIVE_BUBBLE_TIMING = {
    charsPerSecond: 11,
    minTypingMs: 360,
    maxTypingMs: 2600,
    emojiTypingMs: 280,
    pauseMinMs: 180,
    pauseMaxMs: 620,
    jitterRatio: 0.18,
    maxConcurrentTypers: 4,
};

type GroupLiveBubble = {
    type: MessageType;
    content: string;
    metadata?: Message['metadata'];
    textLength: number;
};

type GroupLiveReplyPlan = {
    speaker: CharacterProfile;
    bubbles: GroupLiveBubble[];
};

type GroupLiveBubbleQueue = {
    speaker: CharacterProfile;
    bubbles: GroupLiveBubble[];
    index: number;
    typingAt: number;
    readyAt: number;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function normalizeGroupContextLimit(value: unknown, fallback = GROUP_CHAT_CONTEXT_DEFAULT): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(clamp(parsed, GROUP_CHAT_CONTEXT_MIN, GROUP_CHAT_CONTEXT_MAX));
}

function readStoredGroupContextLimit(group?: GroupProfile | null): number {
    try {
        if (group?.id) {
            const groupSpecific = localStorage.getItem(getGroupContextLimitKey(group.id));
            if (groupSpecific !== null) return normalizeGroupContextLimit(groupSpecific);
        }
        if (typeof group?.contextLimit === 'number') return normalizeGroupContextLimit(group.contextLimit);
        const legacy = localStorage.getItem(GROUP_CHAT_CONTEXT_LIMIT_KEY);
        if (legacy !== null) return normalizeGroupContextLimit(legacy);
    } catch {
        // Fall back to the product default when storage is unavailable.
    }
    return GROUP_CHAT_CONTEXT_DEFAULT;
}

function writeStoredGroupContextLimit(groupId: string | undefined, value: number) {
    const normalized = normalizeGroupContextLimit(value);
    try {
        localStorage.setItem(GROUP_CHAT_CONTEXT_LIMIT_KEY, String(normalized));
        if (groupId) localStorage.setItem(getGroupContextLimitKey(groupId), String(normalized));
    } catch {
        // Best effort: the DB-backed group field is still saved via the settings button.
    }
}

function getGroupContextLoadLimit(limit: number): number {
    return Math.max(GROUP_CHAT_CONTEXT_DEFAULT, normalizeGroupContextLimit(limit));
}

// --- Sub-Component: Group Message Bubble ---
const GroupMessageItem = React.memo(({
    msg,
    isUser,
    char,
    userAvatar,
    onImageClick,
    selectionMode,
    isSelected,
    onToggleSelect,
    onLongPress
}: {
    msg: Message,
    isUser: boolean,
    char?: CharacterProfile,
    userAvatar: string,
    onImageClick: (url: string) => void,
    selectionMode: boolean,
    isSelected: boolean,
    onToggleSelect: (id: number) => void,
    onLongPress: (id: number) => void
}) => {
    const avatar = isUser ? userAvatar : char?.avatar;
    const name = isUser ? '我' : char?.name || '未知成员';
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });

    // Time formatting
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const groupInnerVoice = !isUser && typeof msg.metadata?.groupInnerVoice === 'string'
        ? msg.metadata.groupInnerVoice.trim()
        : '';
    const hasGroupInnerVoice = groupInnerVoice.length > 0;
    const [showGroupInnerVoice, setShowGroupInnerVoice] = useState(false);
    const groupInnerVoiceIssue = String(Math.abs(msg.id || 0) % 100).padStart(2, '0');
    const groupInnerVoiceDate = new Date(msg.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const avatarInitial = name.trim().slice(0, 1) || '?';

    const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
        if ('touches' in e) {
            startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            startPos.current = { x: e.clientX, y: e.clientY };
        }

        longPressTimer.current = setTimeout(() => {
            if (!selectionMode) onLongPress(msg.id);
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!longPressTimer.current) return;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const diffX = Math.abs(clientX - startPos.current.x);
        const diffY = Math.abs(clientY - startPos.current.y);

        if (diffX > 10 || diffY > 10) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleClick = (e: React.MouseEvent) => {
        if (selectionMode) {
            e.stopPropagation();
            onToggleSelect(msg.id);
        }
    };

    // Special Content Renderers
    const renderContent = () => {
        switch (msg.type) {
            case 'image':
                return (
                    <div className="relative group cursor-pointer" onClick={(e) => {
                        if (selectionMode) handleClick(e);
                        else onImageClick(msg.content);
                    }}>
                        <img src={msg.content} className="max-w-[200px] max-h-[200px] rounded-xl shadow-sm border border-black/5" loading="lazy" />
                    </div>
                );
            case 'emoji':
                return <img src={msg.content} className="w-24 h-24 object-contain drop-shadow-sm hover:scale-110 transition-transform" />;
            case 'transfer':
                return (
                    <div className="w-60 bg-[#fb923c] text-white p-3 rounded-xl flex items-center gap-3 shadow-md relative overflow-hidden active:scale-95 transition-transform">
                        <div className="absolute -right-2 -top-2 text-white/20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16"><path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.324.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" /><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="bg-white/20 p-2 rounded-full shrink-0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" /><path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75-.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="z-10">
                            <div className="font-bold text-sm tracking-wide">红包 / 转账</div>
                            <div className="text-[10px] opacity-90">Sully Pay</div>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className={`px-3.5 py-2 rounded-[18px] text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap break-all ${isUser ? 'bg-violet-500 text-white rounded-tr-sm' : 'bg-white text-slate-700 rounded-tl-sm border border-slate-100'}`}>
                        {msg.content}
                    </div>
                );
        }
    };

    return (
        <div
            className={`flex gap-3 mb-4 w-full animate-fade-in relative ${isUser ? 'justify-end' : 'justify-start'} ${selectionMode ? 'pl-8' : ''}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleMove}
            onMouseDown={handleTouchStart}
            onMouseUp={handleTouchEnd}
            onMouseMove={handleMove}
            onClick={handleClick}
        >
            {selectionMode && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 cursor-pointer z-10">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-violet-500 border-violet-500' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                    </div>
                </div>
            )}

            {!isUser && (
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="relative w-9 h-9">
                        <img src={avatar} className="w-9 h-9 rounded-full object-cover shadow-sm border border-white" loading="lazy" />
                        {hasGroupInnerVoice && !selectionMode && (
                            <button
                                type="button"
                                className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-white text-rose-500 shadow-[0_3px_8px_rgba(190,18,60,0.22)] ring-1 ring-rose-100 transition-transform active:scale-90"
                                title="打开心声卡片"
                                aria-label={`打开${name}的心声卡片`}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowGroupInnerVoice(true);
                                }}
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5" aria-hidden="true">
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[80%] ${selectionMode ? 'pointer-events-none' : ''}`}>
                {!isUser && <span className="text-[10px] text-slate-400 ml-1 mb-1">{name}</span>}
                {renderContent()}
                <span className="text-[9px] text-slate-300 mt-1 px-1">{timeStr}</span>
            </div>

            {isUser && (
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <img src={avatar} className="w-9 h-9 rounded-full object-cover shadow-sm border border-white" loading="lazy" />
                </div>
            )}

            {showGroupInnerVoice && hasGroupInnerVoice && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[3px] animate-fade-in"
                    onClick={() => setShowGroupInnerVoice(false)}
                >
                    <div
                        className="relative max-h-[calc(100dvh-44px)] w-full max-w-[390px] overflow-y-auto rounded-[8px] bg-[#f8f4eb] text-slate-950 shadow-[0_30px_90px_rgba(15,23,42,0.42)] ring-1 ring-white/80"
                        style={{
                            backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(255,255,255,0) 42%), radial-gradient(circle at 24px 18px, rgba(15,23,42,0.055) 0, rgba(15,23,42,0.055) 1px, transparent 1px)',
                            backgroundSize: 'auto, 14px 14px',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-[0_10px_24px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/10 backdrop-blur transition-transform active:scale-95"
                            aria-label="关闭心声卡片"
                            title="关闭心声卡片"
                            onClick={() => setShowGroupInnerVoice(false)}
                        >
                            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                <path d="M6.75 6.75l10.5 10.5M17.25 6.75l-10.5 10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>

                        <div className="relative min-h-[245px] overflow-hidden bg-slate-900">
                            <div className="absolute inset-0">
                                {avatar ? (
                                    <img src={avatar} alt={name} className="h-full w-full object-cover saturate-[0.82] contrast-[0.98]" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-slate-800 text-5xl font-black text-white">{avatarInitial}</div>
                                )}
                            </div>
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.10)_0%,rgba(15,23,42,0.18)_36%,rgba(15,23,42,0.78)_100%)]" />
                            <div className="absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-5 text-white">
                                <div className="border-l-2 border-rose-300 pl-3">
                                    <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/80">Private Journal</p>
                                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100">Issue {groupInnerVoiceIssue}</p>
                                </div>
                                <p className="mr-10 text-right text-[9px] font-bold uppercase tracking-[0.22em] text-white/70">{groupInnerVoiceDate}</p>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 px-5 pb-5 text-white">
                                <div className="flex items-end justify-between gap-4 border-b border-white/30 pb-3">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.38em] text-rose-200">Whisper</p>
                                        <h2 className="mt-1 break-words font-[inherit] text-[42px] font-semibold leading-[0.88] tracking-normal drop-shadow-sm">
                                            {name}
                                        </h2>
                                    </div>
                                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/70 bg-white/15 shadow-[0_12px_30px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                                        {avatar ? (
                                            <img src={avatar} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <span className="font-[inherit] text-xl text-white">{avatarInitial}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="relative px-6 pb-7 pt-6">
                            <div className="mb-5 grid grid-cols-[1fr_auto] items-start gap-4 border-b border-slate-950/12 pb-4">
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">Inner voice</p>
                                    <p className="mt-1 text-[11px] font-semibold leading-snug text-slate-500">Captured at {timeStr}</p>
                                </div>
                                <div className="rounded-full border border-slate-950/15 px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-rose-600">
                                    No.{groupInnerVoiceIssue}
                                </div>
                            </div>

                            <div className="relative">
                                <div className="absolute -left-1 -top-6 select-none font-[inherit] text-[76px] leading-none text-rose-500/15">“</div>
                                <p className="relative whitespace-pre-wrap break-words pl-5 font-[inherit] text-[18px] leading-[2.05] tracking-normal text-slate-800">
                                    {groupInnerVoice}
                                </p>
                            </div>

                            <div className="mt-7 grid grid-cols-[56px_1fr] gap-4 border-t border-slate-950/12 pt-5">
                                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[3px] bg-slate-950 text-white shadow-sm">
                                    {avatar ? (
                                        <img src={avatar} alt="" className="h-full w-full object-cover grayscale-[18%] saturate-[0.75]" />
                                    ) : (
                                        <span className="font-[inherit] text-xl">{avatarInitial}</span>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="h-px w-8 bg-rose-500" />
                                        <span className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-400">Editor's note</span>
                                    </div>
                                    <p className="mt-2 break-words text-[11px] font-semibold leading-relaxed text-slate-500">
                                        {name} 的未公开片刻，像夹在页缝里的一张小纸。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// --- Main Component ---

const GroupChat: React.FC = () => {
    const { closeApp, groups, setGroups, createGroup, deleteGroup, characters, updateCharacter, apiConfig, apiPresets, addToast, userProfile, realtimeConfig } = useOS();
    const virtualTime = useVirtualTime();
    const [view, setView] = useState<'list' | 'chat'>('list');
    const [activeGroup, setActiveGroup] = useState<GroupProfile | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [totalMsgCount, setTotalMsgCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(30);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [typingCharId, setTypingCharId] = useState<string | null>(null);
    const [typingCharIds, setTypingCharIds] = useState<string[]>([]);

    // UI State
    const [showActions, setShowActions] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [modalType, setModalType] = useState<'none' | 'create' | 'settings' | 'transfer' | 'member_select' | 'message-options'>('none');
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [preserveContext, setPreserveContext] = useState(true);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryProgress, setSummaryProgress] = useState('');

    // Archive prompt selection (shared with Chat app)
    const [archivePrompts, setArchivePrompts] = useState<{ id: string, name: string, content: string }[]>(DEFAULT_ARCHIVE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');

    // Context limit (like Chat app's settingsContextLimit)
    const [contextLimit, setContextLimit] = useState<number>(() => {
        return readStoredGroupContextLimit(null);
    });
    const [liveGroupModeEnabled, setLiveGroupModeEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('groupchat_live_mode_enabled') === 'true'; } catch { return false; }
    });
    const [liveApiSelectionRevision, setLiveApiSelectionRevision] = useState(0);
    const [liveRoleplayApiSelections, setLiveRoleplayApiSelections] = useState<Record<string, string>>({});
    const [autonomousChatEnabled, setAutonomousChatEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem(GROUP_LIVE_AUTONOMOUS_ENABLED_KEY) === 'true'; } catch { return false; }
    });
    const [autonomousRoundLimit, setAutonomousRoundLimit] = useState<number>(() => {
        try { return Math.max(1, Math.min(20, parseInt(localStorage.getItem(GROUP_LIVE_AUTONOMOUS_ROUND_LIMIT_KEY) || '3', 10))); } catch { return 3; }
    });
    const [autonomousDelaySeconds, setAutonomousDelaySeconds] = useState<number>(() => {
        try { return Math.max(1, Math.min(60, parseInt(localStorage.getItem(GROUP_LIVE_AUTONOMOUS_DELAY_KEY) || '3', 10))); } catch { return 3; }
    });
    const [autonomousRoundsRemaining, setAutonomousRoundsRemaining] = useState(0);
    const [cognitionEditorSpeakerId, setCognitionEditorSpeakerId] = useState<string>('');
    const [cognitionRevision, setCognitionRevision] = useState(0);

    // Selection Mode
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());

    // Data State
    const [emojis, setEmojis] = useState<{ name: string, url: string, categoryId?: string }[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]); // New

    // Create/Edit Group State
    const [tempGroupName, setTempGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    const [transferAmount, setTransferAmount] = useState('');

    // Refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const groupAvatarInputRef = useRef<HTMLInputElement>(null);
    const autonomousTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const refreshApiSelections = () => setLiveApiSelectionRevision(prev => prev + 1);
        window.addEventListener('agent-config-changed', refreshApiSelections);
        return () => window.removeEventListener('agent-config-changed', refreshApiSelections);
    }, []);

    useEffect(() => {
        setTypingCharId(typingCharIds.length === 1 ? typingCharIds[0] : null);
    }, [typingCharIds]);

    useEffect(() => {
        if (!activeGroup) {
            setLiveRoleplayApiSelections({});
            setCognitionEditorSpeakerId('');
            return;
        }

        const memberCharacters = getGroupMemberCharacters(activeGroup, characters);
        const nextSelections: Record<string, string> = {};
        for (const member of memberCharacters) {
            nextSelections[member.id] = readGroupLiveRoleplayApiSelection(activeGroup.id, member.id);
        }
        setLiveRoleplayApiSelections(nextSelections);
        setCognitionEditorSpeakerId(prev => memberCharacters.some(member => member.id === prev) ? prev : (memberCharacters[0]?.id || ''));
    }, [activeGroup?.id, activeGroup?.members, characters, liveApiSelectionRevision]);

    useEffect(() => {
        if (!activeGroup) return;
        const latestGroup = groups.find(group => group.id === activeGroup.id);
        if (latestGroup && latestGroup !== activeGroup) {
            setActiveGroup(latestGroup);
        }
    }, [groups, activeGroup?.id]);

    const secondaryApiPoolForSettings = useMemo(
        () => getSecondaryApiPoolWithStatus(),
        [liveApiSelectionRevision, modalType],
    );
    const liveRoleplayApiOptions = useMemo(
        () => buildGroupLiveRoleplayApiOptions(apiConfig, apiPresets, secondaryApiPoolForSettings),
        [apiConfig, apiPresets, secondaryApiPoolForSettings],
    );

    // Load shared archive prompts from localStorage (same key as Chat app)
    useEffect(() => {
        const savedPrompts = localStorage.getItem('chat_archive_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
                setArchivePrompts(merged);
            } catch (e) { }
        }
    }, []);

    // Initial Load
    useEffect(() => {
        if (activeGroup) {
            const nextContextLimit = readStoredGroupContextLimit(activeGroup);
            const loadLimit = getGroupContextLoadLimit(nextContextLimit);
            setContextLimit(nextContextLimit);
            setVisibleCount(30);
            DB.getRecentGroupMessagesWithCount(activeGroup.id, loadLimit).then(({ messages: msgs, totalCount }) => {
                setMessages(sortGroupLogMessages(msgs));
                setTotalMsgCount(totalCount);
            });
            // Fetch emojis AND categories
            Promise.all([DB.getEmojis(), DB.getEmojiCategories()]).then(([es, cats]) => {
                setEmojis(es);
                setCategories(cats);
            });
        }
    }, [activeGroup]);

    // Auto Scroll
    useLayoutEffect(() => {
        if (scrollRef.current && !selectionMode) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length, activeGroup, showActions, showEmojiPicker, isTyping, selectionMode]);

    const displayMessages = useMemo(() => messages.slice(-visibleCount), [messages, visibleCount]);

    const canReroll = useMemo(() => {
        if (isTyping || messages.length === 0) return false;
        const lastMsg = messages[messages.length - 1];
        return lastMsg.role === 'assistant';
    }, [isTyping, messages]);

    // --- Helpers ---

    const getTimeGapHint = (lastMsgTimestamp: number): string => {
        const now = Date.now();
        const diffHours = Math.floor((now - lastMsgTimestamp) / (1000 * 60 * 60));
        const diffMins = Math.floor((now - lastMsgTimestamp) / (1000 * 60));

        const currentHour = new Date().getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;

        if (diffMins < 10) return '聊天正在火热进行中，大家都很活跃。';
        if (diffMins < 60) return `距离上次发言过了 ${diffMins} 分钟，话题可能有点冷场。`;
        if (diffHours < 12) return `距离上次发言过了 ${diffHours} 小时。${isNight ? '现在是深夜。' : ''}`;
        return `大家已经 ${diffHours} 小时没说话了，群里很安静。`;
    };

    // New: Calculate private chat gap
    const getPrivateTimeGap = async (charId: string): Promise<string> => {
        const msgs = await DB.getMessagesByCharId(charId);
        // DB.getMessagesByCharId already filters out group messages in its definition? 
        // Let's ensure we look at messages WITHOUT groupId
        const privateMsgs = msgs.filter(m => !m.groupId);
        if (privateMsgs.length === 0) return '从未私聊过';

        const lastMsg = privateMsgs[privateMsgs.length - 1];
        const now = Date.now();
        const diffMins = Math.floor((now - lastMsg.timestamp) / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 60) return '刚刚才私聊过';
        if (diffHours < 24) return `${diffHours}小时前私聊过`;
        return `${diffDays}天前私聊过`;
    };

    // --- Logic: Selection & Deletion ---

    const handleMessageLongPress = (id: number) => {
        const msg = messages.find(m => m.id === id);
        if (msg) {
            setSelectedMessage(msg);
            setModalType('message-options');
        }
        setShowActions(false);
        setShowEmojiPicker(false);
    };

    const handleCopyMessage = () => {
        if (!selectedMessage) return;
        navigator.clipboard.writeText(selectedMessage.content);
        setModalType('none');
        setSelectedMessage(null);
        addToast('已复制到剪贴板', 'success');
    };

    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const handleDeleteSingleMessage = async () => {
        if (!selectedMessage) return;
        await DB.deleteMessage(selectedMessage.id);
        setMessages(prev => prev.filter(m => m.id !== selectedMessage.id));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除', 'success');
    };

    const toggleMessageSelection = (id: number) => {
        const next = new Set(selectedMsgIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedMsgIds(next);
    };

    const deleteSelectedMessages = async () => {
        if (selectedMsgIds.size === 0) return;
        await DB.deleteMessages(Array.from(selectedMsgIds));
        setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)));
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        addToast(`已删除 ${selectedMsgIds.size} 条消息`, 'success');
    };

    const handleReroll = async () => {
        if (!canReroll) return;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        // Find all contiguous assistant messages at the end
        const toDeleteIds: number[] = [];
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role === 'assistant') {
            toDeleteIds.push(messages[index].id);
            index--;
        }

        if (toDeleteIds.length === 0) return;

        await DB.deleteMessages(toDeleteIds);
        const newHistory = messages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        if (liveGroupModeEnabled) triggerLiveGroupRound(newHistory);
        else triggerDirector(newHistory);
    };

    // --- Logic: Group Management ---

    const handleCreateGroup = () => {
        if (!tempGroupName.trim() || selectedMembers.size < 2) {
            addToast('请输入群名并至少选择2名成员', 'error');
            return;
        }
        createGroup(tempGroupName, Array.from(selectedMembers));
        setModalType('none');
        setTempGroupName('');
        setSelectedMembers(new Set());
        addToast('群聊已创建', 'success');
    };

    const handleUpdateGroupInfo = async () => {
        if (!activeGroup) return;
        const normalizedContextLimit = normalizeGroupContextLimit(contextLimit);
        const updatedGroup = {
            ...activeGroup,
            name: tempGroupName || activeGroup.name,
            contextLimit: normalizedContextLimit,
        };
        writeStoredGroupContextLimit(updatedGroup.id, normalizedContextLimit);
        await DB.saveGroup(updatedGroup);
        setContextLimit(normalizedContextLimit);
        setActiveGroup(updatedGroup);
        setGroups(prev => prev.map(group => group.id === updatedGroup.id ? updatedGroup : group));
        setModalType('none');
        addToast('群信息已更新', 'success');
    };

    const handleGroupContextLimitChange = (value: number) => {
        const normalizedContextLimit = normalizeGroupContextLimit(value);
        setContextLimit(normalizedContextLimit);
        writeStoredGroupContextLimit(activeGroup?.id, normalizedContextLimit);
    };

    const handleGroupAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeGroup) return;
        try {
            const base64 = await processImage(file);
            const updatedGroup = { ...activeGroup, avatar: base64 };
            await DB.saveGroup(updatedGroup);
            setActiveGroup(updatedGroup);
            setGroups(prev => prev.map(group => group.id === updatedGroup.id ? updatedGroup : group));
            addToast('群头像已修改', 'success');
        } catch (err: any) {
            addToast('图片处理失败', 'error');
        }
    };

    const toggleMemberSelection = (id: string) => {
        const next = new Set(selectedMembers);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedMembers(next);
    };

    const handleDeleteGroup = async (id: string) => {
        await deleteGroup(id);
        if (activeGroup?.id === id) setView('list');
        addToast('群聊已解散', 'success');
    };

    const handleClearHistory = async () => {
        if (!activeGroup) return;

        // Fetch ALL messages from DB, not just the loaded subset
        const allGroupMsgs = await DB.getGroupMessages(activeGroup.id);

        let msgsToDelete = allGroupMsgs;
        if (preserveContext) {
            msgsToDelete = allGroupMsgs.slice(0, -10);
        }

        if (msgsToDelete.length === 0) {
            addToast('消息太少，无需清理', 'info');
            return;
        }

        await DB.deleteMessages(msgsToDelete.map(m => m.id));

        // Refresh local state
        const remaining = preserveContext ? allGroupMsgs.slice(-10) : [];
        setMessages(remaining);
        setTotalMsgCount(remaining.length);

        addToast(`已清理 ${msgsToDelete.length} 条记录${preserveContext ? ' (保留最近10条)' : ''}`, 'success');
        setModalType('none');
    };

    // --- Logic: Group Summary & Distribution ---

    const handleGroupSummary = async () => {
        if (!activeGroup) {
            addToast('请检查配置', 'error');
            return;
        }

        if (messages.length === 0) {
            addToast('暂无聊天记录', 'info');
            return;
        }

        setIsSummarizing(true);
        setSummaryProgress('正在读取记录...');

        try {
            // Group messages by Date (YYYY-MM-DD)
            const msgsByDate: Record<string, Message[]> = {};
            messages.forEach(m => {
                const dateStr = new Date(m.timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
                if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
                msgsByDate[dateStr].push(m);
            });

            const dates = Object.keys(msgsByDate).sort();

            for (let i = 0; i < dates.length; i++) {
                const date = dates[i];
                setSummaryProgress(`正在归档 ${date} (${i + 1}/${dates.length})`);

                const dayMsgs = msgsByDate[date];
                const logText = dayMsgs.map(m => {
                    const sender = m.role === 'user'
                        ? userProfile.name
                        : (characters.find(c => c.id === m.charId)?.name || '未知成员');
                    return `${sender}: ${m.content}`;
                }).join('\n');

                // Use selected prompt template or fall back to default group summary
                const templateObj = archivePrompts.find(p => p.id === selectedPromptId);
                let prompt: string;

                if (templateObj) {
                    // Adapt the chat prompt for group context - replace per-character variables
                    const memberNames = activeGroup.members.map(id => characters.find(c => c.id === id)?.name || '未知').join('、');
                    prompt = templateObj.content
                        .replace(/\$\{dateStr\}/g, date)
                        .replace(/\$\{char\.name\}/g, `群成员(${memberNames})`)
                        .replace(/\$\{userProfile\.name\}/g, userProfile.name)
                        .replace(/\$\{rawLog.*?\}/g, logText.substring(0, 10000));
                    prompt = `[群聊: ${activeGroup.name}]\n${prompt}`;
                } else {
                    prompt = `
### Task: Group Chat Summary
Group: "${activeGroup.name}"
Date: ${date}

### Instructions
Summarize the following chat log into a **concise, 3rd-person, YAML format**.
- Focus on interactions, conflicts, and key topics.
- Be objective (like a narrator).
- **Strictly output valid YAML only.**

### Example Output
summary: "In [Group Name], [Char A] shared a photo of a cat. [Char B] made a joke about it, which caused a brief playful argument about pets."

### Logs
${logText.substring(0, 10000)}
`;
                }

                const summaryApiConfig = selectSecondaryApiConfig();
                if (!summaryApiConfig?.baseUrl || !summaryApiConfig.model) {
                    throw new Error('请先配置可用的副 API，用于群聊总结');
                }

                const response = await fetch(`${summaryApiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${summaryApiConfig.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: summaryApiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.3,
                        max_tokens: GROUP_CHAT_MAX_TOKENS,
                    })
                });

                if (response.ok) {
                    markSecondaryApiConfigSuccess(summaryApiConfig);
                    const data = await safeResponseJson(response);
                    let content = data.choices[0].message.content.trim();
                    // Basic YAML extraction
                    const yamlMatch = content.match(/summary:\s*["']?([\s\S]*?)["']?$/);
                    let summaryText = yamlMatch ? yamlMatch[1] : content.replace(/^summary:\s*/i, '');

                    // Cleanup quotes if matched broadly
                    summaryText = summaryText.replace(/^["']|["']$/g, '').trim();

                    if (summaryText) {
                        // Distribute to Members
                        const newMem: MemoryFragment = {
                            id: `mem-${Date.now()}-${Math.random()}`,
                            date: date,
                            summary: `[群聊归档: ${activeGroup.name}] ${summaryText}`,
                            mood: 'group'
                        };

                        for (const memberId of activeGroup.members) {
                            const member = characters.find(c => c.id === memberId);
                            if (member) {
                                const updatedMems = [...(member.memories || []), newMem];
                                updateCharacter(member.id, { memories: updatedMems });
                            }
                        }
                    }
                } else {
                    const detail = await response.text().catch(() => '');
                    markSecondaryApiConfigFailure(summaryApiConfig, new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`));
                }

                await new Promise(r => setTimeout(r, 500)); // Rate limit buffer
            }

            addToast('群聊记忆已同步至所有成员', 'success');
            setModalType('none');

        } catch (e: any) {
            console.error(e);
            addToast(`归档失败: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
            setSummaryProgress('');
        }
    };

    // --- Logic: Messaging ---

    const clearAutonomousTimer = () => {
        if (!autonomousTimerRef.current) return;
        clearTimeout(autonomousTimerRef.current);
        autonomousTimerRef.current = null;
    };

    const stopAutonomousChat = () => {
        clearAutonomousTimer();
        setAutonomousChatEnabled(false);
        setAutonomousRoundsRemaining(0);
        localStorage.setItem(GROUP_LIVE_AUTONOMOUS_ENABLED_KEY, 'false');
    };

    const startAutonomousChat = () => {
        if (!liveGroupModeEnabled) {
            addToast('请先打开群像 Beta 的真实多角色生成', 'info');
            return;
        }
        const rounds = Math.max(1, Math.min(20, autonomousRoundLimit));
        setAutonomousChatEnabled(true);
        setAutonomousRoundsRemaining(rounds);
        localStorage.setItem(GROUP_LIVE_AUTONOMOUS_ENABLED_KEY, 'true');
    };

    const saveActiveGroupHandoffBridge = async (sourceMessages?: Message[]): Promise<void> => {
        if (!activeGroup) return;
        try {
            let bridgeMessages = sourceMessages && sourceMessages.length > 0 ? sourceMessages : messages;
            if (!sourceMessages || (totalMsgCount > 0 && bridgeMessages.length < totalMsgCount)) {
                bridgeMessages = sortGroupLogMessages(await DB.getGroupMessages(activeGroup.id));
            }

            refreshGroupChatHandoffBridge({
                group: activeGroup,
                messages: bridgeMessages,
                characters,
                userProfile,
                emojis,
            });
        } catch (error) {
            console.warn('Failed to refresh group chat handoff bridge:', error);
        }
    };

    const handleBackToGroupList = () => {
        void saveActiveGroupHandoffBridge();
        setView('list');
    };

    const handleSendMessage = async (content: string, type: MessageType = 'text', metadata?: any) => {
        if (!activeGroup) return;
        const contentToSend = type === 'text' ? content.trim() : content;
        if (!contentToSend) return;

        const timestamp = Date.now();
        const newMessage = {
            charId: 'user',
            groupId: activeGroup.id,
            role: 'user' as const,
            type,
            content: contentToSend,
            timestamp,
            metadata
        };

        let savedMessage: Message;
        try {
            const savedId = await DB.saveMessage(newMessage);
            savedMessage = { ...newMessage, id: savedId };
        } catch (error: any) {
            console.error('Failed to send group message:', error);
            addToast(`消息发送失败: ${error?.message || '本地写入失败'}`, 'error');
            return;
        }

        const optimisticMessages = sortGroupLogMessages([...messages, savedMessage]);
        setMessages(optimisticMessages);
        setTotalMsgCount(prev => prev + 1);
        setInput('');

        // Close panels
        if (type !== 'text') {
            setShowActions(false);
            setShowEmojiPicker(false);
        }

        try {
            const updatedMsgs = sortGroupLogMessages(await DB.getGroupMessages(activeGroup.id));
            setMessages(updatedMsgs);
            setTotalMsgCount(updatedMsgs.length);
            await saveActiveGroupHandoffBridge(updatedMsgs);
        } catch (error) {
            console.warn('Group message saved but refresh failed:', error);
            await saveActiveGroupHandoffBridge(optimisticMessages);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const base64 = await processImage(file, { maxWidth: 600, quality: 0.7, forceJpeg: true });
            handleSendMessage(base64, 'image');
        } catch (err) {
            addToast('图片发送失败', 'error');
        }
    };

    const refreshGroupMessages = async (): Promise<Message[]> => {
        if (!activeGroup) return [];
        const refreshed = sortGroupLogMessages(await DB.getGroupMessages(activeGroup.id));
        setMessages(refreshed);
        setTotalMsgCount(refreshed.length);
        return refreshed;
    };

    const ensureGroupContextMessages = async (sourceMessages: Message[], limit = contextLimit): Promise<Message[]> => {
        if (!activeGroup) return sortGroupLogMessages(sourceMessages);

        const sortedSource = sortGroupLogMessages(sourceMessages);
        const loadLimit = getGroupContextLoadLimit(limit);
        if (sortedSource.length >= loadLimit || (totalMsgCount > 0 && totalMsgCount <= sortedSource.length)) {
            return sortedSource;
        }

        try {
            const { messages: loadedMessages, totalCount } = await DB.getRecentGroupMessagesWithCount(activeGroup.id, loadLimit);
            const sortedLoaded = sortGroupLogMessages(loadedMessages);
            setMessages(sortedLoaded);
            setTotalMsgCount(totalCount);
            setVisibleCount(prev => Math.min(Math.max(prev, GROUP_CHAT_CONTEXT_DEFAULT), sortedLoaded.length || GROUP_CHAT_CONTEXT_DEFAULT));
            return sortedLoaded;
        } catch (error) {
            console.warn('Failed to load configured group context window:', error);
            return sortedSource;
        }
    };

    const appendTextToChatContent = (content: any, text: string): any => {
        if (!text) return content;
        if (typeof content === 'string') return `${content}${text}`;
        if (Array.isArray(content)) return [...content, { type: 'text', text }];
        return `${String(content || '')}${text}`;
    };

    const appendTextToLastUserMessage = (apiMessages: any[], text: string): boolean => {
        const lastUserIdx = apiMessages.map(message => message.role).lastIndexOf('user');
        if (lastUserIdx < 0) return false;
        apiMessages[lastUserIdx].content = appendTextToChatContent(apiMessages[lastUserIdx].content, text);
        return true;
    };

    const formatGroupLogForDirector = (sourceMessages: Message[], limit: number): string => {
        return sortGroupLogMessages(sourceMessages)
            .filter(shouldIncludeMessageInContext)
            .slice(-limit)
            .map(message => {
                const senderName = message.role === 'user'
                    ? userProfile.name
                    : (characters.find(c => c.id === message.charId)?.name || '未知成员');
                const content = formatMessageForContext(message, {
                    surface: 'secondaryModel',
                    charName: senderName,
                    userName: userProfile.name,
                    emojis,
                    compact: true,
                    maxContentChars: 300,
                }) || (message.type === 'image' ? '[图片]' : message.content);
                return `${senderName}: ${content}`;
            })
            .join('\n');
    };

    const fallbackSpeakerWaves = (currentMsgs: Message[], groupMembers: CharacterProfile[]): string[][] => {
        const lastPublic = sortGroupLogMessages(currentMsgs)
            .filter(message => message.role === 'user' || message.role === 'assistant')
            .slice(-1)[0];
        const lastText = lastPublic?.content || '';
        const named = groupMembers
            .filter(member => lastText.includes(member.name))
            .map(member => member.id);
        if (named.length > 0) return named.slice(0, 2).map(id => [id]);

        const lastSpeakerId = lastPublic?.role === 'assistant' ? lastPublic.charId : '';
        const candidate = groupMembers.find(member => member.id !== lastSpeakerId) || groupMembers[0];
        return candidate ? [[candidate.id]] : [];
    };

    const requestLiveSpeakerWaves = async (
        currentMsgs: Message[],
        groupMembers: CharacterProfile[],
        autonomous = false,
    ): Promise<string[][]> => {
        if (!activeGroup) return [];
        const maxSpeakers = Math.min(3, groupMembers.length);
        const prompt = buildGroupSpeakerDirectorPrompt({
            groupName: activeGroup.name,
            members: groupMembers,
            userProfile,
            recentLogText: formatGroupLogForDirector(currentMsgs, Math.min(contextLimit, 80)),
            autonomous,
            maxSpeakers,
        });

        let secondaryDirectorConfig: ReturnType<typeof selectSecondaryApiConfig> = undefined;
        try {
            secondaryDirectorConfig = selectSecondaryApiConfig();
            const directorApiConfig = secondaryDirectorConfig || apiConfig;
            if (!directorApiConfig.baseUrl || !directorApiConfig.model) {
                throw new Error('导演 API 未配置完整');
            }

            const response = await fetch(`${directorApiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${directorApiConfig.apiKey || 'sk-none'}` },
                body: JSON.stringify({
                    model: directorApiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.25,
                    max_tokens: GROUP_CHAT_MAX_TOKENS,
                    stream: false,
                }),
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`导演请求失败 (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
            }
            if (secondaryDirectorConfig) markSecondaryApiConfigSuccess(secondaryDirectorConfig);

            const data = await safeResponseJson(response);
            const content = data.choices?.[0]?.message?.content || '';
            const parsed = parseGroupSpeakerWaves(content, groupMembers, maxSpeakers);
            return parsed !== null ? parsed : fallbackSpeakerWaves(currentMsgs, groupMembers);
        } catch (error) {
            if (secondaryDirectorConfig) markSecondaryApiConfigFailure(secondaryDirectorConfig, error);
            console.warn('[GroupLive] speaker director fallback:', error);
            return fallbackSpeakerWaves(currentMsgs, groupMembers);
        }
    };

    const buildGroupLiveBubbleMetadata = (
        base: NonNullable<Message['metadata']>,
        includePrivateMeta: boolean,
        innerVoice: string | undefined,
        thinking: string | undefined,
    ): Message['metadata'] => ({
        ...base,
        groupLive: true,
        ...(includePrivateMeta && innerVoice?.trim() ? { groupInnerVoice: innerVoice.trim() } : {}),
        ...(includePrivateMeta && thinking?.trim() ? { thinking: thinking.trim() } : {}),
    });

    const buildGroupLivePublicBubbles = (
        publicContent: string,
        innerVoice: string | undefined,
        thinking: string | undefined,
    ): GroupLiveBubble[] => {
        const cleaned = ChatParser.sanitize(publicContent);
        if (!cleaned.trim()) return [];

        const parts = ChatParser.splitResponse(cleaned);
        const bubbles: GroupLiveBubble[] = [];
        let firstBubble = true;

        const pushBubble = (bubble: GroupLiveBubble) => {
            bubbles.push(bubble);
            firstBubble = false;
        };

        for (const part of parts) {
            if (part.type === 'emoji') {
                const foundEmoji = emojis.find(e => e.name === part.content);
                if (!foundEmoji) continue;
                pushBubble({
                    type: 'emoji',
                    content: foundEmoji.url,
                    metadata: buildGroupLiveBubbleMetadata(
                        {
                            name: part.content,
                            categoryId: foundEmoji.categoryId,
                        },
                        firstBubble,
                        innerVoice,
                        thinking,
                    ),
                    textLength: 2,
                });
                continue;
            }

            if (part.type === 'song') {
                const songText = `分享了一首歌：${part.content.songName} - ${part.content.artist}`;
                pushBubble({
                    type: 'text',
                    content: songText,
                    metadata: buildGroupLiveBubbleMetadata(
                        {
                            type: 'song_card',
                            ...part.content,
                        },
                        firstBubble,
                        innerVoice,
                        thinking,
                    ),
                    textLength: songText.replace(/\s+/g, '').length,
                });
                continue;
            }

            const chunks = ChatParser.chunkText(part.content);
            for (const chunk of chunks) {
                const cleanChunk = ChatParser.sanitize(chunk);
                if (!ChatParser.hasDisplayContent(cleanChunk)) continue;
                pushBubble({
                    type: 'text',
                    content: cleanChunk,
                    metadata: buildGroupLiveBubbleMetadata(
                        {},
                        firstBubble,
                        innerVoice,
                        thinking,
                    ),
                    textLength: cleanChunk.replace(/\s+/g, '').length || cleanChunk.length,
                });
            }
        }

        return bubbles;
    };

    const estimateGroupLiveBubbleTypingMs = (bubble: GroupLiveBubble): number => {
        const base = bubble.type === 'emoji'
            ? GROUP_LIVE_BUBBLE_TIMING.emojiTypingMs
            : clamp(
                (Math.max(1, bubble.textLength) / GROUP_LIVE_BUBBLE_TIMING.charsPerSecond) * 1000,
                GROUP_LIVE_BUBBLE_TIMING.minTypingMs,
                GROUP_LIVE_BUBBLE_TIMING.maxTypingMs,
            );
        const jitter = 1 + (Math.random() * 2 - 1) * GROUP_LIVE_BUBBLE_TIMING.jitterRatio;
        return Math.round(clamp(base * jitter, GROUP_LIVE_BUBBLE_TIMING.minTypingMs, GROUP_LIVE_BUBBLE_TIMING.maxTypingMs));
    };

    const getGroupLiveBubblePauseMs = (): number => (
        Math.round(GROUP_LIVE_BUBBLE_TIMING.pauseMinMs + Math.random() * (GROUP_LIVE_BUBBLE_TIMING.pauseMaxMs - GROUP_LIVE_BUBBLE_TIMING.pauseMinMs))
    );

    const releaseGroupLiveBubble = async (
        speaker: CharacterProfile,
        bubble: GroupLiveBubble,
    ): Promise<number> => {
        if (!activeGroup) return 0;
        const timestamp = Date.now();
        const messageDraft = {
            charId: speaker.id,
            groupId: activeGroup.id,
            role: 'assistant' as const,
            type: bubble.type,
            content: bubble.content,
            timestamp,
            metadata: bubble.metadata,
        };
        const id = await DB.saveMessage(messageDraft);
        const savedMessage: Message = { ...messageDraft, id };
        setMessages(prev => sortGroupLogMessages([...prev, savedMessage]));
        setTotalMsgCount(prev => prev + 1);
        return 1;
    };

    const playGroupLiveBubbleSchedule = async (
        plans: GroupLiveReplyPlan[],
    ): Promise<{ savedCount: number; failures: unknown[] }> => {
        const waitingQueues = plans
            .filter(plan => plan.bubbles.length > 0)
            .map(plan => ({ speaker: plan.speaker, bubbles: plan.bubbles }));
        const activeQueues: GroupLiveBubbleQueue[] = [];
        const failures: unknown[] = [];
        let savedCount = 0;
        let virtualNow = 0;

        const startQueue = (queue: { speaker: CharacterProfile; bubbles: GroupLiveBubble[] }, startAt: number): GroupLiveBubbleQueue => {
            const typingAt = startAt;
            return {
                ...queue,
                index: 0,
                typingAt,
                readyAt: typingAt + estimateGroupLiveBubbleTypingMs(queue.bubbles[0]),
            };
        };

        const fillTypingSlots = () => {
            const maxTypers = Math.max(1, GROUP_LIVE_BUBBLE_TIMING.maxConcurrentTypers);
            while (activeQueues.length < maxTypers && waitingQueues.length > 0) {
                const nextQueue = waitingQueues.shift();
                if (nextQueue) activeQueues.push(startQueue(nextQueue, virtualNow));
            }
        };

        const updateVisibleTypers = () => {
            setTypingCharIds(
                activeQueues
                    .filter(queue => queue.index < queue.bubbles.length && queue.typingAt <= virtualNow)
                    .map(queue => queue.speaker.id),
            );
        };

        fillTypingSlots();
        while (activeQueues.length > 0) {
            updateVisibleTypers();
            const nextTypingAt = activeQueues.reduce(
                (nextAt, queue) => queue.typingAt > virtualNow ? Math.min(nextAt, queue.typingAt) : nextAt,
                Number.POSITIVE_INFINITY,
            );
            const nextReadyAt = activeQueues.reduce(
                (nextAt, queue) => Math.min(nextAt, queue.readyAt),
                Number.POSITIVE_INFINITY,
            );
            const nextEventAt = Math.min(nextTypingAt, nextReadyAt);
            if (!Number.isFinite(nextEventAt)) break;

            await wait(Math.max(0, nextEventAt - virtualNow));
            virtualNow = nextEventAt;

            if (nextTypingAt < nextReadyAt) {
                updateVisibleTypers();
                continue;
            }

            activeQueues.sort((left, right) => left.readyAt - right.readyAt);
            const queue = activeQueues.shift();
            if (!queue) break;

            const bubble = queue.bubbles[queue.index];
            try {
                savedCount += await releaseGroupLiveBubble(queue.speaker, bubble);
            } catch (error) {
                failures.push(error);
            }

            const nextIndex = queue.index + 1;
            if (nextIndex < queue.bubbles.length) {
                const typingAt = virtualNow + getGroupLiveBubblePauseMs();
                activeQueues.push({
                    ...queue,
                    index: nextIndex,
                    typingAt,
                    readyAt: typingAt + estimateGroupLiveBubbleTypingMs(queue.bubbles[nextIndex]),
                });
            }
            fillTypingSlots();
        }

        setTypingCharIds([]);
        return { savedCount, failures };
    };

    const readLiveRoleplayApiSelectionValue = (speakerId: string): string => {
        if (!activeGroup) return GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE;
        return liveRoleplayApiSelections[speakerId]
            || readGroupLiveRoleplayApiSelection(activeGroup.id, speakerId);
    };

    const handleLiveRoleplayApiSelectionChange = (memberId: string, value: string) => {
        if (!activeGroup) return;
        writeGroupLiveRoleplayApiSelection(activeGroup.id, memberId, value);
        setLiveRoleplayApiSelections(prev => ({ ...prev, [memberId]: value }));
    };

    const resolveLiveRoleplayApiForSpeaker = (
        speaker: CharacterProfile,
        secondaryPool = getSecondaryApiPoolWithStatus(),
    ): GroupLiveRoleplayApiResolution => {
        if (!activeGroup) throw new Error('群聊未打开');
        const value = readLiveRoleplayApiSelectionValue(speaker.id);
        const resolved = resolveGroupLiveRoleplayApiConfig(value, apiConfig, apiPresets, secondaryPool);
        if (!resolved) {
            throw new Error(`${speaker.name} 的群像扮演 API 未配置完整`);
        }
        return resolved;
    };

    const isSecondaryRoleplayApi = (resolution: GroupLiveRoleplayApiResolution): boolean => {
        return resolution.source === 'secondary-pool' || resolution.source === 'secondary-round-robin';
    };

    type LiveRoleplayJob = {
        speaker: CharacterProfile;
        api: GroupLiveRoleplayApiResolution;
        fingerprint: string;
    };

    const readGroupLiveCognition = (speakerId: string, targetId: string): string => {
        if (!activeGroup) return '';
        try {
            return localStorage.getItem(getGroupLiveCognitionKey(activeGroup.id, speakerId, targetId)) || '';
        } catch {
            return '';
        }
    };

    const writeGroupLiveCognition = (speakerId: string, targetId: string, value: string) => {
        if (!activeGroup) return;
        const key = getGroupLiveCognitionKey(activeGroup.id, speakerId, targetId);
        try {
            if (value.trim()) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
            setCognitionRevision(prev => prev + 1);
        } catch {
            // Best effort: this is prompt-side local UI state.
        }
    };

    const buildGroupLiveCognitionMap = (
        speaker: CharacterProfile,
        groupMembers: CharacterProfile[],
    ): Record<string, string> => {
        const map: Record<string, string> = {};
        for (const member of groupMembers) {
            if (member.id === speaker.id) continue;
            const note = readGroupLiveCognition(speaker.id, member.id).trim();
            if (note) map[member.id] = note;
        }
        return map;
    };

    const generateLiveGroupReply = async (
        speaker: CharacterProfile,
        groupLog: Message[],
        groupMembers: CharacterProfile[],
        autonomous = false,
        apiResolution?: GroupLiveRoleplayApiResolution,
        contextMode: GroupLiveContextMode = 'serial',
    ): Promise<GroupLiveReplyPlan> => {
        if (!activeGroup) return { speaker, bubbles: [] };
        const roleplayApi = apiResolution || resolveLiveRoleplayApiForSpeaker(speaker);
        const roleplayApiConfig = roleplayApi.config;
        const baseUrl = roleplayApiConfig.baseUrl.replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${roleplayApiConfig.apiKey || 'sk-none'}` };
        const embeddingApiKey = getEmbeddingConfig().apiKey || undefined;
        const currentGroupExcluded = groups.filter(group => group.id !== activeGroup.id);
        const perspective = buildGroupPerspectiveMessages(groupLog.slice(-contextLimit), {
            speaker,
            userProfile,
            characters,
            emojis,
            includeTimestamp: true,
        });

        let systemPrompt = await ChatPrompts.buildSystemPrompt(
            speaker,
            userProfile,
            currentGroupExcluded,
            emojis,
            categories,
            perspective.contextMessages,
            realtimeConfig,
            roleplayApiConfig,
            embeddingApiKey,
            undefined,
            {},
        );
        systemPrompt += buildGroupLiveScenePrompt({
            groupName: activeGroup.name,
            speaker,
            members: groupMembers,
            userProfile,
            contextMode,
            autonomous,
            cognitionByMemberId: buildGroupLiveCognitionMap(speaker, groupMembers),
        });

        const fullMessages: any[] = [
            { role: 'system', content: systemPrompt },
            ...perspective.apiMessages.map(message => ({ ...message })),
        ];

        const usePrefill = !roleplayApiConfig.disablePrefill;
        const thinkTag = isDeepSeekMode(roleplayApiConfig) ? 'think' : 'thinking';
        let trailingInstructions = `\n\n[群像输出提醒]\n只输出${speaker.name}自己的本轮回复。不要写其他人的台词。先闭合思考，再写一段 <心声>...</心声>，随后写公开群消息正文。公开正文不要带名字前缀或时间戳。`;
        if (usePrefill) {
            trailingInstructions += isDeepSeekMode(roleplayApiConfig)
                ? `\n\n[思考提示]\n请先在 <think> 内简短思考，闭合 </think> 后输出心声和正文。`
                : `\n\n[思考提示]\n请先在 <thinking> 内简短思考，闭合 </thinking> 后输出心声和正文。`;
        }
        const lastMessageBeforePrefill = fullMessages[fullMessages.length - 1];
        if (lastMessageBeforePrefill?.role === 'user') {
            appendTextToLastUserMessage(fullMessages, trailingInstructions);
        } else {
            fullMessages.push({ role: 'user', content: `[系统执行指令]${trailingInstructions}` });
        }
        if (usePrefill) {
            fullMessages.push({ role: 'assistant', content: `<${thinkTag}>` });
        }

        const chatTemperature = normalizeChatTemperature(roleplayApiConfig.temperature, DEFAULT_CHAT_TEMPERATURE);
        let requestBody: Record<string, any> = {
            model: roleplayApiConfig.model,
            messages: fullMessages,
            temperature: chatTemperature,
            max_tokens: GROUP_CHAT_MAX_TOKENS,
            stream: false,
        };

        const clearStreamPreview = () => {};
        const updateStreamPreview = (_rawContent: string) => {};

        let data: any;
        try {
            if (roleplayApiConfig.streamChat === true) {
                try {
                    requestBody = { ...requestBody, stream: true };
                    data = await fetchStreamingChatCompletion(
                        `${baseUrl}/chat/completions`,
                        { method: 'POST', headers, body: JSON.stringify(requestBody) },
                        updateStreamPreview,
                    );
                    updateStreamPreview(data.choices?.[0]?.message?.content || '');
                } catch (streamError: any) {
                    clearStreamPreview();
                    if (streamError?.partialContent?.trim()) throw streamError;
                    requestBody = { ...requestBody, stream: false };
                    const response = await fetch(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(requestBody),
                    });
                    if (!response.ok) {
                        const detail = await response.text().catch(() => '');
                        throw new Error(`AI 请求失败 (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
                    }
                    data = await safeResponseJson(response);
                }
            } else {
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                });
                if (!response.ok) {
                    const detail = await response.text().catch(() => '');
                    throw new Error(`AI 请求失败 (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
                }
                data = await safeResponseJson(response);
            }

            if (isSecondaryRoleplayApi(roleplayApi)) {
                markSecondaryApiConfigSuccess(roleplayApiConfig);
            }
        } catch (error) {
            if (isSecondaryRoleplayApi(roleplayApi)) {
                markSecondaryApiConfigFailure(roleplayApiConfig, error);
            }
            throw error;
        }

        clearStreamPreview();
        let aiContent = data.choices?.[0]?.message?.content || '';
        const nativeThinking: string = data.choices?.[0]?.message?.reasoning_content || data.choices?.[0]?.message?.thinking || '';
        if (usePrefill && !nativeThinking && !aiContent.includes('<thinking>') && !aiContent.includes('<think>')) {
            aiContent = `<${thinkTag}>\n${aiContent}`;
        }
        const extracted = extractThinking(aiContent);
        const thinkingContent = selectThinkingForDisplay(extracted.thinking, nativeThinking) || '';
        aiContent = extracted.content.trim() || safeThinkingFallbackReply(thinkingContent);
        aiContent = ChatParser.cleanAiSecondPass(aiContent);
        const liveText = extractGroupLiveText(aiContent);

        for (const privateCommand of liveText.privateCommands) {
            await DB.saveMessage({
                charId: speaker.id,
                role: 'assistant',
                type: 'text',
                content: privateCommand.content,
                metadata: { source: 'group_live_private', groupId: activeGroup.id, groupName: activeGroup.name },
            });
            addToast(`${speaker.name} 悄悄对你说: ${privateCommand.content.substring(0, 15)}...`, 'info');
        }

        return {
            speaker,
            bubbles: buildGroupLivePublicBubbles(
                liveText.publicContent,
                liveText.innerVoice,
                thinkingContent || undefined,
            ),
        };
    };

    const buildNextPhysicalRoleplayBatch = (
        pendingSpeakers: CharacterProfile[],
    ): { wave: LiveRoleplayJob[]; rest: CharacterProfile[] } => {
        if (!activeGroup) return { wave: [], rest: pendingSpeakers };

        const wave: LiveRoleplayJob[] = [];
        const rest: CharacterProfile[] = [];
        const usedFingerprints = new Set<string>();

        for (const speaker of pendingSpeakers) {
            const value = readLiveRoleplayApiSelectionValue(speaker.id);
            let api: GroupLiveRoleplayApiResolution | null = null;

            if (value === 'secondary:round-robin') {
                api = reserveDistinctSecondaryRoleplayApis(
                    1,
                    getSecondaryApiPoolWithStatus(),
                    usedFingerprints,
                )[0] || null;
            } else {
                api = resolveGroupLiveRoleplayApiConfig(value, apiConfig, apiPresets, getSecondaryApiPoolWithStatus());
            }

            if (!api) {
                rest.push(speaker);
                continue;
            }

            const fingerprint = getGroupLiveApiFingerprint(api.config);
            if (usedFingerprints.has(fingerprint)) {
                rest.push(speaker);
                continue;
            }

            usedFingerprints.add(fingerprint);
            wave.push({ speaker, api, fingerprint });
        }

        if (wave.length === 0 && pendingSpeakers[0]) {
            resolveLiveRoleplayApiForSpeaker(pendingSpeakers[0]);
        }

        return { wave, rest };
    };

    const generateLiveGroupReplyWithPoolRetry = async (
        job: LiveRoleplayJob,
        groupLog: Message[],
        groupMembers: CharacterProfile[],
        autonomous: boolean,
        waveFingerprints: Set<string>,
        contextMode: GroupLiveContextMode,
    ): Promise<GroupLiveReplyPlan> => {
        try {
            return await generateLiveGroupReply(job.speaker, groupLog, groupMembers, autonomous, job.api, contextMode);
        } catch (firstError) {
            if (!isSecondaryRoleplayApi(job.api)) throw firstError;

            const retryBlockedFingerprints = new Set(waveFingerprints);
            retryBlockedFingerprints.add(job.fingerprint);
            const retryApi = reserveDistinctSecondaryRoleplayApis(
                1,
                getSecondaryApiPoolWithStatus(),
                retryBlockedFingerprints,
            )[0];
            if (!retryApi) throw firstError;

            return generateLiveGroupReply(
                job.speaker,
                groupLog,
                groupMembers,
                autonomous,
                retryApi,
                contextMode,
            );
        }
    };

    const runSnapshotRoleplayJob = async (
        job: LiveRoleplayJob,
        groupLog: Message[],
        groupMembers: CharacterProfile[],
        autonomous: boolean,
        waveFingerprints: Set<string>,
        contextMode: GroupLiveContextMode,
    ): Promise<GroupLiveReplyPlan> => (
        generateLiveGroupReplyWithPoolRetry(job, groupLog, groupMembers, autonomous, waveFingerprints, contextMode)
    );

    const runSemanticRoleplayWave = async (
        semanticSpeakers: CharacterProfile[],
        waveSnapshotLog: Message[],
        groupMembers: CharacterProfile[],
        autonomous: boolean,
    ): Promise<{ savedCount: number; failures: unknown[] }> => {
        let savedCount = 0;
        const failures: unknown[] = [];
        const replyPlans: GroupLiveReplyPlan[] = [];
        let pendingSpeakers = [...semanticSpeakers];
        const contextMode: GroupLiveContextMode = semanticSpeakers.length > 1 ? 'snapshot' : 'serial';

        while (pendingSpeakers.length > 0) {
            const { wave, rest } = buildNextPhysicalRoleplayBatch(pendingSpeakers);
            if (wave.length === 0) {
                throw new Error('群像语义波没有可用 API');
            }
            pendingSpeakers = rest;

            const waveFingerprints = new Set(wave.map(job => job.fingerprint));
            setTypingCharIds(wave.map(job => job.speaker.id));

            if (wave.length >= 2) {
                const results = await Promise.allSettled(
                    wave.map(job => runSnapshotRoleplayJob(job, waveSnapshotLog, groupMembers, autonomous, waveFingerprints, contextMode)),
                );
                for (const result of results) {
                    if (result.status === 'fulfilled') replyPlans.push(result.value);
                    else failures.push(result.reason);
                }
            } else {
                try {
                    const plan = await runSnapshotRoleplayJob(
                        wave[0],
                        waveSnapshotLog,
                        groupMembers,
                        autonomous,
                        waveFingerprints,
                        contextMode,
                    );
                    replyPlans.push(plan);
                } catch (error) {
                    failures.push(error);
                }
            }
        }

        const scheduled = await playGroupLiveBubbleSchedule(replyPlans);
        savedCount += scheduled.savedCount;
        failures.push(...scheduled.failures);

        const refreshed = await refreshGroupMessages();
        await saveActiveGroupHandoffBridge(refreshed);
        return { savedCount, failures };
    };

    const triggerLiveGroupRound = async (currentMsgs: Message[], options: { autonomous?: boolean } = {}) => {
        if (!activeGroup) return;
        if (isTyping) return;

        setIsTyping(true);
        setTypingCharIds([]);
        let savedMessageCount = 0;

        try {
            const groupMembers = getGroupMemberCharacters(activeGroup, characters);
            if (groupMembers.length === 0) {
                throw new Error('群成员数据异常：找不到可发言角色');
            }
            const contextMsgs = await ensureGroupContextMessages(currentMsgs);

            const speakerWaves = await requestLiveSpeakerWaves(contextMsgs, groupMembers, options.autonomous);
            const semanticWaves = speakerWaves
                .map(wave => wave
                    .map(id => groupMembers.find(member => member.id === id))
                    .filter((member): member is CharacterProfile => !!member))
                .filter(wave => wave.length > 0);

            if (semanticWaves.length === 0) {
                addToast('这轮没人接话', 'info');
                return;
            }

            let liveLog = sortGroupLogMessages(contextMsgs);
            const waveFailures: unknown[] = [];

            for (const semanticWave of semanticWaves) {
                const waveSnapshot = liveLog;
                const result = await runSemanticRoleplayWave(
                    semanticWave,
                    waveSnapshot,
                    groupMembers,
                    Boolean(options.autonomous),
                );
                savedMessageCount += result.savedCount;
                waveFailures.push(...result.failures);
                liveLog = await refreshGroupMessages();
            }

            if (savedMessageCount === 0 && waveFailures.length > 0) {
                throw waveFailures[0];
            }

            if (waveFailures.length > 0) {
                addToast(`有 ${waveFailures.length} 个成员这轮生成失败，其余回复已保留`, 'info');
            }

            if (savedMessageCount === 0) {
                throw new Error('AI 已返回，但没有产生可公开显示的群消息');
            }
        } catch (e: any) {
            console.error(e);
            addToast(`群像生成失败: ${e.message || '未知错误'}`, 'error');
        } finally {
            setTypingCharIds([]);
            setIsTyping(false);
            if (options.autonomous) {
                setAutonomousRoundsRemaining(prev => {
                    const next = Math.max(0, prev - 1);
                    if (next === 0) {
                        setAutonomousChatEnabled(false);
                        localStorage.setItem(GROUP_LIVE_AUTONOMOUS_ENABLED_KEY, 'false');
                    }
                    return next;
                });
            }
            const refreshed = await refreshGroupMessages().catch(error => {
                console.error('Failed to refresh group messages:', error);
                return [] as Message[];
            });
            if (refreshed.length > 0) {
                await saveActiveGroupHandoffBridge(refreshed);
            }
            const embeddingApiKey = getEmbeddingConfig().apiKey || undefined;
            const hasSummaryApi = getReadySecondaryApiPoolEntries(getSecondaryApiPoolWithStatus()).length > 0;
            if (activeGroup && liveGroupModeEnabled && hasSummaryApi && embeddingApiKey && refreshed.length > 0) {
                queueGroupMemorySummaries({
                    group: activeGroup,
                    messages: refreshed,
                    characters,
                    userProfile,
                    embeddingApiKey,
                });
            }
        }
    };

    useEffect(() => {
        clearAutonomousTimer();
        if (!activeGroup || !liveGroupModeEnabled || !autonomousChatEnabled || autonomousRoundsRemaining <= 0 || isTyping) {
            return;
        }

        autonomousTimerRef.current = setTimeout(async () => {
            if (!activeGroup || isTyping) return;
            const currentMsgs = sortGroupLogMessages(await DB.getGroupMessages(activeGroup.id));
            await triggerLiveGroupRound(currentMsgs, { autonomous: true });
        }, Math.max(1, autonomousDelaySeconds) * 1000);

        return clearAutonomousTimer;
    }, [
        activeGroup?.id,
        liveGroupModeEnabled,
        autonomousChatEnabled,
        autonomousRoundsRemaining,
        autonomousDelaySeconds,
        isTyping,
        messages.length,
    ]);

    // --- Logic: AI Director (The Core Logic) ---

    const triggerDirector = async (currentMsgs: Message[]) => {
        if (!activeGroup) return;
        if (!apiConfig.apiKey) {
            addToast('请先在设置中配置 API Key', 'error');
            return;
        }
        setIsTyping(true);
        let savedMessageCount = 0;

        try {
            // 1. Prepare Group Context
            const groupMembers = getGroupMemberCharacters(activeGroup, characters);
            if (groupMembers.length === 0) {
                throw new Error('群成员数据异常：找不到可发言角色');
            }
            const contextMsgs = await ensureGroupContextMessages(currentMsgs);

            // Calculate Time Context
            const lastMsg = contextMsgs[contextMsgs.length - 1];
            const timeGapInfo = lastMsg ? getTimeGapHint(lastMsg.timestamp) : "这是群聊的第一条消息。";
            const currentTimeStr = `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;

            let context = `【系统：群聊模拟器配置】
当前群名: "${activeGroup.name}"
当前系统时间: ${currentTimeStr}
时间流逝感知: ${timeGapInfo}
用户 (User): ${userProfile.name} (你服务的对象)
`;

            // 2. Inject Member Context (Strict Isolation via ContextBuilder)
            for (const member of groupMembers) {
                // Use ContextBuilder for the heavy lifting of profile, impression, and archived memories
                const coreContext = ContextBuilder.buildCoreContext(member, userProfile, true);

                // Fetch Private Logs
                const privateMsgs = await DB.getMessagesByCharId(member.id);
                // Get private gap string
                const privateGapInfo = await getPrivateTimeGap(member.id);

                const recentPrivate = privateMsgs
                    .filter(m => shouldIncludeMessageInContext(m))
                    .slice(-10)
                    .map(m => {
                        const content = formatMessageForContext(m, {
                            surface: 'secondaryModel',
                            charName: member.name,
                            userName: userProfile.name,
                            emojis,
                            compact: true,
                            maxContentChars: 120,
                        }) || m.content;
                        return `[${m.role === 'user' ? '用户' : '我'}]: ${content}`;
                    })
                    .join('\n');

                // Private-chat recency should override stale "long time no see"
                // cues from the group thread when we build each member context.
                context += `
<<< 角色档案 START: ${member.name} (ID: ${member.id}) >>>
${coreContext}

[重点：私聊状态 (Private Context)]: 
- **私聊空窗期**: ${privateGapInfo}
- **重要指令**: 如果 [私聊空窗期] 显示 "刚刚" 或 "几小时前"，请【忽略】群聊的时间流逝感知。哪怕群里很久没说话，只要你和用户私底下刚聊过，就【严禁】说 "好久不见" 或表现出疏离感。
- 最近私聊内容摘要，请以此作为你在群里状态的依据，如果私聊在吵架，群聊不会给别人好脸色，或者故意忽视或者试探用户，如果正在甜蜜，群聊中会有点支支吾吾之类的，根据你的性格进行发挥:
${recentPrivate || '(暂无私聊)'}
<<< 角色档案 END >>>
`;
            }

            // 3. Group History (uses configurable context limit)
            // Keep raw image data out of prompt text, but attach recent valid images as OpenAI
            // content parts so the director can actually see what the group is reacting to.
            const recentMsgsWindow = contextMsgs.filter(m => shouldIncludeMessageInContext(m)).slice(-contextLimit);
            const MAX_ATTACHED_IMAGES = 3;
            const validImageWindowIdx: number[] = [];
            recentMsgsWindow.forEach((m, i) => {
                if (m.type === 'image' && isAttachableGroupDirectorImageUrl(m.content)) {
                    validImageWindowIdx.push(i);
                }
            });
            const attachedSet = new Set(validImageWindowIdx.slice(-MAX_ATTACHED_IMAGES));
            const attachedImages: GroupDirectorImageAttachment[] = [];
            const recentGroupMsgs = recentMsgsWindow.map((m, i) => {
                let name = '用户';
                if (m.role === 'assistant') {
                    name = characters.find(c => c.id === m.charId)?.name || '未知';
                }
                let content: string;
                if (m.type === 'image' && attachedSet.has(i) && isAttachableGroupDirectorImageUrl(m.content)) {
                    const tag = attachedImages.length + 1;
                    attachedImages.push({ tag, url: m.content.trim() });
                    content = `[图片#${tag}]`;
                } else {
                    content = formatMessageForContext(m, {
                        surface: 'secondaryModel',
                        charName: name,
                        userName: userProfile.name,
                        emojis,
                        compact: true,
                        maxContentChars: 300,
                    }) || (m.type === 'image' ? '[图片]' : m.content);
                }
                return `${name}: ${content}`;
            }).join('\n');
            const attachedImagesNote = attachedImages.length > 0
                ? `\n（本轮附带 ${attachedImages.length} 张最近的图片，对应记录里的 [图片#1] ~ [图片#${attachedImages.length}]。请基于实际图片内容自然反应，不要无视，也不要瞎猜没附上的旧图。）\n`
                : '';

            // NEW: Build Categorized Emoji Context (filtered by group member visibility)
            const emojiContextStr = (() => {
                if (emojis.length === 0) return '无';

                const memberIds = activeGroup?.members || [];
                // Filter categories: include if no restriction, or if at least one group member is allowed
                const visibleCats = categories.filter(c => {
                    if (!c.allowedCharacterIds || c.allowedCharacterIds.length === 0) return true;
                    return c.allowedCharacterIds.some(id => memberIds.includes(id));
                });
                const hiddenCatIds = new Set(categories.filter(c => !visibleCats.some(vc => vc.id === c.id)).map(c => c.id));
                const visibleEmojis = hiddenCatIds.size === 0 ? emojis : emojis.filter(e => !e.categoryId || !hiddenCatIds.has(e.categoryId));

                const grouped: Record<string, string[]> = {};
                const catMap: Record<string, string> = { 'default': '通用' };
                visibleCats.forEach(c => catMap[c.id] = c.name);

                visibleEmojis.forEach(e => {
                    const cid = e.categoryId || 'default';
                    if (!grouped[cid]) grouped[cid] = [];
                    grouped[cid].push(e.name);
                });

                return Object.entries(grouped).map(([cid, names]) => {
                    const cName = catMap[cid] || '其他';
                    return `${cName}: [${names.join(', ')}]`;
                }).join('; ');
            })();

            const prompt = `${context}

### 【AI 导演任务指令 (Director Mode)】
当前场景：大家正在群里聊天。
最近聊天记录：
${recentGroupMsgs}
${attachedImagesNote}

### 任务：生成一段精彩的群聊互动 (Conversation Flow)
请作为导演，接管所有角色，让群聊**自然地流动起来**。

### 核心规则 (Strict Rules)
1. **去中心化**: 角色之间要有互动，不要每个人都只对着用户说话。并且，必须A说了,B说，然后A会回应B，总之，角色之间应该互相回应，而不是发言完就不发言了。
2. **多轮对话**: 请一次性生成 **1 到 6 条** 消息。
3. **表情包支持**:
   - 角色可以发送表情包。
   - 必须使用格式: \`[[SEND_EMOJI: 表情名称]]\`
   - **可用表情 (按分类)**: ${emojiContextStr}
4. **气泡分段 (Bubble Splitting)**:
   - 就像真人聊天一样，如果一个角色要说长话，或者有停顿，请把内容分成多条消息。
   - 在一条内容中，使用换行符分隔不同的气泡，每一行会变成一个独立气泡。
5. **私聊感知 (优先级最高)**:
   - 请务必检查每个角色的 [私聊空窗期]。
   - 如果某个角色刚刚才私聊过用户，哪怕群里很冷清，TA也应该表现得很熟络，不能说 "好久不见"。
6. **主动私聊 (Private Messaging)**:
   - 角色可以主动向用户发起私聊（例如吐槽群友、邀请约会、或者单纯想避开其他人说话）。
   - 使用格式: \`[[PRIVATE: 私聊内容]]\`。
   - 这条消息将直接发送到私聊频道，**不会**在群里显示。
   - 允许同时在群里说话并发送私聊（分为两个动作或合并）。

### 输出格式 (JSON Array)
[
  {
    "charId": "角色的ID",
    "content": "发言内容... (可以是文本、[[SEND_EMOJI: name]] 或 [[PRIVATE: content]])"
  },
  ...
]
`;

            const userMessageContent = buildGroupDirectorUserContent(prompt, attachedImages);
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: userMessageContent }],
                    temperature: 0.9, // High creativity for banter
                    max_tokens: GROUP_CHAT_MAX_TOKENS,
                })
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`AI 请求失败 (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
            }

            const data = await safeResponseJson(response);
            const rawDirectorContent = data.choices?.[0]?.message?.content;
            const actions = parseGroupDirectorActions(rawDirectorContent);
            if (actions.length === 0) {
                console.error("Director Parse Error", rawDirectorContent);
                throw new Error('AI 返回格式无法解析为群聊消息');
            }

            // Execute Actions with Splitting Logic
            for (const action of actions) {
                const targetId = resolveGroupDirectorMemberId(action, activeGroup, characters);
                if (!targetId) continue;
                const charName = characters.find(c => c.id === targetId)?.name || '成员';
                const actionContent = getGroupDirectorActionContent(action);
                if (!actionContent) continue;

                // 0. Check for Private Message Command (Regex updated for robustness)
                const privateMatches = [];
                // Handle multiple private messages in one block or mixed content
                const privateRegex = /\[\[PRIVATE\s*[:：]\s*([\s\S]*?)\]\]/g;
                let match;
                let publicContent = actionContent;
                while ((match = privateRegex.exec(publicContent)) !== null) {
                    privateMatches.push(match);
                }

                if (privateMatches.length > 0) {
                    for (const m of privateMatches) {
                        const privateContent = m[1].trim();
                        if (privateContent) {
                            // Save to private chat (no groupId)
                            await DB.saveMessage({
                                charId: targetId,
                                role: 'assistant',
                                type: 'text',
                                content: privateContent
                            });
                            savedMessageCount += 1;
                            addToast(`${charName} 悄悄对你说: ${privateContent.substring(0, 15)}...`, 'info');
                        }
                        // Strip the private command from the public content
                        publicContent = publicContent.replace(m[0], '');
                    }
                    publicContent = publicContent.trim();

                    // If content is empty after stripping (pure private message), skip public rendering
                    if (!publicContent) continue;
                }

                // 1. Check for Emoji Command
                const emojiMatch = publicContent.match(/\[\[SEND_EMOJI\s*[:：]\s*(.*?)\]\]/);
                if (emojiMatch) {
                    const emojiName = emojiMatch[1].trim();
                    const foundEmoji = emojis.find(e => e.name === emojiName);
                    if (foundEmoji) {
                        await DB.saveMessage({
                            charId: targetId,
                            groupId: activeGroup.id,
                            role: 'assistant',
                            type: 'emoji',
                            content: foundEmoji.url
                        });
                        savedMessageCount += 1;
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                        await new Promise(r => setTimeout(r, 800)); // Delay after emoji
                        continue; // Skip text processing if it was purely an emoji command (or handled here)
                    }
                }

                // 2. Text Splitting (Standard Chat Logic)
                // Remove the emoji tag if it was processed, or just clean up
                let textContent = publicContent.replace(/\[\[SEND_EMOJI\s*[:：].*?\]\]/g, '').trim();

                if (textContent) {
                    // Primary: split on line breaks
                    let chunks = textContent.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
                        .map((c: string) => c.trim())
                        .filter((c: string) => c.length > 0);

                    // Fallback: split on spaces between CJK characters (中文里空格=AI想换行)
                    if (chunks.length <= 1 && textContent.trim().length > 50) {
                        chunks = textContent.split(/(?<=[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2000-\u206f\u2e80-\u2eff\u3001-\u3003\u2018-\u201f\u300a-\u300f\uff01-\uff0f\uff1a-\uff20])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf])/)
                            .map((c: string) => c.trim())
                            .filter((c: string) => c.length > 0);
                    }

                    if (chunks.length === 0) chunks.push(textContent); // Fallback

                    for (const chunk of chunks) {
                        // Typing delay
                        const delay = Math.max(500, chunk.length * 50 + Math.random() * 200);
                        await new Promise(r => setTimeout(r, delay));

                        await DB.saveMessage({
                            charId: targetId,
                            groupId: activeGroup.id,
                            role: 'assistant',
                            type: 'text',
                            content: chunk
                        });
                        savedMessageCount += 1;
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                    }
                }
            }

            if (savedMessageCount === 0) {
                throw new Error('AI 已返回，但没有匹配到群成员或可显示内容');
            }

        } catch (e: any) {
            console.error(e);
            addToast(`群聊生成失败: ${e.message || '未知错误'}`, 'error');
        } finally {
            if (activeGroup) {
                try {
                    const refreshed = sortGroupLogMessages(await DB.getGroupMessages(activeGroup.id));
                    setMessages(refreshed);
                    setTotalMsgCount(refreshed.length);
                    await saveActiveGroupHandoffBridge(refreshed);
                } catch (refreshError) {
                    console.error('Failed to refresh group messages:', refreshError);
                }
            }
            setIsTyping(false);
        }
    };

    // --- Renderers ---

    if (view === 'list') {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-light">
                <div className="sully-safe-topbar h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-medium text-slate-700 text-lg tracking-wide pl-2">群聊列表</span>
                    <div className="flex-1"></div>
                    <button onClick={() => { setModalType('create'); setSelectedMembers(new Set()); setTempGroupName(''); }} className="p-2 -mr-2 text-violet-500 bg-violet-50 hover:bg-violet-100 rounded-full transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>

                <div className="p-4 space-y-3 overflow-y-auto">
                    {groups.map(g => (
                        <div key={g.id} onClick={() => { setActiveGroup(g); setView('chat'); }} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 active:scale-[0.98] transition-all cursor-pointer group hover:bg-violet-50/30">
                            {/* Group Avatar Logic */}
                            <div className="w-14 h-14 rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 relative shadow-sm">
                                {g.avatar ? (
                                    <img src={g.avatar} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="grid grid-cols-2 gap-0.5 p-0.5 w-full h-full bg-slate-200">
                                        {g.members.slice(0, 4).map(mid => {
                                            const c = characters.find(char => char.id === mid);
                                            return <img key={mid} src={c?.avatar} className="w-full h-full object-cover rounded-sm bg-white" />;
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-slate-700 truncate text-base">{g.name}</div>
                                <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" /></svg>
                                    {g.members.length} 成员
                                </div>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                        </div>
                    ))}
                    {groups.length === 0 && (
                        <div className="text-center text-slate-400 text-xs py-10 flex flex-col items-center gap-2">
                            <span className="text-3xl opacity-50">👥</span>
                            暂无群聊，点击右上角创建
                        </div>
                    )}
                </div>

                <Modal isOpen={modalType === 'create'} title="创建群聊" onClose={() => setModalType('none')} footer={<button onClick={handleCreateGroup} className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg shadow-violet-200">创建</button>}>
                    <div className="space-y-4">
                        <input value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} placeholder="群聊名称" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 transition-all" />
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">选择成员</label>
                            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
                                {characters.map(c => (
                                    <div key={c.id} onClick={() => toggleMemberSelection(c.id)} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all cursor-pointer ${selectedMembers.has(c.id) ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-slate-100 bg-white hover:border-slate-300'}`}>
                                        <img src={c.avatar} className="w-10 h-10 rounded-full object-cover" />
                                        <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Modal>
            </div>
        );
    }

    // CHAT VIEW
    const typingCharacters = typingCharIds
        .map(id => characters.find(c => c.id === id))
        .filter((character): character is CharacterProfile => Boolean(character));
    const typingCharacter = typingCharacters.length === 1
        ? typingCharacters[0]
        : (typingCharId ? characters.find(c => c.id === typingCharId) : null);
    const activeGroupMemberCharacters = activeGroup ? getGroupMemberCharacters(activeGroup, characters) : [];
    const cognitionEditorSpeaker = activeGroupMemberCharacters.find(member => member.id === cognitionEditorSpeakerId) || activeGroupMemberCharacters[0];
    const cognitionEditorTargets = activeGroupMemberCharacters.filter(member => member.id !== cognitionEditorSpeaker?.id);
    const autonomousChatActive = autonomousChatEnabled && autonomousRoundsRemaining > 0;

    return (
        <div className="h-full w-full bg-[#f0f4f8] flex flex-col font-sans relative">
            {/* Header */}
            <div className="sully-safe-topbar-spacious h-24 bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shrink-0 z-30 sticky top-0 shadow-sm transition-all">
                {selectionMode ? (
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); }} className="text-sm font-bold text-slate-500 px-2 py-1">取消</button>
                        <span className="text-sm font-bold text-slate-800">已选 {selectedMsgIds.size} 项</span>
                        <div className="w-10"></div>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 w-full">
                        <button onClick={handleBackToGroupList} className="p-2 -ml-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                        </button>
                        <div className="flex-1 min-w-0" onClick={() => { setTempGroupName(activeGroup?.name || ''); setModalType('settings'); }}>
                            <h1 className="text-base font-bold text-slate-800 truncate flex items-center gap-1">
                                {activeGroup?.name}
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-slate-400"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-medium">{activeGroup?.members.length} 成员</p>
                        </div>

                        {/* Reroll Button (Context Aware) */}
                        {canReroll && !isTyping && (
                            <button
                                onClick={handleReroll}
                                className="p-2 rounded-full bg-slate-100 text-slate-500 hover:text-violet-600 transition-colors"
                                title="重新生成回复"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                            </button>
                        )}

                        {/* Manual Trigger Button (Only trigger, not send) */}
                        <button
                            onClick={() => liveGroupModeEnabled ? triggerLiveGroupRound(messages) : triggerDirector(messages)}
                            disabled={isTyping}
                            className={`p-2 rounded-full transition-all active:scale-90 ${isTyping ? 'bg-slate-100 text-slate-300' : 'bg-violet-100 text-violet-600 shadow-sm'}`}
                            title={liveGroupModeEnabled ? '群像 Beta：真实多角色接话' : '旧导演接话'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .914-.143Z" clipRule="evenodd" /></svg>
                        </button>
                    </div>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-2 bg-[#f0f4f8]" ref={scrollRef}>
                {totalMsgCount > messages.length && activeGroup && (
                    <div className="flex justify-center mb-4">
                        <button onClick={async () => {
                            const { messages: moreMsgs, totalCount } = await DB.getRecentGroupMessagesWithCount(activeGroup.id, messages.length + 30);
                            setMessages(sortGroupLogMessages(moreMsgs));
                            setTotalMsgCount(totalCount);
                            setVisibleCount(moreMsgs.length);
                        }} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors">
                            加载历史消息 ({totalMsgCount - messages.length})
                        </button>
                    </div>
                )}
                {displayMessages.map((m, i) => {
                    const isUser = m.role === 'user';
                    const char = characters.find(c => c.id === m.charId);

                    return (
                        <GroupMessageItem
                            key={m.id || i}
                            msg={m}
                            isUser={isUser}
                            char={char}
                            userAvatar={userProfile.avatar}
                            onImageClick={(url) => window.open(url, '_blank')}
                            selectionMode={selectionMode}
                            isSelected={selectedMsgIds.has(m.id)}
                            onToggleSelect={toggleMessageSelection}
                            onLongPress={handleMessageLongPress}
                        />
                    );
                })}
                {isTyping && (
                    <div className="flex items-center gap-2 pl-4 py-2 animate-pulse opacity-70">
                        <div className="flex -space-x-1">
                            {typingCharacters.length > 0 ? typingCharacters.slice(0, 4).map(character => (
                                <img key={character.id} src={character.avatar} className="w-6 h-6 rounded-full object-cover border-2 border-white" />
                            )) : typingCharacter?.avatar ? (
                                <img src={typingCharacter.avatar} className="w-6 h-6 rounded-full object-cover border-2 border-white" />
                            ) : (
                                <div className="w-6 h-6 rounded-full bg-slate-300 border-2 border-white"></div>
                            )}
                            <div className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white"></div>
                        </div>
                        {typingCharacters.length > 1 ? (
                            <div className="flex flex-col gap-0.5">
                                {typingCharacters.map(character => (
                                    <span key={character.id} className="text-xs text-slate-400 font-medium">{character.name} 正在输入...</span>
                                ))}
                            </div>
                        ) : (
                            <span className="text-xs text-slate-400 font-medium">{typingCharacter ? `${typingCharacter.name} 正在输入...` : '成员正在输入...'}</span>
                        )}
                    </div>
                )}
            </div>

            {/* Redesigned Input Area (WeChat/iOS Style) */}
            <div className="bg-[#f0f2f5] border-t border-slate-200 pb-safe shrink-0 z-40 relative">
                {selectionMode ? (
                    <div className="p-3 flex justify-center bg-white">
                        <button
                            onClick={deleteSelectedMessages}
                            className="w-full py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                            删除 ({selectedMsgIds.size})
                        </button>
                    </div>
                ) : (
                    <div className="p-2 flex items-end gap-2">
                        {/* Plus / Actions Button */}
                        <button
                            onClick={() => { setShowActions(!showActions); setShowEmojiPicker(false); }}
                            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform ${showActions ? 'bg-slate-300 rotate-45' : 'bg-transparent hover:bg-slate-200'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        </button>

                        {/* Input Field Container */}
                        <div className="flex-1 bg-white rounded-xl flex items-end px-3 py-2 border border-slate-200 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
                            <textarea
                                rows={1}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(input); } }}
                                className="flex-1 bg-transparent text-[16px] outline-none resize-none max-h-28 text-slate-800 placeholder:text-slate-400 py-1"
                                placeholder="Message..."
                                style={{ height: 'auto', minHeight: '24px' }}
                            />
                            {/* Emoji Toggle inside input */}
                            <button
                                onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowActions(false); }}
                                className="p-1 -mr-1 ml-1 text-slate-400 hover:text-yellow-500 transition-colors shrink-0"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
                            </button>
                        </div>

                        {/* Send Button */}
                        {input.trim() ? (
                            <button
                                onClick={() => handleSendMessage(input)}
                                className="h-9 px-4 bg-violet-500 text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition-all"
                            >
                                发送
                            </button>
                        ) : (
                            <div className="w-2"></div>
                        )}
                    </div>
                )}

                {/* --- Action Drawer --- */}
                {showActions && (
                    <div className="h-64 bg-[#f0f2f5] border-t border-slate-200 p-6 animate-slide-up">
                        <div className="grid grid-cols-4 gap-6">
                            <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-2 group">
                                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-200 group-active:scale-95 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                                </div>
                                <span className="text-xs text-slate-500">相册</span>
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

                            <button onClick={() => setModalType('transfer')} className="flex flex-col items-center gap-2 group">
                                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-200 group-active:scale-95 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-orange-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                                </div>
                                <span className="text-xs text-slate-500">红包</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* --- Emoji Drawer --- */}
                {showEmojiPicker && (
                    <div className="h-64 bg-[#f0f2f5] border-t border-slate-200 p-4 animate-slide-up overflow-y-auto no-scrollbar">
                        <div className="grid grid-cols-5 gap-3">
                            {emojis.map((e, i) => (
                                <button key={i} onClick={() => handleSendMessage(e.url, 'emoji')} className="aspect-square bg-white rounded-xl p-2 border border-slate-200 shadow-sm active:scale-95 flex items-center justify-center">
                                    <img src={e.url} className="w-full h-full object-contain pointer-events-none" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* --- Modals --- */}

            {/* Group Settings Modal */}
            <Modal isOpen={modalType === 'settings'} title="群组设置" onClose={() => setModalType('none')} footer={<button onClick={handleUpdateGroupInfo} className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg shadow-violet-200">保存修改</button>}>
                <div className="space-y-6">
                    {/* Header Info */}
                    <div className="flex justify-center">
                        <div onClick={() => groupAvatarInputRef.current?.click()} className="w-24 h-24 rounded-3xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden relative group hover:border-violet-400">
                            {activeGroup?.avatar ? <img src={activeGroup.avatar} className="w-full h-full object-cover opacity-90 group-hover:opacity-100" /> : <span className="text-xs text-slate-400 font-bold">更换头像</span>}
                            <div className="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center text-white"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" /></svg></div>
                        </div>
                        <input type="file" ref={groupAvatarInputRef} className="hidden" accept="image/*" onChange={handleGroupAvatarUpload} />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">群名称</label>
                        <input value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-violet-300 transition-all" />
                    </div>

                    {/* Context Limit */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">AI 上下文条数 ({contextLimit})</label>
                        <input type="range" min={GROUP_CHAT_CONTEXT_MIN} max={GROUP_CHAT_CONTEXT_MAX} step="10" value={contextLimit} onChange={e => handleGroupContextLimitChange(parseInt(e.target.value, 10))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-violet-500" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (超长记忆)</span></div>
                        <p className="text-[9px] text-slate-400 mt-1 leading-tight">控制每次触发AI导演时发送的群聊历史消息数量。越多上下文越丰富，但消耗更多token。</p>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">群像 Beta</label>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-700">真实多角色生成</div>
                                <p className="text-[9px] text-slate-400 mt-1 leading-tight">每个被导演点到的成员各自发起一次真实回复，旧导演模式保留。</p>
                            </div>
                            <button
                                onClick={() => {
                                    const next = !liveGroupModeEnabled;
                                    setLiveGroupModeEnabled(next);
                                    localStorage.setItem('groupchat_live_mode_enabled', String(next));
                                }}
                                className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${liveGroupModeEnabled ? 'bg-violet-500' : 'bg-slate-200'}`}
                            >
                                <span className={`block w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${liveGroupModeEnabled ? 'translate-x-5' : 'translate-x-0'}`}></span>
                            </button>
                        </div>
                        <div className="mt-4 rounded-xl border border-slate-100 bg-white px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-700">自主交谈</div>
                                    <p className="text-[9px] text-slate-400 mt-1 leading-tight">不需要你发言，角色们自己聊；你一发言就会打断。</p>
                                </div>
                                <button
                                    onClick={() => autonomousChatActive ? stopAutonomousChat() : startAutonomousChat()}
                                    className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${autonomousChatActive ? 'bg-emerald-500' : 'bg-slate-200'}`}
                                >
                                    <span className={`block w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${autonomousChatActive ? 'translate-x-5' : 'translate-x-0'}`}></span>
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <label className="block">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">轮数上限</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={autonomousRoundLimit}
                                        onChange={event => {
                                            const next = Math.max(1, Math.min(20, parseInt(event.target.value || '1', 10)));
                                            setAutonomousRoundLimit(next);
                                            localStorage.setItem(GROUP_LIVE_AUTONOMOUS_ROUND_LIMIT_KEY, String(next));
                                            if (autonomousChatActive) setAutonomousRoundsRemaining(next);
                                        }}
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-violet-300 focus:bg-white"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">间隔秒数</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={60}
                                        value={autonomousDelaySeconds}
                                        onChange={event => {
                                            const next = Math.max(1, Math.min(60, parseInt(event.target.value || '1', 10)));
                                            setAutonomousDelaySeconds(next);
                                            localStorage.setItem(GROUP_LIVE_AUTONOMOUS_DELAY_KEY, String(next));
                                        }}
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-violet-300 focus:bg-white"
                                    />
                                </label>
                            </div>
                            <div className="mt-2 text-[9px] text-slate-400 leading-tight">
                                {autonomousChatActive
                                    ? `运行中：还会自动聊 ${autonomousRoundsRemaining} 轮。`
                                    : '关闭中：只会在你点闪电时接话。'}
                            </div>
                        </div>
                        {activeGroupMemberCharacters.length > 0 && (
                            <div className="mt-4 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">成员扮演 API</div>
                                        <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">只影响群像 Beta 的角色发言；总结固定走副 API 池。</p>
                                    </div>
                                    <span className="text-[9px] text-slate-400 shrink-0">max_tokens {GROUP_CHAT_MAX_TOKENS}</span>
                                </div>
                                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                    {activeGroupMemberCharacters.map(member => {
                                        const selectedValue = liveRoleplayApiSelections[member.id]
                                            || (activeGroup
                                                ? readGroupLiveRoleplayApiSelection(activeGroup.id, member.id)
                                                : GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE);
                                        const value = liveRoleplayApiOptions.some(option => option.value === selectedValue)
                                            ? selectedValue
                                            : GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE;
                                        const selectedOption = liveRoleplayApiOptions.find(option => option.value === value);
                                        return (
                                            <div key={member.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2">
                                                <img src={member.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-700 truncate">{member.name}</div>
                                                    <select
                                                        value={value}
                                                        onChange={event => {
                                                            handleLiveRoleplayApiSelectionChange(member.id, event.target.value);
                                                        }}
                                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 outline-none focus:border-violet-300 focus:bg-white"
                                                    >
                                                        {liveRoleplayApiOptions.map(option => (
                                                            <option key={option.value} value={option.value} disabled={option.disabled}>
                                                                {option.label} · {option.detail}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {selectedOption && (
                                                        <div className="mt-1 text-[9px] text-violet-500 truncate">
                                                            当前：{selectedOption.label} · {selectedOption.detail}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {activeGroupMemberCharacters.length > 1 && cognitionEditorSpeaker && (
                            <div className="mt-4 space-y-2" data-cognition-revision={cognitionRevision}>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">轻量认知 / 交互层</div>
                                    <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">写“某个角色视角里，他认识谁、什么关系、有没有旧账”。只进该角色群像提示词，不进共享群记录。</p>
                                </div>
                                <select
                                    value={cognitionEditorSpeaker.id}
                                    onChange={event => setCognitionEditorSpeakerId(event.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 outline-none focus:border-violet-300 focus:bg-white"
                                >
                                    {activeGroupMemberCharacters.map(member => (
                                        <option key={member.id} value={member.id}>{member.name} 的视角</option>
                                    ))}
                                </select>
                                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                    {cognitionEditorTargets.map(member => (
                                        <label key={`${cognitionEditorSpeaker.id}-${member.id}`} className="block rounded-xl border border-slate-100 bg-white px-2.5 py-2">
                                            <span className="text-[10px] font-bold text-slate-600">{cognitionEditorSpeaker.name} 对 {member.name}</span>
                                            <textarea
                                                value={readGroupLiveCognition(cognitionEditorSpeaker.id, member.id)}
                                                onChange={event => writeGroupLiveCognition(cognitionEditorSpeaker.id, member.id, event.target.value)}
                                                rows={2}
                                                placeholder="例：以前合作过，嘴上互怼但彼此认可；或：刚进群，还不熟。"
                                                className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-700 outline-none focus:border-violet-300 focus:bg-white"
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Memory & Context Management */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">群聊记忆 (Neural Link)</label>

                        {/* Prompt Selection */}
                        <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 mb-3">
                            <label className="text-[9px] font-bold text-indigo-400 uppercase mb-2 block">选择总结提示词</label>
                            <div className="flex flex-col gap-1.5">
                                {archivePrompts.map(p => (
                                    <div key={p.id} onClick={() => setSelectedPromptId(p.id)} className={`px-3 py-2 rounded-lg border cursor-pointer text-xs font-bold transition-all ${selectedPromptId === p.id ? 'bg-white border-indigo-400 text-indigo-700 shadow-sm' : 'bg-white/50 border-indigo-100 text-slate-500 hover:bg-white'}`}>
                                        {p.name}
                                    </div>
                                ))}
                            </div>
                            <p className="text-[8px] text-indigo-300 mt-2 leading-tight">提示词与聊天-归档共享，可在聊天设置中自定义。</p>
                        </div>

                        <button onClick={handleGroupSummary} disabled={isSummarizing} className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-2xl border border-indigo-100 active:scale-95 transition-transform flex items-center justify-center gap-2 mb-2">
                            {isSummarizing ? (
                                <><div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div><span className="text-xs">{summaryProgress || '处理中...'}</span></>
                            ) : (
                                <><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg> 生成总结并同步到全员记忆</>
                            )}
                        </button>
                        <p className="text-[9px] text-slate-400 leading-tight px-1">使用选中的提示词风格生成群聊总结，并作为记忆植入到所有群成员的大脑中。</p>
                    </div>

                    {/* Danger Zone */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3 block">危险区域</label>

                        <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-violet-500 border-violet-500' : 'bg-slate-100 border-slate-300'}`}>
                                {preserveContext && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                            </div>
                            <span className="text-xs text-slate-600">清空时保留最后10条记录 (维持语境)</span>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={handleClearHistory} className="flex-1 py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2 text-xs">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                清空聊天
                            </button>
                            <button onClick={() => { if (activeGroup) handleDeleteGroup(activeGroup.id); }} className="flex-1 py-3 text-white bg-red-500 hover:bg-red-600 rounded-2xl text-xs font-bold transition-colors shadow-lg shadow-red-200">解散群聊</button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Message Options Modal */}
            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => { setModalType('none'); setSelectedMessage(null); }}>
                <div className="space-y-3">
                    <button onClick={handleEnterSelectionMode} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        多选 / 批量删除
                    </button>
                    {selectedMessage?.type === 'text' && (
                        <button onClick={handleCopyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            复制文字
                        </button>
                    )}
                    <button onClick={handleDeleteSingleMessage} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                        删除消息
                    </button>
                </div>
            </Modal>

            {/* Transfer Modal */}
            <Modal isOpen={modalType === 'transfer'} title="发送红包" onClose={() => setModalType('none')} footer={<button onClick={() => { handleSendMessage(`[红包] ${transferAmount} Credits`, 'transfer', { amount: transferAmount }); setModalType('none'); }} className="w-full py-3 bg-orange-500 text-white font-bold rounded-2xl shadow-lg shadow-orange-200">塞进红包</button>}>
                <div className="space-y-4">
                    <div className="text-center text-5xl py-4 animate-bounce">🧧</div>
                    <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="金额" className="w-full px-4 py-4 bg-slate-100 rounded-2xl text-center text-2xl font-bold outline-none text-slate-800 placeholder:text-slate-300" autoFocus />
                </div>
            </Modal>

        </div>
    );
};

export default GroupChat;
