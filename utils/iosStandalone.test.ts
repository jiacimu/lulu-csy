import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

type ViewportOptions = {
  innerHeight?: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  clientHeight?: number;
};

type DisplayModeOptions = {
  standalone?: boolean | (() => boolean);
};

let visualViewportListeners: Record<string, Set<EventListenerOrEventListenerObject>>;
let visualViewportMock: {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

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
      matches: query === '(display-mode: standalone)' ? readFlag(options.standalone) : false,
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

function ensureVisualViewportMock(options: ViewportOptions) {
  if (!visualViewportMock) {
    visualViewportMock = {
      height: options.visualHeight ?? options.innerHeight ?? 812,
      offsetTop: options.visualOffsetTop ?? 0,
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

function setScreenSize(width: number, height: number) {
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: height,
  });
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
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    paddingTop: `${top}px`,
    paddingBottom: `${bottom}px`,
    getPropertyValue: (property: string) => {
      if (property === 'padding-top') return `${top}px`;
      if (property === 'padding-bottom') return `${bottom}px`;
      return '0px';
    },
  } as CSSStyleDeclaration));
}

function focusTextArea(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  return textarea;
}

async function loadIOSStandaloneModule() {
  vi.resetModules();
  return import('./iosStandalone');
}

describe('iosStandalone SullyOS-style viewport handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    visualViewportListeners = {};
    visualViewportMock = undefined as unknown as typeof visualViewportMock;
    document.body.innerHTML = '';
    document.body.className = '';
    document.body.style.cssText = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-ios-standalone');
    document.documentElement.style.cssText = '';
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setIOSNavigator();
    setDisplayModes({ standalone: true });
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    setScreenSize(0, 0);
    setSafeAreaInsets(47, 34);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('installs iOS standalone classes and exposes probed safe-area variables', async () => {
    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(true);
    expect(document.body.classList.contains('ios-standalone')).toBe(true);
    expect(document.documentElement.dataset.iosStandalone).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-top')).toBe('47px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--real-vh')).toBe('');
  });

  it('keeps app height stable while the iOS keyboard changes visualViewport height', async () => {
    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');

    const textarea = focusTextArea();
    setViewport({ innerHeight: 812, visualHeight: 480, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('332px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');
    expect(document.documentElement.style.getPropertyValue('--effective-safe-bottom')).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--real-vh')).toBe('');

    textarea.blur();
    textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    setViewport({ innerHeight: 812, visualHeight: 812, clientHeight: 812 });
    await vi.advanceTimersByTimeAsync(180);

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--effective-safe-bottom')).toBe('');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
    expect(document.body.classList.contains('ios-keyboard-open')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');
  });

  it('promotes iOS standalone app height when launch is stuck in the smaller viewport', async () => {
    setScreenSize(402, 874);
    setViewport({ innerHeight: 815, visualHeight: 815, clientHeight: 812 });
    setSafeAreaInsets(62, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-top')).toBe('62px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('34px');
  });

  it('does not add bottom safe area again when iOS already exposes the full screen height', async () => {
    setScreenSize(402, 874);
    setViewport({ innerHeight: 874, visualHeight: 874, clientHeight: 812 });
    setSafeAreaInsets(62, 34);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px');
  });

  it('does not apply iOS standalone classes when display mode is not standalone', async () => {
    setDisplayModes({ standalone: false });

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.classList.contains('ios-standalone')).toBe(false);
    expect(document.body.classList.contains('ios-standalone')).toBe(false);
    expect(document.documentElement.dataset.iosStandalone).toBe('false');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('812px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-top')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('0px');
  });

  it('retries safe-area probing when iOS cold start initially reports zero', async () => {
    setSafeAreaInsets(0, 0);

    const { installIOSStandaloneWorkaround } = await loadIOSStandaloneModule();
    installIOSStandaloneWorkaround();

    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-top')).toBe('44px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('0px');

    setSafeAreaInsets(47, 34);
    await vi.advanceTimersByTimeAsync(120);

    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-top')).toBe('47px');
    expect(document.documentElement.style.getPropertyValue('--standalone-safe-area-bottom')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('846px');
  });
});
