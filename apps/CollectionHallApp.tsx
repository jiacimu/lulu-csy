import React,{ useCallback,useEffect,useMemo,useState } from 'react';
import { ArrowRight, BookOpenText, Books, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, type CollectionBook, type CollectionForwardPayload, type GalleryImage } from '../types';
import { DB } from '../utils/db';
import {
    buildCollectionForwardPayload,
    formatCollectionKindLabel,
} from '../utils/collectionBooks';
import { getGalleryImageDisplayUrl } from '../utils/generatedImageStorage';
import { AfterglowReaderModal } from '../components/chat/MessageItem';

const BOOK_COLORS = [
    ['#533622', '#8d5935', '#f1c27b'],
    ['#25433f', '#3f756c', '#d6ece3'],
    ['#4f2c3a', '#8d4961', '#f1bfd0'],
    ['#2d3d61', '#4f6598', '#cfd9ff'],
    ['#594721', '#9b7a35', '#f3db8d'],
    ['#3d3158', '#7059a8', '#ddd1ff'],
];

function colorForBook(book: CollectionBook): string[] {
    const seed = Array.from(book.id || book.title).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return BOOK_COLORS[seed % BOOK_COLORS.length];
}

function seededIndex(value: string, length: number): number {
    if (length <= 0) return 0;
    const seed = Array.from(value || 'collection').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return seed % length;
}

function selectGeneratedGalleryCover(images: GalleryImage[], seed: string): GalleryImage | null {
    const generatedImages = images
        .filter(image => Boolean(image.photoMeta && getGalleryImageDisplayUrl(image)))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (generatedImages.length === 0) return null;

    const recentPool = generatedImages.slice(0, Math.min(6, generatedImages.length));
    return recentPool[seededIndex(seed, recentPool.length)] || recentPool[0] || null;
}

async function resolveCollectionForwardCover(book: CollectionBook, targetCharId?: string): Promise<{
    coverImageId?: string;
    coverImageUrl?: string;
    coverImageAlt?: string;
}> {
    const readIds: string[] = [];
    const addReadId = (id?: string) => {
        const normalized = String(id || '').trim();
        if (normalized && !readIds.includes(normalized)) readIds.push(normalized);
    };
    addReadId(book.charId);
    addReadId(targetCharId);

    for (const charId of [...readIds]) {
        try {
            addReadId(await DB.resolveCharacterContentId(charId));
        } catch {
            // Cover art is optional; forwarding should still work if ID resolution fails.
        }
    }

    for (const charId of readIds) {
        try {
            const gallery = await DB.getGalleryImages(charId);
            const cover = selectGeneratedGalleryCover(gallery, book.id || book.title);
            if (cover) {
                return {
                    coverImageId: cover.id,
                    coverImageUrl: getGalleryImageDisplayUrl(cover),
                    coverImageAlt: cover.visualSummary,
                };
            }
        } catch {
            // Keep trying the next compatible char id.
        }
    }
    return {};
}

