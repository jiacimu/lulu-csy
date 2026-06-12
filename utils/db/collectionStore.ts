import type { CollectionBook, CollectionBookInput, CollectionSourceQuery } from '../../types';
import { buildCollectionDefaultTitle, normalizeCollectionCustomTitle } from '../collectionBooks';
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

export const getAllCollectionBooks = async (): Promise<CollectionBook[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return [];
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_COLLECTION_BOOKS, 'readonly').objectStore(STORE_COLLECTION_BOOKS).getAll();
        request.onsuccess = () => resolve(sortNewestFirst((request.result || []) as CollectionBook[]));
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionBooksByCharId = async (charId: string): Promise<CollectionBook[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_BOOKS, 'readonly');
        const index = tx.objectStore(STORE_COLLECTION_BOOKS).index('charId');
        const request = index.getAll(charId);
        request.onsuccess = () => resolve(sortNewestFirst((request.result || []) as CollectionBook[]));
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionBookById = async (id: string): Promise<CollectionBook | null> => {
    const opened = await getStore('readonly');
    if (!opened) return null;
    return new Promise((resolve, reject) => {
        const request = opened.store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
};

export const findCollectionBookBySource = async (query: CollectionSourceQuery): Promise<CollectionBook | null> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_BOOKS)) return null;
    const body = normalizeBodyForDedup(query.body);
    const contentHash = query.contentHash || '';
    return new Promise((resolve, reject) => {
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
        request.onsuccess = () => {
            const matches = ((request.result || []) as CollectionBook[]).filter(book => (
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
            resolve(sortNewestFirst(matches)[0] || null);
        };
        request.onerror = () => reject(request.error);
    });
};

export const isCollectionSourceCollected = async (query: CollectionSourceQuery): Promise<boolean> =>
    Boolean(await findCollectionBookBySource(query));

export const saveCollectionBook = async (input: CollectionBookInput): Promise<CollectionBook> => {
    const duplicate = await findCollectionBookBySource({
        charId: input.charId,
        kind: input.kind,
        sourceMessageId: input.sourceMessageId,
        contentHash: input.contentHash,
        body: input.body,
    });
    if (duplicate) return duplicate;

    const now = Date.now();
    const normalizedCustomTitle = normalizeCollectionCustomTitle(input.customTitle);
    const record: CollectionBook = {
        ...input,
        id: input.id || createCollectionBookId(),
        title: input.title.trim() || buildCollectionDefaultTitle(input.kind, input.sourceMessageTimestamp || input.collectedAt || input.createdAt),
        customTitle: normalizedCustomTitle,
        customTitleUpdatedAt: normalizedCustomTitle ? input.customTitleUpdatedAt || now : undefined,
        body: normalizeBodyForDedup(input.body),
        tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
        createdAt: input.createdAt || now,
        collectedAt: input.collectedAt || now,
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
