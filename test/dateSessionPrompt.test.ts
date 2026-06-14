import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { buildDateNarrativeControlNote, buildDateSessionPromptMessages, buildDateStatusSnapshotForMainApi, runDateRecapBridgeFirstSync } from '../apps/DateApp';

const char = {
    id: 'char-1',
    name: 'Sully',
    avatar: '',
    description: '',
    systemPrompt: '你会认真回应。',
    memories: [],
    refinedMemories: {
        '2026-06': '一起在雨夜见过面。',
    },
    dateTimeAwarenessEnabled: false,
} as CharacterProfile;

const userProfile: UserProfile = {
    name: '糯米',
    avatar: '',
    bio: '',
};

describe('date session prompt assembly', () => {
    it('splits stable rules, context package, and current user input into three modules', () => {
        const messages = buildDateSessionPromptMessages({
            char,
            userProfile,
            allMsgs: [],
            historyContextBlock: '### 【最近对话上下文】\nSully: [normal] 上一轮正文。\n糯米: 本轮之前的话。',
            statusSnapshotBlock: '### 【当前线下状态快照】\n【此幕】\n此幕-当前场景: 雨夜 · 窗边餐桌',
            photoPromptBlock: '### 【请求发送见面照片】\n输出隐藏标签：`[[PHOTO_DECISION:true]]`。',
            statusPromptBlock: '### 线下状态栏随文生成\n本角色已启用线下状态栏。',
            currentUserInput: '我们现在去哪？',
            turnDirectives: {
                userName: userProfile.name,
                directorNote: '',
                photoPromptBlock: '',
                bilingualNote: '',
                lo: 105,
                hi: 195,
                rotationPicks: [],
                stallNudge: '',
            },
        });

        expect(messages).toHaveLength(3);
        expect(messages.map(message => message.role)).toEqual(['system', 'user', 'user']);

        const [systemMessage, contextMessage, userMessage] = messages.map(message => message.content);

        expect(systemMessage).toContain('MODULE 1 / SYSTEM_RULES');
        expect(systemMessage).toContain('<character_profile>');
        expect(systemMessage).toContain('### 你的身份');
        expect(systemMessage).not.toContain('<relationship_protocol>');
        expect(systemMessage).toContain('<rp_core_live>');
        expect(systemMessage).toContain('<date_protocol>');
        expect(systemMessage).toContain('Step 4 — 文风调度');
        expect(systemMessage).toContain('<output_contract>');
        expect(systemMessage).toContain('### 线下状态栏随文生成');
        expect(systemMessage).not.toContain('### 【当前线下状态快照】');
        expect(systemMessage).not.toContain('### 【最近对话上下文】');
        // trailing CoT trigger removed from system — now in turn_directives
        expect(systemMessage.trim().endsWith('开始思考，不得遗漏起始标签：')).toBe(false);
        // cot_protocol_live is now after output_contract (last block in MODULE 1)
        expect(systemMessage.indexOf('<output_contract>')).toBeLessThan(systemMessage.indexOf('</cot_protocol_live>'));

        expect(contextMessage).toContain('MODULE 2 / CONTEXT_PACKAGE');
        expect(contextMessage).toContain('<runtime_context>');
        expect(contextMessage).toContain('current_time: disabled');
        expect(contextMessage).toContain('<state_snapshot>');
        expect(contextMessage).toContain('此幕-当前场景: 雨夜 · 窗边餐桌');
        expect(contextMessage).toContain('<long_term_memory>');
        expect(contextMessage).toContain('一起在雨夜见过面');
        expect(contextMessage).toContain('<last_turns_raw>');
        expect(contextMessage).toContain('Sully: [normal] 上一轮正文。');
        // photo prompt removed from MODULE 2 special_note
        expect(contextMessage).not.toContain('### 【请求发送见面照片】');
        expect(contextMessage).not.toContain('<current_user_input>');

        expect(userMessage).toContain('MODULE 3 / CURRENT_USER_INPUT');
        expect(userMessage).toContain('<current_user_input>');
        expect(userMessage).toContain('我们现在去哪？');
        expect(userMessage).toContain('<turn_directives>');
        expect(userMessage).toContain('现在输出。你回复的第一个字符必须是 <thinking>。');
        expect(userMessage).not.toContain('上一轮正文');
    });

    it('does not inject old status snapshots when the Date status bar is disabled', () => {
        const statusMessage: Message = {
            id: 11,
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content: '[normal] 上一轮正文。',
            timestamp: 2000,
            metadata: {
                source: 'date',
                hasDateStatusCard: true,
                statusCardData: {
                    cardType: 'custom_text',
                    body: '此幕-当前场景: 雨夜',
                    style: {},
                    meta: {
                        dateStatusRaw: '【此幕】\n此幕-当前场景: 雨夜 · 窗边餐桌\n命途-当前弧线: 旧弧线',
                    },
                },
            },
        };

        expect(buildDateStatusSnapshotForMainApi({
            ...char,
            dateStatusBarEnabled: true,
        }, [statusMessage])).toContain('此幕-当前场景');

        expect(buildDateStatusSnapshotForMainApi({
            ...char,
            dateStatusBarEnabled: false,
        }, [statusMessage])).toBe('');
    });

    it('injects narrative control directives only when a mode is selected', () => {
        const baseInput = {
            char,
            userProfile,
            allMsgs: [],
            currentUserInput: '我靠近一点，但不要替我继续说。',
            turnDirectives: {
                userName: userProfile.name,
                directorNote: '',
                photoPromptBlock: '',
                bilingualNote: '',
                lo: 105,
                hi: 195,
                rotationPicks: [],
                stallNudge: '',
            },
        };

        const defaultUserMessage = buildDateSessionPromptMessages(baseInput)[2].content;
        expect(defaultUserMessage).not.toContain('本轮用户演绎权限');
        expect(defaultUserMessage).not.toContain('抢话');
        expect(defaultUserMessage).not.toContain('转述');
        expect(defaultUserMessage).not.toContain('专注');

        const paraphraseUserMessage = buildDateSessionPromptMessages({
            ...baseInput,
            turnDirectives: {
                ...baseInput.turnDirectives,
                narrativeControlNote: buildDateNarrativeControlNote('paraphrase', char.name, userProfile.name),
            },
        })[2].content;

        expect(paraphraseUserMessage).toContain('■ 本轮用户演绎权限：转述');
        expect(paraphraseUserMessage).toContain('将 <current_user_input> 视为本轮写作指导');
        expect(paraphraseUserMessage).not.toContain('■ 本轮用户演绎权限：抢话');
        expect(paraphraseUserMessage).not.toContain('绝对禁止任何对糯米的演绎');
    });

    it('follows the Date status bar switch in system output rules', () => {
        const baseInput = {
            char,
            userProfile,
            allMsgs: [],
            currentUserInput: '我们现在去哪？',
            turnDirectives: {
                userName: userProfile.name,
                directorNote: '',
                photoPromptBlock: '',
                bilingualNote: '',
                lo: 105,
                hi: 195,
                rotationPicks: [],
                stallNudge: '',
            },
        };

        const disabledSystemMessage = buildDateSessionPromptMessages(baseInput)[0].content;
        expect(disabledSystemMessage).not.toContain('<status>');
        expect(disabledSystemMessage).not.toContain('</status>');
        expect(disabledSystemMessage).not.toContain('状态栏格式');
        expect(disabledSystemMessage).not.toContain('status_bar_protocol');

        const enabledSystemMessage = buildDateSessionPromptMessages({
            ...baseInput,
            statusPromptBlock: '### 线下状态栏随文生成\n本角色已启用线下状态栏。',
        })[0].content;
        expect(enabledSystemMessage).toContain('4. 可选 <status>...</status>');
        expect(enabledSystemMessage).toContain('状态栏格式');
        expect(enabledSystemMessage).toContain('### 线下状态栏随文生成');
    });
});