const EmptyState: React.FC = () => (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[8px] bg-[#efe0c8] text-[#82572e] shadow-inner">
            <Books className="h-8 w-8" weight="fill" />
        </div>
        <h2 className="text-lg font-black text-[#32251c]">典藏馆还空着</h2>
        <p className="mt-2 max-w-xs text-[13px] leading-6 text-[#8b725d]">
            去主聊天打开番外篇或谈心阅读器，点侧边收藏按钮，就会在这里为对应角色添一本小书。
        </p>
    </div>
);

const CollectionHallApp: React.FC = () => {
    const { characters, openApp, addToast } = useOS();
    const [books, setBooks] = useState<CollectionBook[]>([]);
    const [selectedBook, setSelectedBook] = useState<CollectionBook | null>(null);
    const [forwardTargetCharId, setForwardTargetCharId] = useState('');
    const [busyBookId, setBusyBookId] = useState<string | null>(null);

    const charById = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);

    const loadBooks = useCallback(async () => {
        const next = await DB.getAllCollectionBooks();
        setBooks(next);
    }, []);

    useEffect(() => {
        void loadBooks();
    }, [loadBooks]);

    useEffect(() => {
        if (!selectedBook) return;
        setForwardTargetCharId(selectedBook.charId);
    }, [selectedBook]);

    const shelves = useMemo(() => {
        const byChar = new Map<string, CollectionBook[]>();
        for (const book of books) {
            const list = byChar.get(book.charId) || [];
            list.push(book);
            byChar.set(book.charId, list);
        }
        const orderedIds = [
            ...characters.map(char => char.id).filter(id => byChar.has(id)),
            ...Array.from(byChar.keys()).filter(id => !charById.has(id)),
        ];
        return orderedIds.map(charId => ({
            charId,
            character: charById.get(charId),
            books: (byChar.get(charId) || []).sort((a, b) => b.collectedAt - a.collectedAt),
        }));
    }, [books, charById, characters]);

    const handleDeleteSelected = useCallback(async () => {
        if (!selectedBook || busyBookId) return;
        setBusyBookId(selectedBook.id);
        try {
            await DB.deleteCollectionBook(selectedBook.id);
            setSelectedBook(null);
            await loadBooks();
            addToast('已从典藏馆删除', 'success');
        } catch (error) {
            console.error('[CollectionHall] delete failed:', error);
            addToast('删除失败，可以稍后再试', 'error');
        } finally {
            setBusyBookId(null);
        }
    }, [addToast, busyBookId, loadBooks, selectedBook]);

    const handleForwardSelected = useCallback(async () => {
        if (!selectedBook || busyBookId) return;
        const targetCharId = forwardTargetCharId || selectedBook.charId;
        const targetChar = characters.find(char => char.id === targetCharId);
        const sourceChar = charById.get(selectedBook.charId);
        setBusyBookId(selectedBook.id);
        try {
            const cover = await resolveCollectionForwardCover(selectedBook, targetCharId);
            const payload: CollectionForwardPayload = buildCollectionForwardPayload(selectedBook, {
                charName: sourceChar?.name || '角色',
                charAvatar: sourceChar?.avatar || targetChar?.avatar,
                targetCharId,
                ...cover,
            });
            const messageId = await DB.saveMessage({
                charId: targetCharId,
                role: 'user',
                type: 'collection_forward',
                content: JSON.stringify(payload),
                metadata: {
                    source: 'collection_hall',
                    collectionForward: payload,
                },
            });
            addToast(`已转递给 ${targetChar?.name || '角色'}`, 'success');
            setSelectedBook(null);
            openApp(AppID.Chat, {
                targetCharId,
                targetMessageId: messageId,
                targetRequestId: `collection-${Date.now()}`,
            });
        } catch (error) {
            console.error('[CollectionHall] forward failed:', error);
            addToast('转递失败，可以稍后再试', 'error');
        } finally {
            setBusyBookId(null);
        }
    }, [addToast, busyBookId, characters, charById, forwardTargetCharId, openApp, selectedBook]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#f7efe3] text-[#30231a]">
            <header className="shrink-0 border-b border-[#e3d0b7] bg-[#fff9ef]/90 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#3f2d22] text-[#ffe3b5] shadow-inner">
                        <BookOpenText className="h-6 w-6" weight="bold" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-[22px] font-black tracking-wide text-[#30231a]">典藏馆</h1>
                        <p className="mt-0.5 text-[12px] text-[#8b725d]">{books.length} 本收藏 · 随本地/云备份迁移</p>
                    </div>
                </div>
            </header>

            {books.length === 0 ? (
                <EmptyState />
            ) : (
                <main className="flex-1 overflow-y-auto px-4 py-4">
                    <div className="space-y-6 pb-8">
                        {shelves.map(shelf => (
                            <section key={shelf.charId} className="relative">
                                <div className="mb-2 flex items-center gap-3 px-1">
                                    <img
                                        src={shelf.character?.avatar || ''}
                                        alt=""
                                        className="h-9 w-9 rounded-[6px] bg-[#decbb0] object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <h2 className="truncate text-[15px] font-extrabold text-[#352418]">{shelf.character?.name || '已删除角色'}</h2>
                                        <p className="text-[11px] text-[#8b725d]">{shelf.books.length} 本</p>
                                    </div>
                                </div>
                                <div className="relative overflow-x-auto px-2 pb-4 pt-2">
                                    <div className="flex min-h-[138px] items-end gap-2">
                                        {shelf.books.map(book => {
                                            const [dark, mid, light] = colorForBook(book);
                                            const height = 112 + ((book.title.length + book.id.length) % 4) * 8;
                                            return (
                                                <button
                                                    key={book.id}
                                                    type="button"
                                                    className="group relative flex w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-t-[5px] border border-black/10 shadow-[6px_10px_18px_-14px_rgba(45,28,14,0.8)] transition-transform active:scale-95"
                                                    style={{
                                                        height,
                                                        background: `linear-gradient(90deg, ${dark}, ${mid} 45%, ${dark})`,
                                                    }}
                                                    title={book.title}
                                                    onClick={() => setSelectedBook(book)}
                                                >
                                                    <span
                                                        className="max-h-[96px] max-w-[120px] overflow-hidden text-[12px] font-black leading-none text-white/95 drop-shadow"
                                                        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                                                    >
                                                        {book.title}
                                                    </span>
                                                    <span className="absolute bottom-0 left-0 right-0 h-2" style={{ backgroundColor: light }} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="h-4 rounded-b-[6px] bg-gradient-to-b from-[#7a5432] to-[#4c3320] shadow-[0_12px_24px_-18px_rgba(28,16,8,0.95)]" />
                                </div>
                            </section>
                        ))}
                    </div>
                </main>
            )}

            {selectedBook && (
                <AfterglowReaderModal
                    data={selectedBook.cardData}
                    brand={formatCollectionKindLabel(selectedBook.kind)}
                    onClose={() => setSelectedBook(null)}
                    extraActions={
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <select
                                className="h-8 w-32 rounded-full border border-[#d9bea0] bg-[#fffaf2] px-2 text-[11px] font-bold text-[#6a3f1f] outline-none"
                                value={forwardTargetCharId || selectedBook.charId}
                                onChange={(event) => setForwardTargetCharId(event.target.value)}
                            >
                                {characters.map(char => (
                                    <option key={char.id} value={char.id}>{char.name}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="afterglow-reader-action"
                                disabled={busyBookId === selectedBook.id}
                                onClick={handleForwardSelected}
                            >
                                <ArrowRight className="h-4 w-4" weight="bold" />
                                <span>转递</span>
                            </button>
                            <button
                                type="button"
                                className="afterglow-reader-action"
                                disabled={busyBookId === selectedBook.id}
                                onClick={handleDeleteSelected}
                            >
                                <Trash className="h-4 w-4" weight="bold" />
                                <span>删除</span>
                            </button>
                        </div>
                    }
                />
            )}
        </div>
    );
};

export default CollectionHallApp;
