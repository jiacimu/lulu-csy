import { isIOSStandaloneWebApp } from './iosStandalone';

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
let isResettingViewport = false;
let isViewportOffsetFollowEnabled = false;

const VIEWPORT_DEBUG_TRIGGER_SELECTOR = '[data-viewport-debug-trigger="true"]';
const KEYBOARD_CLOSED_TOLERANCE = 80;
const WATCHDOG_DELAY_MS = 150;
const REAL_VIEWPORT_GAP_THRESHOLD = 8;
const REAL_VIEWPORT_KEYBOARD_CLOSED_TOLERANCE = 8;
const UNLOCK_KEYBOARD_SETTLE_TIMEOUT_MS = 350;
const POST_UNLOCK_REPAIR_DELAY_MS = 500;
const SCREEN_CANVAS_GAP_THRESHOLD = 40;
const VIEWPORT_OFFSET_FOLLOW_KEY = 'sully_vv_offset_follow_enabled';
const HARD_RESET_ROUNDS = 2;
const HARD_RESET_ROUND_GAP_MS = 250;

export interface ViewportCalibrationRecord {
  at: string;
  source: string;
  beforeOffsetTop: number | null;
  afterOffsetTop: number | null;
}

export interface ViewportDiagnosticsSnapshot {
  buildHash: string;
  runtimeMode: string;
  offsetTop: number | null;
  visualViewportHeight: number | null;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  screenGap: number;
  documentElementClientHeight: number;
  documentElementScrollHeight: number;
  layoutViewportGap: number;
  scrollY: number;
  documentElementScrollTop: number;
  safeAreaInsetTop: number;
  safeAreaInsetBottom: number;
  rootRectTop: number | null;
  rootRectHeight: number | null;
  cssDvhHeight: number | null;
  cssLvhHeight: number | null;
  cssSvhHeight: number | null;
  realViewportHeight: string;
  browserVersion: string;
  viewportVerdict: string;
  userAgent: string;
  offsetFollowEnabled: boolean;
  calibrationRecords: ViewportCalibrationRecord[];
}

const calibrationRecords: ViewportCalibrationRecord[] = [];

type FocusTarget = HTMLElement & {
  focus(options?: FocusOptions): void;
};

declare global {
  interface Window {
    SullyViewportRepair?: {
      resetViewport: () => Promise<void>;
      showDebug: () => void;
      getDebugText: () => string;
      setOffsetFollowEnabled: (enabled: boolean) => void;
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

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => resolve());
  });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function readViewportOffsetTop(): number | null {
  if (typeof window === 'undefined') return null;
  const offsetTop = window.visualViewport?.offsetTop;
  return typeof offsetTop === 'number' && Number.isFinite(offsetTop) ? Math.round(offsetTop) : null;
}

function readRootRect(): { top: number | null; height: number | null } {
  if (typeof document === 'undefined') return { top: null, height: null };
  const root = document.querySelector('.sully-app-root') || document.getElementById('root');
  if (!root) return { top: null, height: null };
  const rect = root.getBoundingClientRect();
  return {
    top: Number.isFinite(rect.top) ? Math.round(rect.top) : null,
    height: Number.isFinite(rect.height) ? Math.round(rect.height) : null,
  };
}

function readBrowserVersion(userAgent: string): string {
  return userAgent.match(/\bVersion\/([0-9.]+)/)?.[1] || '';
}

function readCurrentBuildHash(): string {
  return typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__.trim()
    ? __APP_BUILD_ID__
    : 'dev';
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  if (navigatorWithStandalone.standalone === true) return true;

  try {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches
      || window.matchMedia?.('(display-mode: fullscreen)').matches,
    );
  } catch {
    return false;
  }
}

function readRuntimeMode(): string {
  if (typeof window === 'undefined') return 'unknown';

  const maybeCapacitor = (window as Window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }).Capacitor;

  try {
    if (maybeCapacitor?.isNativePlatform?.()) {
      return `capacitor-${maybeCapacitor.getPlatform?.() || 'native'}`;
    }
  } catch {
    return 'capacitor-native';
  }

  return isStandaloneDisplayMode() ? 'standalone' : 'browser';
}

function isKeyboardClosedForRealViewport(innerHeight: number, visualViewportHeight: number): boolean {
  return Math.abs(visualViewportHeight - innerHeight) <= REAL_VIEWPORT_KEYBOARD_CLOSED_TOLERANCE;
}

