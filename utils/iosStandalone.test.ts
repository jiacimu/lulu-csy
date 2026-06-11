import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ViewportOptions = {
  innerHeight?: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  clientHeight?: number;
  scale?: number;
};

type DisplayModeOptions = {
  standalone?: boolean | (() => boolean);
  fullscreen?: boolean | (() => boolean);
};

let visualViewportListeners: Record<string, Set<EventListenerOrEventListenerObject>>;
let visualViewportMock: {
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let scrollYValue = 0;

function readFlag(flag: boolean | (() => boolean) | undefined): boolean {
  return typeof flag === 'function' ? flag() : Boolean(flag);
}

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

function setDisplayModes(options: DisplayModeOptions) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)'
        ? readFlag(options.standalone)
        : query === '(display-mode: fullscreen)'
          ? readFlag(options.fullscreen)
          : false,
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

function setScreenSize(width: number, height: number) {
  Object.defineProperty(window, 'screen', {
    configurable: true,
    value: { width, height },
  });
}

function ensureVisualViewportMock(options: ViewportOptions) {
  if (!visualViewportMock) {
    visualViewportMock = {
      height: options.visualHeight ?? options.innerHeight ?? 812,
      offsetTop: options.visualOffsetTop ?? 0,
      scale: options.scale ?? 1,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        visualViewportListeners[type] ??= new Set();
        visualViewportListeners[type].add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        visualViewportListeners[type]?.delete(listener);
      }),
    };

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewportMock,
    });
    return;
  }

  visualViewportMock.height = options.visualHeight ?? options.innerHeight ?? visualViewportMock.height;
  visualViewportMock.offsetTop = options.visualOffsetTop ?? 0;
  visualViewportMock.scale = options.scale ?? 1;
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
  ensureVisualViewportMock(options);
}

function dispatchVisualViewportEvent(type: 'resize' | 'scroll') {
  const event = new Event(type);
  visualViewportListeners[type]?.forEach(listener => {
    if (typeof listener === 'function') {
      listener(event);
    } else {
      listener.handleEvent(event);
    }
  });
}

function setSafeAreaInsets(top: number, bottom: number) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
    const style = (element as HTMLElement).style;
    return {
      overflowY: style.overflowY || '',
      getPropertyValue: (property: string) => {
        if (property === 'padding-top') return `${top}px`;
        if (property === 'padding-bottom') return `${bottom}px`;
        if (property === 'overflow-y') return style.overflowY || '';
        return '0px';
      },
    } as CSSStyleDeclaration;
  });
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

function setWindowScroll(y: number) {
  scrollYValue = y;
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollYValue,
  });
  Object.defineProperty(document, 'scrollingElement', {
    configurable: true,
    get: () => document.documentElement,
  });
  document.documentElement.scrollTop = y;
  document.body.scrollTop = y;
}

function focusTextArea(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  return textarea;
}

function dispatchFirstTouch() {
  document.body.dispatchEvent(new Event('touchstart', { bubbles: true }));
}

async function loadIOSStandaloneModule() {
  vi.resetModules();
  return import('./iosStandalone');
}

