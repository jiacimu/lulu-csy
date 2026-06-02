import { describe, expect, it } from 'vitest';
import {
    DATE_WRITING_STYLE_PRESETS,
    buildDateOutputTuning,
    resolveDateWritingStylePreset,
} from '../utils/datePrompts';

describe('date writing style presets', () => {
    it('exposes the current built-in style set in picker order', () => {
        expect(DATE_WRITING_STYLE_PRESETS.map(p => p.key)).toEqual([
            'cozy',
            'sweet',
            'minimal',
            'immersive',
            'cinematic',
            'desolate',
            'restrained',
            'lyrical',
            'tender',
            'artisan',
            'quiet',
        ]);
    });

    it('maps legacy saved preset keys to the new presets', () => {
        expect(resolveDateWritingStylePreset('daily')?.key).toBe('cozy');
        expect(resolveDateWritingStylePreset('natural')?.key).toBe('cozy');
        expect(resolveDateWritingStylePreset('literary')?.key).toBe('immersive');
        expect(resolveDateWritingStylePreset('hardcore')?.key).toBe('immersive');
        expect(resolveDateWritingStylePreset('poetic')?.key).toBe('cinematic');
    });

    it('injects the resolved preset prompt instead of treating legacy keys as custom text', () => {
        const tuning = buildDateOutputTuning(150, 'daily');

        expect(tuning).toContain('【文风：松弛日常】');
        expect(tuning).not.toContain('【文风指令：自定义】\ndaily');
    });

    it('keeps built-in styles optional when no style is selected', () => {
        const tuning = buildDateOutputTuning(150);

        expect(tuning).toContain('【文风底线 · 系统级】');
        expect(tuning).not.toContain('【文风：松弛日常】');
        expect(tuning).not.toContain('【文风：静水深流】');
        expect(tuning).not.toContain('【文风指令：自定义】');
    });
});
