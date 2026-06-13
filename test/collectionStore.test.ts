import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import { buildCollectionForwardPayload, buildFreeformCollectionBookInput } from '../utils/collectionBooks';
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

const DEFAULT_FREEFORM_HTML = '<!doctype html><html><body><article>21:30 / 牛奶 / 没发出的消息</article></body></html>';

function makeFreeformInput(sourceMessageId: number | null = 101, html = DEFAULT_FREEFORM_HTML): CollectionBookInput {
    const cardData = {
        cardType: 'freeform',
        title: '自由创作',
        body: '便利店小票，背面写了一句没发出去的话。',
        meta: {
            html,
            freeformShape: '便利店小票',
            freeformCandidates: ['便利店小票', '聊天截图', '药板锡纸'],
        },
        style: {},
    } satisfies StatusCardData;
    const sourceMessage = typeof sourceMessageId === 'number'
        ? {
            id: sourceMessageId,
            charId: 'char-a',
            role: 'assistant',
            type: 'text',
            content: '我刚刚下楼买了牛奶。',
            timestamp: 200 + sourceMessageId,
        } as Message
        : undefined;
    return buildFreeformCollectionBookInput('char-a', cardData, sourceMessage);
}

const AFTERGLOW_HTML = '<!doctype html><html><body><article>番外篇正文</article></body></html>';

