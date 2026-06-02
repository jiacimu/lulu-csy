/**
 * WritingStyleSheet — 文风选择器二级弹窗
 * 
 * 从底部滑出的半屏 Sheet，展示所有内置文风预设和自定义文风入口。
 * 每个文风以卡片形式呈现：标签 + 一句话描述 + 可展开的完整提示词预览。
 * 用于 SummaryFloatingBall（悬浮球）和 DateSettings（设置页）复用。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DATE_WRITING_STYLE_PRESETS, resolveDateWritingStylePreset, type DateWritingStylePreset } from '../../utils/datePrompts';

export interface WritingStyleSheetProps {
    isOpen: boolean;
    /** Current style: a preset key (e.g. 'natural') or custom text, or undefined */
    currentStyle?: string;
    onSelect: (style: string | undefined) => void;
    onClose: () => void;
}

/** Check if a style string is a preset key */
const isPresetKey = (s?: string): boolean => {
    return !!resolveDateWritingStylePreset(s);
};

/** Get display label for current style */
const getStyleDisplayLabel = (style?: string): string => {
    if (!style) return '未选择';
    const preset = resolveDateWritingStylePreset(style);
    if (preset) return preset.label;
    return '自定义';
};

const WritingStyleSheet: React.FC<WritingStyleSheetProps> = ({
    isOpen,
    currentStyle,
    onSelect,
    onClose,
}) => {
    // Which card's prompt is expanded
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    // Custom style text (local draft)
    const [customText, setCustomText] = useState<string>('');
    // Whether custom input textarea is shown (independent of active state)
    const [showCustomInput, setShowCustomInput] = useState(false);
    // Whether custom card is "active" (selected & saved)
    const isCustomActive = !!currentStyle && !isPresetKey(currentStyle);
    const activePresetKey = resolveDateWritingStylePreset(currentStyle)?.key;

    // Sync custom text from currentStyle on open
    useEffect(() => {
        if (isOpen && currentStyle && !isPresetKey(currentStyle)) {
            setCustomText(currentStyle);
            setShowCustomInput(true);
        }
    }, [isOpen, currentStyle]);

    // Reset state when closing
    useEffect(() => {
        if (!isOpen) {
            setExpandedKey(null);
            if (!isCustomActive) {
                setShowCustomInput(false);
            }
        }
    }, [isOpen, isCustomActive]);

    const handlePresetClick = useCallback((key: string) => {
        if (activePresetKey === key) {
            onSelect(undefined);
        } else {
            onSelect(key);
            // Deactivate custom input when selecting a preset
            setShowCustomInput(false);
        }
    }, [activePresetKey, onSelect]);

    const handleExpandToggle = useCallback((key: string) => {
        setExpandedKey(prev => prev === key ? null : key);
    }, []);

    const handleCustomToggle = useCallback(() => {
        if (isCustomActive || showCustomInput) {
            // Deselect custom
            onSelect(undefined);
            setShowCustomInput(false);
            setCustomText('');
        } else {
            // Open custom input area (don't select yet — let user type first)
            setShowCustomInput(true);
        }
    }, [isCustomActive, showCustomInput, onSelect]);

    const handleCustomTextChange = useCallback((text: string) => {
        setCustomText(text);
        // Live-save as user types
        if (text.trim()) {
            onSelect(text.trim());
        }
    }, [onSelect]);

    const handleCustomTextBlur = useCallback(() => {
        if (customText.trim()) {
            onSelect(customText.trim());
        } else {
            // Empty text on blur — deactivate
            onSelect(undefined);
            setShowCustomInput(false);
        }
    }, [customText, onSelect]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="writing-style-sheet-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[500]"
                    style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'auto' }}
                    onClick={onClose}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/45" style={{ backdropFilter: 'blur(4px)' }} />

                    {/* Sheet */}
                    <motion.div
                        key="writing-style-sheet"
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', stiffness: 340, damping: 34 }}
                        className="relative w-full"
                        style={{
                            maxWidth: 420,
                            maxHeight: '78vh',
                            display: 'flex',
                            flexDirection: 'column',
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            background: 'linear-gradient(180deg, rgba(20,20,28,0.97) 0%, rgba(12,12,18,0.99) 100%)',
                            boxShadow: '0 -8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Handle bar */}
                        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
                            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
                        </div>

                        {/* Header — fixed, not scrollable */}
                        <div style={{ padding: '4px 20px 12px', flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5 }}>文风选择</div>
                                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>选择一种内置文风，或自定义叙述风格</div>
                                </div>
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={onClose}
                                    style={{
                                        width: 32, height: 32, borderRadius: 16,
                                        background: 'rgba(255,255,255,0.08)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
                                    }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" width={14} height={14}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </div>
                            </div>

                            {/* Current status bar */}
                            <div style={{
                                marginTop: 10, padding: '8px 12px', borderRadius: 12,
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            }}>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>当前文风</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(110,231,183,0.8)' }}>
                                    {getStyleDisplayLabel(currentStyle)}
                                </span>
                            </div>

                            {/* Divider */}
                            <div style={{
                                height: 1, marginTop: 12,
                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
                            }} />
                        </div>

                        {/* Scrollable card list */}
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            overscrollBehavior: 'contain',
                            WebkitOverflowScrolling: 'touch',
                            padding: '4px 16px 24px',
                        }}>
                            {/* Preset cards */}
                            {DATE_WRITING_STYLE_PRESETS.map(preset => (
                                <PresetCard
                                    key={preset.key}
                                    preset={preset}
                                    isActive={activePresetKey === preset.key}
                                    isExpanded={expandedKey === preset.key}
                                    onSelect={() => handlePresetClick(preset.key)}
                                    onToggleExpand={() => handleExpandToggle(preset.key)}
                                />
                            ))}

                            {/* Custom style card */}
                            <div style={{
                                borderRadius: 16, marginTop: 8,
                                border: (isCustomActive || showCustomInput) ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.06)',
                                background: (isCustomActive || showCustomInput) ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)',
                                transition: 'all 0.2s',
                            }}>
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleCustomToggle}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '14px 16px', cursor: 'pointer',
                                    }}
                                >
                                    {/* Checkbox */}
                                    <div style={{
                                        width: 20, height: 20, borderRadius: 10, flexShrink: 0,
                                        border: (isCustomActive || showCustomInput) ? '2px solid rgb(168,85,247)' : '2px solid rgba(255,255,255,0.2)',
                                        background: isCustomActive ? 'rgb(168,85,247)' : (showCustomInput ? 'rgba(168,85,247,0.3)' : 'transparent'),
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.2s',
                                    }}>
                                        {isCustomActive && (
                                            <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>✏️ 自定义文风</div>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2, lineHeight: 1.4 }}>用你自己的话描述想要的叙述风格</div>
                                    </div>
                                </div>

                                {/* Custom textarea — visible when input is open OR style is active */}
                                {(isCustomActive || showCustomInput) && (
                                    <div style={{ padding: '0 16px 14px' }}>
                                        <textarea
                                            value={customText}
                                            onChange={e => handleCustomTextChange(e.target.value)}
                                            onBlur={handleCustomTextBlur}
                                            rows={3}
                                            placeholder="例如：用短句，少用形容词，台词口语化，像聊天记录一样自然…"
                                            onClick={e => e.stopPropagation()}
                                            style={{
                                                width: '100%', resize: 'none', borderRadius: 12,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                background: 'rgba(255,255,255,0.04)',
                                                padding: 12, fontSize: 12, lineHeight: 1.6,
                                                color: 'rgba(255,255,255,0.7)', outline: 'none',
                                                boxSizing: 'border-box',
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Bottom safe area */}
                            <div style={{ height: 20 }} />
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ─── Preset Card Sub-component ───
// Uses <div role="button"> instead of <button> to avoid nested-button issues

interface PresetCardProps {
    preset: DateWritingStylePreset;
    isActive: boolean;
    isExpanded: boolean;
    onSelect: () => void;
    onToggleExpand: () => void;
}

const PresetCard: React.FC<PresetCardProps> = React.memo(({ preset, isActive, isExpanded, onSelect, onToggleExpand }) => {
    return (
        <div style={{
            borderRadius: 16, marginBottom: 8,
            border: isActive ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(255,255,255,0.06)',
            background: isActive ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.02)',
            transition: 'all 0.2s',
        }}>
            {/* Card header: clickable row */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', cursor: 'pointer',
            }}>
                {/* Checkbox — click to select */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={onSelect}
                    style={{
                        width: 20, height: 20, borderRadius: 10, flexShrink: 0,
                        border: isActive ? '2px solid rgb(52,211,153)' : '2px solid rgba(255,255,255,0.2)',
                        background: isActive ? 'rgb(52,211,153)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s', cursor: 'pointer',
                    }}
                >
                    {isActive && (
                        <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    )}
                </div>

                {/* Text content — click to select */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={onSelect}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                >
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{preset.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, lineHeight: 1.4 }}>{preset.desc}</div>
                </div>

                {/* Expand arrow — separate click target */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={onToggleExpand}
                    style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                        background: 'rgba(255,255,255,0.04)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
                        transition: 'all 0.15s',
                    }}
                >
                    <svg
                        width={12} height={12} viewBox="0 0 12 12" fill="none"
                        stroke="currentColor" strokeWidth={1.8}
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                    >
                        <path d="M2.5 4.5L6 8L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
            </div>

            {/* Expandable prompt preview */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        key={`prompt-${preset.key}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ padding: '0 16px 14px' }}>
                            <div style={{
                                borderRadius: 12, padding: 12,
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.05)',
                            }}>
                                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' as const }}>
                                    内置提示词
                                </div>
                                <div style={{
                                    fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6,
                                    whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                                }}>
                                    {preset.prompt.trim()}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

PresetCard.displayName = 'PresetCard';

export default WritingStyleSheet;
export { getStyleDisplayLabel, isPresetKey };
