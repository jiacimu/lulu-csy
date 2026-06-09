import React from 'react';
import { Camera, Image as ImageIcon, Sparkle, X } from '@phosphor-icons/react';
import type { Message } from '../../types';
import { resolveOriginalImageUrl } from '../../utils/generatedImageStorage';

interface DatePhotoPanelProps {
    photos: Message[];
    manualPhotoEnabled: boolean;
    manualPhotoGenerating: boolean;
    onClose: () => void;
    onOpenManualPhoto: () => void;
}

function getPhotoThumb(message: Message): string {
    return String(message.metadata?.thumbnailUrl || message.content || '');
}

function getPhotoCaption(message: Message): string {
    return String(message.metadata?.caption || message.metadata?.visualSummary || '见面照片').trim();
}

const DatePhotoPanel: React.FC<DatePhotoPanelProps> = ({
    photos,
    manualPhotoEnabled,
    manualPhotoGenerating,
    onClose,
    onOpenManualPhoto,
}) => {
    const [selectedId, setSelectedId] = React.useState<number | null>(() => photos[photos.length - 1]?.id || null);
    const selectedPhoto = React.useMemo(() => {
        if (photos.length === 0) return null;
        return photos.find(photo => photo.id === selectedId) || photos[photos.length - 1] || null;
    }, [photos, selectedId]);
    const [originalUrl, setOriginalUrl] = React.useState('');
    const [isOriginalLoading, setIsOriginalLoading] = React.useState(false);

    React.useEffect(() => {
        if (!selectedPhoto) {
            setOriginalUrl('');
            setIsOriginalLoading(false);
            return;
        }

        let cancelled = false;
        const fallback = String(selectedPhoto.content || selectedPhoto.metadata?.thumbnailUrl || '');
        setOriginalUrl(getPhotoThumb(selectedPhoto));
        setIsOriginalLoading(Boolean(selectedPhoto.metadata?.originalAssetId));

        resolveOriginalImageUrl(selectedPhoto.metadata?.originalAssetId, fallback)
            .then(url => {
                if (!cancelled) setOriginalUrl(url);
            })
            .catch(() => {
                if (!cancelled) setOriginalUrl(getPhotoThumb(selectedPhoto));
            })
            .finally(() => {
                if (!cancelled) setIsOriginalLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedPhoto?.id]);

    return (
        <div
            className="absolute right-3 top-[calc(72px+env(safe-area-inset-top))] z-[160] w-[min(92vw,360px)] max-h-[min(72vh,620px)] overflow-hidden rounded-2xl border border-white/12 bg-neutral-950/95 text-white shadow-[0_18px_48px_rgba(0,0,0,0.38)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="见面照片"
        >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
                        <Camera className="h-3.5 w-3.5" weight="bold" />
                        Date Photos
                    </div>
                    <div className="mt-0.5 truncate text-sm font-bold">见面照片 {photos.length ? `· ${photos.length}` : ''}</div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/75 active:scale-95"
                    aria-label="关闭见面照片"
                >
                    <X className="h-4 w-4" weight="bold" />
                </button>
            </div>

            <div className="max-h-[calc(min(72vh,620px)-56px)] overflow-y-auto px-3 py-3">
                {selectedPhoto && (
                    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                        {originalUrl ? (
                            <img
                                src={originalUrl}
                                alt={getPhotoCaption(selectedPhoto)}
                                className="max-h-[46vh] w-full object-contain"
                            />
                        ) : (
                            <div className="grid h-52 place-items-center text-white/35">
                                <ImageIcon className="h-10 w-10" weight="duotone" />
                            </div>
                        )}
                        <figcaption className="border-t border-white/10 px-3 py-2 text-xs leading-relaxed text-white/70">
                            {isOriginalLoading ? '高清原图加载中...' : getPhotoCaption(selectedPhoto)}
                        </figcaption>
                    </figure>
                )}

                {photos.length > 1 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                        {photos.map(photo => {
                            const active = selectedPhoto?.id === photo.id;
                            return (
                                <button
                                    key={photo.id}
                                    type="button"
                                    onClick={() => setSelectedId(photo.id)}
                                    className={`aspect-square overflow-hidden rounded-xl border transition-all active:scale-95 ${active ? 'border-white shadow-[0_0_0_2px_rgba(255,255,255,0.18)]' : 'border-white/10 opacity-70'}`}
                                    aria-label={getPhotoCaption(photo)}
                                >
                                    {getPhotoThumb(photo) ? (
                                        <img src={getPhotoThumb(photo)} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="grid h-full w-full place-items-center bg-white/5 text-white/35">
                                            <ImageIcon className="h-5 w-5" weight="duotone" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {photos.length === 0 && (
                    <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-6 text-center">
                        <div>
                            <ImageIcon className="mx-auto h-9 w-9 text-white/25" weight="duotone" />
                            <div className="mt-3 text-sm font-bold text-white/70">还没有见面照片</div>
                        </div>
                    </div>
                )}

                {manualPhotoEnabled && (
                    <button
                        type="button"
                        onClick={onOpenManualPhoto}
                        disabled={manualPhotoGenerating}
                        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-bold text-black shadow-lg active:scale-95 disabled:bg-white/20 disabled:text-white/35"
                    >
                        <Sparkle className="h-4 w-4" weight="fill" />
                        {manualPhotoGenerating ? '生图中...' : '手动生图'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default DatePhotoPanel;