describe('iosStandalone viewport handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    visualViewportListeners = {};
    visualViewportMock = undefined as unknown as typeof visualViewportMock;
    scrollYValue = 0;
    document.body.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-ios-standalone');
    document.documentElement.style.cssText = '';
    document.documentElement.scrollTop = 0;
    document.body.className = '';
    document.body.style.cssText = '';
    document.body.scrollTop = 0;
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setVisibility('visible');
    setIOSNavigator();
    setDisplayModes({ standalone: true });
    setScreenSize(390, 844);
    setWindowScroll(0);
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn((_x: number, y: number) => {
        setWindowScroll(Number(y) || 0);
      }),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn((id: number) => window.clearTimeout(id)),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps iOS standalone app height inside the visible viewport while exposing safe area vars', async () => {
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
    setDisplayModes({ standalone: () => standalone });
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');

    standalone = true;
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
  });

  it('does not shrink the full app canvas while a focused iOS keyboard changes visualViewport height', async () => {
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');

    await vi.advanceTimersByTimeAsync(1);
    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    focusTextArea();

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('332px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
    expect(document.documentElement.style.getPropertyValue('--effective-safe-bottom')).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  it('clears ghost keyboard state across background restore without a trusted viewport event', async () => {
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    await vi.advanceTimersByTimeAsync(1);
    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    focusTextArea();
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('332px');

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1300);

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--effective-safe-bottom')).toBe('');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);
  });

  it('clears keyboard artifacts when focusout settles while the document is hidden', async () => {
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    await vi.advanceTimersByTimeAsync(1);
    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    const textarea = focusTextArea();
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(true);

    textarea.blur();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(180);

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);
  });

  it('does not persist a smaller standalone height from a transient background restore viewport', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    await vi.advanceTimersByTimeAsync(160);
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    setViewport({ innerHeight: 780, visualHeight: 780, clientHeight: 780 });
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);
  });

  it('does not mark the keyboard open from visualViewport shrink without text entry focus', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    setViewport({ innerHeight: 844, visualHeight: 520, clientHeight: 844 });
    dispatchVisualViewportEvent('resize');

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--effective-safe-bottom')).toBe('');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('waits for post-orientation dimensions before accepting the new standalone height', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    window.dispatchEvent(new Event('orientationchange'));
    await vi.advanceTimersByTimeAsync(80);
    setViewport({ innerHeight: 390, visualHeight: 390, clientHeight: 390 });
    await vi.advanceTimersByTimeAsync(170);

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('390px');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('resets stray document scroll when the keyboard is closed', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);
    setWindowScroll(57);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(window.scrollY).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it('does not write stale smaller standalone restore heights before first interaction', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    setViewport({ innerHeight: 780, visualHeight: 780, clientHeight: 780 });
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(1300);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    dispatchFirstTouch();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('844px');
  });

  it('does not apply the standalone restore height guard in regular browser mode', async () => {
    setDisplayModes({ standalone: false });
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    setViewport({ innerHeight: 780, visualHeight: 780, clientHeight: 780 });
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(1300);

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('780px');
  });

  it('clamps impossible standalone heights to the device long edge', async () => {
    setScreenSize(390, 844);
    setViewport({ innerHeight: 2000, visualHeight: 2000, clientHeight: 2000 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('2000px');
    await vi.advanceTimersByTimeAsync(160);
    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');
  });

  it('does not clamp regular browser layout heights to the device long edge', async () => {
    setDisplayModes({ standalone: false });
    setScreenSize(390, 844);
    setViewport({ innerHeight: 1200, visualHeight: 1200, clientHeight: 1200 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('1200px');
  });

  it('does not clamp standalone height when screen dimensions are unavailable', async () => {
    setScreenSize(0, 0);
    setViewport({ innerHeight: 900, visualHeight: 900, clientHeight: 900 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('900px');
  });

  it('allows a smaller stable height after a trusted viewport event and user interaction', async () => {
    setViewport({ innerHeight: 844, visualHeight: 844, clientHeight: 844 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    await vi.advanceTimersByTimeAsync(160);
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    window.dispatchEvent(new Event('pageshow'));
    setViewport({ innerHeight: 744, visualHeight: 744, clientHeight: 744 });
    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('844px');

    await vi.advanceTimersByTimeAsync(1);
    dispatchFirstTouch();
    await vi.advanceTimersByTimeAsync(600);

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('744px');
  });

  it('keeps keyboard inset while switching focused inputs without a new viewport event', async () => {
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    await vi.advanceTimersByTimeAsync(1);
    setViewport({ innerHeight: 812, visualHeight: 500, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    const first = focusTextArea();
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('312px');

    const second = document.createElement('textarea');
    document.body.appendChild(second);
    first.blur();
    second.focus();
    second.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(180);

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('312px');
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(true);
  });

  it('does not treat element fullscreen as standalone display mode', async () => {
    const fullscreenElement = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    setDisplayModes({ fullscreen: true });
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround, isStandaloneDisplayMode } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(isStandaloneDisplayMode()).toBe(false);
    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.dataset.iosStandalone).toBe('false');
  });

  it('does not call scrollIntoView for a focused dock input without a scrollable ancestor', async () => {
    setViewport({ innerHeight: 812, visualHeight: 500, clientHeight: 812 });
    setSafeAreaInsets(47, 34);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    dispatchVisualViewportEvent('resize');
    focusTextArea();
    await vi.advanceTimersByTimeAsync(0);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(0);
  });

  it('tracks the iOS keyboard state for regular browser text inputs', async () => {
    setDisplayModes({ standalone: false });
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setSafeAreaInsets(47, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    setViewport({ innerHeight: 812, visualHeight: 500, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    focusTextArea();

    expect(document.body.classList.contains('ios-keyboard-open')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('312px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
  });
});