function buildViewportVerdict(snapshot: {
  offsetTop: number | null;
  visualViewportHeight: number | null;
  innerHeight: number;
  layoutViewportGap: number;
  runtimeMode: string;
  screenWidth: number;
  screenHeight: number;
  screenGap: number;
}): string {
  const offsetTop = snapshot.offsetTop ?? 0;
  const visualViewportHeight = snapshot.visualViewportHeight ?? snapshot.innerHeight;
  const keyboardClosed = isKeyboardClosedForRealViewport(snapshot.innerHeight, visualViewportHeight);
  const isPortrait = snapshot.screenHeight > 0 && snapshot.screenWidth > 0
    ? snapshot.screenHeight >= snapshot.screenWidth
    : snapshot.innerHeight >= Math.round(window.innerWidth || 0);

  if (keyboardClosed && offsetTop > 0) {
    return `键盘收起后 offsetTop 残留 ${offsetTop} px`;
  }

  if (keyboardClosed && snapshot.layoutViewportGap > REAL_VIEWPORT_GAP_THRESHOLD) {
    return `布局视口短 ${snapshot.layoutViewportGap} px`;
  }

  if (snapshot.runtimeMode === 'standalone' && isPortrait && snapshot.screenGap > SCREEN_CANVAS_GAP_THRESHOLD) {
    return `画布被系统截留 ${snapshot.screenGap} px`;
  }

  return '视口健康';
}

function pushCalibrationRecord(source: string, beforeOffsetTop: number | null, afterOffsetTop: number | null): void {
  calibrationRecords.unshift({
    at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    source,
    beforeOffsetTop,
    afterOffsetTop,
  });

  calibrationRecords.splice(5);
}

async function resetViewportHardRound(): Promise<void> {
  const de = document.documentElement;
  const prevMinHeight = de.style.minHeight;

  de.style.minHeight = 'calc(100% + 3px)';
  await waitForAnimationFrame();
  safeScrollTo(0, 2);
  await waitForAnimationFrame();
  safeScrollTo(0, 0);
  de.scrollTop = 0;
  if (document.body) {
    document.body.scrollTop = 0;
  }
  await wait(80);
  de.style.minHeight = prevMinHeight;
}

export async function resetViewportHard(source = 'manual'): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (isResettingViewport) return;

  isResettingViewport = true;
  const beforeOffsetTop = readViewportOffsetTop();

  try {
    for (let round = 0; round < HARD_RESET_ROUNDS; round += 1) {
      await resetViewportHardRound();
      if (round < HARD_RESET_ROUNDS - 1) {
        await wait(HARD_RESET_ROUND_GAP_MS);
      }
    }
  } finally {
    const afterOffsetTop = readViewportOffsetTop();
    pushCalibrationRecord(source, beforeOffsetTop, afterOffsetTop);
    refreshDebugOverlay();
    isResettingViewport = false;
  }
}

export function resetViewport(source = 'manual'): Promise<void> {
  return resetViewportHard(source);
}

function checkViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.clearTimeout(viewportWatchdogTimer);
  viewportWatchdogTimer = window.setTimeout(() => {
    if (document.visibilityState === 'hidden') return;
    reconcileRealViewportHeight();

    const vv = window.visualViewport;
    const documentHeight = document.documentElement.clientHeight;
    const kbClosed = !vv || vv.height >= documentHeight - KEYBOARD_CLOSED_TOLERANCE;
    const stuck = Boolean(vv && vv.offsetTop > 0) || document.documentElement.scrollTop !== 0 || window.scrollY !== 0;

    if (kbClosed && stuck) {
      resetViewportHard('watchdog');
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
      resetViewportHard('unlock').finally(resolve);
    };

    timeoutId = window.setTimeout(finish, UNLOCK_KEYBOARD_SETTLE_TIMEOUT_MS);

    if (vv) {
      vv.addEventListener('resize', finish, { once: true });
    }
  });
}

export async function repairViewportAfterUnlockSettle(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  await wait(POST_UNLOCK_REPAIR_DELAY_MS);

  const innerHeight = Math.round(window.innerHeight || 0);
  const visualViewportHeight = Math.round(window.visualViewport?.height || innerHeight);
  if (!isKeyboardClosedForRealViewport(innerHeight, visualViewportHeight)) return;

  await resetViewportHard('unlock-post');
  reconcileRealViewportHeight();
  refreshDebugOverlay();
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

function readSafeAreaInset(edge: 'top' | 'bottom'): number {
  if (typeof document === 'undefined' || !document.body) return 0;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.setProperty(`padding-${edge}`, `env(safe-area-inset-${edge})`);
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const value = parseFloat(computed.getPropertyValue(`padding-${edge}`) || '0') || 0;
  document.body.removeChild(probe);
  return Math.round(value);
}

function measureViewportUnit(unit: 'dvh' | 'lvh' | 'svh'): number | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.width = '0';
  probe.style.height = `1${unit}`;
  document.body.appendChild(probe);

  const rectHeight = probe.getBoundingClientRect().height;
  const computedHeight = parseFloat(window.getComputedStyle(probe).height || '0') || 0;
  document.body.removeChild(probe);

  const oneUnitHeight = rectHeight || computedHeight;
  if (!Number.isFinite(oneUnitHeight) || oneUnitHeight <= 0) return null;
  return Math.round(oneUnitHeight * 100);
}

