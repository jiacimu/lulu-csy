import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/context', () => ({
    ContextBuilder: {
        buildCoreContext: vi.fn(() => ''),
    },
}));

vi.mock('../utils/db', () => ({
    DB: {
        getGroupMessages: vi.fn(async () => []),
    },
}));

vi.mock('../utils/realtimeContext', () => ({
    RealtimeContextManager: {
        buildFullContext: vi.fn(async () => ''),
        getTimeContext: vi.fn(() => ({
            dateStr: '2026-04-29',
            dayOfWeek: '周三',
            isWeekend: false,
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

vi.mock('../utils/vectorMemoryRetriever', () => ({
    VectorMemoryRetriever: {
        retrieve: vi.fn(async () => ''),
    },
}));

vi.mock('../utils/temporalContext', () => ({
    buildTemporalContext: vi.fn(() => '\n[时间感知]\n现在 20:00 晚上'),
}));

import { ChatPrompts } from '../utils/chatPrompts';
import type { CharacterProfile, Message, UserProfile } from '../types';

function character(): CharacterProfile {
    return {
        id: 'char-life-anchor',
        name: '测试角色',
        avatar: '',
        description: '',
        systemPrompt: '周一到周五随机两天才上班，其他时间会上课出去玩会宅在家。',
        memories: [],
    } as CharacterProfile;
}

function user(): UserProfile {
    return {
        name: '糯米',
        avatar: '',
        bio: '',
    };
}

describe('ChatPrompts life anchor injection', () => {
    it('keeps the schedule anchor out of ordinary chat history while preserving temporal context', () => {
        const now = new Date(2026, 3, 29, 20, 0, 0).getTime();
        vi.setSystemTime(now);
        const messages: Message[] = [
            {
                id: 1,
                charId: 'char-life-anchor',
                role: 'assistant',
                content: '我在店里',
                timestamp: now - 60_000,
            } as Message,
            {
                id: 2,
                charId: 'char-life-anchor',
                role: 'user',
                content: '今天休息吧，刚在家吃过饭',
                timestamp: now,
            } as Message,
        ];

        const history = ChatPrompts.buildMessageHistory(messages, 20, character(), user(), []);
        const last = history.apiMessages[history.apiMessages.length - 1].content as string;

        expect(last).not.toContain('【当前日程锚点】');
        expect(last).toContain('[时间感知]');
        expect(last).toContain('现在 20:00 晚上');
        vi.useRealTimers();
    });

    it('places the schedule anchor before the COT reality anchoring section', async () => {
        const now = new Date(2026, 3, 29, 20, 0, 0).getTime();
        vi.setSystemTime(now);
        const systemPrompt = await ChatPrompts.buildSystemPrompt(
            character(),
            user(),
            [],
            [],
            [],
            [],
        );

        expect(systemPrompt).toContain('### 【当前日程锚点】');
        expect(systemPrompt).toContain('旧聊天、旧生活碎片、旧记忆');
        expect(systemPrompt.indexOf('### 【当前日程锚点】')).toBeLessThan(systemPrompt.indexOf('Step 2 — 现实锚定'));
        vi.useRealTimers();
    });
});
