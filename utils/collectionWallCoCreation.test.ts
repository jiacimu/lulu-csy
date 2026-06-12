import { describe, expect, it } from 'vitest';
import type { CollectionWallItem } from '../types';
import {
    buildCharWallNoteItem,
    noteCoversAnyUserItemCenter,
    parseCharWallNoteResponse,
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
    it('parses fenced JSON by taking the first object and truncating content', () => {
        const longContent = '这是一张超过六十字的便签，里面有很多碎碎念，还有买菜清单、楼下关门时间、没说完的半句话，应该被截断，后面这些字不能留下来。';
        const parsed = parseCharWallNoteResponse(`说明文字\n\`\`\`json\n{"action":"note","anchorId":"item-a","placement":"near_anchor","content":"${longContent}"}\n\`\`\`\n{"action":"skip"}`);

        expect(parsed).toMatchObject({
            action: 'note',
            anchorId: 'item-a',
            placement: 'near_anchor',
        });
        expect(parsed.action === 'note' ? parsed.content.length : 0).toBe(60);
    });

    it('skips non-json, missing fields, and fields outside the whitelist', () => {
        expect(parseCharWallNoteResponse('乱码不是 JSON')).toEqual({ action: 'skip' });
        expect(parseCharWallNoteResponse('{"action":"note","anchorId":"item-a","placement":"near_anchor"}')).toEqual({ action: 'skip' });
        expect(parseCharWallNoteResponse('{"action":"note","anchorId":"item-a","placement":"near_anchor","content":"好","deleteItemId":"user-item"}')).toEqual({ action: 'skip' });
    });

    it('falls back to a bottom-right empty spot when the note would cover a user item center', () => {
        const items = [userItem()];
        const preferred = resolveCharWallNoteRect({ x: 68, y: 68 }, items);

        expect(preferred.x).toBeGreaterThan(400);
        expect(preferred.y).toBeGreaterThan(600);
        expect(noteCoversAnyUserItemCenter(preferred, items)).toBe(false);
    });

    it('builds only a new truncated char note item without existing item identity', () => {
        const source = userItem();
        const note = buildCharWallNoteItem({
            wallId: 'wall-a',
            layoutMode: 'free',
            items: [source],
            content: '这是一张超过六十字的便签，里面有很多碎碎念，还有买菜清单、楼下关门时间、没说完的半句话，应该被截断，后面这些字不能留下来。',
            charName: 'Sully',
            rotationSeed: 'fixed',
        });

        expect((note as Partial<CollectionWallItem>).id).toBeUndefined();
        expect((note as Partial<CollectionWallItem>).createdAt).toBeUndefined();
        expect(note.author).toBe('char');
        expect(note.type).toBe('text');
        expect(note.text?.preset).toBe('char_note');
        expect(note.text?.content).toHaveLength(60);
        expect(source.id).toBe('user-item');
    });
});
