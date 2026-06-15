// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from './db';
import {
    loadSparkCharHandles,
    saveSparkCharHandles,
    SPARK_CHAR_HANDLES_STORAGE_KEY,
    type SparkCharHandles,
} from './socialHandlesStorage';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
    localStorage.clear();
    vi.restoreAllMocks();
}

describe('socialHandlesStorage', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('migrates legacy localStorage handles into IndexedDB assets', async () => {
        const handles: SparkCharHandles = {
            char_1: [{ id: 'default', handle: '糯米', note: '主账号' }],
        };
        const raw = JSON.stringify(handles);
        localStorage.setItem(SPARK_CHAR_HANDLES_STORAGE_KEY, raw);

        const loaded = await loadSparkCharHandles();

        expect(loaded).toEqual(handles);
        expect(await DB.getAsset(SPARK_CHAR_HANDLES_STORAGE_KEY)).toBe(raw);
        expect(localStorage.getItem(SPARK_CHAR_HANDLES_STORAGE_KEY)).toBeNull();
    });

    it('saves handles without writing back to localStorage', async () => {
        const handles: SparkCharHandles = {
            char_2: [{ id: 'sub-1', handle: '小号', note: '吐槽号' }],
        };
        localStorage.setItem(SPARK_CHAR_HANDLES_STORAGE_KEY, 'legacy');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

        await saveSparkCharHandles(handles);

        expect(setItemSpy).not.toHaveBeenCalled();
        expect(await DB.getAsset(SPARK_CHAR_HANDLES_STORAGE_KEY)).toBe(JSON.stringify(handles));
        expect(localStorage.getItem(SPARK_CHAR_HANDLES_STORAGE_KEY)).toBeNull();
    });
});
