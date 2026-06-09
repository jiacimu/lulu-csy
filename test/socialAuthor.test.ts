import { describe, expect, it } from 'vitest';
import type { CharacterProfile, SocialPost, SubAccount } from '../types';
import {
    buildSocialIdentityIndex,
    normalizeGeneratedSocialComment,
    normalizeGeneratedSocialCommentsBatch,
    normalizeStoredSocialPost,
} from '../utils/socialAuthor';

function char(id: string, name: string, gender: CharacterProfile['gender'] = 'male'): CharacterProfile {
    return {
        id,
        name,
        gender,
        avatar: `${id}.png`,
        description: '',
        systemPrompt: `${name} 的人设`,
        memories: [],
    };
}

const chars = [
    char('male-1', '阿序', 'male'),
    char('female-1', '小鹿', 'female'),
];

const handles: Record<string, SubAccount[]> = {
    'male-1': [
        { id: 'main', handle: '阿序_main', note: '主账号' },
        { id: 'alt', handle: '今天不加班', note: '吐槽小号' },
    ],
    'female-1': [
        { id: 'main', handle: '小鹿日记', note: '主账号' },
    ],
};

const index = buildSocialIdentityIndex(chars, handles, { name: '糯米' }, { userSparkId: '95279527' });

describe('Spark social author normalization', () => {
    it('infers legacy post and comment identities without author metadata', () => {
        const legacy: SocialPost = {
            id: 'p1',
            authorName: '小鹿日记',
            authorAvatar: 'old.png',
            title: '今天的风有点甜',
            content: '路过花店。',
            images: ['✨'],
            likes: 0,
            isCollected: false,
            isLiked: false,
            comments: [
                { id: 'c1', authorName: '糯米', content: '好看', likes: 0 },
                { id: 'c2', authorName: '路过网友', content: '蹲后续', likes: 0 },
            ],
            timestamp: 1,
            tags: [],
        };

        const normalized = normalizeStoredSocialPost(index, legacy);

        expect(normalized.authorType).toBe('character');
        expect(normalized.charId).toBe('female-1');
        expect(normalized.subAccountId).toBe('main');
        expect(normalized.comments[0].authorType).toBe('user');
        expect(normalized.comments[1].authorType).toBe('npc');
    });

    it('drops generated user authors and invalid character authors', () => {
        expect(normalizeGeneratedSocialComment(index, {
            authorType: 'user',
            authorName: '糯米',
            content: '我来冒充一下',
        }, { mode: 'reply' }, 0)).toBeNull();

        expect(normalizeGeneratedSocialComment(index, {
            authorType: 'character',
            charId: 'male-1',
            authorName: '小鹿日记',
            content: '把别人的马甲套过来',
        }, { mode: 'comment' }, 1)).toBeNull();

        expect(normalizeGeneratedSocialComment(index, {
            authorType: 'character',
            authorName: '阿序_main',
            content: '没有 charId 也不行',
        }, { mode: 'comment' }, 2)).toBeNull();
    });

    it('renames npc author collisions without rewriting safe content', () => {
        const item = normalizeGeneratedSocialComment(index, {
            authorType: 'npc',
            authorName: '阿序_main',
            content: '这标题有点像下班前最后五分钟刷到的东西。',
            tone: '路过锐评',
            targetType: 'thread_general',
        }, { mode: 'comment' }, 3);

        expect(item).not.toBeNull();
        expect(item?.authorType).toBe('npc');
        expect(item?.authorName).not.toBe('阿序_main');
        expect(item?.content).toBe('这标题有点像下班前最后五分钟刷到的东西。');
    });

    it('drops npc collisions when content leaks private or reserved identity cues', () => {
        const item = normalizeGeneratedSocialComment(index, {
            authorType: 'npc',
            authorName: '小鹿日记',
            content: '我记得你上次私聊说过这件事，宝宝别难过。',
            tone: '共情',
            targetType: 'thread_general',
        }, { mode: 'reply' }, 4);

        expect(item).toBeNull();
    });

    it('flags same-tone comfort batches and unanchored user replies for retry', () => {
        const comfortBatch = normalizeGeneratedSocialCommentsBatch(index, [
            { authorType: 'npc', authorName: '路过甲', content: '抱抱你，慢慢来。', tone: '共情', targetType: 'thread_general' },
            { authorType: 'npc', authorName: '路过乙', content: '大家都会好起来。', tone: '共情', targetType: 'thread_general' },
        ], { mode: 'comment' });

        expect(comfortBatch.shouldRetry).toBe(true);
        expect(comfortBatch.issues).toContain('tone_not_diverse');
        expect(comfortBatch.issues).toContain('all_comments_are_comfort');

        const replyBatch = normalizeGeneratedSocialCommentsBatch(index, [
            { authorType: 'npc', authorName: '匿名冲浪人', content: '这个楼主的语气有点东西。', tone: '吃瓜', targetType: 'thread_general' },
        ], { mode: 'reply', userContent: '猫窝这句太离谱了' });

        expect(replyBatch.shouldRetry).toBe(true);
        expect(replyBatch.issues).toContain('reply_not_anchored_to_user_content');
    });

    it('keeps female character post-author targeting as post_author instead of defaulting to user_comment', () => {
        const batch = normalizeGeneratedSocialCommentsBatch(index, [
            {
                authorType: 'character',
                charId: 'male-1',
                authorName: '阿序_main',
                content: '小鹿这条不像随手发的，标题里那个“甜”有点故意。',
                tone: '认真分析',
                targetType: 'post_author',
            },
        ], { mode: 'comment', allowedCharacterIds: new Set(['male-1']) });

        expect(batch.items).toHaveLength(1);
        expect(batch.items[0].authorType).toBe('character');
        expect(batch.items[0].targetType).toBe('post_author');
    });
});
