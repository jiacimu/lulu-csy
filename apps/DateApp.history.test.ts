// @vitest-environment jsdom

import { describe,expect,it } from 'vitest';
import { buildHistorySessions } from './DateApp';
import type { Message } from '../types';

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
});
