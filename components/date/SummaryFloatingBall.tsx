import React,{ memo,useEffect,useMemo,useRef,useState } from 'react';
import { motion,useMotionValue,PanInfo } from 'framer-motion';
import { GearSix,NotePencil,X,WarningCircle } from '@phosphor-icons/react';
import { CharacterProfile } from '../../types';
import { DATE_DEFAULT_WORD_COUNT } from '../../utils/datePrompts';
import WritingStyleSheet, { getStyleDisplayLabel } from './WritingStyleSheet';

interface SummaryFloatingBallProps {
    char: CharacterProfile;
    isGenerating: boolean;
    hasPendingSummary: boolean;
    canManualSummary: boolean;
    canAutoSummary: boolean;
    disabledReason?: string;
    onRequestManualSummary: () => void;
    onReviewPendingSummary: () => void;
    onDiscardPendingSummary: () => void;
    onToggleAutoSummary: (enabled: boolean) => void;
    onToggleAutoHideSummary: (enabled: boolean) => void;
    onChangeThreshold: (threshold: number) => void;
    onOpenSettings: () => void;
    wordCount?: number;
    writingStyle?: string;
    onChangeWordCount: (count: number | undefined) => void;
    onChangeWritingStyle: (style: string | undefined) => void;
    translationEnabled?: boolean;
    translateSourceLang?: string;
    translateTargetLang?: string;
    onToggleTranslation?: (enabled: boolean) => void;
    onSetTranslateSourceLang?: (lang: string) => void;
    onSetTranslateTargetLang?: (lang: string) => void;
}

const BALL_SIZE = 56;
const EDGE_PADDING = 12;
const DEFAULT_THRESHOLD = 20;
const SUMMARY_HEARTS_ICON = '/images/date-summary-hearts.png';

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const readStoredPosition = (key: string) => {
    if (typeof window === 'undefined') return null;
    try {
        const p = JSON.parse(localStorage.getItem(key) || 'null');
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
        return p as { x: number; y: number };
    } catch { return null; }
};

const getDefaultPosition = () => {
    if (typeof window === 'undefined') return { x: 20, y: 160 };
    return {
        x: Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - 20),
        y: Math.max(EDGE_PADDING, Math.round(window.innerHeight * 0.58)),
    };
};

/* ─────────────────────────────────────────────
 *  Design tokens — warm cream light-neumorphism
 * ───────────────────────────────────────────── */
const C = {
    base:    '#F4F0EB',
    card:    '#EEE8E2',
    hi:      '#FBF8F4',
    shadow:  '#D7CEC5',
    text:    '#59545C',
    textSec: '#928B93',
    accent:  '#C8A8AE',
    accent2: '#D8C0B5',
    knob:    '#FDFBF9',
    divider: '#E4DDD6',
} as const;

/* Soft outer shadow for raised elements */
const raisedSm = `1.5px 1.5px 3px ${C.shadow}, -1.5px -1.5px 3px ${C.hi}`;
/* Gentle inset for recessed slots */
const inset    = `inset 1.5px 1.5px 3px ${C.shadow}, inset -1.5px -1.5px 3px ${C.hi}`;

/* ── Shared sub-components ── */

const Toggle: React.FC<{
    on: boolean; disabled?: boolean; onClick: () => void; title?: string;
}> = ({ on, disabled, onClick, title }) => (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
        className="relative flex-shrink-0 transition-all disabled:opacity-35"
        style={{
            width: 38, height: 22, borderRadius: 11,
            background: on ? C.accent : C.card,
            boxShadow: on ? inset : raisedSm,
            border: 'none', cursor: 'pointer',
        }}>
        <span style={{
            position: 'absolute', top: 3, left: 3,
            width: 16, height: 16, borderRadius: '50%',
            background: C.knob,
            boxShadow: `1px 1px 2px ${C.shadow}`,
            transition: 'transform .2s ease',
            transform: on ? 'translateX(16px)' : 'translateX(0)',
        }} />
    </button>
);

const Slot: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { w?: number }> = ({ w = 44, style, ...rest }) => (
    <input {...rest}
        style={{
            width: w, height: 24, borderRadius: 8, border: 'none',
            background: C.card, boxShadow: inset,
            textAlign: 'center', fontSize: 11, fontWeight: 500,
            color: C.text, outline: 'none',
            fontFamily: 'inherit',
            ...style,
        }} />
);