describe('date recap bridge sync ordering', () => {
    it('saves recap, injects bridge, exits, then starts L0 extraction', async () => {
        const calls: string[] = [];

        const result = await runDateRecapBridgeFirstSync({
            saveSummaryRecord: async () => {
                calls.push('save-summary');
                return 42;
            },
            syncBridge: async (summaryMsgId) => {
                calls.push(`bridge:${summaryMsgId}`);
                return { ok: true, bridgeId: 77 };
            },
            finishExitSession: () => calls.push('finish-exit'),
            startL0Extraction: () => calls.push('start-l0'),
        });

        expect(result).toEqual({ ok: true, summaryMsgId: 42, bridgeId: 77 });
        expect(calls).toEqual(['save-summary', 'bridge:42', 'finish-exit', 'start-l0']);
    });

    it('keeps the session open and does not start L0 extraction when bridge injection fails', async () => {
        const calls: string[] = [];

        const result = await runDateRecapBridgeFirstSync({
            saveSummaryRecord: async () => {
                calls.push('save-summary');
                return 42;
            },
            syncBridge: async (summaryMsgId) => {
                calls.push(`bridge:${summaryMsgId}`);
                return { ok: false, reason: 'IndexedDB write failed' };
            },
            finishExitSession: () => calls.push('finish-exit'),
            startL0Extraction: () => calls.push('start-l0'),
        });

        expect(result).toEqual({ ok: false, summaryMsgId: 42, reason: 'IndexedDB write failed' });
        expect(calls).toEqual(['save-summary', 'bridge:42']);
    });
});
