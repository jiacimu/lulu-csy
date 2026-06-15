import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterProfile, GroupProfile, Message, UserProfile } from '../types';
import {
    buildGroupChatHandoffBridge,
    formatGroupChatHandoffBridgeForPrompt,
    GROUP_CHAT_HANDOFF_ENTRY_LIMIT,
    GROUP_CHAT_HANDOFF_SOURCE_LIMIT,
    readGroupChatHandoffBridge,
    refreshGroupChatHandoffBridge,
} from './groupChatHandoffBridge';

const makeChar = (id: string, name: string): CharacterProfile => ({
    id,
    name,
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    createdAt: 1,
} as CharacterProfile);

const group: GroupProfile = {
    id: 'group-1',
    name: '夜聊小群',
    members: ['alice', 'bo'],
    createdAt: 1,
};

const userProfile: UserProfile = {
    name: '云朵',
    avatar: '',
    bio: '',
} as UserProfile;

const alice = makeChar('alice', '阿梨');
const bo = makeChar('bo', '薄荷');

function makeMessage(id: number): Message {
    const mode = id % 3;
    if (mode === 0) {
        return {
            id,
            charId: 'user',
            role: 'user',
            type: 'text',
            content: `用户消息 ${id}`,
            timestamp: id * 1000,
        };
    }
    return {
        id,
        charId: mode === 1 ? 'alice' : 'bo',
        role: 'assistant',
        type: 'text',
        content: `角色消息 ${id}`,
        timestamp: id * 1000,
    };
}

describe('group chat handoff bridge', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('builds a compact handoff from the latest group messages', () => {
        const messages = Array.from({ length: 45 }, (_, index) => makeMessage(index + 1));
        const bridge = buildGroupChatHandoffBridge({
            group,
            messages,
            characters: [alice, bo],
            userProfile,
        });

        expect(bridge).not.toBeNull();
        expect(bridge?.sourceMessageCount).toBe(GROUP_CHAT_HANDOFF_SOURCE_LIMIT);
        expect(bridge?.entries).toHaveLength(GROUP_CHAT_HANDOFF_ENTRY_LIMIT);
        expect(bridge?.entries[0].id).toBe(22);
        expect(bridge?.entries.at(-1)?.id).toBe(45);
    });

    it('starts after the formal memory checkpoint without overlapping recap windows', () => {
        localStorage.setItem('groupchat_live_memory_checkpoint_group-1', JSON.stringify({
            nextStart: 170,
            updatedAt: Date.now(),
        }));

        const bridge = buildGroupChatHandoffBridge({
            group,
            messages: Array.from({ length: 260 }, (_, index) => makeMessage(index + 1)),
            characters: [alice, bo],
            userProfile,
        });

        expect(bridge?.handoffStartIndex).toBe(200);
        expect(bridge?.sourceMessageCount).toBe(GROUP_CHAT_HANDOFF_SOURCE_LIMIT);
        expect(bridge?.entries).toHaveLength(GROUP_CHAT_HANDOFF_ENTRY_LIMIT);
        expect(bridge?.entries[0].id).toBe(237);
        expect(bridge?.entries.at(-1)?.id).toBe(260);
    });

    it('formats the current character as self for private chat prompts', () => {
        const bridge = refreshGroupChatHandoffBridge({
            group,
            messages: Array.from({ length: 45 }, (_, index) => makeMessage(index + 1)),
            characters: [alice, bo],
            userProfile,
        });
        const storedBridge = readGroupChatHandoffBridge(group.id);
        const prompt = formatGroupChatHandoffBridgeForPrompt(storedBridge || bridge!, alice, userProfile);

        expect(storedBridge?.entries).toHaveLength(GROUP_CHAT_HANDOFF_ENTRY_LIMIT);
        expect(prompt).toContain('阿梨（我）');
        expect(prompt).toContain('现场尾巴');
        expect(prompt).not.toContain('缓存口径');
    });

    it('keeps only public content and strips inner voice or private tags', () => {
        const bridge = buildGroupChatHandoffBridge({
            group,
            messages: [
                {
                    ...makeMessage(1),
                    content: '公开一句<心声>不要进桥</心声>[[PRIVATE: 私聊也不要]]结束',
                    metadata: { groupInnerVoice: '头像挂件里看的心声，不进桥' },
                },
                {
                    ...makeMessage(2),
                    metadata: { isPrivate: true },
                },
            ],
            characters: [alice, bo],
            userProfile,
        });

        const joined = bridge?.entries.map(entry => entry.content).join('\n') || '';
        expect(joined).toContain('公开一句');
        expect(joined).toContain('结束');
        expect(joined).not.toContain('不要进桥');
        expect(joined).not.toContain('私聊也不要');
        expect(joined).not.toContain('头像挂件');
        expect(bridge?.entries).toHaveLength(1);
    });

    it('drops stale bridges when the formal memory checkpoint advances', () => {
        refreshGroupChatHandoffBridge({
            group,
            messages: Array.from({ length: 260 }, (_, index) => makeMessage(index + 1)),
            characters: [alice, bo],
            userProfile,
        });
        expect(readGroupChatHandoffBridge(group.id)).not.toBeNull();

        localStorage.setItem('groupchat_live_memory_checkpoint_group-1', JSON.stringify({
            nextStart: 170,
            updatedAt: Date.now(),
        }));

        expect(readGroupChatHandoffBridge(group.id)).toBeNull();
    });
});
