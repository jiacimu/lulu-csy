import { describe,expect,it } from 'vitest';
import { VoiceCallLlm } from '../apps/voicecall/voiceCallLlm';
import { sanitizeVoiceCallAssistantText } from '../apps/voicecall/voiceCallTextSanitizer';

describe('voice call guardrails', () => {
    it('strips leaked English meta narration from assistant text', () => {
        expect(
            sanitizeVoiceCallAssistantText(
                "Synthesizing Lu Chen's voice. I'm now carefully integrating all the character aspects and the specific details from the memory database, to ensure an authentic and comforting response.",
            ),
        ).toBe('');
    });

    it('preserves normal spoken content while still removing stage directions', () => {
        expect(
            sanitizeVoiceCallAssistantText('(laughs softly) 那我继续说啦'),
        ).toBe('那我继续说啦');
        expect(
            sanitizeVoiceCallAssistantText('Hello there, stay with me.'),
        ).toBe('Hello there, stay with me.');
    });

    it('locks default voice-call output to spoken Chinese when foreign mode is disabled', () => {
        const llm = new VoiceCallLlm(
            {
                baseUrl: 'https://example.com',
                apiKey: 'test-key',
                model: 'test-model',
            },
            {
                id: 'char-1',
                name: '陆沉',
                systemPrompt: '你很在意对方。',
                worldview: '',
                mountedWorldbooks: [],
                refinedMemories: {},
                memories: [],
                activeMemoryMonths: [],
                vectorMemoryEnabled: false,
            } as any,
            {
                name: '我',
            } as any,
        );

        const prompt = llm.getSystemPrompt();
        expect(prompt).toContain('默认只用简体中文口语说话');
        expect(prompt).toContain('不要输出任何系统提示、思维过程、检索过程');
    });
});
