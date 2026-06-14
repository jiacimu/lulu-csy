// @vitest-environment jsdom

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const pushMocks = vi.hoisted(() => {
    const listeners: Record<string, (payload: any) => void> = {};
    const remove = vi.fn();

    return {
        listeners,
        capacitor: {
            isNativePlatform: vi.fn(() => true),
            getPlatform: vi.fn(() => 'android'),
        },
        pushNotifications: {
            checkPermissions: vi.fn(),
            requestPermissions: vi.fn(),
            register: vi.fn(),
            unregister: vi.fn(),
            addListener: vi.fn(),
        },
        remove,
    };
});

vi.mock('@capacitor/core', () => ({
    Capacitor: pushMocks.capacitor,
}));

vi.mock('@capacitor/push-notifications', () => ({
    PushNotifications: pushMocks.pushNotifications,
}));

const BACKEND_URL = 'https://csyos-backend-staging.sully-tts-proxy.workers.dev';

describe('nativePushBridge', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        localStorage.clear();

        for (const key of Object.keys(pushMocks.listeners)) {
            delete pushMocks.listeners[key];
        }

        vi.stubEnv('VITE_CSYOS_BACKEND_URL', BACKEND_URL);
        vi.stubEnv('VITE_CSYOS_BACKEND_TOKEN', 'staging-token');

        pushMocks.capacitor.isNativePlatform.mockReturnValue(true);
        pushMocks.capacitor.getPlatform.mockReturnValue('android');
        pushMocks.pushNotifications.checkPermissions.mockResolvedValue({ receive: 'granted' });
        pushMocks.pushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
        pushMocks.pushNotifications.unregister.mockResolvedValue(undefined);
        pushMocks.pushNotifications.addListener.mockImplementation((eventName: string, listener: (payload: any) => void) => {
            pushMocks.listeners[eventName] = listener;
            return Promise.resolve({ remove: pushMocks.remove });
        });
        pushMocks.pushNotifications.register.mockImplementation(() => {
            queueMicrotask(() => {
                pushMocks.listeners.registration?.({ value: 'fcm-token-1234567890' });
            });
            return Promise.resolve();
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('shows a backend-upgrade hint instead of asking users to reinitialize when native push routes are missing', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: 'not_found',
            message: 'Not found',
        }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { registerNativePush } = await import('./nativePushBridge');

        const info = await registerNativePush();

        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BACKEND_URL}/api/push/native/register`);
        expect(info.status).toBe('当前后端未开通原生 FCM 接口');
        expect(info.error).toContain('重复初始化不会生效');
        expect(info.error).toContain('/api/push/native/register');
        expect(info.registered).toBe(false);
        expect(info.offlineCapable).toBe(false);
        expect(info.needsResubscribe).toBe(false);
        expect(info.tokenPreview).toBe('fcm-to...7890');
    });
});
