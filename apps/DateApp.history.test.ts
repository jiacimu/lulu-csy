// @vitest-environment jsdom

import { beforeEach,describe,expect,it,vi } from 'vitest';

vi.mock('../utils/eventExtractor', () => ({
    EventExtractor: {
        extract: vi.fn(() => Promise.resolve()),
        hasTimeKeyword: vi.fn(() => true),
    },
}));

import {
    appendDateTemporalContext,
    buildDateForkBridgeContent,
    buildDateForkOpeningText,
    buildDateSessionSystemPrompt,
    buildHistorySessions,
    maybeExtractDateTemporalEvent,
} from './DateApp';
import { EventExtractor } from '../utils/eventExtractor';
import type { CharacterProfile,Message,UserProfile } from '../types';

const makeMessage = (
    id: number,
    timestamp: number,
    metadata: Record<string, unknown>,
    role: Message['role'] = 'assistant',
): Message => ({
    id,
    charId: 'char-1',
    role,
    type: 'text',
    content: `message-${id}`,
    timestamp,
    metadata,
});

const makeCharacter = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-1',
    name: 'Sully',
    avatar: '',
    description: '',
    systemPrompt: '你是 Sully。',
    memories: [],
    ...overrides,
} as CharacterProfile);

const makeUserProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
    name: '小米',
    avatar: '',
    bio: '',
    ...overrides,
});

const mockedExtract = vi.mocked(EventExtractor.extract);
const mockedHasTimeKeyword = vi.mocked(EventExtractor.hasTimeKeyword);

beforeEach(() => {
    mockedExtract.mockClear();
    mockedHasTimeKeyword.mockReset();
    mockedHasTimeKeyword.mockReturnValue(true);
});

describe('buildHistorySessions', () => {
    it('shows hidden summarized date dialogue in history while keeping summaries and bridges separate', () => {
        const opening = makeMessage(1, 1_000, { source: 'date', isOpening: true });
        const hiddenUser = makeMessage(2, 2_000, {
            source: 'date',
            hiddenFromUser: true,
            dateSummaryAutoHidden: true,
            hiddenBySummaryMsgId: 4,
        }, 'user');
        const hiddenAssistant = makeMessage(3, 3_000, {
            source: 'date',
            hiddenFromUser: true,
            dateSummaryAutoHidden: true,
            hiddenBySummaryMsgId: 4,
        });
        const summary = makeMessage(4, 4_000, {
            source: 'date',
            hiddenFromUser: true,
            isSummary: true,
            summaryType: 'auto',
            sessionStartMsgId: 1,
            coveredMsgIds: [1, 2, 3],
        }, 'system');
        const bridge = makeMessage(5, 5_000, {
            source: 'date',
            hiddenFromUser: true,
            isDateContextBridge: true,
            bridgeType: 'summary',
            sessionStartMsgId: 1,
            coveredMsgIds: [1, 2, 3],
        }, 'system');
        const normalChat = makeMessage(6, 6_000, { source: 'chat', hiddenFromUser: true });

        const sessions = buildHistorySessions([
            normalChat,
            bridge,
            summary,
            hiddenAssistant,
            hiddenUser,
            opening,
        ]);

        expect(sessions).toHaveLength(1);
        expect(sessions[0].msgs.map(m => m.id)).toEqual([1, 2, 3]);
        expect(sessions[0].msgs.every(m => m.metadata?.source === 'date')).toBe(true);
        expect(sessions[0].summaries.map(m => m.id)).toEqual([4]);
        expect(sessions[0].bridges.map(m => m.id)).toEqual([5]);
    });

    it('keeps a fork bridge attached to the new copied date session', () => {
        const oldOpening = makeMessage(1, 1_000, { source: 'date', isOpening: true });
        const oldUser = makeMessage(2, 2_000, { source: 'date' }, 'user');
        const newOpening = makeMessage(10, 10_000, {
            source: 'date',
            isOpening: true,
            forkedFromSessionStartMsgId: 1,
        });
        const forkBridge = makeMessage(11, 10_001, {
            source: 'date',
            hiddenFromUser: true,
            isDateContextBridge: true,
            bridgeType: 'fork',
            sessionStartMsgId: 10,
            forkedFromSessionStartMsgId: 1,
            forkedFromMessageIds: [1, 2],
        }, 'system');

        const sessions = buildHistorySessions([oldOpening, oldUser, newOpening, forkBridge]);

        expect(sessions).toHaveLength(2);
        expect(sessions[0].startMsgId).toBe(10);
        expect(sessions[0].msgs.map(m => m.id)).toEqual([10]);
        expect(sessions[0].bridges.map(m => m.id)).toEqual([11]);
        expect(sessions[1].startMsgId).toBe(1);
        expect(sessions[1].msgs.map(m => m.id)).toEqual([1, 2]);
        expect(sessions[1].bridges).toHaveLength(0);
    });

    it('builds an immersive fork opening and hidden bridge context', () => {
        const session = buildHistorySessions([
            makeMessage(1, 1_000, { source: 'date', isOpening: true }),
            makeMessage(2, 2_000, { source: 'date' }, 'user'),
            makeMessage(3, 3_000, {
                source: 'date',
                hiddenFromUser: true,
                isSummary: true,
                summaryType: 'manual',
                sessionStartMsgId: 1,
            }, 'system'),
        ])[0];

        const opening = buildDateForkOpeningText({ charName: 'Sully', userName: '小米' });
        const bridge = buildDateForkBridgeContent({ session, charName: 'Sully', userName: '小米' });

        expect(opening).toContain('[normal]');
        expect(opening).toContain('Sully');
        expect(opening).toContain('小米');
        expect(bridge).toContain('旧见面分岔背景');
        expect(bridge).toContain('已有总结 1');
        expect(bridge).toContain('Sully: message-1');
        expect(bridge).toContain('小米: message-2');
    });
});

describe('date temporal awareness helpers', () => {
    it('injects the current time block into the date session system prompt', () => {
        const prompt = buildDateSessionSystemPrompt({
            char: makeCharacter(),
            userProfile: makeUserProfile(),
            allMsgs: [],
        });

        expect(prompt).toContain('### 【当前时间】');
        expect(prompt).toContain('读取上方系统提供的【当前时间】');
    });

    it('appends temporal context to the user prompt content', () => {
        expect(appendDateTemporalContext('我到了', '\n[时间感知]\n现在 20:00 晚上'))
            .toBe('我到了\n\n[时间感知]\n现在 20:00 晚上');
        expect(appendDateTemporalContext('我到了', '')).toBe('我到了');
    });

    it('starts background event extraction only when secondary API is complete and text matches time keywords', () => {
        maybeExtractDateTemporalEvent('char-1', '外卖半小时后到', {
            baseUrl: 'https://example.test',
            apiKey: 'key',
            model: 'model',
        });

        expect(mockedExtract).toHaveBeenCalledWith('char-1', '外卖半小时后到', {
            baseUrl: 'https://example.test',
            apiKey: 'key',
            model: 'model',
        });

        mockedExtract.mockClear();
        maybeExtractDateTemporalEvent('char-1', '外卖半小时后到', {
            baseUrl: 'https://example.test',
            apiKey: '',
            model: 'model',
        });
        expect(mockedExtract).not.toHaveBeenCalled();

        mockedHasTimeKeyword.mockReturnValue(false);
        maybeExtractDateTemporalEvent('char-1', '只是普通见面闲聊', {
            baseUrl: 'https://example.test',
            apiKey: 'key',
            model: 'model',
        });
        expect(mockedExtract).not.toHaveBeenCalled();
    });
});
