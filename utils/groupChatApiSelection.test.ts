import { describe,expect,it } from 'vitest';
import type { APIConfig,ApiPreset } from '../types';
import type { SecondaryApiPoolEntryWithStatus } from './runtimeConfig';
import {
    buildGroupLiveRoleplayApiOptions,
    getGroupLiveApiFingerprint,
    GROUP_CHAT_MAX_TOKENS,
    GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE,
    readGroupLiveRoleplayApiSelection,
    reserveDistinctSecondaryRoleplayApis,
    resolveGroupLiveRoleplayApiConfig,
    writeGroupLiveRoleplayApiSelection,
} from './groupChatApiSelection';

const primaryConfig: APIConfig = {
    baseUrl: 'https://primary.example/v1',
    apiKey: 'primary-key',
    model: 'primary-model',
};

const presets: ApiPreset[] = [
    {
        id: 'preset-a',
        name: '主模型 A',
        config: {
            baseUrl: 'https://preset.example/v1',
            apiKey: 'preset-key',
            model: 'preset-model',
        },
    },
];

const secondaryPool: SecondaryApiPoolEntryWithStatus[] = [
    {
        id: 'sub-a',
        name: '副池 A',
        enabled: true,
        config: {
            baseUrl: 'https://sub-a.example/v1',
            apiKey: 'sub-key-a',
            model: 'sub-model-a',
        },
    },
    {
        id: 'sub-b',
        name: '副池 B',
        enabled: false,
        config: {
            baseUrl: 'https://sub-b.example/v1',
            apiKey: 'sub-key-b',
            model: 'sub-model-b',
        },
    },
];

describe('group chat API selection', () => {
    it('uses a high shared output token cap for group calls', () => {
        expect(GROUP_CHAT_MAX_TOKENS).toBe(65536);
    });

    it('builds roleplay options from current primary, primary presets, and secondary pool', () => {
        const options = buildGroupLiveRoleplayApiOptions(primaryConfig, presets, secondaryPool);

        expect(options.map(option => option.value)).toEqual([
            'primary:current',
            'secondary:round-robin',
            'primary-preset:preset-a',
            'secondary:sub-a',
            'secondary:sub-b',
        ]);
        expect(options.find(option => option.value === 'secondary:sub-b')?.disabled).toBe(true);
    });

    it('resolves primary presets and explicit secondary entries', () => {
        expect(resolveGroupLiveRoleplayApiConfig('primary-preset:preset-a', primaryConfig, presets, secondaryPool)?.config.model)
            .toBe('preset-model');

        const secondary = resolveGroupLiveRoleplayApiConfig('secondary:sub-a', primaryConfig, presets, secondaryPool);
        expect(secondary?.config.model).toBe('sub-model-a');
        expect(secondary?.secondaryPoolEntryId).toBe('sub-a');
    });

    it('persists per-group member roleplay API selections', () => {
        writeGroupLiveRoleplayApiSelection('group-1', 'char-a', 'secondary:sub-a');
        expect(readGroupLiveRoleplayApiSelection('group-1', 'char-a')).toBe('secondary:sub-a');

        writeGroupLiveRoleplayApiSelection('group-1', 'char-a', GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE);
        expect(readGroupLiveRoleplayApiSelection('group-1', 'char-a')).toBe(GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE);
    });

    it('fingerprints by endpoint and key, not model name', () => {
        expect(getGroupLiveApiFingerprint({
            ...primaryConfig,
            model: 'another-model',
        })).toBe(getGroupLiveApiFingerprint(primaryConfig));
    });

    it('reserves distinct secondary pool members for one concurrent wave', () => {
        localStorage.setItem('os_sub_api_pool_cursor', '0');
        const readyPool = secondaryPool.map(entry => ({ ...entry, enabled: true }));
        const reserved = reserveDistinctSecondaryRoleplayApis(2, readyPool);

        expect(reserved.map(item => item.secondaryPoolEntryId)).toEqual(['sub-a', 'sub-b']);
        expect(localStorage.getItem('os_sub_api_pool_cursor')).toBe('0');
    });

    it('advances the pool cursor past skipped blocked entries', () => {
        localStorage.setItem('os_sub_api_pool_cursor', '0');
        const readyPool = secondaryPool.map(entry => ({ ...entry, enabled: true }));
        const blocked = new Set([getGroupLiveApiFingerprint(readyPool[0].config)]);
        const reserved = reserveDistinctSecondaryRoleplayApis(1, readyPool, blocked);

        expect(reserved.map(item => item.secondaryPoolEntryId)).toEqual(['sub-b']);
        expect(localStorage.getItem('os_sub_api_pool_cursor')).toBe('0');
    });
});
