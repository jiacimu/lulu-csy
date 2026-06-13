import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectionWallItem } from '../types';
import {
    COLLECTION_WALL_REMARK_MAX_TOKENS,
    buildCollectionWallVisitSystemPrompt,
    buildCharWallNoteItem,
    isDuplicateCharWallRemark,
    noteCoversAnyUserItemCenter,
    parseCharWallNoteResponse,
    requestCharWallNote,
    resolveCharWallNoteRect,
} from './collectionWallCoCreation';

const userItem = (overrides: Partial<CollectionWallItem> = {}): CollectionWallItem => ({
    id: 'user-item',
    wallId: 'wall-a',
    type: 'card',
    author: 'user',
    x: 40,
    y: 40,
    w: 200,
    h: 120,
    rotation: 0,
    z: 1,
    order: 0,
    bookId: 'book-a',
    name: '便利店小票',
    createdAt: 1,
    ...overrides,
});

describe('collection wall co-creation guardrails', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('cleans plain speech output and strips common model wrappers', () => {
        const parsed = parseCharWallNoteResponse('```text\n「Sully：票根挂正中间了？啧，那天的爆米花可还是我请的，下次换你。」\n```', 'Sully');

        expect(parsed).toEqual({
            action: 'note',
            content: '票根挂正中间了？啧，那天的爆米花可还是我请的，下次换你。',
        });
    });

    it('skips empty output and explicit skip marker', () => {
        expect(parseCharWallNoteResponse('')).toEqual({ action: 'skip' });
        expect(parseCharWallNoteResponse('[SKIP]')).toEqual({ action: 'skip' });
    });

    it('switches the wall prompt into a poke-and-continue context', () => {
        const prompt = buildCollectionWallVisitSystemPrompt({
            userName: '小雨',
            wallName: '深夜歌单',
            trigger: 'poke',
        });

        expect(prompt).toContain('又轻轻戳了戳你');
        expect(prompt).toContain('必须换一个观察角度');
        expect(prompt).toContain('很短的动描');
    });

    it('detects repeated char wall remarks after punctuation cleanup', () => {
        expect(isDuplicateCharWallRemark('票根挂正中间了？下次换你。', [
            '「票根挂正中间了，下次换你」',
        ])).toBe(true);
        expect(isDuplicateCharWallRemark('他伸手点了点角落那张便签。这个别挪。', [
            '票根挂正中间了，下次换你。',
        ])).toBe(false);
    });

    it('falls back to a bottom-right empty spot when the note would cover a user item center', () => {
        const items = [userItem()];
        const preferred = resolveCharWallNoteRect({ x: 68, y: 68 }, items);

        expect(preferred.y).toBeGreaterThan(600);
        expect(noteCoversAnyUserItemCenter(preferred, items)).toBe(false);
    });

    it('builds only a new char note item without existing item identity', () => {
        const source = userItem();
        const note = buildCharWallNoteItem({
            wallId: 'wall-a',
            layoutMode: 'free',
            items: [source],
            content: '这是一张超过六十字的便签，里面有很多碎碎念，还有买菜清单、楼下关门时间、没说完的半句话，应该被截断，后面这些字不能留下来。',
            charName: 'Sully',
            remarkTemplate: 'letter',
            rotationSeed: 'fixed',
        });

        expect((note as Partial<CollectionWallItem>).id).toBeUndefined();
        expect((note as Partial<CollectionWallItem>).createdAt).toBeUndefined();
        expect(note.author).toBe('char');
        expect(note.type).toBe('text');
        expect(note.y).toBeGreaterThan(600);
        expect(note.text?.preset).toBe('char_note');
        expect(note.text?.remarkTemplate).toBe('letter');
        expect(note.text?.content.length).toBeLessThanOrEqual(300);
        expect(source.id).toBe('user-item');
    });

    it('returns skip for explicit skip marker and sends prepared chat messages with max tokens', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || '{}'));
            expect(body.messages).toEqual([
                { role: 'system', content: 'main chat system + wall prompt' },
                { role: 'user', content: 'wall manifest' },
            ]);
            expect(body.max_tokens).toBe(COLLECTION_WALL_REMARK_MAX_TOKENS);
            return new Response(JSON.stringify({
                choices: [{ message: { content: '[SKIP]' } }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestCharWallNote({
            apiConfig: { baseUrl: 'https://example.test', apiKey: 'sk-test', model: 'test-model' },
            messages: [
                { role: 'system', content: 'main chat system + wall prompt' },
                { role: 'user', content: 'wall manifest' },
            ],
        })).resolves.toEqual({ action: 'skip' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
