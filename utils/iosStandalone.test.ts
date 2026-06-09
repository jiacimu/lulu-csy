import { beforeEach, describe, expect, it, vi } from 'vitest';

type ViewportOptions = {
  innerHeight?: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  clientHeight?: number;
};

function setIOSNavigator() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
}

function setStandaloneDisplayMode(getStandalone: () => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: getStandalone() && (
        query === '(display-mode: standalone)' ||
        query === '(display-mode: fullscreen)'
      ),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setViewport(options: ViewportOptions) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: options.innerHeight ?? 812,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: options.clientHeight ?? options.innerHeight ?? 812,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      height: options.visualHeight ?? options.innerHeight ?? 812,
      offsetTop: options.visualOffsetTop ?? 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function setSafeAreaInsets(top: number, bottom: number) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: (property: string) => {
      if (property === 'padding-top') return `${top}px`;
      if (property === 'padding-bottom') return `${bottom}px`;
      return '0px';
    },
  } as CSSStyleDeclaration));
}

async function loadIOSStandaloneModule() {
  vi.resetModules();
  return import('./iosStandalone');
}

describe('iosStandalone viewport handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-ios-standalone');
    document.documentElement.style.cssText = '';
    document.body.className = '';
    document.body.style.cssText = '';
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setIOSNavigator();
  });

  it('keeps iOS standalone app height inside the visible viewport while exposing safe area vars', async () => {
    setStandaloneDisplayMode(() => true);
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(true);
    expect(document.body.classList.contains('ios-standalone')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('34px');
  });

  it('re-syncs when iOS display mode becomes standalone after initial install', async () => {
    let standalone = false;
    setStandaloneDisplayMode(() => standalone);
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');

    standalone = true;
    window.dispatchEvent(new Event('pageshow'));

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
  });

  it('does not shrink the full app canvas while the iOS keyboard changes visualViewport height', async () => {
    setStandaloneDisplayMode(() => true);
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');

    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('332px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
  });

  it('tracks the iOS keyboard state for regular browser text inputs', async () => {
    setStandaloneDisplayMode(() => false);
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);

    setViewport({ innerHeight: 812, visualHeight: 500, clientHeight: 812 });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(document.body.classList.contains('ios-keyboard-open')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('312px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
  });
});
