// @vitest-environment jsdom

import { cleanup,render } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import App from './App';

let isIOSStandalone = true;

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
  IOS_STANDALONE_CHANGE_EVENT: 'sully:ios-standalone-change',
  isIOSStandaloneWebApp: vi.fn(() => isIOSStandalone),
}));

describe('App iOS standalone shell layout', () => {
  beforeEach(() => {
    isIOSStandalone = true;
    window.history.replaceState({}, '', '/');
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

  it('pins the iOS standalone canvas to all viewport edges without using real-vh inline height', () => {
    const { container } = render(<App />);

    const appRoot = container.querySelector('.sully-app-root') as HTMLElement | null;

    expect(appRoot).not.toBeNull();
    expect(appRoot?.classList.contains('fixed')).toBe(true);
    expect(appRoot?.classList.contains('inset-0')).toBe(true);
    expect(appRoot?.style.height).toBe('');
    expect(appRoot?.getAttribute('style') ?? '').not.toContain('--real-vh');
  });
});
