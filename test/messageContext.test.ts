import { describe, expect, it } from 'vitest';
import {
    formatMessageForContext,
    shouldIncludeMessageInContext,
} from '../utils/messageContext';
import { ChatPrompts } from '../utils/chatPrompts';
import { formatMessages as formatExtractionMessages } from '../utils/engines/extractionLlm';
import type { Message } from '../types';

function msg(overrides: Partial<Message>): Message {
    return {
        id: 1,
        charId: 'char-1',
        role: 'user',
        type: 'text',
        content: '',
        timestamp: new Date(2026, 3, 21, 10, 30).getTime(),
        ...overrides,
    };
}

const character = {
    id: 'char-1',
    name: '糯米',
    avatar: 'avatar.png',
    description: '',
    systemPrompt: '',
    worldview: '',
    refinedMemories: {},
    activeMemoryMonths: [],
    memories: [],
    mountedWorldbooks: [],
} as any;

const user = {
    name: '栗子',
    avatar: 'avatar.png',
    bio: '',
} as any;

describe('message context formatter', () => {
    it('keeps assistant TTS voice text in chat history', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([
            msg({
                role: 'assistant',
                type: 'voice',
                content: '',
                metadata: { source: 'read-aloud', sourceText: '我刚才说的是饭团，不是别的。' },
            }),
        ], 10, character, user, []);

        expect(apiMessages[0]?.content).toContain('[语音消息] 我刚才说的是饭团，不是别的。');
        expect(apiMessages[0]?.content).not.toContain('[你上一条语音]');
    });

    it('keeps user read-aloud voice via sourceText', () => {
        const text = formatMessageForContext(msg({
            type: 'voice',
            content: '',
            metadata: { source: 'read-aloud', sourceText: '这条文字被朗读后仍要进上下文。' },
        }), {
            surface: 'chat',
            charName: '糯米',
        });

        expect(text).toBe('[🎤用户语音] 这条文字被朗读后仍要进上下文。');
    });

    it('formats rich chat messages instead of dropping them', () => {
        const messages = [
            msg({ type: 'image', content: 'https://example.com/a.png' }),
            msg({ type: 'emoji', content: 'sticker-url' }),
            msg({ type: 'transfer', content: '[转账]', metadata: { amount: '52.00', status: 'accepted' } }),
            msg({ type: 'social_card', content: '', metadata: { post: { title: '今天的云', content: '像一块软糖' } } }),
            msg({ type: 'xhs_card', content: '', metadata: { xhsNote: { title: '探店', author: '栗子', likes: 8, desc: '好吃' } } }),
            msg({
                type: 'chat_forward',
                content: JSON.stringify({
                    fromCharName: 'Sully',
                    count: 2,
                    messages: [
                        { role: 'user', type: 'text', content: '早安' },
                        { role: 'assistant', type: 'voice', content: '', metadata: { sourceText: '早安呀' } },
                    ],
                }),
            }),
        ];

        const formatted = messages.map(m => formatMessageForContext(m, {
            surface: 'memoryExtraction',
            charName: '糯米',
            emojis: [{ name: '挥手', url: 'sticker-url' }],
        }));

        expect(formatted.join('\n')).toContain('[发送了一张图片]');
        expect(formatted.join('\n')).toContain('[发送了表情包: 挥手]');
        expect(formatted.join('\n')).toContain('你已收取用户的 ¥52.00 转账');
        expect(formatted.join('\n')).toContain('标题: 今天的云');
        expect(formatted.join('\n')).toContain('标题: 探店');
        expect(formatted.join('\n')).toContain('用户转发了与 Sully 的 2 条聊天记录');
        expect(formatted.join('\n')).toContain('[语音] 早安呀');
    });

    it('uses low-induction formats for main chat generation context', () => {
        const assistantEmoji = formatMessageForContext(msg({
            role: 'assistant',
            type: 'emoji',
            content: 'sticker-url',
        }), {
            surface: 'chat',
            charName: '糯米',
            emojis: [{ name: '挥手', url: 'sticker-url' }],
        });
        const userEmoji = formatMessageForContext(msg({
            role: 'user',
            type: 'emoji',
            content: 'sticker-url',
        }), {
            surface: 'chat',
            charName: '糯米',
            emojis: [{ name: '挥手', url: 'sticker-url' }],
        });
        const assistantTransfer = formatMessageForContext(msg({
            role: 'assistant',
            type: 'transfer',
            content: '[转账]',
            metadata: { amount: '52.00', status: 'pending' },
        }), {
            surface: 'chat',
            charName: '糯米',
        });
        const userTransfer = formatMessageForContext(msg({
            role: 'user',
            type: 'transfer',
            content: '[转账]',
            metadata: { amount: '52.00', status: 'pending' },
        }), {
            surface: 'chat',
            charName: '糯米',
        });

        expect(assistantEmoji).toBe('[[SEND_EMOJI: 挥手]]');
        expect(assistantEmoji).not.toContain('发送了表情包');
        expect(userEmoji).toBe('[用户发来的表情包「挥手」]');
        expect(assistantTransfer).toBe('[[ACTION:TRANSFER:52.00]]');
        expect(userTransfer).toBe('[用户给你转账 ¥52.00，等待你收款]');
    });

    it('formats emoji messages with registry, metadata, and URL filename fallbacks', () => {
        const registryEmoji = formatMessageForContext(msg({
            role: 'assistant',
            type: 'emoji',
            content: 'https://cdn.example/stickers/sully-goodnight.png',
        }), {
            surface: 'memoryExtraction',
            charName: '糯米',
            emojis: [{ name: 'Sully晚安', url: 'https://cdn.example/stickers/sully-goodnight.png' }],
        });
        const metadataEmoji = formatMessageForContext(msg({
            role: 'assistant',
            type: 'emoji',
            content: 'data:image/png;base64,very-large-sticker',
            metadata: { name: '委屈' },
        }), {
            surface: 'memoryExtraction',
            charName: '糯米',
        });
        const filenameEmoji = formatMessageForContext(msg({
            role: 'assistant',
            type: 'emoji',
            content: 'https://cdn.example/stickers/kiss-face.webp?size=2',
        }), {
            surface: 'memoryExtraction',
            charName: '糯米',
        });

        expect(registryEmoji).toBe('[发送了表情包: Sully晚安]');
        expect(metadataEmoji).toBe('[发送了表情包: 委屈]');
        expect(filenameEmoji).toBe('[发送了表情包: kiss face]');
        expect(metadataEmoji).not.toContain('data:image');
    });

    it('keeps generated assistant images as lightweight summaries in main chat history', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([
            msg({
                role: 'assistant',
                type: 'image',
                content: 'data:image/png;base64,very-large-generated-image',
                metadata: {
                    imageId: 'photo-1',
                    visualSummary: '窗边自拍，暖光，近景构图。',
                },
            }),
        ], 10, character, user, []);

        expect(apiMessages[0]?.content).toBe('[2026-04-21 10:30] [你发送过的图片] 窗边自拍，暖光，近景构图。');
    });

    it('only attaches raw image content for the latest user image', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([
            msg({
                id: 1,
                type: 'image',
                content: 'data:image/png;base64,older-user-image',
                metadata: { caption: '上一张图' },
            }),
            msg({
                id: 2,
                type: 'image',
                content: 'data:image/png;base64,latest-user-image',
                metadata: { caption: '最新图片' },
                timestamp: new Date(2026, 3, 21, 10, 31).getTime(),
            }),
        ], 10, character, user, []);

        expect(apiMessages[0]?.content).toBe('[2026-04-21 10:30] [用户发来的图片] 上一张图');
        expect(Array.isArray(apiMessages[1]?.content)).toBe(true);
        expect(apiMessages[1]?.content[1]).toEqual({
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,latest-user-image' },
        });
    });

    it('formats image reply prefixes without leaking raw image URLs', () => {
        const text = formatMessageForContext(msg({
            role: 'user',
            content: '好帅',
            replyTo: {
                id: 91,
                name: '糯米',
                content: 'https://cdn.example.com/generated/window-selfie.webp',
                type: 'image',
                visualSummary: '窗边自拍',
            },
        }), {
            surface: 'chat',
            charName: '糯米',
        });

        expect(text).toContain('[回复 "窗边自拍...');
        expect(text).toContain('好帅');
        expect(text).not.toContain('https://cdn.example.com');
    });

    it('keeps secondary model summaries unchanged while group director is low-induction', () => {
        const source = msg({
            role: 'assistant',
            type: 'emoji',
            content: 'sticker-url',
        });
        const secondary = formatMessageForContext(source, {
            surface: 'secondaryModel',
            charName: '糯米',
            emojis: [{ name: '挥手', url: 'sticker-url' }],
        });
        const groupDirector = formatMessageForContext(source, {
            surface: 'groupDirector',
            charName: '糯米',
            emojis: [{ name: '挥手', url: 'sticker-url' }],
        });

        expect(secondary).toBe('[发送了表情包: 挥手]');
        expect(groupDirector).toBe('[[SEND_EMOJI: 挥手]]');
    });

    it('includes hidden soul_reflection with the follow-up constraint', () => {
        const text = formatMessageForContext(msg({
            role: 'assistant',
            type: 'soul_reflection',
            content: '我需要更主动承认刚才的遗漏。',
            metadata: { hiddenFromUser: true, source: 'soul_reflection' },
        }), {
            surface: 'chat',
            charName: '糯米',
        });

        expect(text).toContain('[糯米的回神 - 停下来审视自己]');
        expect(text).toContain('自然地在言行中体现调整');
    });

    it('excludes status bar ecosystem content from context and extraction', () => {
        const statusLike = [
            msg({ metadata: { source: 'inner_voice', innerVoice: '这只是心声展示层。' } }),
            msg({ type: 'status_card' as any, content: '状态卡正文' }),
            msg({
                metadata: {
                    source: 'creative_card',
                    statusBarMode: 'creative',
                    statusCardData: { cardType: 'diary', body: '卡片正文', style: {} },
                },
            }),
            msg({
                metadata: {
                    source: 'custom_status',
                    lastStatusCard: { cardType: 'freeform', body: 'HTML 摘要', style: {} },
                },
            }),
        ];

        for (const message of statusLike) {
            expect(shouldIncludeMessageInContext(message)).toBe(false);
            expect(formatMessageForContext(message, { surface: 'memoryExtraction', charName: '糯米' })).toBeNull();
        }
    });

    it('uses the shared formatter for memory extraction windows', () => {
        const formatted = formatExtractionMessages([
            {
                timestamp: 1,
                role: 'assistant',
                type: 'voice',
                content: '',
                metadata: { sourceText: 'TTS 里的正文不能丢。' },
            },
            {
                timestamp: 2,
                role: 'assistant',
                type: 'soul_reflection',
                content: '我会把刚才的遗漏补回来。',
                metadata: { hiddenFromUser: true, source: 'soul_reflection' },
            },
            {
                timestamp: 3,
                role: 'assistant',
                type: 'status_card',
                content: '状态栏卡片正文不应被提取。',
                metadata: { source: 'creative_card' },
            },
        ], '糯米');

        expect(formatted).toContain('[语音消息] TTS 里的正文不能丢。');
        expect(formatted).toContain('[糯米的回神 - 停下来审视自己]');
        expect(formatted).not.toContain('状态栏卡片正文');
    });
});
