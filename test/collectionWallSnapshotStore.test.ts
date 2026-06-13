import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import type { CollectionWall, CollectionWallItem } from '../types';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
}

function makeWall(overrides: Partial<CollectionWall> = {}): CollectionWall {
    return {
        id: 'wall-a',
        charId: 'char-a',
        name: '未分类',
        isDefault: true,
        layoutMode: 'free',
        background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
        allowCharDecorate: true,
        changeCountSinceVisit: 0,
        charRemarks: [],
        hasUnseenCharItem: false,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function makeItem(overrides: Partial<CollectionWallItem> = {}): CollectionWallItem {
    return {
        id: 'item-a',
        wallId: 'wall-a',
        type: 'card',
        author: 'user',
        x: 12,
        y: 24,
        w: 180,
        h: 120,
        rotation: 0,
        z: 1,
        order: 0,
        bookId: 'book-a',
        name: '票根',
        createdAt: 1,
        ...overrides,
    };
}

describe('collection wall snapshot store', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('replaces a wall snapshot atomically and roundtrips layout fields', async () => {
        await DB.replaceCollectionWallSnapshot(makeWall(), [
            makeItem({ id: 'old-item', x: 12, y: 24, rotation: 0 }),
            makeItem({ id: 'deleted-item', x: 40, y: 60, rotation: 2 }),
        ]);

        const updatedWall = makeWall({
            background: { type: 'asset', value: 'asset-wallpaper', fit: 'cover', dim: 0.4 },
            updatedAt: 20,
        });
        await DB.replaceCollectionWallSnapshot(updatedWall, [
            makeItem({
                id: 'new-item',
                x: 250,
                y: 390,
                w: 210,
                h: 160,
                rotation: -13,
                z: 9,
                order: 3,
            }),
        ]);

        const wall = await DB.getCollectionWallById('wall-a');
        const items = await DB.getCollectionWallItemsByWallId('wall-a');

        expect(wall?.background).toEqual({ type: 'asset', value: 'asset-wallpaper', fit: 'cover', dim: 0.4 });
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'new-item',
            x: 250,
            y: 390,
            w: 210,
            h: 160,
            rotation: -13,
            z: 9,
            order: 3,
        });
    });
});
