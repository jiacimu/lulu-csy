// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
    isNativePlatform: vi.fn(() => false),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorMock,
}));

import { resolveProxyBaseUrl, resolveProxyEndpoint } from '../utils/proxyEndpoint';

describe('proxyEndpoint', () => {
    beforeEach(() => {
        capacitorMock.isNativePlatform.mockReturnValue(false);
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('keeps relative proxy routes on web so Vite and Pages Functions handle them', () => {
        expect(resolveProxyEndpoint('/minimax-api/v1/t2a_v2')).toBe('/minimax-api/v1/t2a_v2');
        expect(resolveProxyBaseUrl('/minimax-api', 'https://api.minimaxi.com')).toBe('/minimax-api');
    });

    it('routes relative proxy paths through the frontend origin in native builds', () => {
        capacitorMock.isNativePlatform.mockReturnValue(true);

        expect(resolveProxyEndpoint('/elevenlabs-token')).toBe('https://sully-frontend.pages.dev/elevenlabs-token');
        expect(resolveProxyBaseUrl('/minimax-api', 'https://api.minimaxi.com')).toBe('https://sully-frontend.pages.dev/minimax-api');
    });

    it('does not rewrite absolute provider URLs in native builds', () => {
        capacitorMock.isNativePlatform.mockReturnValue(true);

        expect(resolveProxyEndpoint('https://api.example.com/proxy')).toBe('https://api.example.com/proxy');
        expect(resolveProxyBaseUrl('https://api.minimaxi.com/', '/minimax-api')).toBe('https://api.minimaxi.com');
    });
});
