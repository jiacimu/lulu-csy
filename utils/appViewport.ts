const IOS_SAFE_TOP_FALLBACK_PX = 44;
const IOS_SAFE_BOTTOM_FALLBACK_PX = 34;
const FULLSCREEN_HEIGHT_TOLERANCE_PX = 96;

export interface ViewportEnvironment {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: Pick<VisualViewport, 'width' | 'height' | 'offsetTop' | 'offsetLeft'> | null;
  screenHeight?: number;
  screenAvailHeight?: number;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
  displayModeFullscreen?: boolean;
}

export interface ViewportCssMetrics {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  safeTopFallback: number;
  safeBottomFallback: number;
}

function clampViewportSize(value: number | undefined, fallback: number): number {
  const next = Math.round(Number(value || fallback || 0));
  return Math.max(1, next);
}

export function isAppleMobileViewport(env: ViewportEnvironment): boolean {
  const platform = env.platform || '';
  const userAgent = env.userAgent || '';

  return (
    /\b(iPhone|iPad|iPod)\b/i.test(platform) ||
    /\b(iPhone|iPad|iPod)\b/i.test(userAgent) ||
    (platform === 'MacIntel' && (env.maxTouchPoints || 0) > 1)
  );
}

function isFullscreenLikeViewport(env: ViewportEnvironment): boolean {
  if (env.standalone || env.displayModeStandalone || env.displayModeFullscreen) {
    return true;
  }

  const viewportHeight = env.visualViewport?.height || env.innerHeight;
  const screenHeights = [env.screenHeight, env.screenAvailHeight]
    .filter((value): value is number => typeof value === 'number' && value > 0);

  if (screenHeights.length === 0) return false;

  const screenHeight = Math.min(...screenHeights);
  return viewportHeight >= screenHeight - FULLSCREEN_HEIGHT_TOLERANCE_PX;
}

export function getViewportCssMetrics(env: ViewportEnvironment): ViewportCssMetrics {
  const width = clampViewportSize(env.visualViewport?.width, env.innerWidth);
  const height = clampViewportSize(env.visualViewport?.height, env.innerHeight);
  const offsetTop = Math.max(0, Math.round(env.visualViewport?.offsetTop || 0));
  const offsetLeft = Math.max(0, Math.round(env.visualViewport?.offsetLeft || 0));
  const shouldUseIOSFallback = isAppleMobileViewport(env) && isFullscreenLikeViewport(env);

  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    safeTopFallback: shouldUseIOSFallback
      ? Math.max(offsetTop, IOS_SAFE_TOP_FALLBACK_PX)
      : offsetTop,
    safeBottomFallback: shouldUseIOSFallback ? IOS_SAFE_BOTTOM_FALLBACK_PX : 0,
  };
}

export function applyViewportCssVars(style: CSSStyleDeclaration, metrics: ViewportCssMetrics): void {
  style.setProperty('--app-width', `${metrics.width}px`);
  style.setProperty('--app-height', `${metrics.height}px`);
  style.setProperty('--viewport-offset-top', `${metrics.offsetTop}px`);
  style.setProperty('--viewport-offset-left', `${metrics.offsetLeft}px`);
  style.setProperty('--safe-top-fallback', `${metrics.safeTopFallback}px`);
  style.setProperty('--safe-bottom-fallback', `${metrics.safeBottomFallback}px`);
}

function matchesDisplayMode(win: Window, mode: 'standalone' | 'fullscreen'): boolean {
  try {
    return Boolean(win.matchMedia?.(`(display-mode: ${mode})`).matches);
  } catch {
    return false;
  }
}

function readViewportEnvironment(win: Window): ViewportEnvironment {
  return {
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    visualViewport: win.visualViewport || null,
    screenHeight: win.screen?.height,
    screenAvailHeight: win.screen?.availHeight,
    userAgent: win.navigator?.userAgent,
    platform: win.navigator?.platform,
    maxTouchPoints: win.navigator?.maxTouchPoints,
    standalone: Boolean((win.navigator as Navigator & { standalone?: boolean }).standalone),
    displayModeStandalone: matchesDisplayMode(win, 'standalone'),
    displayModeFullscreen: matchesDisplayMode(win, 'fullscreen'),
  };
}

export function syncAppViewportCssVars(win: Window = window): void {
  applyViewportCssVars(
    win.document.documentElement.style,
    getViewportCssMetrics(readViewportEnvironment(win)),
  );
}

export function installAppViewportCssVars(win: Window = window): () => void {
  let rafId = 0;

  const sync = () => {
    if (rafId) win.cancelAnimationFrame(rafId);
    rafId = win.requestAnimationFrame(() => {
      rafId = 0;
      syncAppViewportCssVars(win);
    });
  };

  syncAppViewportCssVars(win);
  win.addEventListener('resize', sync, { passive: true });
  win.addEventListener('orientationchange', sync, { passive: true });
  win.visualViewport?.addEventListener('resize', sync, { passive: true });
  win.visualViewport?.addEventListener('scroll', sync, { passive: true });

  return () => {
    if (rafId) win.cancelAnimationFrame(rafId);
    win.removeEventListener('resize', sync);
    win.removeEventListener('orientationchange', sync);
    win.visualViewport?.removeEventListener('resize', sync);
    win.visualViewport?.removeEventListener('scroll', sync);
  };
}
