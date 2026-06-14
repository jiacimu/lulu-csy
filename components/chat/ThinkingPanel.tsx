import React,{ useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';

interface ThinkingPanelProps {
    thinking?: string;
    textColor?: string;
    className?: string;
    maxHeight?: number;
    onNestedScrollActiveChange?: (active: boolean) => void;
}

const alphaColor = (color: string | undefined, alphaHex: string, fallback: string) => {
    if (!color) return fallback;
    const trimmed = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return `${trimmed}${alphaHex}`;
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
        const [, r, g, b] = trimmed;
        return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
    }
    return trimmed;
};

type NestedScrollEvent = React.TouchEvent | React.PointerEvent | React.WheelEvent;

const stopNestedScrollPropagation = (event: NestedScrollEvent) => {
    event.stopPropagation();
};

const ThinkingPanel: React.FC<ThinkingPanelProps> = ({
    thinking,
    textColor,
    className = '',
    maxHeight = 240,
    onNestedScrollActiveChange,
}) => {
    const [expanded, setExpanded] = useState(false);
    const content = thinking?.trim();
    if (!content) return null;

    const bodyMaxHeight = Math.max(80, maxHeight - 20);
    const startNestedScroll = (event: NestedScrollEvent) => {
        event.stopPropagation();
        onNestedScrollActiveChange?.(true);
    };
    const endNestedScroll = (event: NestedScrollEvent) => {
        event.stopPropagation();
        onNestedScrollActiveChange?.(false);
    };

    return (
        <div
            data-testid="thinking-panel"
            className={`relative z-10 select-none ${className}`}
            style={{ marginBottom: expanded ? '6px' : '2px' }}
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setExpanded(prev => !prev);
                }}
                className="flex items-center gap-1.5 cursor-pointer active:opacity-60 transition-opacity"
                style={{ userSelect: 'none' }}
            >
                <span style={{
                    fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', 'Palatino', serif",
                    fontStyle: 'italic',
                    fontSize: '10px',
                    letterSpacing: '0.5px',
                    color: alphaColor(textColor, '66', 'rgba(120, 110, 95, 0.55)'),
                }}>
                    ‹ 𝘛𝘩𝘪𝘯𝘬𝘪𝘯𝘨 ›
                </span>
                <CaretDown
                    className="transition-transform duration-200"
                    style={{
                        width: '8px',
                        height: '8px',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        opacity: 0.35,
                        color: textColor || '#786e5f',
                    }}
                    weight="bold"
                />
            </button>

            <div
                data-testid="thinking-panel-collapse"
                className="transition-all duration-300 ease-in-out"
                style={{
                    maxHeight: expanded ? `${maxHeight}px` : '0',
                    opacity: expanded ? 1 : 0,
                    overflow: expanded ? 'visible' : 'hidden',
                    marginTop: expanded ? '4px' : '0',
                }}
            >
                <div
                    data-testid="thinking-panel-scroll"
                    className="sully-thinking-scroll overflow-y-auto no-scrollbar"
                    onPointerDown={startNestedScroll}
                    onPointerMove={startNestedScroll}
                    onPointerUp={endNestedScroll}
                    onPointerCancel={endNestedScroll}
                    onPointerLeave={endNestedScroll}
                    onTouchStart={startNestedScroll}
                    onTouchMove={startNestedScroll}
                    onTouchEnd={endNestedScroll}
                    onTouchCancel={endNestedScroll}
                    onWheel={stopNestedScrollPropagation}
                    style={{
                        maxHeight: `${bodyMaxHeight}px`,
                        overflowX: 'hidden',
                        overflowY: 'auto',
                        WebkitOverflowScrolling: 'touch',
                        overscrollBehavior: 'contain',
                        touchAction: 'pan-y',
                        position: 'relative',
                        minHeight: 0,
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: alphaColor(textColor, '08', 'rgba(140, 130, 115, 0.06)'),
                        borderTop: `1px solid ${alphaColor(textColor, '12', 'rgba(140, 130, 115, 0.1)')}`,
                        borderBottom: `1px solid ${alphaColor(textColor, '12', 'rgba(140, 130, 115, 0.1)')}`,
                    }}
                >
                    <div style={{
                        fontSize: '11px',
                        lineHeight: '1.65',
                        color: alphaColor(textColor, '88', 'rgba(80, 72, 60, 0.55)'),
                        fontFamily: "'Georgia', 'Palatino Linotype', serif",
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}>
                        {content}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ThinkingPanel;
