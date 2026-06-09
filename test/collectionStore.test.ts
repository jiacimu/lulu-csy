import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import type { CollectionBookInput, FullBackupData } from '../types';

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
});
