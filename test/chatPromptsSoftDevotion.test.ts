import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/context', () => ({
    ContextBuilder: {
        buildCoreContext: vi.fn(() => ''),
    },
}));

vi.mock('../utils/db', () => ({
    DB: {
        getGroupMessages: vi.fn(async () => []),
        getAllAnniversaries: vi.fn(async () => []),
    },
}));

vi.mock('../utils/realtimeContext', () => ({
    RealtimeContextManager: {
        buildFullContext: vi.fn(async () => ''),
        getTimeContext: vi.fn(() => ({
            dateStr: '2026-05-23',
            dayOfWeek: '周六',
            isWeekend: true,
        })),
        checkSpecialDates: vi.fn(() => []),
    },
    NotionManager: {
        getRecentDiaries: vi.fn(async () => ({ success: false, entries: [] })),
        getUserNotes: vi.fn(async () => ({ success: false, entries: [] })),
    },
    FeishuManager: {
        getRecentDiaries: vi.fn(async () => ({ success: false, entries: [] })),
    },
    defaultRealtimeConfig: {},
}));

vi.mock('../utils/hotSearchContext', () => ({
    buildCharacterHotSearch: vi.fn(async () => ''),
}));

vi.mock('../utils/aihotContext', () => ({
    buildCharacterAiHot: vi.fn(async () => ''),
}));

vi.mock('../utils/vectorMemoryRetriever', () => ({
    VectorMemoryRetriever: {
        retrieve: vi.fn(async () => ''),
    },
}));

vi.mock('../utils/temporalContext', () => ({
    buildTemporalContext: vi.fn(() => ''),
}));

import { ChatPrompts } from '../utils/chatPrompts';
import type { CharacterProfile, UserProfile } from '../types';

function character(softDevotionChatMode = false): CharacterProfile {
    return {
        id: 'char-soft-devotion',
        name: 'Sully',
        avatar: '',
        description: '',
        systemPrompt: '嘴硬，但会心软。',
        memories: [],
        softDevotionChatMode,
    } as CharacterProfile;
}

function user(): UserProfile {
    return {
        name: '糯米',
        avatar: '',
        bio: '',
    };
}

describe('ChatPrompts soft devotion mode', () => {
    it('does not inject the mode by default', async () => {
        const systemPrompt = await ChatPrompts.buildSystemPrompt(
            character(false),
            user(),
            [],
            [],
            [],
            [],
        );

        expect(systemPrompt).not.toContain('<soft_devotion_chat_mode>');
    });

    it('injects the role-bound mode between RP and speech rules when enabled', async () => {
        const systemPrompt = await ChatPrompts.buildSystemPrompt(
            character(true),
            user(),
            [],
            [],
            [],
            [],
        );

        const rpIndex = systemPrompt.indexOf('<rp_core>');
        const softIndex = systemPrompt.indexOf('<soft_devotion_chat_mode>');
        const speechIndex = systemPrompt.indexOf('<speech_soul>');

        expect(softIndex).toBeGreaterThan(rpIndex);
        expect(softIndex).toBeLessThan(speechIndex);
        expect(systemPrompt).toContain('糯米是你格外珍惜、格外偏爱、格外舍不得弄疼的人');
        expect(systemPrompt).toContain('本模式优先于通用 <equality> 规则里的部分禁用项');
        expect(systemPrompt).toContain('以 <equality> 和 <soft_devotion_chat_mode> 共同为基准');
    });
});
