import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_GENERATION_CONFIG } from './runtimeConfig';
import {
    appendLoveShowSocialSignals,
    canUseLoveShowSocialImage2,
    createLoveShowAltPostFromSecret,
    createLoveShowGuestScenePosts,
    createLoveShowProgramWindPosts,
    createLoveShowSocialSignal,
    ensureLoveShowPostCommentFloor,
    getLoveShowSocialImagePlan,
    LOVE_SHOW_MIN_COMMENTS_PER_POST,
    markLoveShowSocialSignalsConsumed,
    normalizeLoveShowSocialPost,
} from './loveshowSocial';
import type { LoveShowPrivateSecret } from '../types/loveshow';

describe('LoveShow social feed', () => {
    it('normalizes legacy hot-list posts into feed posts', () => {
        const post = normalizeLoveShowSocialPost({
            id: 'old-post',
            platform: 'weibo',
            username: '追更中',
            content: '今天这个眼神太明显了',
            likes: 42,
            dayNumber: 1,
        }, 1);

        expect(post.authorType).toBe('audience');
        expect(post.authorName).toBe('追更中');
        expect(post.likeCount).toBe(42);
        expect(post.comments).toEqual([]);
        expect(post.source).toBe('system');
    });

    it('uses image2-compatible presets and refuses NAI for feed images', () => {
        const novelAiConfig = DEFAULT_IMAGE_GENERATION_CONFIG;
        const image2Config = {
            ...DEFAULT_IMAGE_GENERATION_CONFIG,
            activeProvider: 'openai-compatible' as const,
            openaiCompatible: {
                ...DEFAULT_IMAGE_GENERATION_CONFIG.openaiCompatible,
                baseUrl: 'https://image.example.test/v1',
                apiKey: 'key',
                model: 'gpt-image-2',
            },
        };

        expect(canUseLoveShowSocialImage2(novelAiConfig)).toBe(false);
        expect(canUseLoveShowSocialImage2(image2Config)).toBe(true);
        expect(getLoveShowSocialImagePlan('guest_selfie', 'cg')).toMatchObject({
            mode: 'solo',
            presetId: 'loveshow-solo-cg',
            includeAppearance: true,
            includeUserAppearance: false,
        });
        expect(getLoveShowSocialImagePlan('date_scene', 'real')).toMatchObject({
            mode: 'couple',
            presetId: 'loveshow-couple-real',
            includeUserAppearance: true,
        });
        expect(getLoveShowSocialImagePlan('user_post_image', 'guoman')).toMatchObject({
            mode: 'solo',
            presetId: 'loveshow-solo-guoman',
            includeAppearance: true,
            includeUserAppearance: true,
        });
        expect(getLoveShowSocialImagePlan('alt_account_mood', 'guoman').includeAppearance).toBe(false);
    });

    it('keeps social interactions as consumable signals', () => {
        const likeSignal = createLoveShowSocialSignal({
            id: 'signal-like',
            sourcePostId: 'post-1',
            actorId: 'user',
            actorType: 'user',
            targetGuestId: 'guest-a',
            action: 'like',
            intensity: 'weak',
        });
        const commentSignal = createLoveShowSocialSignal({
            id: 'signal-comment',
            sourcePostId: 'post-1',
            actorId: 'user',
            actorType: 'user',
            targetGuestId: 'guest-a',
            action: 'comment',
            intensity: 'medium',
        });

        const appended = appendLoveShowSocialSignals([], [likeSignal, commentSignal]);
        expect(appended.every(signal => signal.consumed === false)).toBe(true);

        const consumed = markLoveShowSocialSignalsConsumed(appended, ['signal-like']);
        expect(consumed.find(signal => signal.id === 'signal-like')?.consumed).toBe(true);
        expect(consumed.find(signal => signal.id === 'signal-comment')?.consumed).toBe(false);
    });

    it('renders program wind posts from existing wind items', () => {
        const posts = createLoveShowProgramWindPosts({
            day: 2,
            windItems: [{
                id: 'wind-a',
                type: 'solo_date',
                guestId: 'guest-a',
                title: '下一轮镜头',
                body: '观众想看阿序和你单独聊聊。',
            }],
        });

        expect(posts).toHaveLength(1);
        expect(posts[0]).toMatchObject({
            id: 'program_wind_wind-a',
            authorType: 'program',
            source: 'wind',
            authorGuestId: 'guest-a',
        });
    });

    it('derives alt posts from private secrets without revealing exact secret text', () => {
        const secret: LoveShowPrivateSecret = {
            id: 'secret-a',
            seasonId: 'season-a',
            day: 1,
            guestId: 'guest-a',
            userName: '小雨',
            kind: 'confession',
            intensity: 'charged',
            summary: '阿序承认只想收到小雨的短信',
            privateLine: '我只想收到你的短信',
            publicSubtextHint: '公开场会在短信话题里停顿',
            createdAt: 100,
        };
        const post = createLoveShowAltPostFromSecret({
            secret,
            guest: { id: 'guest-a', name: '阿序' },
            day: 1,
            imageStyle: 'guoman',
            enableImage: true,
        });

        expect(post.authorType).toBe('guest_alt');
        expect(post.hiddenOwnerGuestId).toBe('guest-a');
        expect(post.content).not.toContain(secret.summary);
        expect(post.content).not.toContain('我只想收到你的短信');
        expect(post.image?.intent).toBe('alt_account_mood');
    });

    it('fills user posts with guest and audience replies', () => {
        const post = normalizeLoveShowSocialPost({
            id: 'user-post-a',
            platform: 'weibo',
            username: '小雨',
            authorType: 'user',
            authorId: 'user',
            authorName: '小雨',
            content: '刚才那一秒我其实有点想回头。',
            dayNumber: 1,
            source: 'user_action',
        }, 1);

        const enriched = ensureLoveShowPostCommentFloor(post, {
            userName: '小雨',
            guests: [
                { id: 'guest-a', name: '阿序' },
                { id: 'guest-b', name: '沈既白' },
                { id: 'guest-c', name: '林见川' },
            ],
            createdAt: 100,
        });

        expect(enriched.comments).toHaveLength(LOVE_SHOW_MIN_COMMENTS_PER_POST);
        expect(enriched.comments.some(comment => comment.authorType === 'guest')).toBe(true);
        expect(enriched.comments.some(comment => comment.authorType === 'audience')).toBe(true);
        expect(enriched.comments.every(comment => comment.content.trim().length > 8)).toBe(true);
    });

    it('fills guest-to-guest feed replies with a full user-centered comment floor', () => {
        const posts = createLoveShowGuestScenePosts({
            day: 1,
            sceneSummary: '阿序和小雨在厨房停顿了一下',
            userName: '小雨',
            guests: [
                { id: 'guest-a', name: '阿序' },
                { id: 'guest-b', name: '沈既白' },
            ],
            preferredGuestId: 'guest-a',
            imageStyle: 'cg',
            enableImage: true,
        });

        expect(posts).toHaveLength(1);
        expect(posts[0].comments).toHaveLength(LOVE_SHOW_MIN_COMMENTS_PER_POST);
        expect(posts[0].comments.some(comment => comment.authorType === 'guest')).toBe(true);
        expect(posts[0].comments.some(comment => comment.authorType === 'audience')).toBe(true);
        expect(posts[0].comments.every(comment => comment.content.includes('小雨') || comment.content.trim().length > 8)).toBe(true);
        expect(posts[0].image?.stylePresetId).toBe('loveshow-solo-cg');
    });
});
