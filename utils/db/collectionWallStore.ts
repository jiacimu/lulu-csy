import type {
    CollectionBook,
    CollectionWall,
    CollectionWallAsset,
    CollectionWallItem,
} from '../../types';
import {
    openDB,
    STORE_COLLECTION_WALL_ASSETS,
    STORE_COLLECTION_WALL_ITEMS,
    STORE_COLLECTION_WALLS,
} from './core';

export type CollectionWallInput = Omit<CollectionWall, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
};

export type CollectionWallItemInput = Omit<CollectionWallItem, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
};

export type CollectionWallAssetInput = Omit<CollectionWallAsset, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
};

const DEFAULT_WALL_NAME = '未分类';

const createId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeWallName = (name: string | undefined, fallback = DEFAULT_WALL_NAME): string => {
    const normalized = String(name || '').replace(/\s+/g, ' ').trim();
    return (normalized || fallback).slice(0, 12);
};

const sortWalls = (walls: CollectionWall[]): CollectionWall[] =>
    walls.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));

const sortItems = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.sort((a, b) => (
        (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0)
        || (a.createdAt || 0) - (b.createdAt || 0)
        || String(a.id || '').localeCompare(String(b.id || ''))
    ));

const sortAssets = (assets: CollectionWallAsset[]): CollectionWallAsset[] =>
    assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

let collectionWallSnapshotDebugSeq = 0;

const summarizeCollectionWallError = (error: unknown) => {
    const err = error as { name?: string; message?: string; code?: number } | null | undefined;
    return {
        name: err?.name || (error instanceof Error ? error.name : typeof error),
        message: err?.message || String(error || ''),
        code: err?.code,
    };
};

const debugCollectionWallItems = (phase: string, wallId: string, items: CollectionWallItem[]): void => {
    console.info(`[CollectionWallDebug] ${phase}`, {
        wallId,
        items: items.map((item, index) => ({
            index,
            id: item.id,
            x: item.x,
            y: item.y,
            z: item.z,
            order: item.order,
        })),
    });
};

const debugCollectionWallSnapshot = (
    phase: string,
    seq: number,
    wallId: string,
    items: CollectionWallItem[],
    extra: Record<string, unknown> = {},
): void => {
    console.info(`[CollectionWallDebug] snapshot-${phase}`, {
        seq,
        wallId,
        itemCount: items.length,
        head: items.slice(0, 8).map((item, index) => ({
            index,
            id: item.id,
            order: item.order,
            z: item.z,
            x: item.x,
            y: item.y,
        })),
        ...extra,
    });
};

const normalizeCollectionWallRecord = (input: CollectionWallInput, now = Date.now()): CollectionWall => ({
    ...input,
    id: input.id || createId('wall'),
    name: normalizeWallName(input.name),
    background: input.background || { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
    layoutMode: input.layoutMode || 'free',
    allowCharDecorate: input.allowCharDecorate !== false,
    changeCountSinceVisit: Number.isFinite(input.changeCountSinceVisit) ? input.changeCountSinceVisit : 0,
    charRemarks: Array.isArray(input.charRemarks)
        ? input.charRemarks
            .filter(remark => remark && typeof remark.text === 'string' && remark.text.trim())
            .map(remark => ({ text: remark.text.trim().slice(0, 300), ts: Number.isFinite(remark.ts) ? remark.ts : now }))
            .slice(-30)
        : [],
    hasUnseenCharItem: Boolean(input.hasUnseenCharItem),
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    isDefault: Boolean(input.isDefault),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
});

const normalizeCollectionWallItemRecord = (
    input: CollectionWallItemInput,
    wallId = input.wallId,
    now = Date.now(),
): CollectionWallItem => ({
    ...input,
    id: input.id || createId('wallitem'),
    wallId,
    x: typeof input.x === 'number' ? input.x : null,
    y: typeof input.y === 'number' ? input.y : null,
    w: Number.isFinite(input.w) ? input.w : 375,
    h: Number.isFinite(input.h) ? input.h : 360,
    rotation: Number.isFinite(input.rotation) ? input.rotation : 0,
    z: Number.isFinite(input.z) ? input.z : 0,
    order: Number.isFinite(input.order) ? input.order : 0,
    createdAt: input.createdAt || now,
});

const getStore = async (storeName: string, mode: IDBTransactionMode) => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return null;
    const tx = db.transaction(storeName, mode);
    return { tx, store: tx.objectStore(storeName) };
};

