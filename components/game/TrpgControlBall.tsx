import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import type { GameSettings } from '../../types';
import {
    getTrpgWritingStyleLabel,
    normalizeTrpgSettings,
    resolveTrpgWritingStylePreset,
    TRPG_DEFAULT_TEMPERATURE,
    TRPG_WRITING_STYLE_PRESETS
} from '../../utils/trpgSettings';

type TokenUsage = { prompt?: number; completion?: number; total: number } | null;

interface TrpgControlBallProps {
    gameId: string;
    settings?: GameSettings;
    roundCount: number;
    nextSummaryRound: number;
    summariesCount: number;
    summarizedUntil: number;
    lastTokenUsage: TokenUsage;
    totalTokensUsed: number;
    isBusy: boolean;
    onChangeSettings: (patch: Partial<GameSettings>) => void;
}

const BALL_SIZE = 56;
const EDGE_PADDING = 14;
const PANEL_MAX_WIDTH = 328;
const PANEL_MAX_HEIGHT = 620;
const PANEL_SCALE = 0.88;
const WRITING_STYLE_GROUPS = [
    { label: '常用', keys: ['chinese_horror', 'horror', 'hardcore', 'comedy'] },
    { label: '异闻', keys: ['cyber_folklore', 'academy_mystery', 'absurd_mystery', 'noir'] },
    { label: '旧局', keys: ['jianghu_rain', 'court_intrigue', 'epic', 'mythic_ruins'] },
    { label: '险境', keys: ['wasteland_survival', 'romance'] }
] as const;
const PRESETS_BY_KEY = new Map(TRPG_WRITING_STYLE_PRESETS.map(preset => [preset.key, preset]));

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type Bounds = { width: number; height: number };

const readPosition = (key: string) => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
        return parsed as { x: number; y: number };
    } catch {
        return null;
    }
};

const getWindowBounds = (): Bounds => {
    if (typeof window === 'undefined') return { width: 390, height: 780 };
    return { width: window.innerWidth, height: window.innerHeight };
};

const getContainerBounds = (container?: HTMLElement | null): Bounds => {
    if (!container) return getWindowBounds();
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(BALL_SIZE + EDGE_PADDING * 2, rect.width || container.clientWidth),
        height: Math.max(BALL_SIZE + EDGE_PADDING * 2, rect.height || container.clientHeight)
    };
};

const getDefaultPosition = (bounds: Bounds = getWindowBounds()) => ({
    x: Math.round((bounds.width - BALL_SIZE) / 2),
    y: Math.round((bounds.height - BALL_SIZE) / 2)
});

const clampPosition = (position: { x: number; y: number }, bounds: Bounds = getWindowBounds()) => {
    return {
        x: clamp(position.x, EDGE_PADDING, Math.max(EDGE_PADDING, bounds.width - BALL_SIZE - EDGE_PADDING)),
        y: clamp(position.y, EDGE_PADDING, Math.max(EDGE_PADDING, bounds.height - BALL_SIZE - EDGE_PADDING))
    };
};

const getPanelWidth = (bounds: Bounds) => Math.min(PANEL_MAX_WIDTH, Math.max(BALL_SIZE, bounds.width - EDGE_PADDING * 2));
const getPanelMaxHeight = (bounds: Bounds) => Math.max(
    BALL_SIZE,
    Math.min(PANEL_MAX_HEIGHT, Math.floor(bounds.height * 0.8), bounds.height - EDGE_PADDING * 2 - 28)
);

