/**
 * TheaterSession — VN 风格对话场景（光与夜之恋）
 * 底部毛玻璃对话框 · 打字机效果 · 点击翻页 · Auto · Log
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { CharacterProfile, UserProfile, Message, DirectorEvent, TheaterLocation, TimeSlot } from '../../types';
import { TIME_SLOT_LABELS } from '../../types/theater';
import { useOS } from '../../context/OSContext';
import TheaterSettings from './TheaterSettings';

const EVENT_TYPE_ZH: Record<string, string> = {
    ambient: '氛围', encounter: '偶遇', romantic: '浪漫',
    callback: '回忆', conflict: '冲突', surprise: '惊喜',
};

const REQUIRED_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'shy'];

interface TheaterSessionProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    location: TheaterLocation;
    timeSlot: TimeSlot;
    is520: boolean;
    currentEvent: DirectorEvent | null;
    isDirectorLoading: boolean;
    isAiLoading: boolean;
    messages: Message[];
    onSendMessage: (text: string) => Promise<void>;
    onChangeLocation: () => void;
    onExit: () => void;
}

// ── Helpers ──

const cleanText = (text: string) => text.replace(/\[.*?\]/g, '').trim();

const extractCurrentEmotion = (messages: Message[]): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'assistant') continue;
        const lines = (messages[i].content || '').split('\n');
        for (let j = lines.length - 1; j >= 0; j--) {
            const match = lines[j].match(/^\[([a-zA-Z0-9_-]+)\]/);
            if (match) return match[1].toLowerCase();
        }
        break;
    }
    return 'normal';
};

/** Flatten messages into VN pages with type detection */
type PageType = 'dialogue' | 'narration' | 'user';
interface VNPage { role: 'user' | 'assistant'; type: PageType; text: string; msgId: string | number; }

