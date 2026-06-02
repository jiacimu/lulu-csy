// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from './index';
import { SULLY_CATEGORY_ID, SULLY_PRESET_EMOJIS } from './core';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
    localStorage.clear();
}

describe('contentStore emoji initialization', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('seeds preset emojis only for a fresh empty emoji category store', async () => {
        await DB.initializeEmojiData();

        const categories = await DB.getEmojiCategories();
        const emojis = await DB.getEmojis();

        expect(categories.find(category => category.id === 'default')?.isSystem).toBe(true);
        expect(categories.find(category => category.id === SULLY_CATEGORY_ID)?.isSystem).toBe(false);
        expect(emojis.map(emoji => emoji.name)).toEqual(
            expect.arrayContaining(SULLY_PRESET_EMOJIS.map(emoji => emoji.name)),
        );
    });

    it('does not recreate deleted preset emoji categories on later initialization', async () => {
        await DB.initializeEmojiData();
        await DB.deleteEmojiCategory(SULLY_CATEGORY_ID);

        await DB.initializeEmojiData();

        const categories = await DB.getEmojiCategories();
        const emojis = await DB.getEmojis();
        const presetNames = new Set(SULLY_PRESET_EMOJIS.map(emoji => emoji.name));

        expect(categories.some(category => category.id === SULLY_CATEGORY_ID)).toBe(false);
        expect(emojis.some(emoji => presetNames.has(emoji.name))).toBe(false);
    });
});
