let hasInstalledViewportRepair = false;
let hasPatchedFocus = false;
let viewportWatchdogTimer: number | undefined;
let debugOverlay: HTMLDivElement | null = null;
let debugPre: HTMLPreElement | null = null;
let debugInterval: number | undefined;
let lastDebugText = '';
let logoTapCount = 0;
let logoTapTimer: number | undefined;
let lastPointerDebugTapAt = Number.NEGATIVE_INFINITY;

const VIEWPORT_DEBUG_TRIGGER_SELECTOR = '[data-viewport-debug-trigger="true"]';
const KEYBOARD_CLOSED_TOLERANCE = 80;
const WATCHDOG_DELAY_MS = 150;
const UNLOCK_KEYBOARD_SETTLE_TIMEOUT_MS = 350;

type FocusTarget = HTMLElement & {
  focus(options?: FocusOptions): void;
};

declare global {
  interface Window {
    SullyViewportRepair?: {
      resetViewport: () => void;
      showDebug: () => void;
      getDebugText: () => string;
    };
  }
}

function safeScrollTo(x: number, y: number): void {
  try {
    window.scrollTo(x, y);
  } catch {
    // Test and embedded WebView environments may expose scrollTo without implementation.
  }
}

export function resetViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  safeScrollTo(0, 1);
  safeScrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  if (document.body) {
    document.body.scrollTop = 0;
  }
}

function checkViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.clearTimeout(viewportWatchdogTimer);
  viewportWatchdogTimer = window.setTimeout(() => {
    const vv = window.visualViewport;
    const documentHeight = document.documentElement.clientHeight;
    const kbClosed = !vv || vv.height >= documentHeight - KEYBOARD_CLOSED_TOLERANCE;
    const stuck = Boolean(vv && vv.offsetTop > 0) || document.documentElement.scrollTop !== 0 || window.scrollY !== 0;

    if (kbClosed && stuck) {
      resetViewport();
    }
  }, WATCHDOG_DELAY_MS);
}

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && typeof active.blur === 'function') {
    active.blur();
  }
}

export function prepareViewportForUnlock(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve();
  }

  blurActiveElement();

  return new Promise(resolve => {
    const vv = window.visualViewport;
    let settled = false;
    let timeoutId: number | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      vv?.removeEventListener('resize', finish);
      resetViewport();
      resolve();
    };

    timeoutId = window.setTimeout(finish, UNLOCK_KEYBOARD_SETTLE_TIMEOUT_MS);

    if (vv) {
      vv.addEventListener('resize', finish, { once: true });
    }
  });
}

export function focusPreventScroll<T extends FocusTarget | null | undefined>(element: T): void {
  if (!element) return;

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function installPreventScrollFocusPatch(): void {
  if (hasPatchedFocus || typeof HTMLElement === 'undefined') return;

  const originalFocus = HTMLElement.prototype.focus;
  if (typeof originalFocus !== 'function') return;

  hasPatchedFocus = true;
  HTMLElement.prototype.focus = function patchedFocus(options?: FocusOptions) {
    if (options !== undefined) {
      return originalFocus.call(this, options);
    }

    try {
      return originalFocus.call(this, { preventScroll: true });
    } catch {
      return originalFocus.call(this);
    }
  };
}

function readSafeAreaInsetBottom(): number {
  if (typeof document === 'undefined' || !document.body) return 0;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const value = parseFloat(computed.paddingBottom || '0') || 0;
  document.body.removeChild(probe);
  return Math.round(value);
}

function buildDebugText(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';

  const vv = window.visualViewport;
  const lines = [
    `visualViewport.offsetTop: ${vv ? Math.round(vv.offsetTop) : 'n/a'}`,
    `visualViewport.height: ${vv ? Math.round(vv.height) : 'n/a'}`,
    `innerHeight: ${Math.round(window.innerHeight || 0)}`,
    `documentElement.clientHeight: ${Math.round(document.documentElement.clientHeight || 0)}`,
    `scrollY: ${Math.round(window.scrollY || 0)}`,
    `documentElement.scrollTop: ${Math.round(document.documentElement.scrollTop || 0)}`,
    `env(safe-area-inset-bottom): ${readSafeAreaInsetBottom()}px`,
    `UA: ${navigator.userAgent || ''}`,
  ];

  return lines.join('\n');
}

function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => copyTextWithTextarea(text));
    return;
  }

  copyTextWithTextarea(text);
}

function copyTextWithTextarea(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  focusPreventScroll(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    document.execCommand('copy');
  } catch {
    // Clipboard fallback can fail silently on locked-down browsers.
  }

  document.body.removeChild(textarea);
}

