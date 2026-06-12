import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import { buildFreeformCollectionBookInput } from '../utils/collectionBooks';
import type { CollectionBookInput, FullBackupData, Message } from '../types';
import type { StatusCardData } from '../types/statusCard';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
}

function makeBook(overrides: Partial<CollectionBookInput> = {}): CollectionBookInput {
    const body = overrides.body || '《灯雨》\n\n雨停在玻璃外，他没有把那句话说完。';
    return {
        charId: 'char-a',
        kind: 'afterglow',
        title: '灯雨',
        body,
        cardData: {
            cardType: 'freeform',
            title: '番外篇',
            body,
            meta: {
                afterglowMode: 'fanfic',
                afterglowTags: ['#视角重播'],
                afterglowCover: { theme: '雨停之后' },
            },
            style: {},
        },
        sourceMessageId: 42,
        sourceMessageTimestamp: 100,
        sourceReplyExcerpt: '今晚见。',
        tags: ['#视角重播'],
        cover: { theme: '雨停之后' },
        ...overrides,
    };
}

function makeFreeformInput(sourceMessageId = 101): CollectionBookInput {
    const cardData = {
        cardType: 'freeform',
        title: '自由创作',
        body: '便利店小票，背面写了一句没发出去的话。',
        meta: {
            html: '<!doctype html><html><body><article>21:30 / 牛奶 / 没发出的消息</article></body></html>',
            freeformShape: '便利店小票',
            freeformCandidates: ['便利店小票', '聊天截图', '药板锡纸'],
        },
        style: {},
    } satisfies StatusCardData;
    const sourceMessage = {
        id: sourceMessageId,
        charId: 'char-a',
        role: 'assistant',
        type: 'text',
        content: '我刚刚下楼买了牛奶。',
        timestamp: 200 + sourceMessageId,
    } as Message;
    return buildFreeformCollectionBookInput('char-a', cardData, sourceMessage);
}

describe('collection book store', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('saves, groups by char, deletes, and dedupes the same source/body', async () => {
        const first = await DB.saveCollectionBook(makeBook());
        const duplicate = await DB.saveCollectionBook(makeBook({ title: '重复标题也不新建' }));

        expect(duplicate.id).toBe(first.id);
        expect(await DB.isCollectionSourceCollected({
            charId: 'char-a',
            kind: 'afterglow',
            sourceMessageId: 42,
            body: first.body,
        })).toBe(true);
        expect(await DB.getCollectionBooksByCharId('char-a')).toHaveLength(1);

        await DB.deleteCollectionBook(first.id);
        expect(await DB.getCollectionBooksByCharId('char-a')).toHaveLength(0);
    });

    it('allows the same source message to collect different rewrites as separate books', async () => {
        await DB.saveCollectionBook(makeBook({ body: '《灯雨》\n\n第一版。' }));
        await DB.saveCollectionBook(makeBook({ body: '《灯雨》\n\n第二版。' }));

        const books = await DB.getCollectionBooksByCharId('char-a');
        expect(books).toHaveLength(2);
        expect(books.map(book => book.body)).toEqual(expect.arrayContaining(['《灯雨》\n\n第一版。', '《灯雨》\n\n第二版。']));
    });

    it('roundtrips through the full IndexedDB backup payload', async () => {
        await DB.saveCollectionBook(makeBook());

        const exported = await DB.exportFullData();
        expect(exported.collectionBooks?.[0].title).toBe('灯雨');

        resetIndexedDb();
        await DB.importFullData(exported as FullBackupData);

        const restored = await DB.getCollectionBooksByCharId('char-a');
        expect(restored).toHaveLength(1);
        expect(restored[0].sourceReplyExcerpt).toBe('今晚见。');
    });

    it('dedupes freeform books by content hash even when source messages differ', async () => {
        const first = await DB.saveCollectionBook(makeFreeformInput(101));
        const duplicate = await DB.saveCollectionBook(makeFreeformInput(202));

        expect(duplicate.id).toBe(first.id);
        expect(await DB.isCollectionSourceCollected({
            charId: 'char-a',
            kind: 'freeform',
            contentHash: first.contentHash,
            body: '不同摘要也不影响 hash 去重',
        })).toBe(true);
        expect(await DB.getCollectionBooksByCharId('char-a')).toHaveLength(1);
    });

    it('creates a default wall and keeps wall items in backups', async () => {
        const book = await DB.saveCollectionBook(makeFreeformInput());
        const { wall, item } = await DB.addCollectionBookToDefaultWall(book);

        expect(wall.name).toBe('未分类');
        expect(item.bookId).toBe(book.id);
        expect(await DB.getCollectionWallsByCharId('char-a')).toHaveLength(1);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(1);

        const exported = await DB.exportFullData();
        expect(exported.collectionWalls?.[0].id).toBe(wall.id);
        expect(exported.collectionWallItems?.[0].bookId).toBe(book.id);

        resetIndexedDb();
        await DB.importFullData(exported as FullBackupData);

        expect(await DB.getCollectionWallsByCharId('char-a')).toHaveLength(1);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(1);
    });

    it('roundtrips wall image assets through backups', async () => {
        const wall = await DB.saveCollectionWall({
            charId: 'char-a',
            name: '照片墙',
            isDefault: false,
            layoutMode: 'flow',
            background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
            allowCharDecorate: true,
            changeCountSinceVisit: 0,
            hasUnseenCharItem: false,
            sortOrder: 0,
        });
        const asset = await DB.saveCollectionWallAsset({
            blob: new Blob(['fake-image'], { type: 'image/png' }),
            mime: 'image/png',
            bytes: 10,
            hash: 'image-hash-1',
            origin: 'chat_gen',
            meta: { prompt: '雨后的玻璃窗', sourceMessageId: 88, name: '窗边' },
            dataUrl: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
        } as any);
        await DB.saveCollectionWallItem({
            wallId: wall.id,
            type: 'image',
            author: 'user',
            x: null,
            y: null,
            w: 320,
            h: 240,
            rotation: 0,
            z: 1,
            order: 0,
            assetId: asset.id,
            name: '窗边',
        });

        const exported = await DB.exportFullData();
        expect(exported.collectionWallAssets?.[0].dataUrl).toContain('data:image/png;base64,');

        resetIndexedDb();
        await DB.importFullData(exported as FullBackupData);

        expect(await DB.getAllCollectionWalls()).toHaveLength(1);
        const restored = await DB.getCollectionWallAssetById(asset.id);
        expect(restored?.hash).toBe('image-hash-1');
        expect(await restored?.blob.text()).toBe('fake-image');
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(1);
    });
});
