import { addCollectionWallPendingContext, consumeCollectionWallPendingContext } from './collectionWallContext';

describe('collection wall pending context', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('stores and consumes wall context once per character', () => {
        addCollectionWallPendingContext('char-a', ' 用户最近在「深夜歌单」整理了拾光墙 ');
        addCollectionWallPendingContext('char-b', '另一面墙');

        expect(consumeCollectionWallPendingContext('char-a')).toEqual(['用户最近在「深夜歌单」整理了拾光墙']);
        expect(consumeCollectionWallPendingContext('char-a')).toEqual([]);
        expect(consumeCollectionWallPendingContext('char-b')).toEqual(['另一面墙']);
    });
});
