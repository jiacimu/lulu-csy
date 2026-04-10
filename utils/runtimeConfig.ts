import {
    type APIConfig,
    type ApiPreset,
    type RealtimeConfig,
    type SttConfig,
    type TtsConfig,
    DEFAULT_STT_CONFIG,
    DEFAULT_TTS_CONFIG,
} from '../types';
import {
    type BackendResolutionDebug,
    getBackendResolutionDebug,
    getBackendToken,
    getBackendUrl,
    getFrontendOrigin,
    getTtsWsProxyUrl,
    getUserId,
} from './backendConfig';
import {
    readJsonStorage,
    safeLocalStorageGet,
    safeLocalStorageRemove,
    safeLocalStorageSet,
} from './storage';

export type EmbeddingProvider = 'openai' | 'cohere';
export type EmbeddingEngineId = 'standard' | 'enhanced';

export const PRIMARY_API_CONFIG_KEY = 'os_api_config';
export const AVAILABLE_MODELS_KEY = 'os_available_models';
export const API_PRESETS_KEY = 'os_api_presets';
export const SECONDARY_API_CONFIG_KEY = 'os_sub_api_config';
export const REALTIME_CONFIG_KEY = 'os_realtime_config';
export const TTS_CONFIG_KEY = 'os_tts_config';
export const STT_CONFIG_KEY = 'os_stt_config';

export const LEGACY_SUB_API_KEY = 'sub_api_key';
export const LEGACY_SUB_API_BASE_URL_KEY = 'sub_api_base_url';
export const LEGACY_SUB_API_MODEL_KEY = 'sub_api_model';

export const EMBEDDING_PROVIDER_KEY = 'embedding_provider';
export const EMBEDDING_API_KEY_KEY = 'embedding_api_key';
export const EMBEDDING_BASE_URL_KEY = 'embedding_base_url';
export const EMBEDDING_MODEL_KEY = 'embedding_model';
export const RERANK_API_KEY_KEY = 'cohere_rerank_api_key';
export const RERANK_USE_PAID_KEY = 'cohere_rerank_use_paid';
export const CHARACTER_REFINE_PROMPTS_KEY = 'character_refine_prompts';

export const DEFAULT_RUNTIME_REALTIME_CONFIG: RealtimeConfig = {
    weatherEnabled: false,
    weatherApiKey: '',
    weatherCity: 'Beijing',
    newsEnabled: false,
    newsApiKey: '',
    hotSearchEnabled: false,
    notionEnabled: false,
    notionApiKey: '',
    notionDatabaseId: '',
    feishuEnabled: false,
    feishuAppId: '',
    feishuAppSecret: '',
    feishuBaseId: '',
    feishuTableId: '',
    xhsEnabled: false,
    xhsMcpConfig: {
        enabled: false,
        serverUrl: 'http://localhost:18061/api',
    },
    cacheMinutes: 30,
};

export const DEFAULT_RUNTIME_API_CONFIG: APIConfig = {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4o-mini',
};

export const EMBEDDING_ENGINES: Record<
    EmbeddingEngineId,
    { model: string; rerankModel: string; baseUrl: string; dimensions?: number }
> = {
    standard: {
        model: 'BAAI/bge-m3',
        rerankModel: 'BAAI/bge-reranker-v2-m3',
        baseUrl: 'https://api.siliconflow.cn/v1',
    },
    enhanced: {
        model: 'Qwen/Qwen3-Embedding-8B',
        rerankModel: 'Qwen/Qwen3-Reranker-8B',
        baseUrl: 'https://api.siliconflow.cn/v1',
        dimensions: 1024,
    },
};

const EMBEDDING_PROVIDER_DEFAULTS: Record<
    EmbeddingProvider,
    { baseUrl: string; model: string; rerankModel: string; dimensions?: number }
> = {
    openai: {
        baseUrl: EMBEDDING_ENGINES.enhanced.baseUrl,
        model: EMBEDDING_ENGINES.enhanced.model,
        rerankModel: EMBEDDING_ENGINES.enhanced.rerankModel,
        dimensions: EMBEDDING_ENGINES.enhanced.dimensions,
    },
    cohere: {
        baseUrl: 'https://api.cohere.com/v2',
        model: 'embed-v4.0',
        rerankModel: 'rerank-v3.5',
    },
};

