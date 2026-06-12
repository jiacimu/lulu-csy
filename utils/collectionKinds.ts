import type { CollectionBook, CollectionBookKind } from '../types';

export type CollectionShelfKind = 'bookshelf' | 'vanity' | 'walls';

export interface CollectionKindMeta {
    label: string;
    shelf: CollectionShelfKind;
    emptyText: string;
    forwardLabel: (book: CollectionBook) => string;
}

export const KIND_META: Record<CollectionBookKind, CollectionKindMeta> = {
    afterglow: {
        label: '番外篇',
        shelf: 'bookshelf',
        emptyText: '还没有收藏任何番外',
        forwardLabel: (book) => book.customTitle || book.title || '番外篇',
    },
    heart_talk: {
        label: '谈心',
        shelf: 'vanity',
        emptyText: '还没有收下任何谈心',
        forwardLabel: (book) => book.customTitle || book.title || '谈心',
    },
    freeform: {
        label: '视觉碎片',
        shelf: 'walls',
        emptyText: '还没有收下任何碎片',
        forwardLabel: (book) => book.meta?.name || book.meta?.shape || book.customTitle || book.title || '视觉碎片',
    },
};

export function getCollectionKindMeta(kind: CollectionBookKind): CollectionKindMeta {
    return KIND_META[kind] || KIND_META.afterglow;
}

export function formatCollectionKindLabel(kind: CollectionBookKind): string {
    return getCollectionKindMeta(kind).label;
}