function readRealViewportHeightVar(): string {
  if (typeof document === 'undefined') return '';
  const inlineValue = document.documentElement.style.getPropertyValue('--real-vh').trim();
  if (inlineValue) return inlineValue;
  return window.getComputedStyle(document.documentElement).getPropertyValue('--real-vh').trim();
}

function reconcileRealViewportHeight(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (!isIOSStandaloneWebApp()) {
    document.documentElement.style.removeProperty('--real-vh');
    return;
  }

  const innerHeight = Math.round(window.innerHeight || 0);
  const clientHeight = Math.round(document.documentElement.clientHeight || 0);
  const visualViewportHeight = Math.round(window.visualViewport?.height || innerHeight);
  const layoutGap = innerHeight - clientHeight;
  const keyboardClosed = isKeyboardClosedForRealViewport(innerHeight, visualViewportHeight);

  if (keyboardClosed && layoutGap > REAL_VIEWPORT_GAP_THRESHOLD && innerHeight > 0) {
    document.documentElement.style.setProperty('--real-vh', `${innerHeight}px`);
    return;
  }

  if (keyboardClosed && layoutGap <= REAL_VIEWPORT_GAP_THRESHOLD) {
    document.documentElement.style.removeProperty('--real-vh');
  }
}

export function getViewportDiagnosticsSnapshot(): ViewportDiagnosticsSnapshot {
  const vv = window.visualViewport;
  const innerHeight = Math.round(window.innerHeight || 0);
  const screenWidth = Math.round(window.screen?.width || 0);
  const screenHeight = Math.round(window.screen?.height || 0);
  const documentElementClientHeight = Math.round(document.documentElement.clientHeight || 0);
  const rootRect = readRootRect();
  const userAgent = navigator.userAgent || '';
  const partialSnapshot = {
    offsetTop: readViewportOffsetTop(),
    visualViewportHeight: vv ? Math.round(vv.height) : null,
    innerHeight,
    screenWidth,
    screenHeight,
    screenGap: screenHeight - innerHeight,
    documentElementClientHeight,
    layoutViewportGap: innerHeight - documentElementClientHeight,
    runtimeMode: readRuntimeMode(),
  };

  return {
    buildHash: readCurrentBuildHash(),
    runtimeMode: partialSnapshot.runtimeMode,
    offsetTop: partialSnapshot.offsetTop,
    visualViewportHeight: partialSnapshot.visualViewportHeight,
    innerHeight,
    screenWidth,
    screenHeight,
    screenGap: partialSnapshot.screenGap,
    documentElementClientHeight,
    documentElementScrollHeight: Math.round(document.documentElement.scrollHeight || 0),
    layoutViewportGap: partialSnapshot.layoutViewportGap,
    scrollY: Math.round(window.scrollY || 0),
    documentElementScrollTop: Math.round(document.documentElement.scrollTop || 0),
    safeAreaInsetTop: readSafeAreaInset('top'),
    safeAreaInsetBottom: readSafeAreaInset('bottom'),
    rootRectTop: rootRect.top,
    rootRectHeight: rootRect.height,
    cssDvhHeight: measureViewportUnit('dvh'),
    cssLvhHeight: measureViewportUnit('lvh'),
    cssSvhHeight: measureViewportUnit('svh'),
    realViewportHeight: readRealViewportHeightVar(),
    browserVersion: readBrowserVersion(userAgent),
    viewportVerdict: buildViewportVerdict(partialSnapshot),
    userAgent,
    offsetFollowEnabled: isViewportOffsetFollowEnabled,
    calibrationRecords: calibrationRecords.slice(),
  };
}

function formatCalibrationRecord(record: ViewportCalibrationRecord): string {
  return `${record.at} ${record.source}: ${record.beforeOffsetTop ?? 'n/a'} -> ${record.afterOffsetTop ?? 'n/a'}`;
}