export interface EmbeddingRuntimeConfig {
    provider: EmbeddingProvider;
    apiKey: string;
    baseUrl: string;
    model: string;
    rerankModel: string;
    dimensions?: number;
    rerankApiKey: string;
    rerankUsePaid: boolean;
}

export interface BackendRuntimeConfig {
    backendUrl: string | null;
    backendToken: string | null;
    frontendOrigin: string;
    ttsWsProxyUrl: string;
    userId: string;
    resolutionDebug: BackendResolutionDebug;
}

export interface RuntimeConfigSnapshot {
    backend: BackendRuntimeConfig;
    api: {
        primary: APIConfig;
        secondary?: APIConfig;
        availableModels: string[];
        presets: ApiPreset[];
    };
    realtime: RealtimeConfig;
    tts: TtsConfig;
    stt: SttConfig;
    embedding: EmbeddingRuntimeConfig;
}

export interface CharacterRefinePromptConfig {
    id: string;
    name: string;
    content: string;
}

function readJsonValue<T>(key: string): T | null {
    return readJsonStorage<T>(key);
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value: unknown): string {
    return normalizeString(value).replace(/\/+$/, '');
}

function normalizeEmbeddingProvider(value: unknown): EmbeddingProvider {
    return value === 'cohere' ? 'cohere' : 'openai';
}

function normalizeApiConfig(
    value: Partial<APIConfig> | null | undefined,
    defaults: APIConfig = DEFAULT_RUNTIME_API_CONFIG,
): APIConfig {
    return {
        baseUrl: normalizeUrl(value?.baseUrl) || defaults.baseUrl,
        apiKey: normalizeString(value?.apiKey),
        model: normalizeString(value?.model) || defaults.model,
        useGeminiJailbreak: value?.useGeminiJailbreak === true,
        disablePrefill: value?.disablePrefill === true,
    };
}

function normalizeRealtimeConfig(value: Partial<RealtimeConfig> | null | undefined): RealtimeConfig {
    const rawXhsServerUrl = normalizeString(value?.xhsMcpConfig?.serverUrl);
    const legacyUntouchedMcpDefault =
        rawXhsServerUrl === 'http://localhost:18060/mcp'
        && value?.xhsMcpConfig?.enabled !== true
        && !normalizeString(value?.xhsMcpConfig?.loggedInUserId)
        && !normalizeString(value?.xhsMcpConfig?.loggedInNickname);
    const normalizedXhsServerUrl = legacyUntouchedMcpDefault
        ? 'http://localhost:18061/api'
        : rawXhsServerUrl || DEFAULT_RUNTIME_REALTIME_CONFIG.xhsMcpConfig?.serverUrl || 'http://localhost:18061/api';

    return {
        ...DEFAULT_RUNTIME_REALTIME_CONFIG,
        ...(value || {}),
        weatherApiKey: normalizeString(value?.weatherApiKey),
        weatherCity: normalizeString(value?.weatherCity) || DEFAULT_RUNTIME_REALTIME_CONFIG.weatherCity,
        newsApiKey: normalizeString(value?.newsApiKey),
        notionApiKey: normalizeString(value?.notionApiKey),
        notionDatabaseId: normalizeString(value?.notionDatabaseId),
        notionNotesDatabaseId: normalizeString(value?.notionNotesDatabaseId) || undefined,
        feishuAppId: normalizeString(value?.feishuAppId),
        feishuAppSecret: normalizeString(value?.feishuAppSecret),
        feishuBaseId: normalizeString(value?.feishuBaseId),
        feishuTableId: normalizeString(value?.feishuTableId),
        xhsEnabled: value?.xhsEnabled === true,
        xhsMcpConfig: {
            enabled: value?.xhsMcpConfig?.enabled === true,
            serverUrl: normalizedXhsServerUrl,
            loggedInUserId: normalizeString(value?.xhsMcpConfig?.loggedInUserId) || undefined,
            loggedInNickname: normalizeString(value?.xhsMcpConfig?.loggedInNickname) || undefined,
        },
        cacheMinutes: typeof value?.cacheMinutes === 'number' && Number.isFinite(value.cacheMinutes)
            ? value.cacheMinutes
            : DEFAULT_RUNTIME_REALTIME_CONFIG.cacheMinutes,
    };
}

