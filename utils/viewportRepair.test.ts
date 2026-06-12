// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ViewportOptions = {
  innerHeight: number;
  visualHeight: number;
  clientHeight: number;
  visualOffsetTop?: number;
};

let visualViewportListeners: Record<string, Set<EventListenerOrEventListenerObject>>;
let visualViewportMock: {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function setIOSStandaloneEnvironment() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.4 Mobile/15E148 Safari/604.1',
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)',
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
    value: options.innerHeight,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: options.clientHeight,
  });

  if (!visualViewportMock) {
    visualViewportMock = {
      height: options.visualHeight,
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

  visualViewportMock.height = options.visualHeight;
  visualViewportMock.offsetTop = options.visualOffsetTop ?? 0;
}

function setScreenSize(width: number, height: number) {
  Object.defineProperty(window, 'screen', {
    configurable: true,
    value: {
      width,
      height,
      availWidth: width,
      availHeight: height,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: {
        type: height >= width ? 'portrait-primary' : 'landscape-primary',
        angle: 0,
      },
    },
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

async function loadViewportRepairModule() {
  vi.resetModules();
  return import('./viewportRepair');
}

describe('viewportRepair real viewport reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    visualViewportListeners = {};
    visualViewportMock = undefined as unknown as typeof visualViewportMock;
    document.body.innerHTML = '<div class="sully-app-root"></div>';
    document.documentElement.style.cssText = '';
    document.documentElement.scrollTop = 0;
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    setIOSStandaloneEnvironment();
    setScreenSize(402, 874);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets --real-vh from the debounced watchdog when the layout viewport is short', async () => {
    setViewport({ innerHeight: 874, visualHeight: 874, clientHeight: 812 });

    const { installViewportRepair } = await loadViewportRepairModule();
    installViewportRepair();

    await vi.advanceTimersByTimeAsync(151);

    expect(document.documentElement.style.getPropertyValue('--real-vh')).toBe('874px');
  });

  it('does not update --real-vh while the visual viewport is keyboard-sized', async () => {
    setViewport({ innerHeight: 874, visualHeight: 874, clientHeight: 812 });

    const { installViewportRepair } = await loadViewportRepairModule();
    installViewportRepair();
    await vi.advanceTimersByTimeAsync(151);
    expect(document.documentElement.style.getPropertyValue('--real-vh')).toBe('874px');

    setViewport({ innerHeight: 900, visualHeight: 520, clientHeight: 812 });
    dispatchVisualViewportEvent('resize');
    await vi.advanceTimersByTimeAsync(151);

    expect(document.documentElement.style.getPropertyValue('--real-vh')).toBe('874px');
  });

  it('reports the standalone canvas screen gap verdict and always copies screenGap', async () => {
    setViewport({ innerHeight: 874, visualHeight: 874, clientHeight: 874 });
    setScreenSize(402, 932);

    const { buildDebugText, getViewportDiagnosticsSnapshot } = await loadViewportRepairModule();

    const snapshot = getViewportDiagnosticsSnapshot();
    expect(snapshot.screenGap).toBe(58);
    expect(snapshot.viewportVerdict).toBe('画布被系统截留 58 px');
    expect(buildDebugText()).toContain('screenGap: 58');
  });
});