function refreshDebugOverlay(): void {
  if (!debugPre) return;

  lastDebugText = buildDebugText();
  debugPre.textContent = lastDebugText;
}

export function showViewportDebugOverlay(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (!debugOverlay) {
    debugOverlay = document.createElement('div');
    debugOverlay.id = 'sully-viewport-debug-panel';
    debugOverlay.style.cssText = [
      'position:fixed',
      'left:8px',
      'right:8px',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 8px)',
      'z-index:2147483647',
      'max-width:520px',
      'margin:0 auto',
      'padding:10px',
      'border:1px solid rgba(255,255,255,0.2)',
      'border-radius:14px',
      'background:rgba(15,23,42,0.88)',
      'color:#f8fafc',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'box-shadow:0 18px 60px rgba(0,0,0,0.35)',
      'backdrop-filter:blur(14px)',
      '-webkit-backdrop-filter:blur(14px)',
      'pointer-events:auto',
      'user-select:text',
      'white-space:normal',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px';

    const title = document.createElement('div');
    title.textContent = 'Viewport Debug';
    title.style.cssText = 'font-weight:700;letter-spacing:0.02em';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '复制';
    copyButton.style.cssText = 'border:0;border-radius:999px;background:#f8fafc;color:#0f172a;padding:5px 10px;font-weight:700;font-size:11px';
    copyButton.addEventListener('click', () => copyText(lastDebugText || buildDebugText()));

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';
    closeButton.style.cssText = 'border:0;border-radius:999px;background:rgba(255,255,255,0.14);color:#f8fafc;padding:5px 10px;font-weight:700;font-size:11px';
    closeButton.addEventListener('click', hideViewportDebugOverlay);

    debugPre = document.createElement('pre');
    debugPre.style.cssText = 'margin:0;max-height:42vh;overflow:auto;white-space:pre-wrap;word-break:break-word';

    actions.append(copyButton, closeButton);
    header.append(title, actions);
    debugOverlay.append(header, debugPre);
    document.body.appendChild(debugOverlay);
  }

  refreshDebugOverlay();
  if (debugInterval === undefined) {
    debugInterval = window.setInterval(refreshDebugOverlay, 300);
  }
}

function hideViewportDebugOverlay(): void {
  if (debugInterval !== undefined) {
    window.clearInterval(debugInterval);
    debugInterval = undefined;
  }

  debugOverlay?.remove();
  debugOverlay = null;
  debugPre = null;
}

function shouldEnableDebugFromUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

function getDebugTriggerElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target.closest(VIEWPORT_DEBUG_TRIGGER_SELECTOR);
  }

  if (target instanceof Node) {
    return target.parentElement?.closest(VIEWPORT_DEBUG_TRIGGER_SELECTOR) || null;
  }

  return null;
}

function handleDebugTriggerTap(event: Event): void {
  const target = event.target;
  if (!getDebugTriggerElement(target)) return;

  const tappedAt = Date.now();
  if (event.type === 'pointerup') {
    lastPointerDebugTapAt = tappedAt;
  } else if (event.type === 'click' && tappedAt - lastPointerDebugTapAt < 500) {
    return;
  }

  window.clearTimeout(logoTapTimer);
  logoTapCount += 1;
  logoTapTimer = window.setTimeout(() => {
    logoTapCount = 0;
  }, 1600);

  if (logoTapCount >= 5) {
    logoTapCount = 0;
    showViewportDebugOverlay();
  }
}

function syncDebugFromUrl(): void {
  if (shouldEnableDebugFromUrl()) {
    showViewportDebugOverlay();
  }
}

export function installViewportRepair(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (hasInstalledViewportRepair) return;

  hasInstalledViewportRepair = true;
  installPreventScrollFocusPatch();

  const vv = window.visualViewport;
  vv?.addEventListener('resize', checkViewport);
  vv?.addEventListener('scroll', checkViewport);
  window.addEventListener('focusout', checkViewport);
  window.addEventListener('resize', checkViewport);
  window.addEventListener('pageshow', checkViewport);
  window.addEventListener('popstate', syncDebugFromUrl);
  window.addEventListener('hashchange', syncDebugFromUrl);
  document.addEventListener('pointerup', handleDebugTriggerTap, true);
  document.addEventListener('click', handleDebugTriggerTap, true);

  window.SullyViewportRepair = {
    resetViewport,
    showDebug: showViewportDebugOverlay,
    getDebugText: buildDebugText,
  };

  syncDebugFromUrl();
}