const getAllCollectionWallItems = async (): Promise<CollectionWallItem[]> => {
    const opened = await getStore(STORE_COLLECTION_WALL_ITEMS, 'readonly');
    if (!opened) return [];
    return new Promise((resolve, reject) => {
        const request = opened.store.getAll();
        request.onsuccess = () => resolve(sortItems((request.result || []) as CollectionWallItem[]));
        request.onerror = () => reject(request.error);
    });
};

export const getAllCollectionWalls = async (): Promise<CollectionWall[]> => {
    const opened = await getStore(STORE_COLLECTION_WALLS, 'readonly');
    if (!opened) return [];
    return new Promise((resolve, reject) => {
        const request = opened.store.getAll();
        request.onsuccess = () => resolve(sortWalls((request.result || []) as CollectionWall[]));
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionWallsByCharId = async (charId: string): Promise<CollectionWall[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALLS)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_WALLS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_WALLS);
        const request = store.indexNames.contains('charId')
            ? store.index('charId').getAll(charId)
            : store.getAll();
        request.onsuccess = () => {
            const walls = ((request.result || []) as CollectionWall[])
                .filter(wall => wall.charId === charId);
            resolve(sortWalls(walls));
        };
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionWallById = async (id: string): Promise<CollectionWall | null> => {
    const opened = await getStore(STORE_COLLECTION_WALLS, 'readonly');
    if (!opened) return null;
    return new Promise((resolve, reject) => {
        const request = opened.store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
};

export const saveCollectionWall = async (input: CollectionWallInput): Promise<CollectionWall> => {
    const now = Date.now();
    const record = normalizeCollectionWallRecord(input, now);

    const opened = await getStore(STORE_COLLECTION_WALLS, 'readwrite');
    if (!opened) return record;
    return new Promise((resolve, reject) => {
        opened.store.put(record);
        opened.tx.oncomplete = () => resolve(record);
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const getOrCreateDefaultCollectionWall = async (charId: string): Promise<CollectionWall> => {
    const walls = await getCollectionWallsByCharId(charId);
    const existing = walls.find(wall => wall.isDefault) || walls.find(wall => wall.name === DEFAULT_WALL_NAME);
    if (existing) return existing;

    return saveCollectionWall({
        charId,
        name: DEFAULT_WALL_NAME,
        isDefault: true,
        layoutMode: 'free',
        background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
        allowCharDecorate: true,
        changeCountSinceVisit: 0,
        hasUnseenCharItem: false,
        sortOrder: walls.length,
    });
};

export const getCollectionWallItemsByWallId = async (wallId: string): Promise<CollectionWallItem[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_WALL_ITEMS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
        const request = store.indexNames.contains('wallId')
            ? store.index('wallId').getAll(wallId)
            : store.getAll();
        request.onsuccess = () => {
            const items = ((request.result || []) as CollectionWallItem[])
                .filter(item => item.wallId === wallId);
            debugCollectionWallItems('read-raw', wallId, items);
            const sortedItems = sortItems(items);
            debugCollectionWallItems('read-return-sorted', wallId, sortedItems);
            resolve(sortedItems);
        };
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionWallItemsByBookId = async (bookId: string): Promise<CollectionWallItem[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_WALL_ITEMS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
        const request = store.indexNames.contains('bookId')
            ? store.index('bookId').getAll(bookId)
            : store.getAll();
        request.onsuccess = () => {
            const items = ((request.result || []) as CollectionWallItem[])
                .filter(item => item.bookId === bookId);
            resolve(sortItems(items));
        };
        request.onerror = () => reject(request.error);
    });
};

export const saveCollectionWallItem = async (input: CollectionWallItemInput): Promise<CollectionWallItem> => {
    const now = Date.now();
    const record = normalizeCollectionWallItemRecord(input, input.wallId, now);

    const opened = await getStore(STORE_COLLECTION_WALL_ITEMS, 'readwrite');
    if (!opened) return record;
    return new Promise((resolve, reject) => {
        opened.store.put(record);
        opened.tx.oncomplete = () => resolve(record);
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const replaceCollectionWallSnapshot = async (
    wallInput: CollectionWallInput,
    itemsInput: CollectionWallItemInput[],
): Promise<{ wall: CollectionWall; items: CollectionWallItem[] }> => {
    const seq = ++collectionWallSnapshotDebugSeq;
    let wallId = wallInput.id || '(new-wall)';

    try {
        const now = Date.now();
        const wall = normalizeCollectionWallRecord(wallInput, now);
        wallId = wall.id;
        const items = sortItems(itemsInput.map(item => normalizeCollectionWallItemRecord(item, wall.id, now)));
        debugCollectionWallSnapshot('enter', seq, wall.id, items);
        debugCollectionWallItems('write-before-put', wall.id, items);
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_COLLECTION_WALLS) || !db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)) {
            debugCollectionWallSnapshot('skipped-missing-store', seq, wall.id, items, {
                hasWallStore: db.objectStoreNames.contains(STORE_COLLECTION_WALLS),
                hasItemStore: db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS),
            });
            return { wall, items };
        }

        return await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_COLLECTION_WALLS, STORE_COLLECTION_WALL_ITEMS], 'readwrite');
            const wallStore = tx.objectStore(STORE_COLLECTION_WALLS);
            const itemStore = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
            const existingRequest = itemStore.indexNames.contains('wallId')
                ? itemStore.index('wallId').getAll(wall.id)
                : itemStore.getAll();

            existingRequest.onsuccess = () => {
                const existingItems = ((existingRequest.result || []) as CollectionWallItem[])
                    .filter(item => item.wallId === wall.id);
                console.info('[CollectionWallDebug] snapshot-delete-old', {
                    seq,
                    wallId: wall.id,
                    deleteCount: existingItems.length,
                    oldHead: existingItems.slice(0, 8).map((item, index) => ({
                        index,
                        id: item.id,
                        order: item.order,
                        z: item.z,
                    })),
                });
                existingItems.forEach(item => itemStore.delete(item.id));
                wallStore.put(wall);
                items.forEach(item => itemStore.put(item));
            };
            existingRequest.onerror = () => {
                console.error('[CollectionWallDebug] snapshot-read-existing-error', {
                    seq,
                    wallId: wall.id,
                    error: summarizeCollectionWallError(existingRequest.error),
                });
                reject(existingRequest.error);
            };
            tx.oncomplete = () => {
                debugCollectionWallSnapshot('complete', seq, wall.id, items);
                resolve({ wall, items });
            };
            tx.onerror = () => {
                console.error('[CollectionWallDebug] snapshot-tx-error', {
                    seq,
                    wallId: wall.id,
                    error: summarizeCollectionWallError(tx.error),
                });
                reject(tx.error);
            };
            tx.onabort = () => {
                console.error('[CollectionWallDebug] snapshot-tx-abort', {
                    seq,
                    wallId: wall.id,
                    error: summarizeCollectionWallError(tx.error),
                });
                reject(tx.error);
            };
        });
    } catch (error) {
        console.error('[CollectionWallDebug] snapshot-error', {
            seq,
            wallId,
            error: summarizeCollectionWallError(error),
        });
        throw error;
    }
};

export const deleteCollectionWallItem = async (id: string): Promise<void> => {
    const opened = await getStore(STORE_COLLECTION_WALL_ITEMS, 'readwrite');
    if (!opened) return;
    return new Promise((resolve, reject) => {
        opened.store.delete(id);
        opened.tx.oncomplete = () => resolve();
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const deleteCollectionWallItemsByBookId = async (bookId: string): Promise<void> => {
    const items = await getCollectionWallItemsByBookId(bookId);
    if (items.length === 0) return;

    const opened = await getStore(STORE_COLLECTION_WALL_ITEMS, 'readwrite');
    if (!opened) return;
    return new Promise((resolve, reject) => {
        items.forEach(item => opened.store.delete(item.id));
        opened.tx.oncomplete = () => resolve();
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const addCollectionBookToWall = async (book: CollectionBook, wallId: string): Promise<CollectionWallItem> => {
    const wall = await getCollectionWallById(wallId);
    if (!wall) throw new Error('Collection wall not found');

    const [wallItems, existingBookItems] = await Promise.all([
        getCollectionWallItemsByWallId(wallId),
        getCollectionWallItemsByBookId(book.id),
    ]);
    const existingInTarget = existingBookItems.find(item => item.wallId === wallId);
    if (existingInTarget) return existingInTarget;

    const now = Date.now();
    const maxZ = wallItems.reduce((max, item) => Math.max(max, item.z || 0), 0);
    const item: CollectionWallItem = {
        id: createId('wallitem'),
        wallId,
        type: 'card',
        author: 'user',
        x: null,
        y: null,
        w: 375,
        h: 360,
        rotation: 0,
        z: maxZ + 1,
        order: wallItems.length,
        bookId: book.id,
        name: book.meta?.name || book.meta?.shape || book.title,
        createdAt: now,
    };

    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)) return item;
    const stores = db.objectStoreNames.contains(STORE_COLLECTION_WALLS)
        ? [STORE_COLLECTION_WALL_ITEMS, STORE_COLLECTION_WALLS]
        : [STORE_COLLECTION_WALL_ITEMS];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        const itemStore = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
        existingBookItems.forEach(existing => itemStore.delete(existing.id));
        itemStore.put(item);

        if (stores.includes(STORE_COLLECTION_WALLS)) {
            tx.objectStore(STORE_COLLECTION_WALLS).put({
                ...wall,
                updatedAt: now,
                changeCountSinceVisit: (wall.changeCountSinceVisit || 0) + 1,
            });
        }

        tx.oncomplete = () => resolve(item);
        tx.onerror = () => reject(tx.error);
    });
};

export const addCollectionBookToDefaultWall = async (book: CollectionBook): Promise<{ wall: CollectionWall; item: CollectionWallItem }> => {
    const wall = await getOrCreateDefaultCollectionWall(book.charId);
    const item = await addCollectionBookToWall(book, wall.id);
    return { wall, item };
};

export const saveCollectionWallAsset = async (input: CollectionWallAssetInput): Promise<CollectionWallAsset> => {
    let record: CollectionWallAsset | null = null;
    try {
        const now = Date.now();
        record = {
            ...input,
            id: input.id || createId('wallasset'),
            bytes: Number.isFinite(input.bytes) ? input.bytes : input.blob.size,
            createdAt: input.createdAt || now,
        };

        const opened = await getStore(STORE_COLLECTION_WALL_ASSETS, 'readwrite');
        if (!opened) return record;
        return await new Promise((resolve, reject) => {
            opened.store.put(record);
            opened.tx.oncomplete = () => resolve(record);
            opened.tx.onerror = () => {
                console.error('[CollectionWallDebug] asset-save-tx-error', {
                    id: record?.id,
                    bytes: record?.bytes,
                    hash: record?.hash,
                    error: summarizeCollectionWallError(opened.tx.error),
                });
                reject(opened.tx.error);
            };
            opened.tx.onabort = () => {
                console.error('[CollectionWallDebug] asset-save-tx-abort', {
                    id: record?.id,
                    bytes: record?.bytes,
                    hash: record?.hash,
                    error: summarizeCollectionWallError(opened.tx.error),
                });
                reject(opened.tx.error);
            };
        });
    } catch (error) {
        console.error('[CollectionWallDebug] asset-save-error', {
            id: record?.id || input.id,
            bytes: record?.bytes || input.bytes,
            hash: record?.hash || input.hash,
            error: summarizeCollectionWallError(error),
        });
        throw error;
    }
};

export const getCollectionWallAssetById = async (id: string): Promise<CollectionWallAsset | null> => {
    const opened = await getStore(STORE_COLLECTION_WALL_ASSETS, 'readonly');
    if (!opened) return null;
    return new Promise((resolve, reject) => {
        const request = opened.store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
};

export const getAllCollectionWallAssets = async (): Promise<CollectionWallAsset[]> => {
    const opened = await getStore(STORE_COLLECTION_WALL_ASSETS, 'readonly');
    if (!opened) return [];
    return new Promise((resolve, reject) => {
        const request = opened.store.getAll();
        request.onsuccess = () => resolve(sortAssets((request.result || []) as CollectionWallAsset[]));
        request.onerror = () => reject(request.error);
    });
};

export const getCollectionWallAssetsByHash = async (hash: string): Promise<CollectionWallAsset[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALL_ASSETS)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COLLECTION_WALL_ASSETS, 'readonly');
        const store = tx.objectStore(STORE_COLLECTION_WALL_ASSETS);
        const request = store.indexNames.contains('hash')
            ? store.index('hash').getAll(hash)
            : store.getAll();
        request.onsuccess = () => {
            const assets = ((request.result || []) as CollectionWallAsset[])
                .filter(asset => asset.hash === hash);
            resolve(assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        };
        request.onerror = () => reject(request.error);
    });
};

export type CollectionWallAssetDeleteResult = 'deleted' | 'hidden' | 'missing';

export const deleteCollectionWallAsset = async (id: string): Promise<CollectionWallAssetDeleteResult> => {
    const asset = await getCollectionWallAssetById(id);
    if (!asset) return 'missing';

    const [items, walls] = await Promise.all([
        getAllCollectionWallItems(),
        getAllCollectionWalls(),
    ]);
    const usedByItem = items.some(item => item.assetId === id);
    const usedByBondFrame = items.some(item => item.bond?.avatarFrame === id);
    const usedByTextFont = items.some(item => item.text?.fontAssetId === id);
    const usedByBackground = walls.some(wall => wall.background?.type === 'asset' && wall.background.value === id);

    if (usedByItem || usedByBondFrame || usedByTextFont || usedByBackground) {
        await saveCollectionWallAsset({
            ...asset,
            meta: {
                ...(asset.meta || {}),
                hiddenFromLibrary: true,
            },
        });
        return 'hidden';
    }

    const opened = await getStore(STORE_COLLECTION_WALL_ASSETS, 'readwrite');
    if (!opened) return 'missing';
    return new Promise((resolve, reject) => {
        opened.store.delete(id);
        opened.tx.oncomplete = () => resolve('deleted');
        opened.tx.onerror = () => reject(opened.tx.error);
    });
};

export const deleteCollectionWall = async (id: string): Promise<void> => {
    const items = await getCollectionWallItemsByWallId(id);
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_COLLECTION_WALLS)) return;
    const stores = db.objectStoreNames.contains(STORE_COLLECTION_WALL_ITEMS)
        ? [STORE_COLLECTION_WALLS, STORE_COLLECTION_WALL_ITEMS]
        : [STORE_COLLECTION_WALLS];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore(STORE_COLLECTION_WALLS).delete(id);
        if (stores.includes(STORE_COLLECTION_WALL_ITEMS)) {
            const itemStore = tx.objectStore(STORE_COLLECTION_WALL_ITEMS);
            items.forEach(item => itemStore.delete(item.id));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};
