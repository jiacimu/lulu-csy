import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCollectionWallPendingContext, consumeCollectionWallPendingContext } from './collectionWallContext';

describe('collection wall pending context', () => {
    beforeEach(() => {
        vi.useRealTimers();
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores and consumes wall context once per character', () => {
        addCollectionWallPendingContext('char-a', ' 用户最近在「深夜歌单」整理了拾光墙 ');
        addCollectionWallPendingContext('char-b', '另一面墙');

        expect(consumeCollectionWallPendingContext('char-a')).toEqual(['用户最近在「深夜歌单」整理了拾光墙']);
        expect(localStorage.getItem('collection_wall_pending_context_char-a')).toBe('[]');
        expect(consumeCollectionWallPendingContext('char-a')).toEqual([]);
        expect(consumeCollectionWallPendingContext('char-b')).toEqual(['另一面墙']);
    });

    it('drops unconsumed wall context after 72 hours', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
        addCollectionWallPendingContext('char-a', '三天前整理过墙');

        vi.setSystemTime(new Date('2026-06-04T00:00:00.001Z'));
        expect(consumeCollectionWallPendingContext('char-a')).toEqual([]);
        expect(localStorage.getItem('collection_wall_pending_context_char-a')).toBe('[]');
    });
});
