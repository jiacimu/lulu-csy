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

    it('sends the main chat mirror before the secondary task prompt when available', async () => {
        mockFetchContent('{"innerVoice":"先把上方那段完整设定吃进去。"}');

        await MindSnapshotExtractor.generateInnerVoice(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            undefined,
            true,
            '',
            {
                mirrorMessages: [
                    { role: 'system', content: 'FULL SYSTEM PROMPT WITH WORLDBOOKS' },
                    { role: 'user', content: 'full db context line' },
                ],
                mirrorThinking: '角色刚刚的思考链',
                contextLimit: 1000000,
                historyMsgCount: 2,
                model: 'main-chat-model',
            },
        );

        const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
        expect(body.messages[0]).toEqual({ role: 'system', content: 'FULL SYSTEM PROMPT WITH WORLDBOOKS' });
        expect(body.messages[1]).toEqual({ role: 'user', content: 'full db context line' });
        expect(body.messages[2].role).toBe('user');
        expect(body.messages[2].content).toContain('Secondary Task Instructions');
        expect(body.messages[2].content).toContain('角色刚刚的思考链');
        expect(body.messages[2].content).toContain('请基于上方主聊天完整上下文镜像执行本任务');
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

        expect(result?.meta?.html).toBe('<div>G1|G9|G10|G11|</div>');
        expect(result?.meta?.allowScripts).not.toBe(true);
    });

    it('marks custom status cards as script-enabled only when the template opts in', async () => {
        mockFetchContent('<status>Text: ready</status>');

        const result = await MindSnapshotExtractor.generateCustomCard(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            {
                id: 'tpl-script',
                name: 'script template',
                systemPrompt: '输出 status 字段。',
                extractRegex: '<status>\\s*Text:\\s*(.*?)\\s*<\\/status>',
                htmlTemplate: '<div id="root">$1</div><script>document.getElementById("root").dataset.ready = "yes";</script>',
                allowScripts: true,
                renderMode: 'html',
            },
        );

        expect(result?.meta?.html).toContain('<script>');
        expect(result?.meta?.allowScripts).toBe(true);
    });

    it('generates custom status cards from layered templates', async () => {
        mockFetchContent('<status>\nMood: quiet\nPlace: library\n</status>');

        const result = await MindSnapshotExtractor.generateCustomCard(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            {
                id: 'tpl-layered',
                name: 'layered template',
                systemPrompt: '输出 status 字段。',
                extractRegex: '<status>\\s*Mood:\\s*(.*?)\\s*Place:\\s*(.*?)\\s*<\\/status>',
                htmlBody: '<section class="status-card"><strong>$1</strong><span>$2</span></section>',
                cssTemplate: '.status-card { color: #fff; }',
                jsTemplate: 'document.querySelector(".status-card")?.classList.add("ready");',
                templateVersion: 2,
                allowScripts: true,
                renderMode: 'html',
            },
        );

        expect(result?.meta?.html).toContain('<strong>quiet</strong>');
        expect(result?.meta?.html).toContain('<span>library</span>');
        expect(result?.meta?.html).toContain('.status-card { color: #fff; }');
        expect(result?.meta?.html).toContain('classList.add("ready")');
        expect(result?.meta?.allowScripts).toBe(true);
    });

    it('generates custom status cards from named placeholders without extractRegex', async () => {
        mockFetchContent('<status>\n心情: 安静\n弹幕:\n  - 第一条\n  - 第二条\n</status>');

        const result = await MindSnapshotExtractor.generateCustomCard(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            {
                id: 'tpl-named',
                name: 'named template',
                systemPrompt: '输出 status 字段。',
                extractRegex: '',
                fields: [
                    { id: 'field_1', name: '心情', description: '当前心情', required: true },
                    { id: 'field_2', name: '弹幕', description: '直播弹幕', required: true, type: 'list' },
                ],
                htmlBody: '<section class="status-card"><strong>{{心情}}</strong><ul>{{#弹幕}}<li>{{.}}</li>{{/弹幕}}</ul></section>',
                cssTemplate: '.status-card { color: #fff; }',
                jsTemplate: 'document.body.dataset.count = String(window.__statusData["弹幕"].length);',
                templateVersion: 2,
                allowScripts: true,
                renderMode: 'html',
            },
        );

        expect(result?.meta?.html).toContain('<strong>安静</strong>');
        expect(result?.meta?.html).toContain('<li>第一条</li><li>第二条</li>');
        expect(result?.meta?.html).toContain('window.__statusData');
        expect(result?.meta?.allowScripts).toBe(true);
    });

    it('uses parsed named fields even when a legacy extractRegex is present', async () => {
        mockFetchContent('<status>\n心情: 安静\nMood: quiet\n</status>');

        const result = await MindSnapshotExtractor.generateCustomCard(
            baseCharacter,
            '我会提前看材料。',
            currentMsgs as any,
            apiConfig,
            {
                id: 'tpl-mixed',
                name: 'mixed template',
                systemPrompt: '输出 status 字段。',
                extractRegex: '<status>[\\s\\S]*?Mood:\\s*(.*?)\\s*<\\/status>',
                fields: [
                    { id: 'field_1', name: '心情', description: '当前心情', required: true },
                ],
                htmlBody: '<section class="status-card"><strong>{{心情}}</strong><span>$1</span></section>',
                templateVersion: 2,
                renderMode: 'html',
            },
        );

        expect(result?.meta?.html).toContain('<strong>安静</strong><span>quiet</span>');
        expect(result?.meta?.html).not.toContain('{{心情}}');
    });
});