function normalizeTtsConfig(value: Partial<TtsConfig> | null | undefined): TtsConfig {
    return {
        ...DEFAULT_TTS_CONFIG,
        ...(value || {}),
        baseUrl: normalizeString(value?.baseUrl) || DEFAULT_TTS_CONFIG.baseUrl,
        apiKey: normalizeString(value?.apiKey),
        groupId: normalizeString(value?.groupId),
        model: normalizeString(value?.model) || DEFAULT_TTS_CONFIG.model,
        voiceSetting: {
            ...DEFAULT_TTS_CONFIG.voiceSetting,
            ...(value?.voiceSetting || {}),
        },
        audioSetting: {
            ...DEFAULT_TTS_CONFIG.audioSetting,
            ...(value?.audioSetting || {}),
        },
        preprocessConfig: {
            ...DEFAULT_TTS_CONFIG.preprocessConfig,
            ...(value?.preprocessConfig || {}),
        },
        voiceModify: value?.voiceModify === null
            ? undefined
            : (value?.voiceModify
                ? {
                    ...(DEFAULT_TTS_CONFIG.voiceModify || { pitch: 0, intensity: 0, timbre: 0 }),
                    ...value.voiceModify,
                }
                : DEFAULT_TTS_CONFIG.voiceModify),
    };
}

function normalizeSttConfig(value: Partial<SttConfig> | null | undefined): SttConfig {
    return {
        ...DEFAULT_STT_CONFIG,
        ...(value || {}),
        groqApiKey: normalizeString(value?.groqApiKey),
        siliconflowApiKey: normalizeString(value?.siliconflowApiKey),
        baseUrl: normalizeString(value?.baseUrl) || undefined,
        model: normalizeString(value?.model) || undefined,
        language: normalizeString(value?.language) || undefined,
    };
}

function normalizeApiPreset(value: unknown): ApiPreset | null {
    if (!value || typeof value !== 'object') return null;

    const parsed = value as Partial<ApiPreset>;
    const id = normalizeString(parsed.id);
    const name = normalizeString(parsed.name);
    if (!id || !name) return null;

    return {
        id,
        name,
        config: normalizeApiConfig(parsed.config || {}, DEFAULT_RUNTIME_API_CONFIG),
    };
}

function normalizeCharacterRefinePrompt(value: unknown): CharacterRefinePromptConfig | null {
    if (!value || typeof value !== 'object') return null;

    const parsed = value as Partial<CharacterRefinePromptConfig>;
    const id = normalizeString(parsed.id);
    const name = normalizeString(parsed.name);
    const content = normalizeString(parsed.content);
    if (!id || !name || !content) return null;

    return {
        id,
        name,
        content,
    };
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeString(item))
        .filter(Boolean);
}

function normalizeApiPresets(value: unknown): ApiPreset[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(normalizeApiPreset)
        .filter((preset): preset is ApiPreset => Boolean(preset));
}

function hasCompleteApiConfig(config?: APIConfig): config is APIConfig {
    return Boolean(config?.apiKey && config.baseUrl && config.model);
}

export function inferEmbeddingEngineId(modelId?: string | null): EmbeddingEngineId {
    const normalized = normalizeString(modelId).toLowerCase();
    return normalized.includes('qwen3-embedding') ? 'enhanced' : 'standard';
}

function getEmbeddingProviderDefaults(provider: EmbeddingProvider, modelId?: string): {
    baseUrl: string;
    model: string;
    rerankModel: string;
    dimensions?: number;
} {
    if (provider === 'openai') {
        return EMBEDDING_ENGINES[inferEmbeddingEngineId(modelId)];
    }

    return EMBEDDING_PROVIDER_DEFAULTS[provider];
}

