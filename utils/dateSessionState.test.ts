import { describe, expect, it } from 'vitest';
import type { CharacterProfile, DateState, Message } from '../types';
import {
    buildDateHistoryRecoveryState,
    createLightweightDateState,
    findPendingDateReplyGap,
    resolveDateStateBackground,
    resolveDateStateSprite,
    shouldUseDateVisualSafeMode,
} from './dateSessionState';

const heavyDataUrl = `data:image/png;base64,${'a'.repeat(8192)}`;

const makeCharacter = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-1',
    name: 'Sully',
    avatar: 'avatar.png',
    description: '',
    systemPrompt: '',
    memories: [],
    dateBackground: 'bg.png',
    sprites: {
        normal: 'normal.png',
        happy: 'happy.png',
    },
    ...overrides,
} as CharacterProfile);

const makeMessage = (
    id: number,
    role: Message['role'],
    content: string,
    metadata: Record<string, unknown>,
): Message => ({
    id,
    charId: 'char-1',
    role,
    type: 'text',
    content,
    timestamp: id * 1000,
    metadata,
});

describe('date session lightweight state', () => {
    it('does not duplicate large background or sprite assets in autosaves', () => {
        const char = makeCharacter({
            dateBackground: heavyDataUrl,
            sprites: { normal: heavyDataUrl },
        });

        const state = createLightweightDateState({
            dialogueQueue: [],
            dialogueBatch: [{ text: 'hello', emotion: 'normal' }],
            currentText: 'hello',
            bgImage: heavyDataUrl,
            currentSprite: heavyDataUrl,
            isNovelMode: true,
            visualSafeMode: true,
            peekStatus: 'opening',
        }, char, 'before-send');

        expect(state.bgImage).toBe('');
        expect(state.bgSource).toBe('characterDateBackground');
        expect(state.currentSprite).toBe('');
        expect(state.currentSpriteKey).toBe('normal');
        expect(state.autosaveReason).toBe('before-send');
    });

    it('restores old full-image state fields for compatibility', () => {
        const char = makeCharacter();
        const legacyState = {
            bgImage: 'legacy-bg.png',
            currentSprite: 'legacy-sprite.png',
        } as Partial<DateState>;

        expect(resolveDateStateBackground(char, legacyState)).toBe('legacy-bg.png');
        expect(resolveDateStateSprite(char, legacyState)).toBe('legacy-sprite.png');
    });

    it('resolves sprite keys from the active date skin set', () => {
        const char = makeCharacter({
            activeSkinSetId: 'skin-2',
            dateSkinSets: [
                { id: 'skin-1', name: 'One', sprites: { happy: 'skin-1-happy.png' } },
                { id: 'skin-2', name: 'Two', sprites: { happy: 'skin-2-happy.png' } },
            ],
        });

        expect(resolveDateStateSprite(char, { currentSpriteKey: 'happy' })).toBe('skin-2-happy.png');
    });

    it('only uses visual safe mode for explicit recovery states', () => {
        expect(shouldUseDateVisualSafeMode(undefined, { deviceMemory: 4 })).toBe(false);
        expect(shouldUseDateVisualSafeMode(undefined, { hardwareConcurrency: 4 })).toBe(false);
        expect(shouldUseDateVisualSafeMode(undefined, { connection: { saveData: true } })).toBe(false);
        expect(shouldUseDateVisualSafeMode({ autosaveReason: 'after-reply', visualSafeMode: true })).toBe(false);
        expect(shouldUseDateVisualSafeMode({ autosaveReason: 'history-recovery' })).toBe(true);
        expect(shouldUseDateVisualSafeMode({ restoredFromHistory: true })).toBe(true);
    });

    it('builds a text-first recovery state from recent date history', () => {
        const char = makeCharacter();
        const state = buildDateHistoryRecoveryState([
            makeMessage(1, 'assistant', 'opening', { source: 'date', isOpening: true }),
            makeMessage(2, 'user', 'user reply', { source: 'date' }),
        ], char);

        expect(state).not.toBeNull();
        expect(state?.isNovelMode).toBe(true);
        expect(state?.visualSafeMode).toBe(true);
        expect(state?.restoredFromHistory).toBe(true);
        expect(state?.peekStatus).toBe('opening');
        expect(state?.currentSpriteKey).toBe('normal');
    });

    it('detects the latest user date message when no assistant reply was saved', () => {
        const gap = findPendingDateReplyGap([
            makeMessage(1, 'assistant', 'opening', { source: 'date', isOpening: true }),
            makeMessage(2, 'user', '你在吗', {
                source: 'date',
                dateReplyStatus: 'pending',
            }),
        ]);

        expect(gap).toEqual({
            userMessageId: 2,
            userText: '你在吗',
            status: 'pending',
        });
    });

    it('does not report a pending gap when an assistant reply exists after the user message', () => {
        const gap = findPendingDateReplyGap([
            makeMessage(1, 'assistant', 'opening', { source: 'date', isOpening: true }),
            makeMessage(2, 'user', '你在吗', {
                source: 'date',
                dateReplyStatus: 'pending',
            }),
            makeMessage(3, 'assistant', '我在', { source: 'date' }),
        ]);

        expect(gap).toBeNull();
    });

    it('treats a completed user message with a missing assistant reply as failed', () => {
        const gap = findPendingDateReplyGap([
            makeMessage(1, 'assistant', 'opening', { source: 'date', isOpening: true }),
            makeMessage(2, 'user', '刚才是不是断了', {
                source: 'date',
                dateReplyStatus: 'complete',
                replyMessageId: 99,
            }),
        ]);

        expect(gap).toEqual({
            userMessageId: 2,
            userText: '刚才是不是断了',
            status: 'failed',
        });
    });
});