const TrpgControlBall: React.FC<TrpgControlBallProps> = memo(({
    gameId,
    settings,
    roundCount,
    nextSummaryRound,
    summariesCount,
    summarizedUntil,
    lastTokenUsage,
    totalTokensUsed,
    isBusy,
    onChangeSettings
}) => {
    const storageKey = `trpg_control_ball_pos_v2_${gameId}`;
    const constraintsRef = useRef<HTMLDivElement>(null);
    const normalized = normalizeTrpgSettings(settings);
    const activePreset = resolveTrpgWritingStylePreset(normalized.writingStyle);
    const isCustomStyle = !!normalized.writingStyle && !activePreset;
    const [panelOpen, setPanelOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [customEditorOpen, setCustomEditorOpen] = useState(isCustomStyle);
    const [bounds, setBounds] = useState<Bounds>(() => getWindowBounds());
    const [position, setPosition] = useState(() => {
        const initialBounds = getWindowBounds();
        return clampPosition(readPosition(storageKey) || getDefaultPosition(initialBounds), initialBounds);
    });
    const [customStyle, setCustomStyle] = useState(isCustomStyle ? normalized.writingStyle || '' : '');
    const x = useMotionValue(position.x);
    const y = useMotionValue(position.y);

    useEffect(() => {
        const nextBounds = getContainerBounds(constraintsRef.current);
        setBounds(nextBounds);
        const savedPosition = readPosition(storageKey);
        const next = clampPosition(savedPosition || getDefaultPosition(nextBounds), nextBounds);
        setPosition(next);
        x.set(next.x);
        y.set(next.y);
    }, [gameId, storageKey, x, y]);

    useEffect(() => {
        setCustomStyle(isCustomStyle ? normalized.writingStyle || '' : '');
        if (isCustomStyle) setCustomEditorOpen(true);
    }, [isCustomStyle, normalized.writingStyle]);

    useEffect(() => {
        const syncToBounds = () => {
            const nextBounds = getContainerBounds(constraintsRef.current);
            setBounds(nextBounds);
            const savedPosition = readPosition(storageKey);
            const hasStoredPosition = !!savedPosition;
            const next = clampPosition(hasStoredPosition ? { x: x.get(), y: y.get() } : getDefaultPosition(nextBounds), nextBounds);
            setPosition(next);
            x.set(next.x);
            y.set(next.y);
            if (hasStoredPosition) localStorage.setItem(storageKey, JSON.stringify(next));
        };
        window.addEventListener('resize', syncToBounds);
        const observer = typeof ResizeObserver !== 'undefined' && constraintsRef.current
            ? new ResizeObserver(syncToBounds)
            : null;
        if (constraintsRef.current) observer?.observe(constraintsRef.current);
        return () => {
            window.removeEventListener('resize', syncToBounds);
            observer?.disconnect();
        };
    }, [storageKey, x, y]);

    const panelPlacement = useMemo(() => {
        const panelWidth = getPanelWidth(bounds);
        const panelMaxHeight = getPanelMaxHeight(bounds);
        return {
            panelWidth,
            panelMaxHeight,
            scaledPanelWidth: panelWidth * PANEL_SCALE,
            scaledPanelMaxHeight: panelMaxHeight * PANEL_SCALE
        };
    }, [bounds]);

    const panelStyle: React.CSSProperties = {
        width: panelPlacement.panelWidth,
        maxHeight: panelPlacement.panelMaxHeight,
        background: 'radial-gradient(circle at 50% 0%, rgba(92,31,21,0.28), transparent 36%), linear-gradient(180deg, #160C09 0%, #100907 46%, #090605 100%)',
        left: Math.round((bounds.width - panelPlacement.scaledPanelWidth) / 2 - position.x),
        top: Math.round((bounds.height - panelPlacement.scaledPanelMaxHeight) / 2 - position.y),
        transform: `scale(${PANEL_SCALE})`,
        transformOrigin: 'top left'
    };

    const commitPosition = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const nextBounds = getContainerBounds(constraintsRef.current);
        setBounds(nextBounds);
        const next = clampPosition({ x: x.get(), y: y.get() }, nextBounds);
        setPosition(next);
        x.set(next.x);
        y.set(next.y);
        if (Math.hypot(info.offset.x, info.offset.y) >= 8) {
            localStorage.setItem(storageKey, JSON.stringify(next));
        }
        window.setTimeout(() => setDragging(false), 0);
    };

    const summaryProgress = `${Math.min(roundCount, nextSummaryRound)}/${nextSummaryRound}`;
    const summaryPercent = nextSummaryRound > 0
        ? clamp((Math.min(roundCount, nextSummaryRound) / nextSummaryRound) * 100, 0, 100)
        : 0;
    const usageLabel = lastTokenUsage
        ? `${lastTokenUsage.prompt ?? '?'} / ${lastTokenUsage.completion ?? '?'}`
        : '后台静默';
    const activeStyleLabel = getTrpgWritingStyleLabel(normalized.writingStyle);

    const handleTemperatureChange = (value: string) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        const next = Math.round(clamp(parsed, 0.1, 2) * 100) / 100;
        onChangeSettings({ temperature: Math.abs(next - TRPG_DEFAULT_TEMPERATURE) < 0.001 ? undefined : next });
    };

    const handleStyleSelect = (style: string | undefined) => {
        setCustomEditorOpen(false);
        onChangeSettings({ writingStyle: style });
    };

    const handleCustomStyleChange = (value: string) => {
        setCustomStyle(value);
        onChangeSettings({ writingStyle: value.trim() || undefined });
    };

    const handleCustomStyleOpen = () => {
        setCustomEditorOpen(true);
        if (customStyle.trim()) {
            onChangeSettings({ writingStyle: customStyle.trim() });
        }
    };

    return (
        <div
            ref={constraintsRef}
            className="absolute inset-0 z-[45] pointer-events-none"
            onClick={() => panelOpen && setPanelOpen(false)}
        >
            <motion.div
                drag={!panelOpen}
                dragConstraints={constraintsRef}
                dragElastic={0}
                dragMomentum={false}
                style={{ x, y }}
                onDragStart={() => setDragging(true)}
                onDragEnd={commitPosition}
                className="absolute left-0 top-0 pointer-events-auto"
            >
                <button
                    type="button"
                    aria-label="TRPG GM 控制台"
                    onClick={(event) => {
                        event.stopPropagation();
                        if (dragging) return;
                        setPanelOpen(prev => !prev);
                    }}
                    className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] border text-[#d8c8b2] shadow-[0_16px_34px_rgba(0,0,0,0.5),0_0_0_1px_rgba(155,115,80,0.08)_inset] transition-all active:scale-95 ${
                        panelOpen
                            ? 'border-[#9b7350]/70 bg-[#151111]'
                            : 'border-[#4a2b22] bg-[#0b0706] hover:border-[#7a241c]'
                    }`}
                >
                    <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(155,115,80,0.16),transparent_34%),linear-gradient(180deg,rgba(42,13,13,0.42),rgba(0,0,0,0.18))]" />
                    <span className="absolute inset-1 rounded-[13px] border border-[#9b7350]/25" />
                    <span className="absolute bottom-1.5 left-1.5 right-1.5 h-px bg-[#7a241c]/45" />
                    <span className="relative flex flex-col items-center leading-none">
                        <span className="font-sans text-[13px] font-bold tracking-[0.18em] text-[#caa67b]">GM</span>
                        <span className="mt-1 font-sans text-[9px] text-[#8f7560]">{roundCount}幕</span>
                    </span>
                    {isBusy && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#7a241c] shadow-[0_0_10px_rgba(122,36,28,0.9)]" />}
                </button>

                {panelOpen && (
                    <div
                        className="trpg-control-panel absolute overflow-hidden rounded-[22px] border border-[rgba(156,91,62,0.45)] text-[#e3d2ba] shadow-[0_24px_70px_rgba(0,0,0,0.68),0_1px_0_rgba(255,217,168,0.08)_inset,0_0_0_1px_rgba(255,180,120,0.04)_inset]"
                        style={panelStyle}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="pointer-events-none absolute inset-0 rounded-[22px] opacity-[0.07] mix-blend-screen [background:linear-gradient(90deg,rgba(255,229,190,0.16)_1px,transparent_1px),linear-gradient(180deg,rgba(255,229,190,0.08)_1px,transparent_1px)] [background-size:24px_24px]" />
                        <div className="pointer-events-none absolute inset-0 rounded-[22px] opacity-[0.08] mix-blend-overlay [background:radial-gradient(circle_at_22%_14%,rgba(176,138,99,0.5),transparent_18%),linear-gradient(110deg,transparent_0%,rgba(255,220,170,0.12)_44%,transparent_48%,rgba(90,35,24,0.18)_74%,transparent_100%)]" />
                        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#b08a63]/45 to-transparent" />
                        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-[#35110d]/80 to-transparent" />
                        <div className="pointer-events-none absolute left-4 top-4 h-3 w-3 border-l border-t border-[#8c6548]/35" />
                        <div className="pointer-events-none absolute right-4 top-4 h-3 w-3 border-r border-t border-[#8c6548]/28" />
                        <div className="pointer-events-none absolute bottom-4 left-4 h-3 w-3 border-b border-l border-[#7a2a1e]/35" />
                        <div className="pointer-events-none absolute bottom-4 right-4 h-3 w-3 border-b border-r border-[#7a2a1e]/28" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[#090605] via-[#090605]/78 to-transparent" />

                        <div
                            className="trpg-control-panel-scroll relative overflow-y-auto p-4 pb-8"
                            style={{ maxHeight: panelPlacement.panelMaxHeight }}
                        >
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[rgba(140,83,58,0.28)] pb-3">
                                <div className="flex min-w-0 items-start gap-3">
                                    <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[16px] border border-[#8c6548]/55 bg-[#1a0f0c] shadow-[0_1px_0_rgba(255,217,168,0.08)_inset,0_12px_18px_rgba(0,0,0,0.42),0_-10px_18px_rgba(53,17,13,0.36)_inset]">
                                        <span className="absolute inset-[7px] rounded-[11px] border border-[#7a2a1e]/42" />
                                        <span className="absolute inset-0 rounded-[16px] bg-[radial-gradient(circle_at_35%_20%,rgba(176,138,99,0.2),transparent_38%)]" />
                                        <span className="relative font-sans text-[17px] font-bold tracking-[0.14em] text-[#b08a63]">GM</span>
                                    </div>
                                    <div className="min-w-0 pt-1">
                                        <div className="font-sans text-[24px] font-semibold leading-none tracking-[0.08em] text-[#e8d6be]">GM 控制台</div>
                                        <div className="mt-2 font-sans text-[12px] tracking-[0.08em] text-[#e3d2ba]/45"><span className="text-[#8c6548]/55">|</span> 第 {roundCount} 幕后台设备</div>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <span className="flex h-9 items-center gap-2 rounded-[11px] border border-[rgba(176,101,72,0.38)] bg-[#1a0f0c] px-2.5 font-sans text-[10px] tracking-[0.1em] text-[#a8957d] shadow-[0_1px_0_rgba(255,217,168,0.05)_inset,0_8px_14px_rgba(0,0,0,0.25)_inset]">
                                        <span className={`h-2 w-2 rounded-full ${isBusy ? 'bg-[#9a3328] shadow-[0_0_8px_rgba(154,51,40,0.45)]' : 'bg-[#b08a63] shadow-[0_0_9px_rgba(176,138,99,0.36)]'}`} />
                                        {isBusy ? '灯已亮' : '待命中'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setPanelOpen(false)}
                                        className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-[#5b3428]/55 bg-[#120b09] text-[#8c6548] shadow-[0_1px_0_rgba(255,217,168,0.05)_inset,0_7px_14px_rgba(0,0,0,0.35)] transition-colors hover:border-[#7a2a1e] hover:text-[#e3d2ba]"
                                        aria-label="关闭 GM 控制台"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            <div className="mb-3 grid grid-cols-3 gap-2">
                                <StatPill label="幕次" value={`${roundCount}`} />
                                <StatPill label="复盘" value={summaryProgress} />
                                <StatPill label="档案" value={`${summariesCount}`} />
                            </div>

                            <section className="mb-3 rounded-[16px] border border-[rgba(126,67,47,0.36)] bg-[#0f0807] p-3.5 shadow-[0_1px_0_rgba(255,214,160,0.04)_inset,0_14px_24px_rgba(0,0,0,0.32)_inset]">
                                <div className="mb-3 flex items-center justify-between">
                                    <SectionLabel marker="火候" label="理智偏移" />
                                    <span className="rounded-[9px] border border-[#8c6548]/42 bg-[#1a0f0c] px-2.5 py-1 font-sans text-[11px] text-[#b08a63] shadow-[0_1px_0_rgba(255,217,168,0.06)_inset]">{normalized.temperature.toFixed(2)}</span>
                                </div>
                                <div className="relative px-1 pb-1 pt-3">
                                    <div className="pointer-events-none absolute left-1 right-1 top-[14px] flex justify-between">
                                        {Array.from({ length: 9 }).map((_, index) => (
                                            <span key={index} className={`${index % 2 === 0 ? 'h-3' : 'h-2'} w-px bg-[#5a3327]/55`} />
                                        ))}
                                    </div>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="2"
                                        step="0.05"
                                        value={normalized.temperature}
                                        onChange={event => handleTemperatureChange(event.target.value)}
                                        className="trpg-temperature-slider h-2 w-full cursor-pointer appearance-none rounded-full border border-[rgba(126,67,47,0.45)] bg-[linear-gradient(90deg,#27100c,#462016_60%,#32120e)] shadow-[0_1px_3px_rgba(0,0,0,0.8)_inset]"
                                    />
                                </div>
                                <div className="mt-2 flex justify-between font-sans text-[9px] tracking-[0.14em] text-[#6f6254]">
                                    <span>冷静</span>
                                    <span>失控</span>
                                </div>
                            </section>

                            <section className="mb-3 rounded-[16px] border border-[rgba(126,67,47,0.32)] bg-[#160c09] p-3.5 shadow-[0_1px_0_rgba(255,214,160,0.035)_inset]">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                    <SectionLabel marker="戏码" label="文风签牌" />
                                    <span className="max-w-[9rem] truncate font-sans text-[12px] text-[#e8d6be]">
                                        <span className="text-[#a8957d]">当前：</span>{activeStyleLabel}
                                    </span>
                                </div>
                                <div className="mb-2 grid grid-cols-2 gap-1.5">
                                    <StyleButton
                                        label="默认"
                                        active={!normalized.writingStyle && !customEditorOpen}
                                        onClick={() => handleStyleSelect(undefined)}
                                    />
                                    <StyleButton
                                        label="自定义"
                                        active={isCustomStyle || customEditorOpen}
                                        onClick={handleCustomStyleOpen}
                                    />
                                </div>
                                <div className="space-y-2.5">
                                    {WRITING_STYLE_GROUPS.map(group => (
                                        <div key={group.label}>
                                            <div className="mb-1.5 flex items-center gap-2 pr-16">
                                                <span className="shrink-0 font-sans text-[13px] tracking-[0.08em] text-[#a87a56]">{group.label}</span>
                                                <span className="h-px flex-1 bg-[rgba(133,72,51,0.26)]" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                {group.keys.map(key => {
                                                    const preset = PRESETS_BY_KEY.get(key);
                                                    if (!preset) return null;
                                                    return (
                                                        <StyleButton
                                                            key={preset.key}
                                                            label={preset.label}
                                                            title={preset.desc}
                                                            active={normalized.writingStyle === preset.key}
                                                            onClick={() => handleStyleSelect(preset.key)}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {(isCustomStyle || customEditorOpen) && (
                                    <textarea
                                        value={customStyle}
                                        onChange={event => handleCustomStyleChange(event.target.value)}
                                        placeholder="写下你想要的 TRPG 文风，例如：更像克苏鲁调查报告，少抒情，多线索和心理压迫。"
                                        className="mt-2.5 h-20 w-full resize-none rounded-[12px] border border-[rgba(113,61,45,0.38)] bg-[#090605] p-3 text-[11px] leading-relaxed text-[#e3d2ba] outline-none placeholder:text-[#6f6254] shadow-[0_10px_18px_rgba(0,0,0,0.25)_inset] focus:border-[#7a2a1e]"
                                    />
                                )}
                            </section>

                            <section className="rounded-[16px] border border-[rgba(126,67,47,0.28)] bg-[#100907] p-3 shadow-[0_1px_0_rgba(255,214,160,0.03)_inset]">
                                <div className="mb-3 flex items-center justify-between">
                                    <SectionLabel marker="卷宗" label="后台记录" />
                                    <button
                                        type="button"
                                        onClick={() => onChangeSettings({ showTokenHud: !normalized.showTokenHud })}
                                        className="rounded-[9px] border border-[rgba(113,61,45,0.38)] bg-[#090605] px-2.5 py-1 font-sans text-[10px] text-[#8c6548] transition-colors hover:border-[#7a2a1e] hover:text-[#e3d2ba]"
                                    >
                                        {normalized.showTokenHud ? '封存' : '启封'}
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    <DataTile label="最近回声" value={usageLabel} />
                                    <DataTile label="累计余量" value={`${totalTokensUsed || 0}`} />
                                </div>
                                <div className="mt-3">
                                    <div className="mb-1.5 flex items-center justify-between font-sans text-[9px] text-[#6f6254]">
                                        <span>压缩仪表</span>
                                        <span>第 {summarizedUntil} 轮</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-[4px] border border-[rgba(113,61,45,0.32)] bg-[#090605] shadow-[0_4px_10px_rgba(0,0,0,0.28)_inset]">
                                        <div
                                            className="h-full bg-gradient-to-r from-[#8c6548] to-[#7a2a1e]"
                                            style={{ width: `${summaryPercent}%` }}
                                        />
                                    </div>
                                </div>
                            </section>
                        </div>
                        <style>{`
                            .trpg-control-panel-scroll {
                                scrollbar-width: thin;
                                scrollbar-color: rgba(140, 101, 72, 0.36) rgba(9, 6, 5, 0.28);
                            }
                            .trpg-control-panel-scroll::-webkit-scrollbar {
                                width: 4px;
                            }
                            .trpg-control-panel-scroll::-webkit-scrollbar-track {
                                background: rgba(9, 6, 5, 0.28);
                            }
                            .trpg-control-panel-scroll::-webkit-scrollbar-thumb {
                                background: rgba(140, 101, 72, 0.36);
                                border-radius: 999px;
                            }
                            .trpg-temperature-slider::-webkit-slider-thumb {
                                appearance: none;
                                width: 22px;
                                height: 22px;
                                border-radius: 999px;
                                background: radial-gradient(circle at 35% 28%, #c99a68, #8c5b38 58%, #4c2519 100%);
                                border: 1px solid rgba(255, 210, 150, 0.35);
                                box-shadow: 0 4px 10px rgba(0,0,0,0.55), 0 0 0 4px rgba(124,55,34,0.12);
                            }
                            .trpg-temperature-slider::-moz-range-thumb {
                                width: 22px;
                                height: 22px;
                                border-radius: 999px;
                                background: radial-gradient(circle at 35% 28%, #c99a68, #8c5b38 58%, #4c2519 100%);
                                border: 1px solid rgba(255, 210, 150, 0.35);
                                box-shadow: 0 4px 10px rgba(0,0,0,0.55), 0 0 0 4px rgba(124,55,34,0.12);
                            }
                        `}</style>
                    </div>
                )}
            </motion.div>
        </div>
    );
});

const SectionLabel: React.FC<{ marker: string; label: string }> = ({ marker, label }) => (
    <div className="flex items-center gap-2">
        <span className="rounded-[6px] border border-[#4a2b22] bg-[#0b0706] px-1.5 py-0.5 font-sans text-[9px] tracking-[0.16em] text-[#9b7350]">
            {marker}
        </span>
        <span className="font-sans text-[12px] font-semibold tracking-[0.12em] text-[#d8c8b2]">{label}</span>
    </div>
);

const DataTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="rounded-[12px] border border-[rgba(130,68,48,0.32)] bg-[linear-gradient(180deg,rgba(18,13,11,0.9),rgba(10,7,6,0.92))] p-2.5 shadow-[0_1px_0_rgba(255,214,160,0.035)_inset,0_-8px_14px_rgba(0,0,0,0.18)_inset]">
        <div className="font-sans text-[8px] tracking-[0.14em] text-[#6f6254]">{label}</div>
        <div className="mt-1 truncate font-sans text-[11px] font-bold text-[#e3d2ba]">{value}</div>
    </div>
);

const StatPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex h-[70px] flex-col items-center justify-center rounded-[16px] border border-[rgba(130,68,48,0.38)] bg-[linear-gradient(180deg,rgba(18,13,11,0.96),rgba(10,7,6,0.96))] px-2 text-center shadow-[0_1px_0_rgba(255,214,160,0.05)_inset,0_-10px_18px_rgba(0,0,0,0.22)_inset]">
        <div className="font-sans text-[10px] tracking-[0.14em] text-[#a87f5b]">{label}</div>
        <div className="mt-1 font-sans text-[16px] font-bold text-[#e6d0b3]">{value}</div>
    </div>
);

const StyleButton: React.FC<{ label: string; active: boolean; title?: string; onClick: () => void }> = ({ label, active, title, onClick }) => (
    <button
        type="button"
        title={title}
        onClick={onClick}
        className={`relative h-12 overflow-hidden rounded-[12px] border px-2.5 py-1.5 text-[11px] font-semibold leading-tight transition-all active:scale-95 ${
            active
                ? 'border-[rgba(150,61,43,0.82)] bg-[linear-gradient(180deg,rgba(58,18,14,0.78),rgba(17,8,7,0.92))] text-[#e8d6be] shadow-[3px_0_0_rgba(148,43,31,0.9)_inset,0_-2px_0_rgba(113,34,25,0.85)_inset,0_6px_16px_rgba(0,0,0,0.28)]'
                : 'border-[rgba(113,61,45,0.38)] bg-[rgba(10,7,6,0.76)] text-[#afa08d] shadow-[0_1px_0_rgba(255,220,170,0.03)_inset] hover:border-[rgba(122,42,30,0.62)] hover:bg-[#120b09] hover:text-[#e3d2ba]'
        }`}
    >
        {active && (
            <>
                <span className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full bg-[#9a3328] shadow-[0_0_6px_rgba(154,51,40,0.35)]" />
                <span className="absolute inset-x-3 bottom-1.5 h-px bg-[#713019]/75" />
            </>
        )}
        <span className="relative flex h-full items-center">{label}</span>
    </button>
);

TrpgControlBall.displayName = 'TrpgControlBall';

export default TrpgControlBall;
