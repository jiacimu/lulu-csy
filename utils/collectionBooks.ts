import type { CollectionBook, CollectionBookInput, CollectionForwardPayload, CollectionBookKind, Message } from '../types';
import type { StatusCardData } from '../types/statusCard';

const TITLE_FALLBACK: Record<CollectionBookKind, string> = {
    afterglow: '未命名番外',
    heart_talk: '未命名谈心',
};

const CUSTOM_TITLE_MAX_LENGTH = 32;

export function formatCollectionKindLabel(kind: CollectionBookKind): string {
    return kind === 'heart_talk' ? '谈心' : '番外篇';
}

export function inferCollectionBookKind(cardData: StatusCardData): CollectionBookKind {
    const mode = String(cardData.meta?.afterglowMode || cardData.meta?.mode || '').toLowerCase();
    return mode === 'hearttalk' || mode === 'heart_talk' ? 'heart_talk' : 'afterglow';
}

export function normalizeCollectionCustomTitle(value?: string): string | undefined {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, CUSTOM_TITLE_MAX_LENGTH) : undefined;
}

function isValidTimestamp(timestamp?: number): timestamp is number {
    return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;
}

function formatDatePart(timestamp?: number): string {
    if (!isValidTimestamp(timestamp)) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

export function formatCollectionMinuteTitle(timestamp?: number): string {
    if (!isValidTimestamp(timestamp)) return TITLE_FALLBACK.heart_talk;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return TITLE_FALLBACK.heart_talk;
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const datePart = formatDatePart(timestamp);
    return datePart ? `${datePart} ${time}` : time;
}

export function buildCollectionDefaultTitle(kind: CollectionBookKind, timestamp?: number): string {
    if (kind === 'heart_talk') return formatCollectionMinuteTitle(timestamp);
    const datePart = formatDatePart(timestamp);
    return datePart ? `${datePart}的番外` : TITLE_FALLBACK.afterglow;
}

export function extractCollectionTitle(
    cardData: StatusCardData,
    kind: CollectionBookKind = inferCollectionBookKind(cardData),
    timestamp?: number,
): string {
    if (kind === 'heart_talk') return buildCollectionDefaultTitle(kind, timestamp);

    const explicitTitle = String(cardData.title || '').trim();
    if (explicitTitle && explicitTitle !== '番外篇') return explicitTitle.slice(0, 40);

    const body = String(cardData.body || '');
    const bookTitle = body.match(/《\s*([^《》\n]{1,40})\s*》/)?.[1]?.trim();
    if (bookTitle) return bookTitle;

    return buildCollectionDefaultTitle(kind, timestamp);
}

export function getCollectionDisplayTitle(book: CollectionBook): string {
    const customTitle = normalizeCollectionCustomTitle(book.customTitle);
    if (customTitle) return customTitle;

    const timestamp = book.sourceMessageTimestamp || book.collectedAt || book.createdAt;
    if (book.kind === 'heart_talk') return buildCollectionDefaultTitle(book.kind, timestamp);

    const title = String(book.title || '').trim();
    return title && title !== TITLE_FALLBACK.afterglow
        ? title.slice(0, 40)
        : buildCollectionDefaultTitle(book.kind, timestamp);
}

export function buildCollectionExcerpt(value: string, maxLength = 92): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function hashCollectionBody(body: string): string {
    let hash = 2166136261;
    const text = String(body || '').trim();
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function buildCollectionSourceKey(query: {
    charId: string;
    kind: CollectionBookKind;
    sourceMessageId?: number;
    body: string;
}): string {
    return [
        query.charId,
        query.kind,
        typeof query.sourceMessageId === 'number' ? query.sourceMessageId : 'no-source',
        hashCollectionBody(query.body),
    ].join('::');
}

export function extractCollectionTags(cardData: StatusCardData): string[] {
    const rawTags = cardData.meta?.afterglowTags || cardData.meta?.afterglowCover?.tags || [];
    if (!Array.isArray(rawTags)) return [];
    return rawTags
        .map(tag => String(tag || '').trim())
        .filter((tag, index, list) => tag && list.indexOf(tag) === index)
        .slice(0, 8);
}

export function buildCollectionBookInput(
    charId: string,
    cardData: StatusCardData,
    sourceMessage?: Message,
): CollectionBookInput {
    const kind = inferCollectionBookKind(cardData);
    const timestamp = sourceMessage?.timestamp;
    return {
        charId,
        kind,
        title: extractCollectionTitle(cardData, kind, timestamp),
        body: String(cardData.body || '').trim(),
        cardData,
        sourceMessageId: sourceMessage?.id,
        sourceMessageTimestamp: timestamp,
        sourceReplyExcerpt: sourceMessage ? buildCollectionExcerpt(sourceMessage.content, 120) : undefined,
        tags: extractCollectionTags(cardData),
        cover: cardData.meta?.afterglowCover,
    };
}

export function buildCollectionForwardPayload(
    book: CollectionBook,
    options: { charName?: string; charAvatar?: string; targetCharId?: string; coverImageId?: string; coverImageUrl?: string; coverImageAlt?: string } = {},
): CollectionForwardPayload {
    return {
        bookId: book.id,
        charId: book.charId,
        charName: options.charName,
        charAvatar: options.charAvatar,
        targetCharId: options.targetCharId,
        kind: book.kind,
        title: getCollectionDisplayTitle(book),
        body: book.body,
        excerpt: buildCollectionExcerpt(book.body, 120),
        tags: book.tags,
        cover: book.cover,
        coverImageId: options.coverImageId,
        coverImageUrl: options.coverImageUrl,
        coverImageAlt: options.coverImageAlt,
        collectedAt: book.collectedAt,
        sourceMessageId: book.sourceMessageId,
        sourceMessageTimestamp: book.sourceMessageTimestamp,
        sourceReplyExcerpt: book.sourceReplyExcerpt,
    };
}
