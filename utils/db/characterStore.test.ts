// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from './index';
import { openDB, STORE_MESSAGES } from './core';
import type { Message } from '../../types';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
    localStorage.clear();
    localStorage.setItem('csyos_user_id', 'owner-a');
}

async function rawInsertMessage(message: Partial<Message> & { charId: string; timestamp: number }) {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MESSAGES, 'readwrite');
        const request = tx.objectStore(STORE_MESSAGES).add({
            role: 'user',
            type: 'text',
            content: '',
            ...message,
        });
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

describe('characterStore recent message windows', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('returns the latest messages in ascending timestamp/id order', async () => {
        for (let i = 1; i <= 40; i += 1) {
            await DB.saveMessage({
                charId: 'char-1',
                role: 'user',
                type: 'text',
                content: `message-${i}`,
                timestamp: 1000 + i,
            });
        }

        const recent = await DB.getRecentMessagesByCharId('char-1', 30);

        expect(recent).toHaveLength(30);
        expect(recent[0].content).toBe('message-11');
        expect(recent[29].content).toBe('message-40');
        expect(recent.map(message => message.timestamp)).toEqual(
            [...recent].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id).map(message => message.timestamp),
        );
    });

    it('reports whether older messages remain without requiring a total count', async () => {
        for (let i = 1; i <= 40; i += 1) {
            await DB.saveMessage({
                charId: 'char-1',
                role: 'assistant',
                type: 'text',
                content: `assistant-${i}`,
                timestamp: 2000 + i,
            });
        }

        const firstWindow = await DB.getRecentMessageWindow('char-1', 30);
        const fullWindow = await DB.getRecentMessageWindow('char-1', 60);

        expect(firstWindow.messages).toHaveLength(30);
        expect(firstWindow.hasMore).toBe(true);
        expect(fullWindow.messages).toHaveLength(40);
        expect(fullWindow.hasMore).toBe(false);
    });

    it('returns the latest messages inside a timestamp range without scanning the full history', async () => {
        const base = 1717286400000;
        for (let i = 1; i <= 10; i += 1) {
            await DB.saveMessage({
                charId: 'char-1',
                role: 'user',
                type: 'text',
                content: `range-${i}`,
                timestamp: base + i,
            });
        }

        const range = await DB.getMessagesByCharIdBetweenTimestamps('char-1', base + 3, base + 8, 3);

        expect(range.map(message => message.content)).toEqual(['range-6', 'range-7', 'range-8']);
        expect(range.map(message => message.timestamp)).toEqual([base + 6, base + 7, base + 8]);
    });

    it('keeps legacy second-based timestamps visible in timestamp range reads', async () => {
        await rawInsertMessage({
            charId: 'char-1',
            content: 'legacy-seconds',
            timestamp: 1717286400,
        });
        await DB.saveMessage({
            charId: 'char-1',
            role: 'assistant',
            type: 'text',
            content: 'modern-ms',
            timestamp: 1717286400000,
        });

        const range = await DB.getMessagesByCharIdBetweenTimestamps(
            'char-1',
            1717286400000,
            1717286400000,
            10,
        );

        expect(range.map(message => message.content)).toEqual(['legacy-seconds', 'modern-ms']);
    });

    it('keeps owner, group, and legacy character compatibility filters', async () => {
        await DB.saveCharacter({
            id: 'char-1',
            charInstanceId: 'chinst_legacy_1',
            name: 'Sully',
            avatar: '',
            description: '',
            systemPrompt: '',
            memories: [],
        } as any);

        await rawInsertMessage({
            charId: 'chinst_legacy_1',
            content: 'legacy-without-owner',
            timestamp: 1000,
        });
        await rawInsertMessage({
            charId: 'char-1',
            content: 'other-owner',
            ownerUserId: 'owner-b',
            timestamp: 2000,
        });
        await rawInsertMessage({
            charId: 'char-1',
            content: 'group-message',
            ownerUserId: 'owner-a',
            groupId: 'group-1',
            timestamp: 3000,
        });
        await DB.saveMessage({
            charId: 'char-1',
            role: 'assistant',
            type: 'text',
            content: 'canonical-owner',
            timestamp: 4000,
        });

        const messages = await DB.getRecentMessagesByCharId('char-1', 10);
        const smallWindow = await DB.getRecentMessageWindow('char-1', 1);

        expect(messages.map(message => message.content)).toEqual([
            'legacy-without-owner',
            'canonical-owner',
        ]);
        expect(smallWindow.messages.map(message => message.content)).toEqual(['canonical-owner']);
        expect(smallWindow.hasMore).toBe(true);
    });
});
