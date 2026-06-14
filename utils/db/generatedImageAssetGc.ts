import type { GalleryImage, Message } from '../../types';
import {
    collectGeneratedImageOriginalAssetIdsFromGalleryImages,
    collectGeneratedImageOriginalAssetIdsFromMessages,
    collectGeneratedImageOriginalAssetIdsFromValue,
    isGeneratedImageOriginalAssetId,
} from '../generatedImageAssets';
import { openDB, STORE_ASSETS, STORE_GALLERY, STORE_MEMORY_RECORDS, STORE_MESSAGES } from './core';

export interface GeneratedImageAssetCleanupResult {
    candidates: string[];
    referenced: string[];
    deleted: string[];
    failed: string[];
}

const emptyCleanupResult = (): GeneratedImageAssetCleanupResult => ({
    candidates: [],
    referenced: [],
    deleted: [],
    failed: [],
});

function uniqueGeneratedImageAssetIds(candidateIds: Iterable<unknown>): string[] {
    return Array.from(new Set(
        Array.from(candidateIds).filter(isGeneratedImageOriginalAssetId),
    ));
}

function readAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);

    return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve((request.result || []) as T[]);
        request.onerror = () => reject(request.error);
    });
}

async function readAllGeneratedImageAssetIds(): Promise<string[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_ASSETS)) return [];

    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS).getAllKeys();
        request.onsuccess = () => resolve(uniqueGeneratedImageAssetIds(request.result || []));
        request.onerror = () => reject(request.error);
    });
}

export async function getReferencedGeneratedImageOriginalAssetIds(): Promise<Set<string>> {
    const db = await openDB();
    const [messages, galleryImages, memoryRecords] = await Promise.all([
        readAllFromStore<Message>(db, STORE_MESSAGES),
        readAllFromStore<GalleryImage>(db, STORE_GALLERY),
        readAllFromStore<unknown>(db, STORE_MEMORY_RECORDS),
    ]);

    return new Set([
        ...collectGeneratedImageOriginalAssetIdsFromMessages(messages),
        ...collectGeneratedImageOriginalAssetIdsFromGalleryImages(galleryImages),
        ...collectGeneratedImageOriginalAssetIdsFromValue(memoryRecords),
    ]);
}

export async function cleanupUnreferencedGeneratedImageOriginalAssets(candidateIds: Iterable<unknown>): Promise<GeneratedImageAssetCleanupResult> {
    const candidates = uniqueGeneratedImageAssetIds(candidateIds);
    if (candidates.length === 0) return emptyCleanupResult();

    try {
        const referencedIds = await getReferencedGeneratedImageOriginalAssetIds();
        const referenced = candidates.filter(id => referencedIds.has(id));
        const unreferenced = candidates.filter(id => !referencedIds.has(id));

        if (unreferenced.length === 0) {
            return { candidates, referenced, deleted: [], failed: [] };
        }

        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
            return { candidates, referenced, deleted: [], failed: unreferenced };
        }

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_ASSETS, 'readwrite');
            const store = tx.objectStore(STORE_ASSETS);
            unreferenced.forEach(id => store.delete(id));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });

        return { candidates, referenced, deleted: unreferenced, failed: [] };
    } catch (error) {
        console.warn('[GeneratedImageStorage] failed to clean unreferenced original assets:', error);
        return { candidates, referenced: [], deleted: [], failed: candidates };
    }
}

export async function cleanupAllUnreferencedGeneratedImageOriginalAssets(): Promise<GeneratedImageAssetCleanupResult> {
    try {
        const candidateIds = await readAllGeneratedImageAssetIds();
        return cleanupUnreferencedGeneratedImageOriginalAssets(candidateIds);
    } catch (error) {
        console.warn('[GeneratedImageStorage] failed to scan generated image original assets:', error);
        return emptyCleanupResult();
    }
}
