// @vitest-environment jsdom

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
    EMBEDDING_API_KEY_KEY,
    EMBEDDING_BASE_URL_KEY,
    EMBEDDING_MODEL_KEY,
    EMBEDDING_PROVIDER_KEY,
    LEGACY_SUB_API_BASE_URL_KEY,
    LEGACY_SUB_API_KEY,
    LEGACY_SUB_API_MODEL_KEY,
    REALTIME_CONFIG_KEY,
    SECONDARY_API_CONFIG_KEY,
    STT_CONFIG_KEY,
    getEmbeddingConfig,
    getRealtimeConfig,
    getSecondaryApiConfig,
    getSttConfig,
    hasCloudSyncTarget,
    setEmbeddingConfig,
    setSecondaryApiConfig,
} from './runtimeConfig';

describe('runtimeConfig', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('reads the structured secondary API config before legacy keys', () => {
        localStorage.setItem(SECONDARY_API_CONFIG_KEY, JSON.stringify({
            apiKey: 'structured-key',
            baseUrl: 'https://llm.example.com/',
            model: 'gpt-structured',
        }));
        localStorage.setItem(LEGACY_SUB_API_KEY, 'legacy-key');
        localStorage.setItem(LEGACY_SUB_API_BASE_URL_KEY, 'https://legacy.example.com');
        localStorage.setItem(LEGACY_SUB_API_MODEL_KEY, 'gpt-legacy');

        expect(getSecondaryApiConfig()).toEqual({
            apiKey: 'structured-key',
            baseUrl: 'https://llm.example.com',
            model: 'gpt-structured',
            useGeminiJailbreak: false,
            disablePrefill: false,
        });
    });

    it('writes the secondary API config to both the structured key and legacy keys', () => {
        setSecondaryApiConfig({
            apiKey: 'sub-key',
            baseUrl: 'https://llm.example.com/',
            model: 'gpt-test',
        });

        expect(JSON.parse(localStorage.getItem(SECONDARY_API_CONFIG_KEY) || '{}')).toMatchObject({
            apiKey: 'sub-key',
            baseUrl: 'https://llm.example.com',
            model: 'gpt-test',
        });
        expect(localStorage.getItem(LEGACY_SUB_API_KEY)).toBe('sub-key');
        expect(localStorage.getItem(LEGACY_SUB_API_BASE_URL_KEY)).toBe('https://llm.example.com');
        expect(localStorage.getItem(LEGACY_SUB_API_MODEL_KEY)).toBe('gpt-test');
    });

    it('normalizes embedding config with provider-aware defaults', () => {
        localStorage.setItem(EMBEDDING_PROVIDER_KEY, 'openai');
        localStorage.setItem(EMBEDDING_API_KEY_KEY, 'embed-key');
        localStorage.setItem(EMBEDDING_BASE_URL_KEY, 'https://api.siliconflow.cn/v1/');
        localStorage.setItem(EMBEDDING_MODEL_KEY, 'Qwen/Qwen3-Embedding-8B');

        expect(getEmbeddingConfig()).toMatchObject({
            provider: 'openai',
            apiKey: 'embed-key',
            baseUrl: 'https://api.siliconflow.cn/v1',
            model: 'Qwen/Qwen3-Embedding-8B',
            rerankModel: 'Qwen/Qwen3-Reranker-8B',
            dimensions: 1024,
        });
    });

    it('round-trips embedding config through the runtime setter', () => {
        setEmbeddingConfig({
            provider: 'openai',
            apiKey: 'embed-key',
            baseUrl: 'https://api.siliconflow.cn/v1/',
            model: 'Qwen/Qwen3-Embedding-8B',
            rerankModel: 'ignored-at-write-time',
            dimensions: 2048,
            rerankApiKey: 'rerank-key',
            rerankUsePaid: true,
        });

        expect(getEmbeddingConfig()).toEqual({
            provider: 'openai',
            apiKey: 'embed-key',
            baseUrl: 'https://api.siliconflow.cn/v1',
            model: 'Qwen/Qwen3-Embedding-8B',
            rerankModel: 'Qwen/Qwen3-Reranker-8B',
            dimensions: 1024,
            rerankApiKey: 'rerank-key',
            rerankUsePaid: true,
        });
    });

    it('merges STT config onto defaults without throwing on partial JSON', () => {
        localStorage.setItem(STT_CONFIG_KEY, JSON.stringify({
            provider: 'siliconflow',
            siliconflowApiKey: 'silicon-key',
        }));

        expect(getSttConfig()).toEqual({
            provider: 'siliconflow',
            groqApiKey: '',
            siliconflowApiKey: 'silicon-key',
        });
    });

    it('defaults xhs config to the recommended bridge server', () => {
        expect(getRealtimeConfig().xhsMcpConfig).toEqual({
            enabled: false,
            serverUrl: 'http://localhost:18061/api',
            loggedInUserId: undefined,
            loggedInNickname: undefined,
        });
    });

    it('migrates the untouched legacy xhs MCP default to the bridge server', () => {
        localStorage.setItem(REALTIME_CONFIG_KEY, JSON.stringify({
            xhsEnabled: false,
            xhsMcpConfig: {
                enabled: false,
                serverUrl: 'http://localhost:18060/mcp',
            },
        }));

        expect(getRealtimeConfig().xhsMcpConfig).toEqual({
            enabled: false,
            serverUrl: 'http://localhost:18061/api',
            loggedInUserId: undefined,
            loggedInNickname: undefined,
        });
    });

    it('preserves an explicitly enabled legacy MCP endpoint', () => {
        localStorage.setItem(REALTIME_CONFIG_KEY, JSON.stringify({
            xhsEnabled: true,
            xhsMcpConfig: {
                enabled: true,
                serverUrl: 'http://localhost:18060/mcp',
            },
        }));

        expect(getRealtimeConfig().xhsMcpConfig).toEqual({
            enabled: true,
            serverUrl: 'http://localhost:18060/mcp',
            loggedInUserId: undefined,
            loggedInNickname: undefined,
        });
    });

    it('detects when cloud sync can write based on backend env + token', () => {
        vi.stubEnv('VITE_CSYOS_BACKEND_URL', 'https://backend.example.com');
        vi.stubEnv('VITE_CSYOS_BACKEND_TOKEN', 'token-1');

        expect(hasCloudSyncTarget()).toBe(true);
    });
});
