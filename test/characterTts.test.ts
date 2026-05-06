import { describe,expect,it } from 'vitest';
import { DEFAULT_TTS_CONFIG,type CharacterProfile,type TtsConfig } from '../types';
import { resolveCharacterVoiceId,withCharacterTtsVoice } from '../utils/characterTts';
import {
    buildVoiceCallQueuedSentence,
    buildVoiceCallTtsConfig,
    getVoiceCallPlaybackSentence,
} from '../apps/voicecall/useVoiceCallEngine';

function buildTtsConfig(voiceId = 'global-voice'): TtsConfig {
    return {
        ...DEFAULT_TTS_CONFIG,
        voiceSetting: {
            ...DEFAULT_TTS_CONFIG.voiceSetting,
            voice_id: voiceId,
        },
    };
}

function buildChar(ttsVoiceId?: string): CharacterProfile {
    return {
        id: 'char-test',
        name: 'Test',
        avatar: '',
        description: '',
        systemPrompt: '',
        memories: [],
        ttsVoiceId,
    } as CharacterProfile;
}

describe('character TTS voice binding', () => {
    it('uses the character voice id before the global fallback', () => {
        const config = buildTtsConfig('global-voice');
        const char = buildChar('  character-voice  ');

        expect(resolveCharacterVoiceId(char, config)).toBe('character-voice');
        expect(withCharacterTtsVoice(config, char).voiceSetting.voice_id).toBe('character-voice');
    });

    it('falls back to the global voice id when the character has none', () => {
        const config = buildTtsConfig('  global-voice  ');

        expect(resolveCharacterVoiceId(buildChar(), config)).toBe('global-voice');
        expect(resolveCharacterVoiceId(buildChar('   '), config)).toBe('global-voice');
    });

    it('does not mutate the original TTS config', () => {
        const config = buildTtsConfig('global-voice');
        const merged = withCharacterTtsVoice(config, buildChar('character-voice'));

        expect(merged).not.toBe(config);
        expect(merged.voiceSetting).not.toBe(config.voiceSetting);
        expect(config.voiceSetting.voice_id).toBe('global-voice');
    });

    it('keeps the character voice id when preparing voice-call PCM config', () => {
        const config = withCharacterTtsVoice(buildTtsConfig('global-voice'), buildChar('character-voice'));
        const voiceCallConfig = buildVoiceCallTtsConfig(config);
        const lowMemoryVoiceCallConfig = buildVoiceCallTtsConfig(config, undefined, 16000);

        expect(voiceCallConfig.voiceSetting.voice_id).toBe('character-voice');
        expect(voiceCallConfig.audioSetting.format).toBe('pcm');
        expect(voiceCallConfig.audioSetting.audio_sample_rate).toBe(24000);
        expect(lowMemoryVoiceCallConfig.audioSetting.format).toBe('pcm');
        expect(lowMemoryVoiceCallConfig.audioSetting.audio_sample_rate).toBe(16000);
    });

    it('temporarily overrides voice-call language boost for foreign mode only', () => {
        const base = {
            ...buildTtsConfig('global-voice'),
            languageBoost: 'Chinese',
        };

        expect(buildVoiceCallTtsConfig(base).languageBoost).toBe('Chinese');
        expect(buildVoiceCallTtsConfig(base, { sourceLang: '日本語', targetLang: '中文' }).languageBoost).toBe('Japanese');
        expect(buildVoiceCallTtsConfig(base, { sourceLang: '中文', targetLang: 'English' }).languageBoost).toBe('Chinese');
    });

    it('keeps translation paired with the sentence that is currently playing', () => {
        const first = buildVoiceCallQueuedSentence('こんにちは。[[翻译:你好。]]');
        const second = buildVoiceCallQueuedSentence('今日は何してたの？[[翻译:今天在做什么呀？]]');

        expect(first).toEqual({ spokenText: 'こんにちは。', translationText: '你好。' });
        expect(second).toEqual({ spokenText: '今日は何してたの？', translationText: '今天在做什么呀？' });

        const queue = [first!, second!];
        expect(getVoiceCallPlaybackSentence(queue, 0)?.translationText).toBe('你好。');
        expect(getVoiceCallPlaybackSentence(queue, 1)?.translationText).toBe('今天在做什么呀？');
    });
});
