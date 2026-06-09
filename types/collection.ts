import type { StatusCardData } from './statusCard';

export type CollectionBookKind = 'afterglow' | 'heart_talk';

export interface CollectionBook {
    id: string;
    charId: string;
    kind: CollectionBookKind;
    title: string;
    body: string;
    cardData: StatusCardData;
    sourceMessageId?: number;
    sourceMessageTimestamp?: number;
    sourceReplyExcerpt?: string;
    tags: string[];
    cover?: unknown;
    createdAt: number;
    collectedAt: number;
}

export type CollectionBookInput = Omit<CollectionBook, 'id' | 'createdAt' | 'collectedAt'> & {
    id?: string;
    createdAt?: number;
    collectedAt?: number;
};

export interface CollectionSourceQuery {
    charId: string;
    kind: CollectionBookKind;
    sourceMessageId?: number;
    body: string;
}

export interface CollectionForwardPayload {
    bookId: string;
    charId: string;
    charName?: string;
    charAvatar?: string;
    targetCharId?: string;
    kind: CollectionBookKind;
    title: string;
    body: string;
    excerpt?: string;
    tags?: string[];
    cover?: unknown;
    coverImageId?: string;
    coverImageUrl?: string;
    coverImageAlt?: string;
    collectedAt: number;
    sourceMessageId?: number;
    sourceMessageTimestamp?: number;
    sourceReplyExcerpt?: string;
}