function makeMisfiledAfterglowInput(
    mode: 'fanfic' | 'heartTalk' = 'fanfic',
    overrides: Partial<CollectionBookInput> = {},
): CollectionBookInput {
    const body = mode === 'heartTalk'
        ? '她把没说出口的心事摊在桌上，问他要不要一起看雨。'
        : '《灯雨》\n\n雨停在玻璃外，他没有把那句话说完。';
    const cardData = {
        cardType: 'freeform',
        title: '番外篇',
        body,
        meta: {
            html: AFTERGLOW_HTML,
            allowScripts: true,
            source: 'afterglow',
            afterglowMode: mode,
            afterglowTags: ['#雨停之后'],
            afterglowCover: { theme: '雨停之后' },
        },
        style: {},
    } satisfies StatusCardData;

    return {
        charId: 'char-a',
        kind: 'freeform',
        title: '便利店小票',
        body,
        cardData,
        sourceMessageId: 303,
        sourceMessageTimestamp: 1000,
        sourceReplyExcerpt: '今晚见。',
        tags: ['便利店小票'],
        cover: undefined,
        contentHash: 'legacy-freeform-hash',
        meta: {
            html: AFTERGLOW_HTML,
            shape: '便利店小票',
            summary: body,
            sourceMessageId: 303,
        },
        ...overrides,
    };
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

    it('blocks repeated collection of the same freeform card by content hash', async () => {
        const firstInput = makeFreeformInput(101);
        const first = await DB.saveCollectionBook(firstInput);
        const duplicate = await DB.saveCollectionBook({ ...firstInput, title: '重复收藏也不新建' });

        expect(duplicate.id).toBe(first.id);
        expect(await DB.getCollectionBooksByCharId('char-a')).toHaveLength(1);
    });

    it('allows a regenerated freeform card with a different content hash to be collected separately', async () => {
        const first = await DB.saveCollectionBook(makeFreeformInput(101));
        const regenerated = await DB.saveCollectionBook(makeFreeformInput(101, `${DEFAULT_FREEFORM_HTML}<section>第二版</section>`));

        expect(regenerated.id).not.toBe(first.id);
        expect(regenerated.contentHash).not.toBe(first.contentHash);
        expect(await DB.getCollectionBooksByCharId('char-a')).toHaveLength(2);
    });

    it('saves html-backed afterglow cards as afterglow books instead of freeform wall fragments', async () => {
        const saved = await DB.saveCollectionBook(makeMisfiledAfterglowInput('fanfic'));

        expect(saved.kind).toBe('afterglow');
        expect(saved.title).toBe('灯雨');
        expect(saved.tags).toEqual(['#雨停之后']);
        expect(saved.cover).toEqual({ theme: '雨停之后' });
        expect(saved.contentHash).toBeUndefined();
    });

    it('saves html-backed heart talk cards as heart talk books', async () => {
        const saved = await DB.saveCollectionBook(makeMisfiledAfterglowInput('heartTalk'));

        expect(saved.kind).toBe('heart_talk');
        expect(saved.title).not.toBe('便利店小票');
        expect(saved.contentHash).toBeUndefined();
    });

    it('collects legacy freeform cards without sourceMessageId by content hash', async () => {
        const legacy = await DB.saveCollectionBook(makeFreeformInput(null));

        expect(legacy.sourceMessageId).toBeUndefined();
        expect(await DB.isCollectionSourceCollected({
            charId: 'char-a',
            kind: 'freeform',
            contentHash: legacy.contentHash,
            body: '存量卡摘要不同也按 hash 查询',
        })).toBe(true);
    });

    it('deletes freeform wall items when canceling collection by content hash', async () => {
        const saved = await DB.saveCollectionBook(makeFreeformInput(101));
        const { wall } = await DB.addCollectionBookToDefaultWall(saved);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(1);

        const removed = await DB.deleteCollectionBookBySource({
            charId: 'char-a',
            kind: 'freeform',
            contentHash: saved.contentHash,
            body: '按 hash 删除时不依赖摘要全文',
        });

        expect(removed?.id).toBe(saved.id);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(0);
        expect(await DB.getCollectionWallItemsByBookId(saved.id)).toHaveLength(0);
    });

    it('repairs legacy afterglow books that were misfiled on a freeform wall', async () => {
        const legacyBook = {
            ...makeMisfiledAfterglowInput('fanfic'),
            id: 'legacy-afterglow',
            createdAt: 1000,
            collectedAt: 1000,
        };
        const wall = {
            id: 'wall-legacy',
            charId: 'char-a',
            name: '未分类',
            isDefault: true,
            layoutMode: 'free',
            background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
            allowCharDecorate: true,
            changeCountSinceVisit: 0,
            hasUnseenCharItem: false,
            sortOrder: 0,
            createdAt: 1000,
            updatedAt: 1000,
        };
        const item = {
            id: 'wallitem-legacy-afterglow',
            wallId: wall.id,
            type: 'card',
            author: 'user',
            x: null,
            y: null,
            w: 375,
            h: 360,
            rotation: 0,
            z: 1,
            order: 0,
            bookId: legacyBook.id,
            name: '便利店小票',
            createdAt: 1000,
        };
        await DB.importFullData({
            collectionBooks: [legacyBook],
            collectionWalls: [wall],
            collectionWallItems: [item],
        } as FullBackupData);

        const found = await DB.findCollectionBookBySource({
            charId: 'char-a',
            kind: 'afterglow',
            sourceMessageId: legacyBook.sourceMessageId,
            body: legacyBook.body,
        });

        expect(found?.id).toBe(legacyBook.id);
        expect(found?.kind).toBe('afterglow');
        expect(found?.title).toBe('灯雨');
        expect(found?.tags).toEqual(['#雨停之后']);
        expect(found?.cover).toEqual({ theme: '雨停之后' });
        expect(await DB.getCollectionWallItemsByBookId(legacyBook.id)).toHaveLength(0);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(0);
        expect((await DB.getCollectionBookById(legacyBook.id))?.kind).toBe('afterglow');
    });

    it('uses only freeform meta name, shape, or fallback for forward labels', async () => {
        const saved = await DB.saveCollectionBook(makeFreeformInput(101));

        expect(buildCollectionForwardPayload({
            ...saved,
            title: '摘要全文标题',
            customTitle: '自定义标签',
            meta: { ...saved.meta, name: '多喝水卡片' },
        }).title).toBe('多喝水卡片');
        expect(buildCollectionForwardPayload({
            ...saved,
            title: '摘要全文标题',
            customTitle: '自定义标签',
            meta: { shape: '购物小票' },
        }).title).toBe('购物小票');
        expect(buildCollectionForwardPayload({
            ...saved,
            title: '摘要全文标题',
            customTitle: '自定义标签',
            meta: undefined,
        }).title).toBe('视觉碎片');
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

    it('roundtrips hidden char invite avatar wall assets through backups', async () => {
        const asset = await DB.saveCollectionWallAsset({
            blob: new Blob(['avatar-image'], { type: 'image/webp' }),
            mime: 'image/webp',
            bytes: 12,
            hash: 'char-avatar-hash',
            origin: 'upload',
            meta: {
                assetKind: 'char_invite_avatar',
                charId: 'char-a',
                name: 'Sully 的Q版小人',
                uploadedFileName: 'sully.webp',
                hiddenFromLibrary: true,
            },
            dataUrl: 'data:image/webp;base64,YXZhdGFyLWltYWdl',
        } as any);

        const exported = await DB.exportFullData();
        expect(exported.collectionWallAssets?.[0].meta?.assetKind).toBe('char_invite_avatar');
        expect(exported.collectionWallAssets?.[0].meta?.charId).toBe('char-a');

        resetIndexedDb();
        await DB.importFullData(exported as FullBackupData);

        const restored = await DB.getCollectionWallAssetById(asset.id);
        expect(restored?.meta?.assetKind).toBe('char_invite_avatar');
        expect(restored?.meta?.charId).toBe('char-a');
        expect(restored?.meta?.hiddenFromLibrary).toBe(true);
        expect(await restored?.blob.text()).toBe('avatar-image');
    });

    it('lists and removes custom wall assets without breaking used decorations', async () => {
        const loose = await DB.saveCollectionWallAsset({
            blob: new Blob(['loose'], { type: 'image/png' }),
            mime: 'image/png',
            bytes: 5,
            hash: 'asset-loose',
            origin: 'upload',
            meta: { name: '散落素材', uploadedFileName: 'loose.png', hiddenFromLibrary: false },
            createdAt: 10,
        });
        const used = await DB.saveCollectionWallAsset({
            blob: new Blob(['used'], { type: 'image/webp' }),
            mime: 'image/webp',
            bytes: 4,
            hash: 'asset-used',
            origin: 'upload',
            meta: { name: '贴纸素材', uploadedFileName: 'sticker.webp', hiddenFromLibrary: false },
            createdAt: 20,
            dataUrl: 'data:image/webp;base64,dXNlZA==',
        } as any);
        const wall = await DB.saveCollectionWall({
            charId: 'char-a',
            name: '贴纸墙',
            isDefault: false,
            layoutMode: 'free',
            background: { type: 'asset', value: used.id, fit: 'cover', dim: 0.18 },
            allowCharDecorate: true,
            changeCountSinceVisit: 0,
            hasUnseenCharItem: false,
            sortOrder: 0,
        });
        await DB.saveCollectionWallItem({
            wallId: wall.id,
            type: 'sticker',
            author: 'user',
            x: 100,
            y: 100,
            w: 120,
            h: 120,
            rotation: 0,
            z: 1,
            order: 0,
            assetId: used.id,
            name: '贴纸素材',
        });

        expect((await DB.getAllCollectionWallAssets()).map(asset => asset.id)).toEqual([used.id, loose.id]);
        expect(await DB.deleteCollectionWallAsset(loose.id)).toBe('deleted');
        expect(await DB.getCollectionWallAssetById(loose.id)).toBeNull();
        expect(await DB.deleteCollectionWallAsset(used.id)).toBe('hidden');
        expect((await DB.getCollectionWallAssetById(used.id))?.meta?.hiddenFromLibrary).toBe(true);

        const exported = await DB.exportFullData();
        expect(exported.collectionWallAssets?.[0].meta?.uploadedFileName).toBe('sticker.webp');
        expect(exported.collectionWallAssets?.[0].meta?.hiddenFromLibrary).toBe(true);

        resetIndexedDb();
        await DB.importFullData(exported as FullBackupData);

        const restored = await DB.getCollectionWallAssetById(used.id);
        expect(restored?.meta?.hiddenFromLibrary).toBe(true);
        expect(await DB.getCollectionWallItemsByWallId(wall.id)).toHaveLength(1);
    });
});
