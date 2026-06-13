import type { StatusCardData } from './statusCard';

export type CollectionBookKind = 'afterglow' | 'heart_talk' | 'freeform';

export interface CollectionBookMeta {
    html?: string;
    shape?: string;
    candidates?: string[];
    summary?: string;
    name?: string;
    sourceMessageId?: number | null;
}

export interface CollectionBook {
    id: string;
    charId: string;
    kind: CollectionBookKind;
    title: string;
    customTitle?: string;
    customTitleUpdatedAt?: number;
    body: string;
    cardData: StatusCardData;
    sourceMessageId?: number;
    sourceMessageTimestamp?: number;
    sourceReplyExcerpt?: string;
    tags: string[];
    cover?: unknown;
    contentHash?: string;
    meta?: CollectionBookMeta;
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
    contentHash?: string;
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

export type CollectionWallLayoutMode = 'flow' | 'free';
export type CollectionWallBackgroundType = 'color' | 'preset' | 'asset';
export type CollectionWallBackgroundFit = 'cover' | 'tile';

export interface CollectionWallBackground {
    type: CollectionWallBackgroundType;
    value: string;
    fit: CollectionWallBackgroundFit;
    dim: number;
}

export interface CollectionWall {
    id: string;
    charId: string;
    name: string;
    isDefault: boolean;
    layoutMode: CollectionWallLayoutMode;
    background: CollectionWallBackground;
    allowCharDecorate: boolean;
    changeCountSinceVisit: number;
    charLastVisitManifest?: string;
    charLastVisitAt?: number;
    charRemarks?: { text: string; ts: number }[];
    hasUnseenCharItem: boolean;
    defaultBondWidgetHidden?: boolean;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
}

export type CollectionWallItemType = 'card' | 'image' | 'sticker' | 'text' | 'bond' | 'html';
export type CollectionWallItemAuthor = 'user' | 'char';
export type CollectionWallTextPreset = 'sticky_note' | 'big_plain' | 'typewriter' | 'handwriting' | 'char_note';
export type CollectionWallRemarkTemplate = 'ticket' | 'pol' | 'card' | 'letter' | 'receipt';

export interface CollectionWallTextData {
    content: string;
    preset: CollectionWallTextPreset;
    color?: string;
    stroke?: boolean;
    fontAssetId?: string;
    fontFamily?: string;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    remarkTemplate?: CollectionWallRemarkTemplate;
}

export interface CollectionWallBondData {
    variant?: 'default';
    avatarFrame?: string;
}

export interface CollectionWallItem {
    id: string;
    wallId: string;
    type: CollectionWallItemType;
    author: CollectionWallItemAuthor;
    x: number | null;
    y: number | null;
    w: number;
    h: number;
    rotation: number;
    z: number;
    order: number;
    bookId?: string;
    assetId?: string;
    html?: string;
    text?: CollectionWallTextData;
    bond?: CollectionWallBondData;
    name?: string;
    createdAt: number;
}

export type CollectionWallAssetOrigin = 'upload' | 'chat_gen' | 'char';

export interface CollectionWallAssetMeta {
    assetKind?: 'image' | 'font' | 'char_invite_avatar';
    prompt?: string;
    sourceMessageId?: number | string;
    name?: string;
    charId?: string;
    uploadedFileName?: string;
    hasTransparency?: boolean;
    hiddenFromLibrary?: boolean;
}

export interface CollectionWallAsset {
    id: string;
    blob: Blob;
    mime: string;
    width?: number;
    height?: number;
    bytes: number;
    hash: string;
    origin: CollectionWallAssetOrigin;
    meta?: CollectionWallAssetMeta;
    createdAt: number;
}

export type SerializedCollectionWallAsset = Omit<CollectionWallAsset, 'blob'> & {
    dataUrl?: string;
};
