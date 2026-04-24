import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAllCharacters: vi.fn(),
    saveCharacter: vi.fn(),
}));

vi.mock('../utils/db', () => ({
    DB: dbMocks,
}));

vi.mock('../utils/realtimeContext', () => ({
    RealtimeContextManager: {
        getTimeContext: () => ({
            timeStr: '22:15',
            timeOfDay: '夜晚',
            dateStr: '2026-04-14',
            dayOfWeek: '星期二',
        }),
    },
}));

import { MindSnapshotExtractor } from '../utils/mindSnapshotExtractor';

describe('MindSnapshotExtractor.generateInnerVoice', () => {
    const apiConfig = {
        baseUrl: 'https://example.com/v1',
        model: 'test-model',
        apiKey: 'test-key',
    };

    const baseCharacter = {
        id: 'char-1',
        name: 'Marcus',
        systemPrompt: '冷静、敏感，讲话克制。',
        moodState: undefined,
    } as any;

    const currentMsgs = [
        { role: 'user', type: 'text', content: '你明天还记得那个会吗？' },
        { role: 'assistant', type: 'text', content: '记得，我会提前看材料。' },
    ] as any[];

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
        dbMocks.getAllCharacters.mockResolvedValue([{ ...baseCharacter }]);
        dbMocks.saveCharacter.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function mockFetchContent(content: string) {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content } }],
            }),
        } as Response);
    }

    it('parses and normalizes classic inner voice text beyond 40 characters', async () => {
        mockFetchContent('{"innerVoice":"  今天风有点大，\\n\\n 但我还是想先把桌上的纸收好，再去想明天那场见面。  "}');

        const result = await MindSnapshotExtractor.generateInnerVoice(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
        );

        expect(result?.innerVoice).toBe('今天风有点大，\n但我还是想先把桌上的纸收好，再去想明天那场见面。');
        expect(dbMocks.saveCharacter).toHaveBeenCalledTimes(1);
        expect(dbMocks.saveCharacter.mock.calls[0][0].moodState.innerVoice).toBe(result?.innerVoice);
    });

    it('recovers innerVoice from raw output when JSON parsing fails', async () => {
        mockFetchContent('结果如下：\ninnerVoice: "今天不想再拖了，先把这件事做完再说。"');

        const result = await MindSnapshotExtractor.generateInnerVoice(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
        );

        expect(result?.innerVoice).toBe('今天不想再拖了，先把这件事做完再说。');
        expect(dbMocks.saveCharacter).toHaveBeenCalledTimes(1);
    });

    it('truncates classic inner voice text to 120 characters', async () => {
        const overlongInnerVoice = '想把这件事想清楚'.repeat(20);
        mockFetchContent(JSON.stringify({ innerVoice: overlongInnerVoice }));

        const result = await MindSnapshotExtractor.generateInnerVoice(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
        );

        expect(result).not.toBeNull();
        expect(result!.innerVoice.length).toBe(120);
        expect(result!.innerVoice).toBe(overlongInnerVoice.slice(0, 120));
    });

    it('replaces two-digit custom status template captures as full placeholders', async () => {
        const values = Array.from({ length: 11 }, (_, index) => `G${index + 1}`);
        const statusBlock = `<status>\n${values.map((value, index) => `F${index + 1}: ${value}`).join('\n')}\n</status>`;

        mockFetchContent(statusBlock);

        const result = await MindSnapshotExtractor.generateCustomCard(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            {
                id: 'tpl-custom',
                name: 'custom',
                systemPrompt: '输出 status 字段。',
                extractRegex: `<status>\\s*${values.map((_, index) => `F${index + 1}:\\s*(.*?)`).join('\\s*')}\\s*<\\/status>`,
                htmlTemplate: '<div>$1|$9|$10|$11|$12</div>',
                renderMode: 'html',
            },
        );

        expect(result?.meta?.html).toBe('<div>G1|G9|G10|G11|$12</div>');
    });
});
