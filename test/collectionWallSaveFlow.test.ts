import { describe, expect, it, vi } from 'vitest';
import { saveCollectionWallEditorDraftSnapshot } from '../utils/collectionWallSaveFlow';
import type { CollectionWall, CollectionWallItem } from '../types';

function makeWall(overrides: Partial<CollectionWall> = {}): CollectionWall {
    return {
        id: 'wall-a',
        charId: 'char-a',
        name: '深夜歌单',
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

function makeWallItem(overrides: Partial<CollectionWallItem> = {}): CollectionWallItem {
    return {
        id: 'item-1',
        wallId: 'wall-a',
        type: 'card',
        author: 'user',
        x: null,
        y: null,
        w: 375,
        h: 220,
        rotation: 0,
        z: 1,
        order: 1,
        bookId: 'book-1',
        createdAt: 1,
        ...overrides,
    };
}

function makeDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('collection wall save flow', () => {
    it('waits for the snapshot write and parent refresh before resolving', async () => {
        const wall = makeWall({ background: { type: 'color', value: '#fff', fit: 'cover', dim: 5 } });
        const item = makeWallItem({ wallId: 'draft-wall' });
        const write = makeDeferred<{ wall: CollectionWall; items: CollectionWallItem[] }>();
        const refresh = makeDeferred<void>();
        const writeSnapshot = vi.fn(() => write.promise);
        const refreshAfterSave = vi.fn(() => refresh.promise);
        let resolved = false;

        const save = saveCollectionWallEditorDraftSnapshot({
            draftWall: wall,
            wallId: 'wall-a',
            name: '新墙名',
            items: [item],
            writeSnapshot,
            refreshAfterSave,
        }).then(result => {
            resolved = true;
            return result;
        });

        expect(writeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            name: '新墙名',
            layoutMode: 'free',
            changeCountSinceVisit: 1,
            background: expect.objectContaining({ dim: 0.6 }),
        }), [expect.objectContaining({ id: 'item-1', wallId: 'wall-a' })]);
        expect(refreshAfterSave).not.toHaveBeenCalled();

        write.resolve({ wall: { ...wall, name: '新墙名' }, items: [item] });
        await vi.waitFor(() => expect(refreshAfterSave).toHaveBeenCalledTimes(1));
        expect(resolved).toBe(false);

        refresh.resolve();
        await expect(save).resolves.toMatchObject({
            wall: expect.objectContaining({ name: '新墙名' }),
            items: [expect.objectContaining({ id: 'item-1' })],
        });
        expect(resolved).toBe(true);
    });

    it('normalizes asset background dim to zero before saving', async () => {
        const wall = makeWall({ background: { type: 'asset', value: 'asset-bg', fit: 'cover', dim: 0.4 } });
        const item = makeWallItem();
        const writeSnapshot = vi.fn(async (savedWall: CollectionWall, savedItems: CollectionWallItem[]) => ({
            wall: savedWall,
            items: savedItems,
        }));

        await saveCollectionWallEditorDraftSnapshot({
            draftWall: wall,
            wallId: 'wall-a',
            name: '背景墙',
            items: [item],
            writeSnapshot,
            refreshAfterSave: vi.fn(),
        });

        expect(writeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            background: expect.objectContaining({ type: 'asset', dim: 0 }),
        }), expect.any(Array));
    });

    it.each(['snapshot', 'refresh'] as const)('rejects when the %s step fails', async (stage) => {
        const wall = makeWall();
        const item = makeWallItem();
        const writeSnapshot = vi.fn(async () => {
            if (stage === 'snapshot') throw new Error('snapshot failed');
            return { wall, items: [item] };
        });
        const refreshAfterSave = vi.fn(async () => {
            if (stage === 'refresh') throw new Error('refresh failed');
        });

        await expect(saveCollectionWallEditorDraftSnapshot({
            draftWall: wall,
            wallId: 'wall-a',
            name: '新墙名',
            items: [item],
            writeSnapshot,
            refreshAfterSave,
        })).rejects.toThrow(stage === 'snapshot' ? 'snapshot failed' : 'refresh failed');

        expect(writeSnapshot).toHaveBeenCalledTimes(1);
        expect(refreshAfterSave).toHaveBeenCalledTimes(stage === 'snapshot' ? 0 : 1);
    });
});
