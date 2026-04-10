import React, { useCallback } from 'react';
import type { SongCardMetadata } from '../../../types/music';

// Import module-level play function to avoid unnecessary hook re-renders
// playSongInternal is a plain async function, not a hook
import { useAudioPlayer } from '../../../hooks/useAudioPlayer';

interface SongShareCardBubbleProps {
    metadata: SongCardMetadata;
}

/**
 * MIOS-style Song Share Card — minimalist black/white/grey design
 * 
 * Layout:
 *   ┌──────────────────────────────┐
 *   │  [cover]  Song Name          │
 *   │  60×60    Artist             │
 *   │            Emo Cloud          │
 *   │──────────────────────────────│
 *   │  🎵 音乐                     │
 *   └──────────────────────────────┘
 */
const SongShareCardBubble: React.FC<SongShareCardBubbleProps> = ({ metadata }) => {
    const { playSong } = useAudioPlayer();

    const handlePlay = useCallback(() => {
        if (!metadata.songId || metadata.songId === 0) return;

        // Build a minimal NeteaseSong object for the player
        const song = {
            id: metadata.songId,
            name: metadata.songName,
            artists: [{ id: 0, name: metadata.artist }],
            album: {
                kind: 'album' as const,
                id: 0,
                name: metadata.albumName || '',
                picUrl: metadata.albumCover,
            },
            duration: metadata.duration || 0,
        };

        playSong(song);
    }, [metadata, playSong]);

    const formatDuration = (ms?: number) => {
        if (!ms || ms <= 0) return '';
        const totalSec = Math.round(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${String(sec).padStart(2, '0')}`;
    };

    const durationStr = formatDuration(metadata.duration);

    return (
        <div
            className="animate-fade-in active:scale-[0.97] transition-transform cursor-pointer select-none"
            onClick={handlePlay}
            style={{
                width: '240px',
                background: '#fafafa',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '0.5px solid rgba(0,0,0,0.08)',
            }}
        >
            {/* Main content area */}
            <div style={{ display: 'flex', gap: '10px', padding: '12px' }}>
                {/* Album cover */}
                <div
                    style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '4px',
                        flexShrink: 0,
                        overflow: 'hidden',
                        background: metadata.albumCover
                            ? undefined
                            : 'linear-gradient(135deg, #e0e0e0, #bdbdbd)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {metadata.albumCover ? (
                        <img
                            src={metadata.albumCover}
                            alt=""
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                            }}
                            loading="lazy"
                            decoding="async"
                        />
                    ) : (
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            style={{ width: '20px', height: '20px' }}
                        >
                            <path
                                d="M9 18V5l12-2v13"
                                stroke="#999"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <circle cx="6" cy="18" r="3" stroke="#999" strokeWidth="1.5" />
                            <circle cx="18" cy="16" r="3" stroke="#999" strokeWidth="1.5" />
                        </svg>
                    )}
                </div>

                {/* Song info */}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        gap: '2px',
                    }}
                >
                    <div
                        style={{
                            fontSize: '14px',
                            fontWeight: 500,
                            color: '#1a1a1a',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {metadata.songName}
                    </div>
                    <div
                        style={{
                            fontSize: '11px',
                            color: '#999',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {metadata.artist}
                        {durationStr ? ` · ${durationStr}` : ''}
                    </div>
                    <div
                        style={{
                            fontSize: '10px',
                            color: '#bbb',
                            lineHeight: 1.3,
                            marginTop: '1px',
                        }}
                    >
                        Emo Cloud
                    </div>
                </div>
            </div>

            {/* Footer divider + label */}
            <div
                style={{
                    borderTop: '0.5px solid rgba(0,0,0,0.06)',
                    padding: '6px 12px',
                }}
            >
                <span style={{
                    fontSize: '10px',
                    color: '#c0c0c0',
                    fontFamily: "'Georgia', 'Palatino Linotype', serif",
                    fontStyle: 'italic',
                    letterSpacing: '0.8px',
                }}>
                    Music
                </span>
            </div>
        </div>
    );
};

export default SongShareCardBubble;
