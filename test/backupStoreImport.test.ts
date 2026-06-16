import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import type { FullBackupData, Message } from '../types';
import type { ImportFullDataProgress } from '../utils/db/backupStore';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
}

function makeMessage(id: number, charId = 'char-a'): Message {
    return {
        id,
        charId,
        role: id % 2 === 0 ? 'assistant' : 'user',
        type: 'text',
        content: `message ${id}`,
        timestamp: 1000 + id,
    } as Message;
}

describe('backupStore importFullData', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('imports large stores in item chunks and reports progress', async () => {
        const progress: ImportFullDataProgress[] = [];
        const data = {
            timestamp: Date.now(),
            version: 1,
            characters: [{ id: 'char-a', name: 'A' }],
            messages: Array.from({ length: 5 }, (_, index) => makeMessage(index + 1)),
        } as FullBackupData;

        await DB.importFullData(data, {
            batchSize: 2,
            onProgress: item => progress.push(item),
        });

        const messageItemProgress = progress
            .filter(item => item.label === '聊天记录' && item.stage === 'items')
            .map(item => item.itemDone);

        expect(messageItemProgress).toEqual([2, 4, 5]);
        await expect(DB.getMessagesByCharId('char-a')).resolves.toHaveLength(5);
        expect(progress.some(item => item.stage === 'done' && item.label === '聊天记录')).toBe(true);
    });

    it('clears old messages when a full backup contains an empty message list', async () => {
        await DB.saveMessage({
            charId: 'old-char',
            role: 'user',
            type: 'text',
            content: 'old message',
        });

        await DB.importFullData({
            timestamp: Date.now(),
            version: 1,
            characters: [{ id: 'new-char', name: 'New' }],
            messages: [] as Message[],
        } as FullBackupData, { batchSize: 2 });

        await expect(DB.getMessagesByCharId('old-char')).resolves.toHaveLength(0);
    });
});