function normalizeEmbeddingConfig(
    value: Partial<EmbeddingRuntimeConfig> | null | undefined,
): EmbeddingRuntimeConfig {
    const provider = normalizeEmbeddingProvider(value?.provider);
    const explicitModel = normalizeString(value?.model);
    const providerDefaults = getEmbeddingProviderDefaults(provider, explicitModel);

    return {
        provider,
        apiKey: normalizeString(value?.apiKey),
        baseUrl: normalizeUrl(value?.baseUrl) || providerDefaults.baseUrl,
        model: explicitModel || providerDefaults.model,
        rerankModel: providerDefaults.rerankModel,
        dimensions: providerDefaults.dimensions,
        rerankApiKey: normalizeString(value?.rerankApiKey),
        rerankUsePaid: value?.rerankUsePaid === true,
    };
}

export function getPrimaryApiConfig(): APIConfig {
    return normalizeApiConfig(readJsonValue<Partial<APIConfig>>(PRIMARY_API_CONFIG_KEY));
}

export function setPrimaryApiConfig(config: APIConfig): void {
    safeLocalStorageSet(PRIMARY_API_CONFIG_KEY, JSON.stringify(normalizeApiConfig(config)));
}

export function getAvailableModels(): string[] {
    return normalizeStringArray(readJsonValue<unknown>(AVAILABLE_MODELS_KEY));
}

export function setAvailableModels(models: string[]): void {
    safeLocalStorageSet(AVAILABLE_MODELS_KEY, JSON.stringify(normalizeStringArray(models)));
}

export function getApiPresets(): ApiPreset[] {
    return normalizeApiPresets(readJsonValue<unknown>(API_PRESETS_KEY));
}

export function setApiPresets(presets: ApiPreset[]): void {
    safeLocalStorageSet(API_PRESETS_KEY, JSON.stringify(normalizeApiPresets(presets)));
}

function readLegacySecondaryApiConfig(): APIConfig | undefined {
    const config = normalizeApiConfig({
        apiKey: safeLocalStorageGet(LEGACY_SUB_API_KEY) ?? undefined,
        baseUrl: safeLocalStorageGet(LEGACY_SUB_API_BASE_URL_KEY) ?? undefined,
        model: safeLocalStorageGet(LEGACY_SUB_API_MODEL_KEY) ?? undefined,
    });

    return hasCompleteApiConfig(config) ? config : undefined;
}

export function getSecondaryApiConfig(): APIConfig | undefined {
    const structured = normalizeApiConfig(readJsonValue<Partial<APIConfig>>(SECONDARY_API_CONFIG_KEY));
    if (hasCompleteApiConfig(structured)) {
        return structured;
    }

    return readLegacySecondaryApiConfig();
}

export function setSecondaryApiConfig(config?: APIConfig | null): void {
    if (!config) {
        safeLocalStorageRemove(SECONDARY_API_CONFIG_KEY);
        safeLocalStorageRemove(LEGACY_SUB_API_KEY);
        safeLocalStorageRemove(LEGACY_SUB_API_BASE_URL_KEY);
        safeLocalStorageRemove(LEGACY_SUB_API_MODEL_KEY);
        return;
    }

    const normalized = normalizeApiConfig(config);
    safeLocalStorageSet(SECONDARY_API_CONFIG_KEY, JSON.stringify(normalized));
    safeLocalStorageSet(LEGACY_SUB_API_KEY, normalized.apiKey);
    safeLocalStorageSet(LEGACY_SUB_API_BASE_URL_KEY, normalized.baseUrl);
    safeLocalStorageSet(LEGACY_SUB_API_MODEL_KEY, normalized.model);
}

export function getRealtimeConfig(): RealtimeConfig {
    return normalizeRealtimeConfig(readJsonValue<Partial<RealtimeConfig>>(REALTIME_CONFIG_KEY));
}

export function setRealtimeConfig(config: RealtimeConfig): void {
    safeLocalStorageSet(REALTIME_CONFIG_KEY, JSON.stringify(normalizeRealtimeConfig(config)));
}

