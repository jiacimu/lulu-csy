/**
 * TheaterFloatingBall — 520约会剧场独立悬浮球
 * 粉色系主题，不与见面的 SummaryFloatingBall 耦合。
 * 实装：场景切换、设置入口
 * 占位：BGM、记忆印记、心情读取、取景框
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, PanInfo } from 'framer-motion';

interface TheaterFloatingBallProps {
    charId: string;
    onChangeLocation: () => void;
    onOpenSettings: () => void;
}

const BALL_SIZE = 48;
const EDGE_PADDING = 10;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const readPos = (key: string) => {
    try {
        const p = JSON.parse(localStorage.getItem(key) || 'null');
        if (p && typeof p.x === 'number' && typeof p.y === 'number') return p as { x: number; y: number };
    } catch { /* ignore */ }
    return null;
};

const defaultPos = () => ({
    x: typeof window !== 'undefined' ? Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - 16) : 20,
    y: typeof window !== 'undefined' ? Math.max(EDGE_PADDING, Math.round(window.innerHeight * 0.42)) : 200,
});

/* ── Placeholder menu item ── */
const PlaceholderItem: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 opacity-40 cursor-not-allowed">
        <div className="flex items-center gap-2.5">
            <span className="text-base">{icon}</span>
            <span className="text-xs text-white/70">{label}</span>
        </div>
        <span className="text-[9px] text-white/30 tracking-wider">即将推出</span>
    </div>
);

const TheaterFloatingBall: React.FC<TheaterFloatingBallProps> = memo(({
    charId,
    onChangeLocation,
    onOpenSettings,
}) => {
    const storageKey = `theater_ball_pos_${charId}`;
    const constraintsRef = useRef<HTMLDivElement>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [position, setPosition] = useState(() => readPos(storageKey) || defaultPos());
    const [dragging, setDragging] = useState(false);
    const x = useMotionValue(position.x);
    const y = useMotionValue(position.y);

    useEffect(() => {
        const next = readPos(storageKey) || defaultPos();
        const maxX = Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - EDGE_PADDING);
        const maxY = Math.max(EDGE_PADDING, window.innerHeight - BALL_SIZE - EDGE_PADDING);
        const c = { x: clamp(next.x, EDGE_PADDING, maxX), y: clamp(next.y, EDGE_PADDING, maxY) };
        setPosition(c); x.set(c.x); y.set(c.y);
    }, [charId]);

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
    }, [storageKey]);

    const panelPlacement = useMemo(() => ({
        horizontal: position.x > window.innerWidth - 240 ? 'left' as const : 'right' as const,
        vertical: position.y > window.innerHeight - 340 ? 'up' as const : 'down' as const,
    }), [position]);

    const panelStyle: React.CSSProperties = {
        left: panelPlacement.horizontal === 'right' ? BALL_SIZE + 8 : undefined,
        right: panelPlacement.horizontal === 'left' ? BALL_SIZE + 8 : undefined,
        top: panelPlacement.vertical === 'down' ? -4 : undefined,
        bottom: panelPlacement.vertical === 'up' ? -4 : undefined,
    };

    const commitPos = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const maxX = Math.max(EDGE_PADDING, window.innerWidth - BALL_SIZE - EDGE_PADDING);
        const maxY = Math.max(EDGE_PADDING, window.innerHeight - BALL_SIZE - EDGE_PADDING);
        const c = { x: clamp(x.get(), EDGE_PADDING, maxX), y: clamp(y.get(), EDGE_PADDING, maxY) };
        setPosition(c); x.set(c.x); y.set(c.y);
        if (Math.hypot(info.offset.x, info.offset.y) >= 10) {
            localStorage.setItem(storageKey, JSON.stringify(c));
        }
        window.setTimeout(() => setDragging(false), 0);
    };

    return (
        <div ref={constraintsRef} className="absolute inset-0 z-[90] pointer-events-none">
            <motion.div
                drag={!panelOpen}
                dragConstraints={constraintsRef}
                dragMomentum={false}
                dragElastic={0}
                style={{ x, y }}
                onDragStart={() => setDragging(true)}
                onDragEnd={commitPos}
                className="absolute left-0 top-0 pointer-events-auto"
            >
                {/* Ball */}
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (!dragging) setPanelOpen(v => !v); }}
                    className={`relative flex items-center justify-center rounded-full transition-all active:scale-90 ${dragging ? 'opacity-60' : 'opacity-100'}`}
                    style={{ width: BALL_SIZE, height: BALL_SIZE }}
                >
                    {/* Glow */}
                    <span className="absolute inset-0 rounded-full" style={{
                        background: 'radial-gradient(circle, rgba(255,107,157,0.35) 0%, transparent 70%)',
                        animation: 'theater-pulse 3s ease-in-out infinite',
                    }} />
                    {/* Core */}
                    <span className="relative flex items-center justify-center w-10 h-10 rounded-full" style={{
                        background: 'linear-gradient(135deg, rgba(255,107,157,0.7), rgba(196,69,105,0.7))',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        boxShadow: '0 4px 20px rgba(255,107,157,0.4)',
                    }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#fff" width={18} height={18}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                        </svg>
                    </span>
                </button>

                {/* Panel */}
                {panelOpen && (
                    <div
                        className="control-panel absolute w-56 rounded-2xl border p-3 text-white shadow-2xl"
                        style={{
                            ...panelStyle,
                            background: 'rgba(15, 5, 10, 0.85)',
                            backdropFilter: 'blur(28px) saturate(1.4)',
                            WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
                            borderColor: 'rgba(255,107,157,0.15)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3 px-1">
                            <span className="text-[11px] font-bold tracking-widest" style={{ color: 'rgba(255,107,157,0.8)' }}>✦ 520 工具箱</span>
                            <button
                                type="button"
                                onClick={() => setPanelOpen(false)}
                                className="w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.06)' }}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="rgba(255,255,255,0.4)" width={12} height={12}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-0.5">
                            {/* Scene Switch — working */}
                            <button
                                type="button"
                                onClick={() => { setPanelOpen(false); onChangeLocation(); }}
                                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors active:bg-white/10"
                                style={{ background: 'rgba(255,255,255,0.04)' }}
                            >
                                <span className="text-base">🗺️</span>
                                <span className="text-xs text-white/80 font-medium">场景切换</span>
                            </button>

                            {/* Settings — working */}
                            <button
                                type="button"
                                onClick={() => { setPanelOpen(false); onOpenSettings(); }}
                                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors active:bg-white/10"
                                style={{ background: 'rgba(255,255,255,0.04)' }}
                            >
                                <span className="text-base">⚙️</span>
                                <span className="text-xs text-white/80 font-medium">立绘设置</span>
                            </button>

                            {/* Divider */}
                            <div className="my-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

                            {/* Placeholders */}
                            <PlaceholderItem icon="🎵" label="氛围 BGM" />
                            <PlaceholderItem icon="📸" label="记忆印记" />
                            <PlaceholderItem icon="💭" label="心情读取" />
                            <PlaceholderItem icon="📷" label="取景框" />
                        </div>
                    </div>
                )}
            </motion.div>
        </div>
    );
});

TheaterFloatingBall.displayName = 'TheaterFloatingBall';

export default TheaterFloatingBall;
