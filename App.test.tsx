// @vitest-environment jsdom

import { cleanup,render } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import App from './App';
import { isIOSStandaloneWebApp } from './utils/iosStandalone';

vi.mock('./components/PhoneShell', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'phone-shell' }, 'PhoneShell'),
  };
});

vi.mock('./components/FeaturePreviewPage', async () => {
  const React = await import('react');
  return {
    default: ({ onEnterApp }: { onEnterApp: () => void }) => (
      React.createElement('button', { type: 'button', onClick: onEnterApp }, 'Enter app')
    ),
  };
});

vi.mock('./context/VirtualTimeContext', async () => {
  const React = await import('react');
  return {
    VirtualTimeProvider: ({ children }: { children: React.ReactNode }) => (
      React.createElement(React.Fragment, null, children)
    ),
  };
});

vi.mock('./context/OSContext', async () => {
  const React = await import('react');
  return {
    OSProvider: ({ children }: { children: React.ReactNode }) => (
      React.createElement(React.Fragment, null, children)
    ),
  };
});

vi.mock('./utils/keepAlive', () => ({
  startBackendHeartbeat: vi.fn(),
  startKeepAlive: vi.fn(),
}));

vi.mock('./utils/autofillSuppression', () => ({
  installGlobalAutofillSuppression: vi.fn(() => vi.fn()),
}));

vi.mock('./utils/systemFullscreen', () => ({
  isFullscreenEnabled: vi.fn(() => false),
  requestSystemFullscreenForMobileRestore: vi.fn(),
}));

vi.mock('./utils/iosStandalone', () => ({
  isIOSStandaloneWebApp: vi.fn(() => false),
}));

describe('App fullscreen shell layout', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    vi.mocked(isIOSStandaloneWebApp).mockReturnValue(false);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the fixed app shell outside iOS standalone', () => {
    const { container } = render(<App />);

    const appRoot = container.firstElementChild as HTMLElement | null;

    expect(appRoot).not.toBeNull();
    expect(appRoot?.classList.contains('fixed')).toBe(true);
    expect(appRoot?.classList.contains('inset-0')).toBe(true);
    expect(appRoot?.classList.contains('sully-app-root')).toBe(true);
    expect(appRoot?.classList.contains('h-screen')).toBe(false);
    expect(appRoot?.style.height).toBe('');
    expect(appRoot?.getAttribute('style') ?? '').not.toContain('--real-vh');

    const appCanvas = appRoot?.firstElementChild as HTMLElement | null;

    expect(appCanvas?.classList.contains('absolute')).toBe(true);
    expect(appCanvas?.classList.contains('inset-0')).toBe(true);
  });

  it('uses the SullyOS-style app-height shell in iOS standalone', () => {
    vi.mocked(isIOSStandaloneWebApp).mockReturnValue(true);

    const { container } = render(<App />);

    const appRoot = container.firstElementChild as HTMLElement | null;
    const appCanvas = appRoot?.firstElementChild as HTMLElement | null;

    expect(appRoot?.classList.contains('fixed')).toBe(true);
    expect(appRoot?.classList.contains('inset-0')).toBe(true);
    expect(appRoot?.classList.contains('sully-app-root')).toBe(true);
    expect(appRoot?.classList.contains('h-screen')).toBe(false);
    expect(appRoot?.style.height).toBe('var(--app-height, 100lvh)');
    expect(appRoot?.style.minHeight).toBe('var(--app-height, 100lvh)');
    expect(appRoot?.getAttribute('style') ?? '').not.toContain('--real-vh');
    expect(appCanvas?.classList.contains('absolute')).toBe(true);
    expect(appCanvas?.classList.contains('fixed')).toBe(false);
  });
});