export function getTtsConfig(): TtsConfig {
    return normalizeTtsConfig(readJsonValue<Partial<TtsConfig>>(TTS_CONFIG_KEY));
}

export function setTtsConfig(config: TtsConfig): void {
    safeLocalStorageSet(TTS_CONFIG_KEY, JSON.stringify(normalizeTtsConfig(config)));
}

export function getSttConfig(): SttConfig {
    return normalizeSttConfig(readJsonValue<Partial<SttConfig>>(STT_CONFIG_KEY));
}

export function setSttConfig(config: SttConfig): void {
    safeLocalStorageSet(STT_CONFIG_KEY, JSON.stringify(normalizeSttConfig(config)));
}

export function getEmbeddingConfig(): EmbeddingRuntimeConfig {
    return normalizeEmbeddingConfig({
        provider: (safeLocalStorageGet(EMBEDDING_PROVIDER_KEY) as EmbeddingProvider | null) ?? undefined,
        apiKey: safeLocalStorageGet(EMBEDDING_API_KEY_KEY) ?? undefined,
        baseUrl: safeLocalStorageGet(EMBEDDING_BASE_URL_KEY) ?? undefined,
        model: safeLocalStorageGet(EMBEDDING_MODEL_KEY) ?? undefined,
        rerankApiKey: safeLocalStorageGet(RERANK_API_KEY_KEY) ?? undefined,
        rerankUsePaid: safeLocalStorageGet(RERANK_USE_PAID_KEY) === 'true',
    });
}

export function setEmbeddingConfig(config: EmbeddingRuntimeConfig): void {
    const normalized = normalizeEmbeddingConfig(config);

    safeLocalStorageSet(EMBEDDING_PROVIDER_KEY, normalized.provider);
    safeLocalStorageSet(EMBEDDING_BASE_URL_KEY, normalized.baseUrl);
    safeLocalStorageSet(EMBEDDING_MODEL_KEY, normalized.model);
    safeLocalStorageSet(RERANK_USE_PAID_KEY, normalized.rerankUsePaid ? 'true' : 'false');

    if (normalized.apiKey) {
        safeLocalStorageSet(EMBEDDING_API_KEY_KEY, normalized.apiKey);
    } else {
        safeLocalStorageRemove(EMBEDDING_API_KEY_KEY);
    }

    if (normalized.rerankApiKey) {
        safeLocalStorageSet(RERANK_API_KEY_KEY, normalized.rerankApiKey);
    } else {
        safeLocalStorageRemove(RERANK_API_KEY_KEY);
    }
}

export function getCharacterRefinePrompts(): CharacterRefinePromptConfig[] {
    const prompts = readJsonValue<unknown>(CHARACTER_REFINE_PROMPTS_KEY);
    if (!Array.isArray(prompts)) return [];

    return prompts
        .map(normalizeCharacterRefinePrompt)
        .filter((prompt): prompt is CharacterRefinePromptConfig => Boolean(prompt))
        .filter((prompt) => !prompt.id.startsWith('refine_'));
}

export function getBackendRuntimeConfig(): BackendRuntimeConfig {
    return {
        backendUrl: getBackendUrl(),
        backendToken: getBackendToken(),
        frontendOrigin: getFrontendOrigin(),
        ttsWsProxyUrl: getTtsWsProxyUrl(),
        userId: getUserId(),
        resolutionDebug: getBackendResolutionDebug(),
    };
}

export function hasCloudSyncTarget(): boolean {
    const backend = getBackendRuntimeConfig();
    return Boolean(backend.backendUrl && backend.backendToken);
}

export function getRuntimeConfigSnapshot(): RuntimeConfigSnapshot {
    return {
        backend: getBackendRuntimeConfig(),
        api: {
            primary: getPrimaryApiConfig(),
            secondary: getSecondaryApiConfig(),
            availableModels: getAvailableModels(),
            presets: getApiPresets(),
        },
        realtime: getRealtimeConfig(),
        tts: getTtsConfig(),
        stt: getSttConfig(),
        embedding: getEmbeddingConfig(),
    };
}
