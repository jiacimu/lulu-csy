import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { buildDateRequestContextMessages } from './dateContext';

const baseTime = new Date('2026-06-04T12:00:00+08:00').getTime();

function msg(overrides: Partial<Message>): Message {
    return {
        id: overrides.id || 1,
        charId: 'char-1',
        role: overrides.role || 'assistant',
        type: overrides.type || 'text',
        content: overrides.content || '',
        timestamp: overrides.timestamp || baseTime + (overrides.id || 1) * 1000,
        metadata: overrides.metadata,
    };
}

describe('date request context', () => {
    it('uses main chat context plus current Date session, without old unsynced Date raw messages', () => {
        const oldDateRaw = msg({
            id: 1,
            role: 'assistant',
            content: '旧见面原文不该进入新见面',
            metadata: { source: 'date' },
        });
        const syncedDateBridge = msg({
            id: 2,
            role: 'system',
            content: '用户同步过的见面总结保留一次',
            metadata: {
                source: 'date',
                hiddenFromUser: true,
                isDateContextBridge: true,
                bridgeType: 'summary',
            },
        });
        const chatMessage = msg({
            id: 3,
            role: 'user',
            content: '普通聊天历史',
        });
        const currentOpening = msg({
            id: 4,
            role: 'assistant',
            content: '当前见面开场',
            metadata: { source: 'date', isOpening: true },
        });
        const currentUser = msg({
            id: 5,
            role: 'user',
            content: '当前见面第一句话',
            metadata: { source: 'date' },
        });

        const context = buildDateRequestContextMessages({
            allMessages: [oldDateRaw, syncedDateBridge, chatMessage, currentOpening, currentUser],
            currentSessionMessages: [currentOpening, currentUser],
            contextLimit: 500,
        });

        expect(context.map(item => item.sourceMessage.id)).toEqual([2, 3, 4, 5]);
        expect(context.map(item => item.content)).not.toContain('旧见面原文不该进入新见面');
    });

    it('does not truncate selected main chat content', () => {
        const longContent = '长'.repeat(5000);
        const context = buildDateRequestContextMessages({
            allMessages: [msg({ id: 1, role: 'user', content: longContent })],
            currentSessionMessages: [],
            contextLimit: 500,
        });

        expect(context[0]?.content).toBe(longContent);
    });

    it('excludes current Date session raw messages hidden by summary compression', () => {
        const currentOpening = msg({
            id: 10,
            role: 'assistant',
            content: '当前见面开场',
            metadata: { source: 'date', isOpening: true },
        });
        const compressedRaw = msg({
            id: 11,
            role: 'assistant',
            content: '已经被总结压缩的旧原文',
            metadata: {
                source: 'date',
                hiddenFromUser: true,
                dateSummaryAutoHidden: true,
                hiddenBySummaryMsgId: 99,
            },
        });
        const currentUser = msg({
            id: 12,
            role: 'user',
            content: '压缩之后的新消息',
            metadata: { source: 'date' },
        });

        const context = buildDateRequestContextMessages({
            allMessages: [currentOpening, compressedRaw, currentUser],
            currentSessionMessages: [currentOpening, compressedRaw, currentUser],
            contextLimit: 500,
        });

        expect(context.map(item => item.sourceMessage.id)).toEqual([10, 12]);
        expect(context.map(item => item.content)).not.toContain('已经被总结压缩的旧原文');
    });

    it('formats hidden Date photos as text summaries without leaking image data', () => {
        const currentOpening = msg({
            id: 20,
            role: 'assistant',
            content: '当前见面开场',
            metadata: { source: 'date', isOpening: true },
        });
        const datePhoto = msg({
            id: 21,
            role: 'assistant',
            type: 'image',
            content: 'data:image/png;base64,very-large-original',
            metadata: {
                source: 'date_photo',
                hiddenFromUser: true,
                isDatePhoto: true,
                sessionStartMsgId: 20,
                caption: '给你看这张。',
                visualSummary: '雨夜便利店门口，两个人共撑一把伞。',
                photoMeta: {
                    continuity_summary: '他们在雨夜靠得很近，伞沿滴水。',
                },
            },
        });

        const context = buildDateRequestContextMessages({
            allMessages: [currentOpening, datePhoto],
            currentSessionMessages: [currentOpening, datePhoto],
            contextLimit: 500,
        });

        expect(context.map(item => item.sourceMessage.id)).toEqual([20, 21]);
        expect(context[1]?.content).toContain('[见面照片]');
        expect(context[1]?.content).toContain('雨夜便利店门口');
        expect(context[1]?.content).not.toContain('data:image');
    });

    it('includes hidden Date photo failures as text context', () => {
        const currentOpening = msg({
            id: 30,
            role: 'assistant',
            content: '当前见面开场',
            metadata: { source: 'date', isOpening: true },
        });
        const failedPhoto = msg({
            id: 31,
            role: 'system',
            type: 'system',
            content: '[见面照片发送失败]\n刚才尝试生成一张见面照片，但图片没有成功送达。',
            metadata: {
                source: 'date_photo_delivery_failed',
                hiddenFromUser: true,
                sessionStartMsgId: 30,
                errorMessage: 'provider timeout',
            },
        });

        const context = buildDateRequestContextMessages({
            allMessages: [currentOpening, failedPhoto],
            currentSessionMessages: [currentOpening, failedPhoto],
            contextLimit: 500,
        });

        expect(context.map(item => item.sourceMessage.id)).toEqual([30, 31]);
        expect(context[1]?.content).toContain('[见面照片失败]');
        expect(context[1]?.content).toContain('provider timeout');
    });
});