const SummaryFloatingBall: React.FC<SummaryFloatingBallProps> = memo(({
    char,
    isGenerating,
    hasPendingSummary,
    canManualSummary,
    canAutoSummary,
    disabledReason: _disabledReason,
    onRequestManualSummary,
    onReviewPendingSummary,
    onDiscardPendingSummary,
    onToggleAutoSummary,
    onToggleAutoHideSummary,
    onChangeThreshold,
    onOpenSettings,
    wordCount, writingStyle,
    onChangeWordCount, onChangeWritingStyle,
    translationEnabled, translateSourceLang, translateTargetLang,
    onToggleTranslation, onSetTranslateSourceLang, onSetTranslateTargetLang,
}) => {
    const storageKey = `date_summary_ball_pos_${char.id}`;
    const constraintsRef = useRef<HTMLDivElement>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [styleSheetOpen, setStyleSheetOpen] = useState(false);
    const [position, setPosition] = useState(() => readStoredPosition(storageKey) || getDefaultPosition());
    const [dragging, setDragging] = useState(false);
    const x = useMotionValue(position.x);
    const y = useMotionValue(position.y);

    useEffect(() => {
        const next = readStoredPosition(storageKey) || getDefaultPosition();
        const maxX = Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - EDGE_PADDING);
        const maxY = Math.max(EDGE_PADDING, window.innerHeight - BALL_SIZE - EDGE_PADDING);
        const c = { x: clamp(next.x, EDGE_PADDING, maxX), y: clamp(next.y, EDGE_PADDING, maxY) };
        setPosition(c); x.set(c.x); y.set(c.y);
    }, [char.id, storageKey, x, y]);

    useEffect(() => {
        const onResize = () => {
            const maxX = Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - EDGE_PADDING);
            const maxY = Math.max(EDGE_PADDING, window.innerHeight - BALL_SIZE - EDGE_PADDING);
            const c = { x: clamp(x.get(), EDGE_PADDING, maxX), y: clamp(y.get(), EDGE_PADDING, maxY) };
            setPosition(c); x.set(c.x); y.set(c.y);
            localStorage.setItem(storageKey, JSON.stringify(c));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [storageKey, x, y]);

    const panelPlacement = useMemo(() => {
        if (typeof window === 'undefined') return { horizontal: 'right' as const, vertical: 'down' as const };
        return {
            horizontal: position.x > window.innerWidth - 220 ? 'left' as const : 'right' as const,
            vertical: position.y > window.innerHeight - 260 ? 'up' as const : 'down' as const,
        };
    }, [position]);

    const panelStyle: React.CSSProperties = {
        left: panelPlacement.horizontal === 'right' ? BALL_SIZE + 10 : undefined,
        right: panelPlacement.horizontal === 'left' ? BALL_SIZE + 10 : undefined,
        top: panelPlacement.vertical === 'down' ? 0 : undefined,
        bottom: panelPlacement.vertical === 'up' ? 0 : undefined,
    };

    const commitPosition = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const maxX = Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - EDGE_PADDING);
        const maxY = Math.max(EDGE_PADDING, window.innerHeight - BALL_SIZE - EDGE_PADDING);
        const next = { x: clamp(x.get(), EDGE_PADDING, maxX), y: clamp(y.get(), EDGE_PADDING, maxY) };
        setPosition(next); x.set(next.x); y.set(next.y);
        if (Math.hypot(info.offset.x, info.offset.y) >= 10) localStorage.setItem(storageKey, JSON.stringify(next));
        window.setTimeout(() => setDragging(false), 0);
    };

    const threshold = char.dateSummaryAutoThreshold || DEFAULT_THRESHOLD;
    const autoEnabled = !!char.dateSummaryAutoEnabled;
    const autoHideEnabled = !!char.dateSummaryAutoHideEnabled;
    const handleThreshold = (v: string) => onChangeThreshold(clamp(parseInt(v || `${DEFAULT_THRESHOLD}`, 10), 4, 200));

    /* ── shared inline styles ── */
    const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
    const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: C.text };
    const sub: React.CSSProperties = { fontSize: 9, color: C.textSec, marginTop: 1 };
    const sectionGap = 6;

    return (
        <div ref={constraintsRef} className="absolute inset-0 z-[90] pointer-events-none">
            <motion.div
                drag={!panelOpen} dragConstraints={constraintsRef}
                dragMomentum={false} dragElastic={0}
                style={{ x, y }}
                onDragStart={() => setDragging(true)} onDragEnd={commitPosition}
                className="absolute left-0 top-0 pointer-events-auto"
            >
                {/* ── Floating ball ── */}
                <button type="button"
                    onClick={(e) => { e.stopPropagation(); if (!dragging) setPanelOpen(v => !v); }}
                    className={`relative flex h-14 w-14 items-center justify-center rounded-full transition-opacity active:scale-95 ${dragging ? 'opacity-70' : 'opacity-100'}`}
                    title="见面总结">
                    <img src={SUMMARY_HEARTS_ICON} alt="" aria-hidden="true"
                        className="relative h-14 w-14 scale-[1.55] object-contain"
                        style={{ filter: 'drop-shadow(2px 3px 4px rgba(100,90,85,0.25))' }}
                        draggable={false} />
                    {hasPendingSummary && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full" style={{ background: C.accent, boxShadow: '1px 1px 2px rgba(100,90,85,0.3)' }} />}
                </button>

                {/* ═══════════════════════════════════════
                    Panel — warm cream light-neumorphism
                   ═══════════════════════════════════════ */}
                {panelOpen && (
                    <div className="control-panel absolute" style={{
                        ...panelStyle, width: 224, borderRadius: 20, padding: '14px 14px 12px',
                        background: C.base,
                        boxShadow: `3px 4px 10px rgba(180,170,160,0.35), 0 1px 3px rgba(160,150,140,0.15), inset 0 0.5px 0 ${C.hi}`,
                        fontFamily: '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                        color: C.text,
                    }} onClick={e => e.stopPropagation()}>

                        {/* ── Header ── */}
                        <div style={{ ...row, marginBottom: 10 }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>见面模式</div>
                                <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 0.3, marginTop: 1 }}>沉浸阅读 · 辅助设置</div>
                            </div>
                            <button type="button" onClick={() => setPanelOpen(false)}
                                style={{ width: 22, height: 22, borderRadius: 8, border: 'none', background: C.card, boxShadow: raisedSm, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={11} color={C.textSec} />
                            </button>
                        </div>

                        {/* ── Section 1: 总结 ── */}
                        <div style={{ background: C.card, borderRadius: 14, padding: '9px 10px', marginBottom: sectionGap, boxShadow: raisedSm }}>
                            {/* 自动总结 */}
                            <div style={row}>
                                <div>
                                    <div style={label}>自动总结</div>
                                    {!canAutoSummary && (
                                        <div style={{ ...sub, display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <WarningCircle size={9} color={C.textSec} />副 API 未配置
                                        </div>
                                    )}
                                </div>
                                <Toggle on={autoEnabled} disabled={!canAutoSummary || isGenerating}
                                    onClick={() => onToggleAutoSummary(!autoEnabled)}
                                    title={!canAutoSummary ? '请配置副 API' : undefined} />
                            </div>

                            {/* 触发条数 — compact inline */}
                            <div style={{ ...row, marginTop: 7, fontSize: 10, color: C.textSec }}>
                                <span>每</span>
                                <Slot type="number" min={4} max={200} value={threshold}
                                    disabled={isGenerating} onChange={e => handleThreshold(e.target.value)} w={40} />
                                <span>条触发</span>
                            </div>

                            {/* divider */}
                            <div style={{ height: 1, background: C.divider, margin: '7px 0' }} />

                            {/* 压缩旧记录 */}
                            <div style={row}>
                                <div>
                                    <div style={{ ...label, fontSize: 10 }}>压缩旧记录</div>
                                    <div style={sub}>总结后收起较早原文</div>
                                </div>
                                <Toggle on={autoHideEnabled} disabled={isGenerating}
                                    onClick={() => onToggleAutoHideSummary(!autoHideEnabled)} />
                            </div>
                        </div>

                        {/* 待确认总结 */}
                        {hasPendingSummary && (
                            <div style={{ background: C.card, borderRadius: 12, padding: '6px 10px', marginBottom: sectionGap, boxShadow: raisedSm }}>
                                <button type="button" onClick={onReviewPendingSummary}
                                    style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.accent, padding: '3px 0' }}>
                                    查看待确认总结
                                </button>
                                <button type="button" onClick={onDiscardPendingSummary}
                                    style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 9, color: C.textSec, padding: '2px 0' }}>
                                    丢弃
                                </button>
                            </div>
                        )}

                        {/* 手动总结 */}
                        <button type="button" disabled={!canManualSummary || isGenerating}
                            onClick={onRequestManualSummary}
                            className="transition-all active:scale-[0.97] disabled:opacity-35"
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                padding: '7px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                                background: C.card, boxShadow: raisedSm,
                                fontSize: 11, fontWeight: 600, color: C.accent,
                                marginBottom: sectionGap,
                            }}>
                            <NotePencil size={13} color={C.accent} />
                            {isGenerating ? '生成中…' : '手动总结'}
                        </button>

                        {/* ── Section 2: 回复 ── */}
                        <div style={{ background: C.card, borderRadius: 14, padding: '9px 10px', marginBottom: sectionGap, boxShadow: raisedSm }}>
                            {/* 回复字数 */}
                            <div style={row}>
                                <span style={label}>回复字数</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <Slot type="number" min={30} max={2000} step={10}
                                        value={wordCount && wordCount > 0 ? wordCount : ''}
                                        onChange={e => { const v = parseInt(e.target.value, 10); onChangeWordCount(v > 0 ? v : undefined); }}
                                        placeholder={String(DATE_DEFAULT_WORD_COUNT)} w={44} />
                                    <span style={{ fontSize: 9, color: C.textSec }}>字</span>
                                </div>
                            </div>

                            <div style={{ height: 1, background: C.divider, margin: '7px 0' }} />

                            {/* 文风 */}
                            <div style={row}>
                                <span style={label}>文风</span>
                                <button type="button" onClick={() => setStyleSheetOpen(true)}
                                    className="transition-all active:scale-[0.97]"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '4px 8px', borderRadius: 10, border: 'none',
                                        background: C.base, boxShadow: raisedSm, cursor: 'pointer',
                                        maxWidth: 110,
                                    }}>
                                    <span style={{
                                        fontSize: 11, fontWeight: 600, overflow: 'hidden',
                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        color: writingStyle ? C.accent : C.textSec,
                                    }}>
                                        {getStyleDisplayLabel(writingStyle)}
                                    </span>
                                    <span style={{ fontSize: 9, color: C.textSec, flexShrink: 0 }}>›</span>
                                </button>
                            </div>
                        </div>

                        {/* ── Section 3: 辅助 ── */}
                        <div style={{ ...row, background: C.card, borderRadius: 14, padding: '8px 10px', marginBottom: sectionGap, boxShadow: raisedSm }}>
                            <span style={label}>翻译</span>
                            <Toggle on={!!translationEnabled} onClick={() => onToggleTranslation?.(!translationEnabled)} />
                        </div>

                        {/* Translation detail (conditional) */}
                        {translationEnabled && (
                            <div style={{ background: C.card, borderRadius: 14, padding: '8px 10px', marginBottom: sectionGap, boxShadow: raisedSm }}>
                                {/* Source language */}
                                <div style={{ fontSize: 9, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>原文</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 7 }}>
                                    {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => {
                                        const active = translateSourceLang === lang;
                                        return (
                                            <button key={`s-${lang}`} type="button" onClick={() => onSetTranslateSourceLang?.(lang)}
                                                className="transition-all active:scale-95"
                                                style={{
                                                    padding: '2px 7px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                                    fontSize: 9, fontWeight: 600,
                                                    background: active ? C.accent : C.base,
                                                    color: active ? '#fff' : C.textSec,
                                                    boxShadow: active ? 'none' : raisedSm,
                                                }}>
                                                {lang}
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Target language */}
                                <div style={{ fontSize: 9, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>译为</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
                                    {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => {
                                        const active = translateTargetLang === lang;
                                        return (
                                            <button key={`t-${lang}`} type="button" onClick={() => onSetTranslateTargetLang?.(lang)}
                                                className="transition-all active:scale-95"
                                                style={{
                                                    padding: '2px 7px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                                    fontSize: 9, fontWeight: 600,
                                                    background: active ? C.accent2 : C.base,
                                                    color: active ? '#fff' : C.textSec,
                                                    boxShadow: active ? 'none' : raisedSm,
                                                }}>
                                                {lang}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div style={{ textAlign: 'center', fontSize: 9, color: C.textSec, background: C.base, boxShadow: inset, borderRadius: 8, padding: '3px 0' }}>
                                    {translateSourceLang || '?'} → {translateTargetLang || '?'}
                                </div>
                            </div>
                        )}

                        {/* ── Bottom: 设置 / 关闭 ── */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            <button type="button"
                                onClick={() => { setPanelOpen(false); onOpenSettings(); }}
                                className="transition-all active:scale-[0.96]"
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    padding: '6px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                                    background: C.base, boxShadow: raisedSm,
                                    fontSize: 10, fontWeight: 500, color: C.textSec,
                                }}>
                                <GearSix size={12} color={C.textSec} />设置
                            </button>
                            <button type="button" onClick={() => setPanelOpen(false)}
                                className="transition-all active:scale-[0.96]"
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                    padding: '6px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                                    background: C.base, boxShadow: raisedSm,
                                    fontSize: 10, fontWeight: 500, color: C.textSec,
                                }}>
                                <X size={11} color={C.textSec} />关闭
                            </button>
                        </div>
                    </div>
                )}
            </motion.div>

            <WritingStyleSheet
                isOpen={styleSheetOpen}
                currentStyle={writingStyle}
                onSelect={onChangeWritingStyle}
                onClose={() => setStyleSheetOpen(false)}
            />
        </div>
    );
});

SummaryFloatingBall.displayName = 'SummaryFloatingBall';

export default SummaryFloatingBall;
