import type { APIConfig, ApiPreset } from '../types';
import {
    SECONDARY_API_POOL_CURSOR_KEY,
    getSecondaryApiPoolWithStatus,
    selectSecondaryApiConfig,
    type SecondaryApiPoolEntryWithStatus,
} from './runtimeConfig';
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from './storage';

export const GROUP_CHAT_MAX_TOKENS = 65536;

export const GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE = 'primary:current';
const GROUP_LIVE_ROLEPLAY_API_KEY_PREFIX = 'groupchat_live_roleplay_api_selection';

export type GroupLiveRoleplayApiSource =
    | 'primary-current'
    | 'primary-preset'
    | 'secondary-round-robin'
    | 'secondary-pool';

export interface GroupLiveRoleplayApiOption {
    value: string;
    label: string;
    detail: string;
    disabled?: boolean;
}

export interface GroupLiveRoleplayApiResolution {
    config: APIConfig;
    label: string;
    source: GroupLiveRoleplayApiSource;
    secondaryPoolEntryId?: string;
}

function selectionKey(groupId: string, charId: string): string {
    return `${GROUP_LIVE_ROLEPLAY_API_KEY_PREFIX}_${groupId}_${charId}`;
}

function hasCompleteApiConfig(config?: APIConfig): config is APIConfig {
    return Boolean(config?.baseUrl?.trim() && config?.model?.trim());
}

function getPoolEntryLabel(entry: SecondaryApiPoolEntryWithStatus): string {
    return entry.name || entry.config.model || '副 API';
}

function buildSecondaryPoolResolution(entry: SecondaryApiPoolEntryWithStatus): GroupLiveRoleplayApiResolution {
    return {
        config: entry.config,
        label: `副 API：${getPoolEntryLabel(entry)}`,
        source: 'secondary-pool',
        secondaryPoolEntryId: entry.id,
    };
}

export function getGroupLiveApiFingerprint(config: APIConfig): string {
    const baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
    const apiKey = String(config.apiKey || 'sk-none').trim();
    return `${baseUrl}|${apiKey}`;
}

export function readGroupLiveRoleplayApiSelection(groupId: string, charId: string): string {
    const saved = safeLocalStorageGet(selectionKey(groupId, charId));
    return saved || GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE;
}

export function writeGroupLiveRoleplayApiSelection(groupId: string, charId: string, value: string): void {
    if (!value || value === GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE) {
        safeLocalStorageRemove(selectionKey(groupId, charId));
        return;
    }

    safeLocalStorageSet(selectionKey(groupId, charId), value);
}

export function buildGroupLiveRoleplayApiOptions(
    primaryConfig: APIConfig,
    apiPresets: ApiPreset[],
    secondaryPool: SecondaryApiPoolEntryWithStatus[] = getSecondaryApiPoolWithStatus(),
): GroupLiveRoleplayApiOption[] {
    const options: GroupLiveRoleplayApiOption[] = [
        {
            value: GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE,
            label: '当前主 API',
            detail: primaryConfig.model || '未选择模型',
            disabled: !hasCompleteApiConfig(primaryConfig),
        },
        {
            value: 'secondary:round-robin',
            label: '副 API 轮询池',
            detail: secondaryPool.some(entry => entry.enabled) ? '按池内可用入口轮询' : '未配置可用副 API',
            disabled: !secondaryPool.some(entry => entry.enabled && hasCompleteApiConfig(entry.config)),
        },
    ];

    for (const preset of apiPresets) {
        options.push({
            value: `primary-preset:${preset.id}`,
            label: `主预设：${preset.name}`,
            detail: preset.config.model || '未选择模型',
            disabled: !hasCompleteApiConfig(preset.config),
        });
    }

    for (const entry of secondaryPool) {
        const cooldownUntil = entry.cooldownUntil || 0;
        const cooling = cooldownUntil > Date.now();
        options.push({
            value: `secondary:${entry.id}`,
            label: `副 API：${getPoolEntryLabel(entry)}`,
            detail: entry.config.model || (entry.enabled ? '未选择模型' : '已停用'),
            disabled: !entry.enabled || cooling || !hasCompleteApiConfig(entry.config),
        });
    }

    return options;
}

export function getReadySecondaryApiPoolEntries(
    secondaryPool: SecondaryApiPoolEntryWithStatus[] = getSecondaryApiPoolWithStatus(),
): SecondaryApiPoolEntryWithStatus[] {
    const now = Date.now();
    return secondaryPool.filter(entry =>
        entry.enabled
        && hasCompleteApiConfig(entry.config)
        && (entry.cooldownUntil || 0) <= now
    );
}

export function reserveDistinctSecondaryRoleplayApis(
    count: number,
    secondaryPool: SecondaryApiPoolEntryWithStatus[] = getSecondaryApiPoolWithStatus(),
    blockedFingerprints: Set<string> = new Set(),
): GroupLiveRoleplayApiResolution[] {
    const readyEntries = getReadySecondaryApiPoolEntries(secondaryPool);
    if (count <= 0 || readyEntries.length === 0) return [];

    const cursorRaw = Number(safeLocalStorageGet(SECONDARY_API_POOL_CURSOR_KEY) || '0');
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.floor(cursorRaw) : 0;
    const selected: SecondaryApiPoolEntryWithStatus[] = [];
    const usedFingerprints = new Set(blockedFingerprints);
    let lastSelectedOffset = -1;

    for (let offset = 0; offset < readyEntries.length && selected.length < count; offset++) {
        const entry = readyEntries[(cursor + offset) % readyEntries.length];
        const fingerprint = getGroupLiveApiFingerprint(entry.config);
        if (usedFingerprints.has(fingerprint)) continue;
        selected.push(entry);
        usedFingerprints.add(fingerprint);
        lastSelectedOffset = offset;
    }

    if (lastSelectedOffset >= 0) {
        safeLocalStorageSet(SECONDARY_API_POOL_CURSOR_KEY, String((cursor + lastSelectedOffset + 1) % readyEntries.length));
    }

    return selected.map(buildSecondaryPoolResolution);
}

export function resolveGroupLiveRoleplayApiConfig(
    value: string,
    primaryConfig: APIConfig,
    apiPresets: ApiPreset[],
    secondaryPool: SecondaryApiPoolEntryWithStatus[] = getSecondaryApiPoolWithStatus(),
): GroupLiveRoleplayApiResolution | null {
    if (!value || value === GROUP_LIVE_ROLEPLAY_DEFAULT_API_VALUE) {
        if (!hasCompleteApiConfig(primaryConfig)) return null;
        return {
            config: primaryConfig,
            label: '当前主 API',
            source: 'primary-current',
        };
    }

    if (value === 'secondary:round-robin') {
        const config = selectSecondaryApiConfig();
        if (!hasCompleteApiConfig(config)) return null;
        return {
            config,
            label: '副 API 轮询池',
            source: 'secondary-round-robin',
        };
    }

    if (value.startsWith('primary-preset:')) {
        const id = value.slice('primary-preset:'.length);
        const preset = apiPresets.find(item => item.id === id);
        if (!preset || !hasCompleteApiConfig(preset.config)) return null;
        return {
            config: preset.config,
            label: `主预设：${preset.name}`,
            source: 'primary-preset',
        };
    }

    if (value.startsWith('secondary:')) {
        const id = value.slice('secondary:'.length);
        const entry = getReadySecondaryApiPoolEntries(secondaryPool).find(item => item.id === id);
        if (!entry) return null;
        return buildSecondaryPoolResolution(entry);
    }

    return null;
}
