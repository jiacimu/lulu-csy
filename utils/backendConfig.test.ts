// @vitest-environment jsdom

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const PROD_BACKEND_URL = 'https://chushiyu.de5.net';
const PROD_BACKEND_TOKEN = 'production-token';
const STALE_STAGING_TOKEN = 'stale-staging-token';
const BACKEND_URL_KEY = 'csyos_backend_url';
const BACKEND_TOKEN_KEY = 'csyos_backend_token';
const HEALTH_CACHE_KEY = 'csyos_backend_alive';
const originalImportMetaEnv = {
    VITE_CSYOS_BACKEND_URL: (import.meta as ImportMeta & {
        env: Record<string, string | undefined>;
    }).env.VITE_CSYOS_BACKEND_URL,
    VITE_CSYOS_BACKEND_TOKEN: (import.meta as ImportMeta & {
        env: Record<string, string | undefined>;
    }).env.VITE_CSYOS_BACKEND_TOKEN,
};
const originalProcessEnv = {
    VITE_CSYOS_BACKEND_URL: (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    }).process?.env?.VITE_CSYOS_BACKEND_URL,
    VITE_CSYOS_BACKEND_TOKEN: (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    }).process?.env?.VITE_CSYOS_BACKEND_TOKEN,
};

function stubViteEnv(key: string, value: string): void {
    vi.stubEnv(key, value);
    ((import.meta as ImportMeta & {
        env: Record<string, string | undefined>;
    }).env)[key] = value;
    const runtimeProcess = (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    }).process;
    if (runtimeProcess?.env) {
        runtimeProcess.env[key] = value;
    }
}

function restoreEnvValue(key: 'VITE_CSYOS_BACKEND_URL' | 'VITE_CSYOS_BACKEND_TOKEN'): void {
    const importEnv = (import.meta as ImportMeta & {
        env: Record<string, string | undefined>;
    }).env;
    const runtimeProcess = (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    }).process;

    if (originalImportMetaEnv[key] === undefined) {
        delete importEnv[key];
    } else {
        importEnv[key] = originalImportMetaEnv[key];
    }

    if (runtimeProcess?.env) {
        if (originalProcessEnv[key] === undefined) {
            delete runtimeProcess.env[key];
        } else {
            runtimeProcess.env[key] = originalProcessEnv[key];
        }
    }
}

async function loadBackendConfig() {
    vi.resetModules();
    return import('./backendConfig');
}

