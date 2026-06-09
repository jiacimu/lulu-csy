import React,{ useEffect,useMemo,useState } from 'react';
import { BookOpenText, Sparkle } from '@phosphor-icons/react';
import type { CollectionForwardPayload } from '../../../types';
import { formatCollectionKindLabel } from '../../../utils/collectionBooks';

interface CollectionForwardCardProps {
    data: CollectionForwardPayload;
    commonLayout: (content: React.ReactNode) => React.ReactElement;
    selectionMode: boolean;
}

const formatDate = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const MAGAZINE_PALETTES = [
    {
        paper: '#fffaf4',
        ink: '#241f1f',
        muted: '#8a6a62',
        accent: '#8f2f45',
        accentSoft: '#f4d6dc',
        stamp: '#2c7470',
        coverA: '#f8d9d0',
        coverB: '#f6ead8',
        coverC: '#28343a',
    },
    {
        paper: '#fbf7ef',
        ink: '#26241f',
        muted: '#7d6a56',
        accent: '#a96b2e',
        accentSoft: '#efd4b5',
        stamp: '#446f7c',
        coverA: '#e8c08b',
        coverB: '#f9e8cc',
        coverC: '#394f4c',
    },
    {
        paper: '#fff8f8',
        ink: '#27202a',
        muted: '#846677',
        accent: '#7e3f66',
        accentSoft: '#ead4e2',
        stamp: '#2f7779',
        coverA: '#eed2de',
        coverB: '#f8e6d2',
        coverC: '#30304b',
    },
    {
        paper: '#f8fbf7',
        ink: '#202626',
        muted: '#60716e',
        accent: '#9b3f3f',
        accentSoft: '#efd5cf',
        stamp: '#2c7470',
        coverA: '#d9ebe5',
        coverB: '#f6ead4',
        coverC: '#31443f',
    },
];

const makePaletteIndex = (value: string): number => {
    const seed = Array.from(value || 'collection').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return seed % MAGAZINE_PALETTES.length;
};

const makeIssueNumber = (value: string): string => {
    const seed = Array.from(value || 'afterglow').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return String((seed % 89) + 11).padStart(2, '0');
};

const CollectionForwardCard: React.FC<CollectionForwardCardProps> = ({ data, commonLayout, selectionMode }) => {
    const kindLabel = formatCollectionKindLabel(data.kind);
    const palette = useMemo(() => MAGAZINE_PALETTES[makePaletteIndex(data.bookId || data.title)], [data.bookId, data.title]);
    const issueNumber = useMemo(() => makeIssueNumber(data.bookId || data.title), [data.bookId, data.title]);
    const formattedDate = formatDate(data.collectedAt);
    const visibleTags = Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 2) : [];
    const [coverFailed, setCoverFailed] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const coverImageUrl = typeof data.coverImageUrl === 'string' ? data.coverImageUrl.trim() : '';
    const charAvatar = typeof data.charAvatar === 'string' ? data.charAvatar.trim() : '';
    const hasCoverImage = Boolean(coverImageUrl && !coverFailed);
    const hasAvatarCover = Boolean(charAvatar && !hasCoverImage && !avatarFailed);

    useEffect(() => {
        setCoverFailed(false);
    }, [coverImageUrl]);

    useEffect(() => {
        setAvatarFailed(false);
    }, [charAvatar]);

    return (
        commonLayout(
            <article
                className={`relative w-64 overflow-hidden rounded-[14px] border shadow-[0_18px_42px_-28px_rgba(32,25,20,0.6)] transition-transform ${selectionMode ? '' : 'active:scale-[0.99]'}`}
                style={{
                    backgroundColor: palette.paper,
                    borderColor: `${palette.accent}33`,
                    color: palette.ink,
                }}
                aria-label={`${kindLabel}典藏馆转递卡片`}
            >
                <div
                    className="absolute right-3 top-3 z-10 rounded-full border px-2 py-0.5 text-[9px] font-black tracking-[0.18em]"
                    style={{
                        borderColor: `${palette.stamp}55`,
                        color: palette.stamp,
                        backgroundColor: `${palette.paper}cc`,
                    }}
                >
                    VOL.{issueNumber}
                </div>

                <div className="px-4 pb-3 pt-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-black tracking-[0.28em]" style={{ color: palette.accent }}>AFTERGLOW</div>
                            <div className="mt-0.5 text-[9px] font-bold tracking-[0.18em]" style={{ color: palette.muted }}>
                                {kindLabel}特辑 · 典藏馆转递
                            </div>
                        </div>
                    </div>

                    <div
                        className="relative mt-3 h-[112px] overflow-hidden rounded-[10px]"
                        style={{
                            background: `linear-gradient(135deg, ${palette.coverA} 0%, ${palette.coverB} 48%, ${palette.coverC} 100%)`,
                        }}
                    >
                        {hasCoverImage && (
                            <img
                                src={coverImageUrl}
                                alt={data.coverImageAlt || ''}
                                className="absolute inset-0 h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                                onError={() => setCoverFailed(true)}
                            />
                        )}
                        {hasAvatarCover && (
                            <img
                                src={charAvatar}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                                onError={() => setAvatarFailed(true)}
                            />
                        )}
                        {(hasCoverImage || hasAvatarCover) && (
                            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/55" />
                        )}
                        <div className="absolute inset-0 opacity-50 mix-blend-soft-light" style={{
                            backgroundImage: 'radial-gradient(circle at 26% 22%, rgba(255,255,255,0.72), transparent 26%), linear-gradient(120deg, rgba(255,255,255,0.16), transparent 42%)',
                        }} />
                        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold" style={{
                            color: palette.ink,
                            backgroundColor: 'rgba(255,255,255,0.62)',
                        }}>
                            <Sparkle className="h-3 w-3" weight="fill" />
                            <span>PRIVATE ISSUE</span>
                        </div>
                        <div className="absolute bottom-3 left-3 right-3">
                            <h3 className="line-clamp-2 text-[18px] font-black leading-[1.12] tracking-normal text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.36)]">
                                {data.title || '未命名典藏'}
                            </h3>
                        </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                        <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-inner"
                            style={{ backgroundColor: palette.accent }}
                        >
                            <BookOpenText className="h-4 w-4" weight="bold" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-extrabold" style={{ color: palette.ink }}>
                                来自 {data.charName || '角色'} 的典藏
                            </div>
                            <div className="mt-0.5 truncate text-[9px] font-bold tracking-[0.12em]" style={{ color: palette.muted }}>
                                {formattedDate ? `${formattedDate} · ` : ''}转递给你，与TA共读
                            </div>
                        </div>
                    </div>

                    {visibleTags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {visibleTags.map(tag => (
                                <span
                                    key={tag}
                                    className="max-w-[110px] truncate rounded-full px-2 py-0.5 text-[9px] font-bold"
                                    style={{
                                        color: palette.accent,
                                        backgroundColor: palette.accentSoft,
                                    }}
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </article>
        )
    );
};

export default CollectionForwardCard;
