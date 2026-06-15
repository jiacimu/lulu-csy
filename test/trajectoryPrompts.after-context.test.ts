import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import type { TrajectoryNode } from '../types/trajectory';
import {
    buildAfterMeetingMonologuePrompt,
    buildAfterMeetingNodeExtractionPrompt,
    buildWhisperResponsePrompt,
} from '../utils/trajectoryPrompts';

const userProfile: UserProfile = {
    name: '初初',
    avatar: '',
    bio: '女，温柔但慢热，喜欢雨天和旧书。',
    healthGender: 'female',
};

const character: CharacterProfile = {
    id: 'char-lize',
    name: '黎泽',
    avatar: '',
    description: '总是嘴硬的旧书店老板',
    systemPrompt: '黎泽谨慎、克制、嘴硬，但会把在意藏进具体行动里。',
    worldview: '旧雨城里，书店和电车站之间隔着一条常年潮湿的巷子。',
    memories: [
        { id: 'mem-1', date: '2026-06-01', mood: 'soft', summary: '初初在雨夜把伞留在书店门口。' },
    ],
    refinedMemories: {
        '2026-06': '初初和黎泽的关系从互相试探变成能共享沉默。',
    },
    activeMemoryMonths: ['2026-06'],
    mountedWorldbooks: [
        {
            id: 'wb-rain-city',
            title: '雨城与旧书店',
            category: '地点设定',
            position: 'after_worldview',
            content: '雨城设定原文：旧书店在黄昏后会点一盏蓝色台灯。',
        },
    ],
    impression: {
        version: 1,
        value_map: {
            likes: ['雨声', '安静陪伴'],
            dislikes: [],
            core_values: '平等和真诚',
        },
        behavior_profile: {
            tone_style: '轻声但有边界',
            emotion_summary: '慢热',
            response_patterns: '先观察再回应',
        },
        emotion_schema: {
            triggers: {
                positive: ['被认真记住'],
                negative: ['被忽视真实感受'],
            },
            comfort_zone: '不用解释太多也被接住',
            stress_signals: ['沉默'],
        },
        personality_core: {
            observed_traits: ['慢热', '敏感', '会把重要的事藏在玩笑里'],
            interaction_style: '需要被平等对待',
            summary: '初初不是背景板，她有明确的气质和边界。',
        },
    },
};

const afterNode: TrajectoryNode = {
    id: 'node-1',
    charId: character.id,
    age: 0,
    title: '雨夜没有收回的伞',
    era: 'after_meeting',
    mood: 'nostalgic',
    keywords: ['雨夜', '旧书店', '伞'],
    memorySource: 'vector',
    sortOrder: 100,
    createdAt: 1,
    updatedAt: 1,
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('trajectory after-meeting prompt context', () => {
    it('injects user profile, worldbooks, impression, and memories into after-node extraction', () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const prompt = buildAfterMeetingNodeExtractionPrompt(
            character,
            userProfile,
            '[1] 雨夜没有收回的伞\n初初在雨夜把伞留在书店门口。',
        );

        expect(prompt).toContain('### 互动对象 (User)');
        expect(prompt).toContain('- 名字: 初初');
        expect(prompt).toContain('女，温柔但慢热，喜欢雨天和旧书。');
        expect(prompt).toContain('雨城设定原文');
        expect(prompt).toContain('初初不是背景板');
        expect(prompt).toContain('初初和黎泽的关系从互相试探变成能共享沉默');
        expect(prompt).toContain('初初在雨夜把伞留在书店门口');
    });

    it('injects the same after-meeting context into monologue and whisper prompts', () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const monologuePrompt = buildAfterMeetingMonologuePrompt(
            character,
            afterNode,
            userProfile,
            '[1] 雨夜没有收回的伞\n初初在雨夜把伞留在书店门口。',
        );
        const whisperPrompt = buildWhisperResponsePrompt(character, afterNode, '你还记得我吗', userProfile);

        for (const prompt of [monologuePrompt, whisperPrompt]) {
            expect(prompt).toContain('### 互动对象 (User)');
            expect(prompt).toContain('雨城设定原文');
            expect(prompt).toContain('初初不是背景板');
            expect(prompt).toContain('女，温柔但慢热');
        }
    });
});
