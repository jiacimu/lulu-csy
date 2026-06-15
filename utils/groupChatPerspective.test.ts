import { describe,expect,it } from 'vitest';
import type { CharacterProfile,Message,UserProfile } from '../types';
import {
    buildGroupLiveScenePrompt,
    buildGroupPerspectiveMessages,
    extractGroupLiveText,
    parseGroupSpeakerPlan,
    parseGroupSpeakerWaves,
} from './groupChatPerspective';

const makeChar = (id: string, name: string): CharacterProfile => ({
    id,
    name,
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    createdAt: 1,
} as CharacterProfile);

const userProfile: UserProfile = {
    name: '云朵',
    avatar: '',
    bio: '',
} as UserProfile;

const msg = (partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'charId' | 'content'>): Message => ({
    type: 'text',
    timestamp: partial.id * 1000,
    ...partial,
} as Message);

describe('group chat perspective', () => {
    it('flattens public group log from one speaker perspective', () => {
        const alice = makeChar('alice', '阿梨');
        const bo = makeChar('bo', '薄荷');
        const result = buildGroupPerspectiveMessages([
            msg({ id: 1, role: 'user', charId: 'user', content: '大家在吗' }),
            msg({ id: 2, role: 'assistant', charId: 'alice', content: '我在' }),
            msg({ id: 3, role: 'assistant', charId: 'bo', content: '刚看到\n怎么了' }),
            msg({ id: 4, role: 'user', charId: 'user', content: '想问点事' }),
            msg({ id: 5, role: 'assistant', charId: 'alice', content: '你说' }),
        ], {
            speaker: alice,
            userProfile,
            characters: [alice, bo],
        });

        expect(result.apiMessages).toEqual([
            { role: 'user', content: '「云朵」大家在吗' },
            { role: 'assistant', content: '我在' },
            { role: 'user', content: '「薄荷」刚看到\n「薄荷」怎么了\n「云朵」想问点事' },
            { role: 'assistant', content: '你说' },
        ]);
        expect(result.contextMessages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant']);
    });

    it('extracts inner voice and private commands from public output', () => {
        const extracted = extractGroupLiveText(`
<心声>这句话还是别让群里听出来。</心声>
我刚刚看到了
[[PRIVATE: 你别理他，我等下私下跟你说]]
`);

        expect(extracted.innerVoice).toBe('这句话还是别让群里听出来。');
        expect(extracted.privateCommands).toEqual([{ content: '你别理他，我等下私下跟你说' }]);
        expect(extracted.publicContent).toBe('我刚刚看到了');
        expect(extracted.publicContent).not.toContain('心声');
        expect(extracted.publicContent).not.toContain('PRIVATE');
    });

    it('parses speaker plans from JSON ids or names', () => {
        const alice = makeChar('alice', '阿梨');
        const bo = makeChar('bo', '薄荷');

        expect(parseGroupSpeakerPlan('{"speakers":["bo","alice"]}', [alice, bo])).toEqual(['bo', 'alice']);
        expect(parseGroupSpeakerPlan('["薄荷"]', [alice, bo])).toEqual(['bo']);
    });

    it('parses speaker waves and treats legacy speaker lists as serial waves', () => {
        const alice = makeChar('alice', '阿梨');
        const bo = makeChar('bo', '薄荷');
        const chen = makeChar('chen', '陈陈');

        expect(parseGroupSpeakerWaves('[["alice"],["薄荷","chen"]]', [alice, bo, chen])).toEqual([
            ['alice'],
            ['bo', 'chen'],
        ]);
        expect(parseGroupSpeakerWaves('{"speakers":["alice","bo"]}', [alice, bo, chen])).toEqual([
            ['alice'],
            ['bo'],
        ]);
        expect(parseGroupSpeakerWaves('[]', [alice, bo, chen])).toEqual([]);
        expect(parseGroupSpeakerWaves('not json', [alice, bo, chen])).toBeNull();
    });

    it('injects lightweight cognition notes into the group scene prompt', () => {
        const alice = makeChar('alice', '阿梨');
        const bo = makeChar('bo', '薄荷');

        const prompt = buildGroupLiveScenePrompt({
            groupName: '夜聊',
            speaker: alice,
            members: [alice, bo],
            userProfile,
            contextMode: 'snapshot',
            cognitionByMemberId: {
                bo: '以前合作过，嘴上互怼但彼此认可。',
            },
        });

        expect(prompt).toContain('「薄荷」：以前合作过，嘴上互怼但彼此认可。');
    });
});
