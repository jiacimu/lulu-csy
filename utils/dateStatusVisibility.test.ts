import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
    findLatestDateStatusDialogueMessage,
    findLatestDateStatusMessage,
    getRecentDateStatusMessageIds,
} from './dateStatusVisibility';

const createMessage = (overrides: Partial<Message>): Message => ({
    id: 1,
    charId: 'char-date-status',
    role: 'assistant',
    type: 'text',
    content: '',
    timestamp: 1,
    metadata: { source: 'date' },
    ...overrides,
});

describe('dateStatusVisibility', () => {
    it('keeps the latest status reply eligible when a date photo follows it', () => {
        const statusReply = createMessage({
            id: 2,
            content: '[normal]雨声贴着窗沿落下来。',
            metadata: {
                source: 'date',
                statusCardData: {
                    cardType: 'freeform',
                    body: '雨夜状态栏',
                    meta: { html: '<div>雨夜状态栏</div>' },
                    style: { mood: '' },
                },
                hasDateStatusCard: true,
            },
        });
        const datePhoto = createMessage({
            id: 3,
            type: 'image',
            content: '/date-photo.png',
            timestamp: 3,
            metadata: {
                source: 'date_photo',
                isDatePhoto: true,
            },
        });

        const messages = [
            createMessage({ id: 1, timestamp: 1, metadata: { source: 'date', isOpening: true } }),
            statusReply,
            datePhoto,
        ];

        expect(findLatestDateStatusMessage(messages)?.id).toBe(statusReply.id);
        expect(findLatestDateStatusDialogueMessage(messages)?.id).toBe(statusReply.id);
    });

    it('does not treat an old status card as the current visual overlay after a newer user message', () => {
        const statusReply = createMessage({
            id: 2,
            metadata: {
                source: 'date',
                statusCardData: { cardType: 'custom_text', body: '旧状态', style: { mood: '' } },
                hasDateStatusCard: true,
            },
        });
        const userMessage = createMessage({
            id: 3,
            role: 'user',
            content: '你是不是有话没说？',
            timestamp: 3,
        });
        const messages = [statusReply, userMessage];

        expect(findLatestDateStatusMessage(messages)?.id).toBe(statusReply.id);
        expect(findLatestDateStatusDialogueMessage(messages)?.id).toBe(userMessage.id);
    });

    it('keeps only the recent status card ids for inline reader rendering', () => {
        const messages = Array.from({ length: 5 }, (_, index) => createMessage({
            id: index + 1,
            timestamp: index + 1,
            metadata: {
                source: 'date',
                statusCardData: { cardType: 'custom_text', body: `状态 ${index + 1}`, style: { mood: '' } },
                hasDateStatusCard: true,
            },
        }));

        expect([...getRecentDateStatusMessageIds(messages)]).toEqual([5, 4, 3]);
    });
});

