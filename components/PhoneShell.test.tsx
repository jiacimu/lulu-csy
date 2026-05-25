// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneShell from './PhoneShell';
import { AppID } from '../types';
import { VirtualTimeProvider } from '../context/VirtualTimeContext';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { StatusBar as CapStatusBar } from '@capacitor/status-bar';

let launcherRenderCount = 0;
let statusBarRenderCount = 0;

vi.mock('../context/OSContext', () => ({
    useOS: vi.fn(),
}));

vi.mock('../apps/Launcher', async () => {
    const React = await import('react');
    return {
        default: () => {
            launcherRenderCount += 1;
            return React.createElement('div', null, 'Launcher App');
        },
    };
});

vi.mock('./os/StatusBar', async () => {
    const React = await import('react');
    const { useVirtualTime } = await import('../context/VirtualTimeContext');

    return {
        default: () => {
            statusBarRenderCount += 1;
            const virtualTime = useVirtualTime();
            return React.createElement('div', { 'data-testid': 'status-bar' }, `status:${virtualTime.hours}:${virtualTime.minutes}`);
        },
    };
});

vi.mock('./os/AppSplashScreen', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement('div', null, 'Loading App'),
    };
});

vi.mock('../apps/zhaixinglou/ZhaixinglouApp', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement('div', null, 'Zhaixinglou App'),
    };
});

vi.mock('../apps/EchoRecordApp', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement('div', null, 'EchoRecord App'),
    };
});

vi.mock('../apps/zhaixinglou/AssetPreloader', () => ({
    prefetchZhaixinglouAssets: vi.fn(() => Promise.resolve()),
}));

vi.mock('./os/UpdatePopup', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement(React.Fragment, null),
    };
});

vi.mock('./os/DynamicIsland', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement(React.Fragment, null),
    };
});

vi.mock('./os/FloatingLyrics', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement(React.Fragment, null),
    };
});

vi.mock('./ValentineEvent', async () => {
    const React = await import('react');
    return {
        SpecialMomentsApp: () => React.createElement(React.Fragment, null),
        ValentineController: () => React.createElement(React.Fragment, null),
    };
});

vi.mock('../utils/specialEvents', () => ({
    getSpecialEventDefinition: vi.fn(() => null),
    shouldShowSpecialEventPopup: vi.fn(() => false),
}));

vi.mock('../utils/haptics', () => ({
    haptic: {
        light: vi.fn(),
    },
}));

vi.mock('../utils/runtimeRecovery', () => ({
    attemptChunkAutoReload: vi.fn(() => false),
    isChunkLoadError: vi.fn(() => false),
    reloadApplication: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        getPlatform: vi.fn(() => 'web'),
    },
}));

vi.mock('@capacitor/app', () => ({
    App: {
        addListener: vi.fn(),
        exitApp: vi.fn(),
        removeAllListeners: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('@capacitor/status-bar', () => ({
    StatusBar: {
        hide: vi.fn(),
        setOverlaysWebView: vi.fn(),
        setStyle: vi.fn(),
    },
    Style: {
        Dark: 'dark',
    },
    Animation: {
        None: 'NONE',
    },
}));

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        checkPermissions: vi.fn(() => Promise.resolve({ display: 'granted' })),
        requestPermissions: vi.fn(() => Promise.resolve({ display: 'granted' })),
    },
}));

vi.mock('../utils/systemFullscreen', () => ({
    requestSystemFullscreen: vi.fn(),
}));

const mockedUseOS = vi.mocked(useOS);

describe('PhoneShell active app rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'));

        launcherRenderCount = 0;
        statusBarRenderCount = 0;

        localStorage.clear();
        localStorage.setItem('sullyos_disclaimer_accepted', '1');
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

        window.scrollTo = vi.fn();
        window.requestIdleCallback = ((callback: IdleRequestCallback) => window.setTimeout(() => callback({
            didTimeout: false,
            timeRemaining: () => 50,
        }), 1)) as typeof window.requestIdleCallback;
        window.cancelIdleCallback = ((id: number) => window.clearTimeout(id)) as typeof window.cancelIdleCallback;

        mockedUseOS.mockReturnValue({
            activeApp: AppID.Launcher,
            characters: [],
            closeApp: vi.fn(),
            handleBack: vi.fn(() => true),
            isDataLoaded: true,
            isLocked: false,
            theme: {
                wallpaper: 'linear-gradient(#000000, #111111)',
                hideStatusBar: false,
            },
            toasts: [],
            unreadMessages: {},
            unlock: vi.fn(),
        } as any);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not rerender the active app when virtual time ticks in the status bar', async () => {
        render(
            <VirtualTimeProvider>
                <PhoneShell />
            </VirtualTimeProvider>,
        );

        expect(launcherRenderCount).toBe(1);

        await act(async () => {
            vi.advanceTimersByTime(3100);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(statusBarRenderCount).toBeGreaterThan(1);
        expect(launcherRenderCount).toBe(1);
    });

    it('renders the EchoRecord app when it is the active app', async () => {
        vi.useRealTimers();
        mockedUseOS.mockReturnValue({
            activeApp: AppID.EchoRecord,
            characters: [],
            closeApp: vi.fn(),
            handleBack: vi.fn(() => true),
            isDataLoaded: true,
            isLocked: false,
            theme: {
                wallpaper: 'linear-gradient(#000000, #111111)',
                hideStatusBar: false,
            },
            toasts: [],
            unreadMessages: {},
            unlock: vi.fn(),
        } as any);

        render(
            <VirtualTimeProvider>
                <PhoneShell />
            </VirtualTimeProvider>,
        );

        expect(await screen.findByText('EchoRecord App', {}, { timeout: 3000 })).toBeTruthy();
    });

    it('keeps opened apps below the top device safe area', async () => {
        vi.useRealTimers();
        mockedUseOS.mockReturnValue({
            activeApp: AppID.EchoRecord,
            characters: [],
            closeApp: vi.fn(),
            handleBack: vi.fn(() => true),
            isDataLoaded: true,
            isLocked: false,
            theme: {
                wallpaper: 'linear-gradient(#000000, #111111)',
                hideStatusBar: false,
            },
            toasts: [],
            unreadMessages: {},
            unlock: vi.fn(),
        } as any);

        render(
            <VirtualTimeProvider>
                <PhoneShell />
            </VirtualTimeProvider>,
        );

        const appFrame = screen.getByTestId('active-app-container');

        expect(appFrame.style.paddingTop).toBe('var(--safe-top, env(safe-area-inset-top))');
        expect(appFrame.style.paddingBottom).toBe('');
    });

    it('does not add safe-area padding on the launcher', () => {
        render(
            <VirtualTimeProvider>
                <PhoneShell />
            </VirtualTimeProvider>,
        );

        const appFrame = screen.getByTestId('active-app-container');

        expect(appFrame.style.paddingTop).toBe('0px');
        expect(appFrame.style.paddingBottom).toBe('');
    });

    it('does not call the Android-only overlay API before hiding the iOS status bar', async () => {
        vi.useRealTimers();
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

        render(
            <VirtualTimeProvider>
                <PhoneShell />
            </VirtualTimeProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(CapStatusBar.setOverlaysWebView).not.toHaveBeenCalled();
        expect(CapStatusBar.hide).toHaveBeenCalledWith({ animation: 'NONE' });
    });
});
