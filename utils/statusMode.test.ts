import { describe, expect, it } from 'vitest';
import { pickMixedStatusMode, resolveChatStatusMode } from './statusMode';

describe('statusMode utilities', () => {
    it.each([
        [0, 'classic'],
        [0.249, 'classic'],
        [0.25, 'freeform'],
        [0.5, 'afterglow'],
        [0.75, 'story_phone'],
        [0.999, 'story_phone'],
    ])('picks a mixed status mode for random=%s', (randomValue, expectedMode) => {
        expect(pickMixedStatusMode(() => randomValue)).toBe(expectedMode);
    });

    it('resolves mixed mode from message metadata', () => {
        expect(resolveChatStatusMode('mixed', { metadata: { mixedStatusMode: 'story_phone' } })).toBe('story_phone');
        expect(resolveChatStatusMode('mixed', { metadata: { mixedStatusMode: 'afterglow' } })).toBe('afterglow');
        expect(resolveChatStatusMode('mixed', { metadata: { mixedStatusMode: 'freeform' } })).toBe('freeform');
        expect(resolveChatStatusMode('mixed', { metadata: { mixedStatusMode: 'classic' } })).toBe('classic');
    });

    it('keeps configured non-mixed modes authoritative', () => {
        expect(resolveChatStatusMode('classic', { metadata: { mixedStatusMode: 'story_phone' } })).toBe('classic');
        expect(resolveChatStatusMode('afterglow', { metadata: { mixedStatusMode: 'freeform' } })).toBe('afterglow');
    });

    it('falls back to mixed when mixed metadata is missing or invalid', () => {
        expect(resolveChatStatusMode('mixed', { metadata: {} })).toBe('mixed');
        expect(resolveChatStatusMode('mixed', { metadata: { mixedStatusMode: 'custom' } })).toBe('mixed');
        expect(resolveChatStatusMode('mixed', null)).toBe('mixed');
    });
});
