import { describe, expect, it } from 'vitest';
import { extractThinkingFromChatCompletionResponse, selectThinkingForDisplay } from '../utils/thinkingExtractor';

describe('extractThinkingFromChatCompletionResponse', () => {
    it('prefers project CoT tags over native message reasoning fields', () => {
        const result = extractThinkingFromChatCompletionResponse({
            choices: [{
                message: {
                    content: '<thinking>Project CoT</thinking>\nVisible reply',
                    reasoning_content: 'Native reasoning',
                },
            }],
        });

        expect(result).toEqual({
            content: 'Visible reply',
            thinking: 'Project CoT',
        });
    });

    it('falls back to embedded thinking tags', () => {
        const result = extractThinkingFromChatCompletionResponse({
            choices: [{
                message: {
                    content: '<thinking>Embedded reasoning</thinking>\nVisible reply',
                },
            }],
        });

        expect(result).toEqual({
            content: 'Visible reply',
            thinking: 'Embedded reasoning',
        });
    });

    it('reads reasoning from content parts when providers return array content', () => {
        const result = extractThinkingFromChatCompletionResponse({
            choices: [{
                message: {
                    content: [
                        { type: 'reasoning', reasoning: 'Part reasoning' },
                        { type: 'text', text: 'Visible reply' },
                    ],
                },
            }],
        });

        expect(result).toEqual({
            content: 'Visible reply',
            thinking: 'Part reasoning',
        });
    });

    it('uses project CoT instead of native think tags when both are present', () => {
        const result = extractThinkingFromChatCompletionResponse({
            choices: [{
                message: {
                    content: '<think>Native tag reasoning</think>\n<thinking>Project CoT</thinking>\nVisible reply',
                },
            }],
        });

        expect(result).toEqual({
            content: 'Visible reply',
            thinking: 'Project CoT',
        });
    });

    it('strips status blocks from thinking display text', () => {
        const result = extractThinkingFromChatCompletionResponse({
            choices: [{
                message: {
                    content: '<thinking>Project CoT\n<status>\n状态: 不该展示\n</status></thinking>\nVisible reply\n<status>状态: 应交给状态栏解析</status>',
                },
            }],
        });

        expect(result).toEqual({
            content: 'Visible reply\n<status>状态: 应交给状态栏解析</status>',
            thinking: 'Project CoT',
        });
    });

    it('shares main-chat display selection: project CoT first, native fallback second', () => {
        expect(selectThinkingForDisplay('Project CoT', 'Native reasoning')).toBe('Project CoT');
        expect(selectThinkingForDisplay('', 'Native reasoning')).toBe('Native reasoning');
        expect(selectThinkingForDisplay('Project CoT\n<status>状态: 不展示</status>', '')).toBe('Project CoT');
    });
});