describe('backendConfig local override resolution', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
        stubViteEnv('VITE_CSYOS_BACKEND_URL', PROD_BACKEND_URL);
        stubViteEnv('VITE_CSYOS_BACKEND_TOKEN', PROD_BACKEND_TOKEN);
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
        restoreEnvValue('VITE_CSYOS_BACKEND_URL');
        restoreEnvValue('VITE_CSYOS_BACKEND_TOKEN');
    });

    it('uses the build token when only an old local token exists', async () => {
        localStorage.setItem(BACKEND_TOKEN_KEY, STALE_STAGING_TOKEN);
        const { getBackendResolutionDebug,getBackendToken } = await loadBackendConfig();

        expect(getBackendToken()).toBe(PROD_BACKEND_TOKEN);
        expect(getBackendResolutionDebug().backendTokenSource).toBe('build_env');
    });

    it('uses the build URL and token when a stored URL matches the build host', async () => {
        localStorage.setItem(BACKEND_URL_KEY, `${PROD_BACKEND_URL}/`);
        localStorage.setItem(BACKEND_TOKEN_KEY, STALE_STAGING_TOKEN);
        const {
            getBackendResolutionDebug,
            getBackendToken,
            getBackendUrl,
        } = await loadBackendConfig();

        expect(getBackendUrl()).toBe(PROD_BACKEND_URL);
        expect(getBackendToken()).toBe(PROD_BACKEND_TOKEN);
        expect(getBackendResolutionDebug()).toMatchObject({
            backendUrlSource: 'build_env',
            backendTokenSource: 'build_env',
        });
    });

    it('allows a local token only when the backend URL is a local debug override', async () => {
        localStorage.setItem(BACKEND_URL_KEY, 'http://localhost:8787');
        localStorage.setItem(BACKEND_TOKEN_KEY, 'local-dev-token');
        const {
            getBackendResolutionDebug,
            getBackendToken,
            getBackendUrl,
        } = await loadBackendConfig();

        expect(getBackendUrl()).toBe('http://localhost:8787');
        expect(getBackendToken()).toBe('local-dev-token');
        expect(getBackendResolutionDebug()).toMatchObject({
            backendUrlSource: 'local_override',
            backendTokenSource: 'local_override',
        });
    });

    it('keeps local token as a fallback when no build token exists', async () => {
        stubViteEnv('VITE_CSYOS_BACKEND_TOKEN', '');
        localStorage.setItem(BACKEND_TOKEN_KEY, 'manual-token');
        const { getBackendResolutionDebug,getBackendToken } = await loadBackendConfig();

        expect(getBackendToken()).toBe('manual-token');
        expect(getBackendResolutionDebug().backendTokenSource).toBe('local_override');
    });

    it('clears local backend URL, token, and health cache together', async () => {
        localStorage.setItem(BACKEND_URL_KEY, 'http://localhost:8787');
        localStorage.setItem(BACKEND_TOKEN_KEY, 'local-dev-token');
        const {
            BACKEND_HEALTH_TIMEOUT_MS,
            clearBackendConfigOverride,
            getBackendHealthCache,
            setBackendHealthCache,
        } = await loadBackendConfig() as typeof import('./backendConfig') & {
            clearBackendConfigOverride: () => void;
        };

        setBackendHealthCache(true);
        expect(getBackendHealthCache()?.alive).toBe(true);

        clearBackendConfigOverride();

        expect(localStorage.getItem(BACKEND_URL_KEY)).toBeNull();
        expect(localStorage.getItem(BACKEND_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(HEALTH_CACHE_KEY)).toBeNull();
        expect(getBackendHealthCache()).toBeNull();
        expect(BACKEND_HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('prefers the build backend when localStorage points to a different deployed environment', async () => {
        localStorage.setItem(BACKEND_URL_KEY, 'https://csyos-backend-staging.sully-tts-proxy.workers.dev');
        localStorage.setItem(BACKEND_TOKEN_KEY, STALE_STAGING_TOKEN);
        const { getBackendToken,getBackendUrl } = await loadBackendConfig();

        expect(getBackendUrl()).toBe(PROD_BACKEND_URL);
        expect(getBackendToken()).toBe(PROD_BACKEND_TOKEN);
        expect(getBackendToken()).not.toBe(STALE_STAGING_TOKEN);
    });

    it('reports when backend config comes from build env instead of localStorage', async () => {
        const { getBackendResolutionDebug } = await loadBackendConfig();

        const debug = getBackendResolutionDebug();
        expect(debug.backendUrl).toBe(PROD_BACKEND_URL);
        expect(debug.backendUrlSource).toBe('build_env');
        expect(debug.hasBackendToken).toBe(true);
        expect(debug.backendTokenSource).toBe('build_env');
    });

    it('keeps a stable local client id and sends it with backend requests', async () => {
        localStorage.setItem('csyos_user_id', 'csy-user-a');
        const {
            buildBackendAuthQuery,
            buildBackendHeaders,
            getClientId,
        } = await loadBackendConfig();
        const clientId = getClientId();

        expect(clientId).toMatch(/^csy-client-/);
        expect(getClientId()).toBe(clientId);

        const headers = buildBackendHeaders();
        expect(headers['X-Client-Id']).toBe(clientId);

        const params = new URLSearchParams(buildBackendAuthQuery());
        expect(params.get('_clientId')).toBe(clientId);
        expect(params.get('userId')).toBe('csy-user-a');
    });

    it('only changes the sync code through the explicit manual path', async () => {
        localStorage.setItem('csyos_user_id', 'csy-user-original');
        const { setUserId } = await loadBackendConfig();

        const unsafeSetUserId = setUserId as unknown as (id: string, options?: { source?: string }) => void;
        unsafeSetUserId('csy-user-from-import');
        expect(localStorage.getItem('csyos_user_id')).toBe('csy-user-original');

        setUserId('csy-user-manual', { source: 'manual' });
        expect(localStorage.getItem('csyos_user_id')).toBe('csy-user-manual');
    });
});