/** Detect if a cleaned line is dialogue (wrapped in quotes) and strip the quotes */
function classifyLine(clean: string): { type: 'dialogue' | 'narration'; text: string } {
    // Match "..." or \u201C...\u201D or \u300C...\u300D
    const m = clean.match(/^["\u201C\u300C](.+)["\u201D\u300D]$/);
    if (m) return { type: 'dialogue', text: m[1] };
    // Partial match: starts with quote (AI sometimes doesn't close)
    const m2 = clean.match(/^["\u201C\u300C](.+)/);
    if (m2) return { type: 'dialogue', text: m2[1].replace(/["\u201D\u300D]$/, '') };
    return { type: 'narration', text: clean };
}

function buildPages(messages: Message[]): VNPage[] {
    const pages: VNPage[] = [];
    for (const msg of messages) {
        if (msg.role === 'user') {
            const clean = cleanText(msg.content);
            if (clean) pages.push({ role: 'user', type: 'user', text: clean, msgId: msg.id });
        } else {
            const lines = (msg.content || '').split('\n');
            for (const line of lines) {
                const clean = cleanText(line);
                if (!clean) continue;
                const { type, text } = classifyLine(clean);
                pages.push({ role: 'assistant', type, text, msgId: msg.id });
            }
        }
    }
    return pages;
}

// ── Typewriter Hook ──

function useTypewriter(text: string, speed = 30) {
    const [displayed, setDisplayed] = useState('');
    const [done, setDone] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval>>();

    useEffect(() => {
        setDisplayed('');
        setDone(false);
        let idx = 0;
        timerRef.current = setInterval(() => {
            idx++;
            if (idx >= text.length) {
                setDisplayed(text);
                setDone(true);
                clearInterval(timerRef.current);
            } else {
                setDisplayed(text.slice(0, idx));
            }
        }, speed);
        return () => clearInterval(timerRef.current);
    }, [text, speed]);

    const skipToEnd = useCallback(() => {
        clearInterval(timerRef.current);
        setDisplayed(text);
        setDone(true);
    }, [text]);

    return { displayed, done, skipToEnd };
}

// ══════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════

const TheaterSession: React.FC<TheaterSessionProps> = ({
    char, userProfile, location, timeSlot,
    is520: _is520, currentEvent, isDirectorLoading, isAiLoading,
    messages, onSendMessage, onChangeLocation, onExit,
}) => {
    const { addToast, registerBackHandler } = useOS();

    // ── VN State ──
    const pages = useMemo(() => buildPages(messages), [messages]);
    const [pageIndex, setPageIndex] = useState(0);
    const [showInput, setShowInput] = useState(false);
    const [autoMode, setAutoMode] = useState(false);
    const [showLog, setShowLog] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [input, setInput] = useState('');
    const [eventCollapsed, setEventCollapsed] = useState(false);
    const autoTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const timeLabel = TIME_SLOT_LABELS[timeSlot];

    const currentPage = pages[pageIndex] || null;
    const isLastPage = pageIndex >= pages.length - 1;
    const isLoading = isAiLoading || isDirectorLoading;

    // ── Typewriter ──
    const { displayed, done, skipToEnd } = useTypewriter(currentPage?.text || '', 30);

    // ── Jump to last page when new messages arrive ──
    useEffect(() => {
        if (pages.length > 0) {
            setPageIndex(pages.length - 1);
            setShowInput(false);
        }
    }, [pages.length]);

    // ── Auto-play: advance page after typewriter finishes ──
    useEffect(() => {
        if (!autoMode || !done || isLoading) return;
        if (isLastPage) {
            // Wait a moment then show input
            autoTimerRef.current = setTimeout(() => setShowInput(true), 1500);
        } else {
            autoTimerRef.current = setTimeout(() => setPageIndex(i => i + 1), 2000);
        }
        return () => clearTimeout(autoTimerRef.current);
    }, [autoMode, done, isLastPage, isLoading, pageIndex]);

    // ── Sprite System ──
    const dateEmotionKeys = useMemo(
        () => [...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])],
        [char.customDateSprites],
    );

    const activeSprites: Record<string, string> = useMemo(() => {
        if (char.activeSkinSetId && char.dateSkinSets) {
            const skin = char.dateSkinSets.find(s => s.id === char.activeSkinSetId);
            if (skin && Object.keys(skin.sprites).length > 0) return skin.sprites;
        }
        return char.sprites || {};
    }, [char.activeSkinSetId, char.dateSkinSets, char.sprites]);

    const spriteConfig = char.spriteConfig || { scale: 1, x: 0, y: 0 };
    const hasSprites = Object.keys(activeSprites).length > 0;
    const currentEmotion = extractCurrentEmotion(messages);
    const currentSprite = useMemo(() => {
        if (!hasSprites) return null;
        if (activeSprites[currentEmotion]) return activeSprites[currentEmotion];
        const found = dateEmotionKeys.find(k => currentEmotion.includes(k));
        if (found && activeSprites[found]) return activeSprites[found];
        return activeSprites['normal'] || Object.values(activeSprites)[0] || null;
    }, [currentEmotion, activeSprites, hasSprites, dateEmotionKeys]);

    // ── Event overlay auto-collapse ──
    useEffect(() => {
        if (currentEvent && !eventCollapsed) {
            const t = setTimeout(() => setEventCollapsed(true), 5000);
            return () => clearTimeout(t);
        }
    }, [currentEvent]);

    useEffect(() => {
        if (currentEvent) setEventCollapsed(false);
    }, [currentEvent?.event]);

    // ── Back handler ──
    useEffect(() => {
        const unreg = registerBackHandler(() => {
            if (showLog) { setShowLog(false); return true; }
            if (showInput) { setShowInput(false); return true; }
            if (window.confirm('离开当前场景？')) onExit();
            return true;
        });
        return unreg;
    }, [showInput, showLog, registerBackHandler, onExit]);

    // ── Click to advance ──
    const handleDialogClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!done) { skipToEnd(); return; }
        if (isLastPage) { setShowInput(true); return; }
        setPageIndex(i => i + 1);
    }, [done, skipToEnd, isLastPage]);

    // ── Send message ──
    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const text = input.trim();
        setInput('');
        setShowInput(false);
        try { await onSendMessage(text); } catch { addToast('发送失败，请重试', 'error'); }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // ── Toggle auto ──
    const toggleAuto = (e: React.MouseEvent) => {
        e.stopPropagation();
        setAutoMode(v => !v);
    };

    // ── Render ──
    return (
        <div className="h-full w-full relative bg-black overflow-hidden font-sans select-none flex flex-col">
            {/* Background */}
            <div
                className="absolute inset-0"
                style={{
                    background: location.bgImage
                        ? `url(${location.bgImage}) center/cover`
                        : location.bgGradient || '#111',
                    opacity: hasSprites ? 0.8 : 0.3,
                    filter: hasSprites ? 'none' : 'blur(20px) brightness(0.6)',
                }}
            />

            {/* Character Sprite */}
            {hasSprites && currentSprite && (
                <div className="absolute inset-x-0 bottom-0 h-[85%] flex items-end justify-center pointer-events-none z-10 overflow-hidden">
                    <img
                        src={currentSprite}
                        alt={char.name}
                        className="max-h-full max-w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all duration-300 origin-bottom"
                        style={{ transform: `translate(${spriteConfig.x}%, ${spriteConfig.y}%) scale(${spriteConfig.scale})` }}
                    />
                </div>
            )}

            {/* Top Bar */}
            <div className="relative z-50 flex items-center justify-between px-4 pt-12 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onChangeLocation}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                        style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={14} height={14}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                        </svg>
                        换地点
                    </button>
                    <span className="text-white/60 text-xs font-medium">{location.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="theater-time-badge" style={{ padding: '4px 10px', fontSize: 11 }}>
                        <span>{timeLabel.icon}</span>
                        <span>{timeLabel.zh}</span>
                    </div>
                    <button onClick={() => setShowSettings(true)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="rgba(255,255,255,0.7)" width={14} height={14}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .136c.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.212 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.136c-.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                    </button>
                    <button onClick={onExit} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,80,80,0.3)', border: '1px solid rgba(255,80,80,0.3)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#fff" width={14} height={14}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Director Event Overlay */}
            {currentEvent && (
                <div
                    className={`theater-event-overlay ${eventCollapsed ? 'collapsed' : ''}`}
                    onClick={() => eventCollapsed && setEventCollapsed(false)}
                    style={{ top: 100 }}
                >
                    {!eventCollapsed && (
                        <>
                            <span className={`theater-event-type-badge ${currentEvent.sceneType}`}>
                                {EVENT_TYPE_ZH[currentEvent.sceneType] || currentEvent.sceneType}
                            </span>
                            <p className="theater-event-text">{currentEvent.atmosphere}</p>
                            {currentEvent.event && (
                                <p className="theater-event-text" style={{ marginTop: 8, fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>
                                    {currentEvent.event}
                                </p>
                            )}
                        </>
                    )}
                    {eventCollapsed && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                            {EVENT_TYPE_ZH[currentEvent.sceneType]} · 点击展开
                        </span>
                    )}
                </div>
            )}

            {/* ════════ VN Dialog Box ════════ */}
            {!showInput && (
                <div className="theater-vn-dialog" onClick={handleDialogClick}>
                    {/* Control buttons: Auto / Log */}
                    <div className="theater-vn-controls" onClick={e => e.stopPropagation()}>
                        <button className={`theater-vn-ctrl-btn ${autoMode ? 'active' : ''}`} onClick={toggleAuto}>
                            AUTO
                        </button>
                        <button className="theater-vn-ctrl-btn" onClick={(e) => { e.stopPropagation(); setShowLog(true); }}>
                            LOG
                        </button>
                    </div>

                    {/* Name tag — dialogue: char name, user: user name, narration: hidden */}
                    {currentPage && currentPage.type !== 'narration' && (
                        <div className={`theater-vn-name-tag ${currentPage.type === 'user' ? 'user' : ''}`}>
                            {currentPage.type === 'user' ? (userProfile.name || '你') : char.name}
                        </div>
                    )}

                    {/* Text area */}
                    {isLoading ? (
                        <div className="theater-vn-loading">
                            <div className="theater-vn-loading-dots">
                                <span /><span /><span />
                            </div>
                            <span className="theater-vn-loading-label">
                                {isDirectorLoading ? '导演编排中…' : `${char.name}…`}
                            </span>
                        </div>
                    ) : currentPage ? (
                        <div className={`theater-vn-text ${currentPage.type}`}>
                            {currentPage.type === 'dialogue' && <span className="theater-vn-quote-mark open">{'\u201C'}</span>}
                            {displayed}
                            {!done && <span className="theater-vn-cursor" />}
                            {currentPage.type === 'dialogue' && done && <span className="theater-vn-quote-mark close">{'\u201D'}</span>}
                        </div>
                    ) : (
                        <div className="theater-vn-text" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            点击屏幕开始对话…
                        </div>
                    )}

                    {/* Click to continue indicator */}
                    {done && !isLoading && !isLastPage && (
                        <div className="theater-vn-ctc">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" width={12} height={12}>
                                <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
                            </svg>
                        </div>
                    )}

                    {/* End of conversation → tap hint */}
                    {done && !isLoading && isLastPage && pages.length > 0 && (
                        <div className="theater-vn-ctc" style={{ fontSize: 10, letterSpacing: 2 }}>
                            点击回复
                        </div>
                    )}
                </div>
            )}

            {/* ════════ Input Area ════════ */}
            {showInput && (
                <div className="theater-vn-input-area" onClick={e => e.stopPropagation()}>
                    <div className="theater-vn-input-row">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isLoading ? '等待回应…' : '说点什么…'}
                            disabled={isLoading}
                            autoFocus
                        />
                        <button
                            className="theater-vn-send-btn"
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={20} height={20}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                            </svg>
                        </button>
                    </div>
                    <button
                        onClick={() => setShowInput(false)}
                        style={{ width: '100%', marginTop: 8, padding: '6px 0', fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                        返回对话
                    </button>
                </div>
            )}

            {/* ════════ History Log ════════ */}
            {showLog && (
                <div className="theater-vn-log-overlay">
                    <div className="theater-vn-log-header">
                        <span className="theater-vn-log-title">对话记录</span>
                        <button className="theater-vn-log-close" onClick={() => setShowLog(false)}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="theater-vn-log-scroll">
                        {messages.map(msg => (
                            <div key={msg.id} className="theater-vn-log-item">
                                <div className={`theater-vn-log-item-name ${msg.role === 'user' ? 'user' : ''}`}>
                                    {msg.role === 'user' ? (userProfile.name || '你') : char.name}
                                </div>
                                <div className="theater-vn-log-item-text">{cleanText(msg.content)}</div>
                            </div>
                        ))}
                        {messages.length === 0 && (
                            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', paddingTop: 40, fontSize: 13 }}>
                                暂无对话记录
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Settings Overlay */}
            <TheaterSettings
                char={char}
                location={location}
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
};

export default TheaterSession;
