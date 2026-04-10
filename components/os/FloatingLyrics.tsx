import React, {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useLyrics } from '../../hooks/useLyrics';
import { AppID } from '../../types';
import { useApp } from '../../context/AppContext';
import {
    type FloatingLyricsSettings,
    type LyricPosition,
    readFloatingLyricsSettings,
    updateFloatingLyricsSettings,
} from './floatingLyricsSettings';
import { isSongPlayable } from '../../types/music';
import './FloatingLyrics.css';

const FloatingLyrics: React.FC = () => {
    const { activeApp } = useApp();
    const { currentSong, currentTime } = useAudioPlayer();
    const [settings, setSettings] = useState<FloatingLyricsSettings>(() =>
        readFloatingLyricsSettings(),
    );
    const [trackOffset, setTrackOffset] = useState(0);
    const viewportRef = useRef<HTMLDivElement>(null);
    const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

    const { lines, currentIndex } = useLyrics({
        songId: currentSong && isSongPlayable(currentSong) ? currentSong.id : undefined,
        currentTime,
        enabled: settings.enabled && activeApp !== AppID.Music,
    });

    useEffect(() => {
        const handleStorage = () => {
            setSettings(readFloatingLyricsSettings());
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    useEffect(() => {
        lineRefs.current = lineRefs.current.slice(0, lines.length);
    }, [lines.length]);

    useLayoutEffect(() => {
        if (currentIndex < 0) {
            setTrackOffset(0);
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            const viewport = viewportRef.current;
            const activeLine = lineRefs.current[currentIndex];

            if (!viewport || !activeLine) {
                setTrackOffset(0);
                return;
            }

            const viewportCenter = viewport.clientHeight / 2;
            const activeLineCenter =
                activeLine.offsetTop + activeLine.offsetHeight / 2;

            setTrackOffset(viewportCenter - activeLineCenter);
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [currentIndex, lines, settings.showTranslation]);

    const shouldShow =
        settings.enabled &&
        currentSong !== null &&
        isSongPlayable(currentSong) &&
        activeApp !== AppID.Music &&
        lines.length > 0;

    const positionLabels: Record<LyricPosition, string> = {
        top: '顶部',
        center: '居中',
        bottom: '底部',
    };

    const handleCyclePosition = () => {
        const order: LyricPosition[] = ['top', 'center', 'bottom'];
        const nextPosition =
            order[(order.indexOf(settings.position) + 1) % order.length];
        setSettings(
            updateFloatingLyricsSettings({
                position: nextPosition,
            }),
        );
    };

    const handleToggleTranslation = () => {
        setSettings(
            updateFloatingLyricsSettings({
                showTranslation: !settings.showTranslation,
            }),
        );
    };

    const handleToggleEnabled = () => {
        setSettings(
            updateFloatingLyricsSettings({
                enabled: !settings.enabled,
            }),
        );
    };

    if (!shouldShow) return null;

    return (
        <div
            className={`floating-lyrics floating-lyrics--${settings.position}`}
            style={{ opacity: settings.opacity }}
        >
            <div className="floating-lyrics-scroll" ref={viewportRef}>
                <div
                    className="floating-lyrics-track"
                    style={{
                        transform: `translate3d(0, ${trackOffset}px, 0)`,
                    }}
                >
                    {lines.map((line, index) => (
                        <div
                            key={`${line.time}-${index}`}
                            ref={(node) => {
                                lineRefs.current[index] = node;
                            }}
                            className={`floating-lyric-line ${index === currentIndex ? 'floating-lyric-line--active' : ''}`}
                        >
                            <span className="floating-lyric-text">
                                {line.text}
                            </span>
                            {settings.showTranslation &&
                                index === currentIndex &&
                                line.translation && (
                                <span className="floating-lyric-translation">
                                    {line.translation}
                                </span>
                                )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="floating-lyrics-toolbar">
                <button
                    className="fl-tool-btn"
                    onClick={handleCyclePosition}
                    title="切换位置"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M12 2v20M2 12h20" />
                    </svg>
                    <span>{positionLabels[settings.position]}</span>
                </button>
                <button
                    className="fl-tool-btn"
                    onClick={handleToggleTranslation}
                    title="翻译"
                >
                    <span>{settings.showTranslation ? '译✓' : '译'}</span>
                </button>
                <button
                    className="fl-tool-btn fl-tool-btn--close"
                    onClick={handleToggleEnabled}
                    title="关闭歌词"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default React.memo(FloatingLyrics);