export function buildDebugText(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';

  const snapshot = getViewportDiagnosticsSnapshot();
  const lines = [
    `buildHash: ${snapshot.buildHash}`,
    `runtimeMode: ${snapshot.runtimeMode}`,
    `screen: ${snapshot.screenWidth}x${snapshot.screenHeight}`,
    `screenGap: ${snapshot.screenGap}`,
    `verdict: ${snapshot.viewportVerdict}`,
    `visualViewport.offsetTop: ${snapshot.offsetTop ?? 'n/a'}`,
    `visualViewport.height: ${snapshot.visualViewportHeight ?? 'n/a'}`,
    `innerHeight: ${snapshot.innerHeight}`,
    `documentElement.clientHeight: ${snapshot.documentElementClientHeight}`,
    `layout gap: ${snapshot.layoutViewportGap}`,
    `documentElement.scrollHeight: ${snapshot.documentElementScrollHeight}`,
    `scrollY: ${snapshot.scrollY}`,
    `documentElement.scrollTop: ${snapshot.documentElementScrollTop}`,
    `env(safe-area-inset-top): ${snapshot.safeAreaInsetTop}px`,
    `env(safe-area-inset-bottom): ${snapshot.safeAreaInsetBottom}px`,
    `root rect: top=${snapshot.rootRectTop ?? 'n/a'} height=${snapshot.rootRectHeight ?? 'n/a'}`,
    `100dvh/100lvh/100svh: ${snapshot.cssDvhHeight ?? 'n/a'} / ${snapshot.cssLvhHeight ?? 'n/a'} / ${snapshot.cssSvhHeight ?? 'n/a'}`,
    `--real-vh: ${snapshot.realViewportHeight || 'unset'}`,
    `Version: ${snapshot.browserVersion || 'n/a'}`,
    `offset follow: ${snapshot.offsetFollowEnabled ? 'on' : 'off'}`,
    `recent calibrations: ${snapshot.calibrationRecords.length ? snapshot.calibrationRecords.map(formatCalibrationRecord).join(' | ') : 'none'}`,
    `UA: ${snapshot.userAgent}`,
  ];

  return lines.join('\n');
}

export function copyViewportDiagnostics(): void {
  copyText(buildDebugText());
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

function getDebugOverlayHost(): HTMLElement {
  return (document.querySelector('.sully-app-root') as HTMLElement | null) || document.body;
}

export function showViewportDebugOverlay(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (!debugOverlay) {
    const overlayHost = getDebugOverlayHost();
    const position = overlayHost === document.body ? 'fixed' : 'absolute';

    debugOverlay = document.createElement('div');
    debugOverlay.id = 'sully-viewport-debug-panel';
    debugOverlay.style.cssText = [
      `position:${position}`,
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
    overlayHost.appendChild(debugOverlay);
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

function syncViewportOffsetVar(): void {
  if (typeof document === 'undefined') return;
  const offsetTop = isViewportOffsetFollowEnabled ? (readViewportOffsetTop() ?? 0) : 0;
  document.documentElement.style.setProperty('--vv-offset', `${offsetTop}px`);
}

function readStoredViewportOffsetFollow(): boolean {
  try {
    return localStorage.getItem(VIEWPORT_OFFSET_FOLLOW_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setViewportOffsetFollowEnabled(enabled: boolean): void {
  isViewportOffsetFollowEnabled = enabled;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('vv-offset-follow', enabled);
  }

  try {
    localStorage.setItem(VIEWPORT_OFFSET_FOLLOW_KEY, String(enabled));
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }

  syncViewportOffsetVar();
  refreshDebugOverlay();
}

export function getViewportOffsetFollowEnabled(): boolean {
  return isViewportOffsetFollowEnabled;
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
  setViewportOffsetFollowEnabled(readStoredViewportOffsetFollow());

  const handleViewportChange = () => {
    syncViewportOffsetVar();
    checkViewport();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      checkViewport();
    }
  };

  const vv = window.visualViewport;
  vv?.addEventListener('resize', handleViewportChange);
  vv?.addEventListener('scroll', handleViewportChange);
  window.addEventListener('focusout', checkViewport);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('pageshow', handleViewportChange);
  window.addEventListener('popstate', syncDebugFromUrl);
  window.addEventListener('hashchange', syncDebugFromUrl);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pointerup', handleDebugTriggerTap, true);
  document.addEventListener('click', handleDebugTriggerTap, true);

  window.SullyViewportRepair = {
    resetViewport,
    showDebug: showViewportDebugOverlay,
    getDebugText: buildDebugText,
    setOffsetFollowEnabled: setViewportOffsetFollowEnabled,
  };

  syncDebugFromUrl();
  checkViewport();
}
