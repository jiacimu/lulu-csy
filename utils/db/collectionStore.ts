import type { CollectionBook, CollectionBookInput, CollectionSourceQuery } from '../../types';
import {
    buildCollectionDefaultTitle,
    extractCollectionTags,
    extractCollectionTitle,
    inferCollectionBookKind,
    normalizeCollectionCustomTitle,
} from '../collectionBooks';
import { openDB, STORE_COLLECTION_BOOKS, STORE_COLLECTION_WALL_ITEMS } from './core';

const createCollectionBookId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `colbook-${crypto.randomUUID()}`;
    }
    return `colbook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeBodyForDedup = (body: string): string => String(body || '').trim();

const sortNewestFirst = (books: CollectionBook[]): CollectionBook[] =>
    books.sort((a, b) => (b.collectedAt || b.createdAt || 0) - (a.collectedAt || a.createdAt || 0));

const getStore = async (mode: IDBTransactionMode) => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return null;
    const tx = db.transaction(STORE_COLLECTION_BOOKS, mode);
    return { tx, store: tx.objectStore(STORE_COLLECTION_BOOKS) };
};

const normalizeCollectionBookInput = (input: CollectionBookInput): CollectionBookInput => {
    if (input.kind !== 'freeform' || !input.cardData) return input;
    const inferredKind = inferCollectionBookKind(input.cardData);
    if (inferredKind === 'freeform') return input;
    const timestamp = input.sourceMessageTimestamp || input.collectedAt || input.createdAt;
    return {
        ...input,
        kind: inferredKind,
        title: extractCollectionTitle(input.cardData, inferredKind, timestamp),
        tags: extractCollectionTags(input.cardData),
        cover: input.cardData.meta?.afterglowCover,
        contentHash: undefined,
    };
};

const normalizeStoredCollectionBook = (book: CollectionBook): CollectionBook => {
    const normalized = normalizeCollectionBookInput(book);
    if (normalized === book) return book;
    return {
        ...book,
        ...normalized,
        id: book.id,
        body: normalizeBodyForDedup(normalized.body),
        createdAt: book.createdAt,
        collectedAt: book.collectedAt,
    };
};

const persistNormalizedCollectionBook = async (book: CollectionBook): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return;
    const stores = db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)
        ? [STORE_COLLECTION_BOOKS, STORE_COLLECTION_WALL_ITEMS]
        : [STORE_COLLECTION_BOOKS];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore(STORE_COLLECTION_BOOKS).put(book);

        if (book.kind !== 'freeform' && stores.includes(STORE_COLLECTION_WALL_ITEMS)) {
            const itemStore = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
            if (itemStore.indexNames.contains('bookId')) {
                const cursorRequest = itemStore.index('bookId').openCursor(IDBKeyRange.only(book.id));
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
            }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const normalizeStoredCollectionBooks = async (books: CollectionBook[]): Promise<CollectionBook[]> => {
    const normalized = books.map(normalizeStoredCollectionBook);
    const changed = normalized.filter((book, index) => book !== books[index]);
    if (changed.length > 0) {
        await Promise.all(changed.map(book => persistNormalizedCollectionBook(book)));
    }
    return sortNewestFirst(normalized);
};

export const getAllCollectionBooks = async (): Promise<CollectionBook[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return [];
    const books = await new Promise<CollectionBook[]>((resolve, reject) => {
        const request = db.transaction(STORE_COLLECTION_BOOKS, 'readonly').objectStore(STORE_COLLECTION_BOOKS).getAll();
        request.onsuccess = () => resolve((request.result || []) as CollectionBook[]);
        request.onerror = () => reject(request.error);
    });
    return normalizeStoredCollectionBooks(books);
};

export const getCollectionBooksByCharId = async (charId: string): Promise<CollectionBook[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return [];
    const books = await new Promise<CollectionBook[]>((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_BOOKS, 'readonly');
        const index = tx.objectStore(STORE_COLLECTION_BOOKS).index('charId');
        const request = index.getAll(charId);
        request.onsuccess = () => resolve((request.result || []) as CollectionBook[]);
        request.onerror = () => reject(request.error);
    });
    return normalizeStoredCollectionBooks(books);
};

export const getCollectionBookById = async (id: string): Promise<CollectionBook | null> => {
    const opened = await getStore('readonly');
    if (!opened) return null;
    const book = await new Promise<CollectionBook | null>((resolve, reject) => {
        const request = opened.store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    if (!book) return null;
    const normalized = normalizeStoredCollectionBook(book);
    if (normalized !== book) await persistNormalizedCollectionBook(normalized);
    return normalized;
};

export const findCollectionBookBySource = async (query: CollectionSourceQuery): Promise<CollectionBook | null> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return null;
    const body = normalizeBodyForDedup(query.body);
    const contentHash = query.contentHash || '';
    const readCandidates = async (request: IDBRequest<CollectionBook[]>): Promise<CollectionBook[]> =>
        new Promise((resolve, reject) => {
            request.onsuccess = () => resolve((request.result || []) as CollectionBook[]);
            request.onerror = () => reject(request.error);
        });

    const findMatch = (books: CollectionBook[]): CollectionBook | null => {
        const matches = books.filter(book => (
            book.kind === query.kind
            && (
                query.kind === 'freeform' && query.contentHash
                    ? book.contentHash === query.contentHash
                    : normalizeBodyForDedup(book.body) === body
            )
            && (
                query.kind === 'freeform' && query.contentHash
                    ? true
                    : typeof query.sourceMessageId !== 'number' || book.sourceMessageId === query.sourceMessageId
            )
        ));
        return sortNewestFirst(matches)[0] || null;
    };

    const candidates = await new Promise<CollectionBook[]>((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_BOOKS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_BOOKS);
        const canQueryContentHash = query.kind === 'freeform'
            && Boolean(contentHash)
            && store.indexNames.contains('charKindContentHash');
        const request = canQueryContentHash
            ? store.index('charKindContentHash').getAll([query.charId, query.kind, contentHash])
            : typeof query.sourceMessageId === 'number' && store.indexNames.contains('charKindSourceMessage')
                ? store.index('charKindSourceMessage').getAll([query.charId, query.kind, query.sourceMessageId])
                : store.index('charId').getAll(query.charId);
        void readCandidates(request).then(resolve, reject);
    });
    const normalizedCandidates = await normalizeStoredCollectionBooks(candidates);
    const directMatch = findMatch(normalizedCandidates);
    if (directMatch || query.kind === 'freeform') return directMatch;

    const fallbackBooks = await new Promise<CollectionBook[]>((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_BOOKS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_BOOKS);
        const request = store.index('charId').getAll(query.charId);
        void readCandidates(request).then(resolve, reject);
    });
    return findMatch(await normalizeStoredCollectionBooks(fallbackBooks));
};

export const isCollectionSourceCollected = async (query: CollectionSourceQuery): Promise<boolean> =>
    Boolean(await findCollectionBookBySource(query));

export const saveCollectionBook = async (input: CollectionBookInput): Promise<CollectionBook> => {
    const normalizedInput = normalizeCollectionBookInput(input);
    const duplicate = await findCollectionBookBySource({
        charId: normalizedInput.charId,
        kind: normalizedInput.kind,
        sourceMessageId: normalizedInput.sourceMessageId,
        contentHash: normalizedInput.contentHash,
        body: normalizedInput.body,
    });
    if (duplicate) return duplicate;

    const now = Date.now();
    const normalizedCustomTitle = normalizeCollectionCustomTitle(normalizedInput.customTitle);
    const record: CollectionBook = {
        ...normalizedInput,
        id: normalizedInput.id || createCollectionBookId(),
        title: normalizedInput.title.trim() || buildCollectionDefaultTitle(normalizedInput.kind, normalizedInput.sourceMessageTimestamp || normalizedInput.collectedAt || normalizedInput.createdAt),
        customTitle: normalizedCustomTitle,
        customTitleUpdatedAt: normalizedCustomTitle ? normalizedInput.customTitleUpdatedAt || now : undefined,
        body: normalizeBodyForDedup(normalizedInput.body),
        tags: Array.isArray(normalizedInput.tags) ? normalizedInput.tags.filter(Boolean) : [],
        createdAt: normalizedInput.createdAt || now,
        collectedAt: normalizedInput.collectedAt || now,
    };

    const opened = await getStore('readwrite');
    if (!opened) return record;
    return new Promise((resolve, reject) => {
        opened.store.put(record);
        opened.tx.oncomplete = () => resolve(record);
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const updateCollectionBookTitle = async (id: string, customTitle?: string): Promise<CollectionBook | null> => {
    const existing = await getCollectionBookById(id);
    if (!existing) return null;

    const normalizedTitle = normalizeCollectionCustomTitle(customTitle);
    const next: CollectionBook = {
        ...existing,
        customTitle: normalizedTitle,
        customTitleUpdatedAt: normalizedTitle ? Date.now() : undefined,
    };
    if (!normalizedTitle) {
        delete next.customTitle;
        delete next.customTitleUpdatedAt;
    }

    const opened = await getStore('readwrite');
    if (!opened) return next;
    return new Promise((resolve, reject) => {
        opened.store.put(next);
        opened.tx.oncomplete = () => resolve(next);
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const deleteCollectionBook = async (id: string): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return;
    const stores = db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)
        ? [STORE_COLLECTION_BOOKS, STORE_COLLECTION_WALL_ITEMS]
        : [STORE_COLLECTION_BOOKS];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore(STORE_COLLECTION_BOOKS).delete(id);

        if (stores.includes(STORE_COLLECTION_WALL_ITEMS)) {
            const itemStore = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
            if (itemStore.indexNames.contains('bookId')) {
                const cursorRequest = itemStore.index('bookId').openCursor(IDBKeyRange.only(id));
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
            }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteCollectionBookBySource = async (query: CollectionSourceQuery): Promise<CollectionBook | null> => {
    const existing = await findCollectionBookBySource(query);
    if (!existing) return null;
    await deleteCollectionBook(existing.id);
    return existing;
};
