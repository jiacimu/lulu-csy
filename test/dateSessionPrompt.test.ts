import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { buildDateSessionPromptMessages, runDateRecapBridgeFirstSync } from '../apps/DateApp';

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
