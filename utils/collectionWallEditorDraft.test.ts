import { describe, expect, it } from 'vitest';
import type { CollectionWall, CollectionWallItem } from '../types';
import { hasWallEditorDraftChanges, serializeWallEditorDraft } from './collectionWallEditorDraft';

const wall: CollectionWall = {
    id: 'wall-a',
    charId: 'char-a',
    name: '未分类',
    isDefault: true,
    layoutMode: 'flow',
    background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
    allowCharDecorate: true,
    changeCountSinceVisit: 0,
    hasUnseenCharItem: false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
};

const item: CollectionWallItem = {
    id: 'item-a',
    wallId: 'wall-a',
    type: 'text',
    author: 'user',
    x: null,
    y: null,
    w: 220,
    h: 150,
    rotation: 0,
    z: 1,
    order: 0,
    text: { content: '第一张便签', preset: 'sticky_note' },
    name: '文字便签',
    createdAt: 2,
};

describe('collection wall editor draft snapshots', () => {
    it('detects wall, item, and pending text edits as dirty draft state', () => {
        const initial = serializeWallEditorDraft(wall, [item]);

        expect(hasWallEditorDraftChanges(initial, wall, [item])).toBe(false);
        expect(hasWallEditorDraftChanges(initial, { ...wall, name: '深夜歌单' }, [item])).toBe(true);
        expect(hasWallEditorDraftChanges(initial, wall, [{ ...item, order: 1 }])).toBe(true);
        expect(hasWallEditorDraftChanges(initial, wall, [item], '还没插入的便签')).toBe(true);
    });

    it('tracks custom HTML cards and bond avatar frames in draft snapshots', () => {
        const htmlItem: CollectionWallItem = {
            ...item,
            id: 'html-a',
            type: 'html',
            html: '<main>旧卡</main>',
            text: undefined,
            name: '自定义卡',
        };
        const bondItem: CollectionWallItem = {
            ...item,
            id: 'bond-a',
            type: 'bond',
            text: undefined,
            bond: { variant: 'default', avatarFrame: 'wallasset-frame' },
            name: '头像连接',
        };
        const initial = serializeWallEditorDraft(wall, [htmlItem, bondItem]);

        expect(hasWallEditorDraftChanges(initial, wall, [{ ...htmlItem, html: '<main>新卡</main>' }, bondItem])).toBe(true);
        expect(hasWallEditorDraftChanges(initial, wall, [htmlItem, { ...bondItem, bond: { variant: 'default' } }])).toBe(true);
    });
});
