let hasInstalledIOSStandaloneWorkaround = false;
let stableStandaloneHeight = 0;
let stableStandaloneHeightCoversScreen = false;
let cachedTopInset: number | null = null;
let cachedBottomInset: number | null = null;
let lastStandaloneState: boolean | null = null;

const KEYBOARD_INSET_THRESHOLD = 120;
const FALLBACK_TOP_INSET = 44;
const SCREEN_CANVAS_GAP_THRESHOLD = 40;
const LARGE_VIEWPORT_PROMOTION_TOLERANCE = 8;
const SAFE_AREA_RETRY_DELAYS_MS = [120, 500, 1500, 3000] as const;

export const IOS_STANDALONE_CHANGE_EVENT = 'sully:ios-standalone-change';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

function readSafeAreaInsets(): { top: number; bottom: number } {
  if (typeof document === 'undefined' || !document.body) {
    return { top: cachedTopInset ?? 0, bottom: cachedBottomInset ?? 0 };
  }

  if (cachedTopInset !== null && cachedBottomInset !== null) {
    return { top: cachedTopInset, bottom: cachedBottomInset };
  }

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.paddingTop = 'env(safe-area-inset-top)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const top = Math.round(
    parseFloat(computed.paddingTop || computed.getPropertyValue('padding-top')) || 0,
  );
  const bottom = Math.round(
    parseFloat(computed.paddingBottom || computed.getPropertyValue('padding-bottom')) || 0,
  );

  document.body.removeChild(probe);

  if (cachedTopInset === null && top > 0) cachedTopInset = top;
  if (cachedBottomInset === null && bottom > 0) cachedBottomInset = bottom;

  return { top: cachedTopInset ?? top, bottom: cachedBottomInset ?? bottom };
}

function measureViewportUnit(unit: 'lvh'): number | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.width = '0';
  probe.style.height = `100${unit}`;
  document.body.appendChild(probe);

  const rectHeight = probe.getBoundingClientRect().height;
  const computedHeight = parseFloat(window.getComputedStyle(probe).height || '0') || 0;
  document.body.removeChild(probe);

  const height = Math.round(rectHeight || computedHeight);
  return Number.isFinite(height) && height > 0 ? height : null;
}

function readStandaloneLargeViewportHeight(): number {
  if (typeof window === 'undefined') return 0;

  const cssLargeViewportHeight = measureViewportUnit('lvh') ?? 0;
  const screenHeight = Math.round(window.screen?.height || 0);
  return Math.max(cssLargeViewportHeight, screenHeight);
}

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isCapacitorIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return Boolean(capacitor?.isNativePlatform?.()) && capacitor?.getPlatform?.() === 'ios';
  } catch {
    return false;
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as NavigatorWithStandalone).standalone,
  );
}

export function isIOSStandaloneWebApp(): boolean {
  return isIOSDevice() && (isStandaloneDisplayMode() || isCapacitorIOS());
}

export function isIOSStandaloneBrowserWebApp(): boolean {
  return isIOSDevice() && isStandaloneDisplayMode() && !isCapacitorIOS();
}

function toggleClass(element: Element | null | undefined, className: string, force: boolean): void {
  if (!element) return;
  if (element.classList.contains(className) !== force) {
    element.classList.toggle(className, force);
  }
}

function setRootStyleProperty(name: string, value: string): void {
  const style = document.documentElement.style;
  if (style.getPropertyValue(name) !== value) {
    style.setProperty(name, value);
  }
}

function removeRootStyleProperty(name: string): void {
  const style = document.documentElement.style;
  if (style.getPropertyValue(name)) {
    style.removeProperty(name);
  }
}

function invalidateSafeAreaCache(): void {
  cachedTopInset = null;
  cachedBottomInset = null;
}

function syncIOSStandaloneState(): boolean {
  const useStandaloneFixes = isIOSStandaloneWebApp();
  toggleClass(document.documentElement, 'ios-standalone', useStandaloneFixes);
  toggleClass(document.body, 'ios-standalone', useStandaloneFixes);
  document.documentElement.dataset.iosStandalone = useStandaloneFixes ? 'true' : 'false';

  if (lastStandaloneState !== useStandaloneFixes) {
    lastStandaloneState = useStandaloneFixes;
    window.dispatchEvent(new CustomEvent(IOS_STANDALONE_CHANGE_EVENT, {
      detail: { isStandalone: useStandaloneFixes },
    }));
  }

  return useStandaloneFixes;
}

function isTextEntryElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function setKeyboardOpen(isOpen: boolean): void {
  toggleClass(document.documentElement, 'keyboard-open', isOpen);
  toggleClass(document.body, 'keyboard-open', isOpen);
  toggleClass(document.body, 'ios-keyboard-open', isOpen);
  if (isOpen) {
    setRootStyleProperty('--effective-safe-bottom', '0px');
  } else {
    removeRootStyleProperty('--effective-safe-bottom');
  }
}

function setViewportVars(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const shouldUseStandaloneFixes = syncIOSStandaloneState();
  const innerHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
  const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
  const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
  const layoutHeight = Math.round(document.documentElement.clientHeight || innerHeight);
  const visualViewportBottom = viewportHeight + viewportOffsetTop;
  const nextViewportHeight = Math.max(innerHeight, layoutHeight, visualViewportBottom);
  const screenWidth = Math.round(window.screen?.width || 0);
  const screenHeight = Math.round(window.screen?.height || 0);
  const isPortrait = screenHeight > 0 && screenWidth > 0
    ? screenHeight >= screenWidth
    : innerHeight >= Math.round(window.innerWidth || 0);
  const safeInsets = shouldUseStandaloneFixes ? readSafeAreaInsets() : { top: 0, bottom: 0 };
  const topSafeInset = shouldUseStandaloneFixes
    ? (safeInsets.top > 0 ? safeInsets.top : FALLBACK_TOP_INSET)
    : 0;
  const bottomSafeInset = shouldUseStandaloneFixes ? safeInsets.bottom : 0;
  const obscuredHeight = Math.max(0, innerHeight - visualViewportBottom);
  const isKeyboardOpen = shouldUseStandaloneFixes
    && isTextEntryElement(document.activeElement)
    && obscuredHeight > KEYBOARD_INSET_THRESHOLD;
  const keyboardInset = isKeyboardOpen ? obscuredHeight : 0;
  const largeViewportHeight = shouldUseStandaloneFixes && !isKeyboardOpen && isPortrait
    ? readStandaloneLargeViewportHeight()
    : 0;
  const screenGap = screenHeight > 0 ? screenHeight - nextViewportHeight : 0;
  const shouldPromoteToLargeViewport = largeViewportHeight > nextViewportHeight + LARGE_VIEWPORT_PROMOTION_TOLERANCE
    && (
      screenGap > SCREEN_CANVAS_GAP_THRESHOLD
      || largeViewportHeight - nextViewportHeight > SCREEN_CANVAS_GAP_THRESHOLD
    );
  const resolvedViewportHeight = shouldPromoteToLargeViewport ? largeViewportHeight : nextViewportHeight;
  const resolvedViewportCoversScreen = shouldPromoteToLargeViewport
    || (
      screenHeight > 0
      && Math.abs(resolvedViewportHeight - screenHeight) <= LARGE_VIEWPORT_PROMOTION_TOLERANCE
    );

  if (shouldUseStandaloneFixes) {
    if (!isKeyboardOpen || !stableStandaloneHeight) {
      stableStandaloneHeight = resolvedViewportHeight;
      stableStandaloneHeightCoversScreen = resolvedViewportCoversScreen;
    }
  } else {
    stableStandaloneHeight = 0;
    stableStandaloneHeightCoversScreen = false;
  }

  const appHeight = shouldUseStandaloneFixes
    ? (stableStandaloneHeight || nextViewportHeight) + (stableStandaloneHeightCoversScreen ? 0 : bottomSafeInset)
    : nextViewportHeight;

  setRootStyleProperty('--app-height', `${appHeight}px`);
  setRootStyleProperty('--visual-viewport-height', `${viewportHeight}px`);
  setRootStyleProperty('--keyboard-inset', `${keyboardInset}px`);
  setRootStyleProperty('--standalone-safe-area-top', `${topSafeInset}px`);
  setRootStyleProperty('--standalone-safe-area-bottom', `${bottomSafeInset}px`);
  setRootStyleProperty('--hardware-safe-top', `${topSafeInset}px`);
  setRootStyleProperty('--hardware-safe-bottom', `${bottomSafeInset}px`);
  removeRootStyleProperty('--real-vh');

  if (shouldUseStandaloneFixes) {
    setKeyboardOpen(isKeyboardOpen);
  } else {
    setKeyboardOpen(false);
  }
}

export function installIOSStandaloneWorkaround(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (hasInstalledIOSStandaloneWorkaround) return;

  hasInstalledIOSStandaloneWorkaround = true;

  const handleViewportChange = () => {
    setViewportVars();
  };

  const handleSafeAreaChange = () => {
    stableStandaloneHeight = 0;
    invalidateSafeAreaCache();
    setViewportVars();
  };

  const handleDisplayModeChange = () => {
    invalidateSafeAreaCache();
    setViewportVars();
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!isTextEntryElement(event.target)) return;
    setViewportVars();

    const target = event.target;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (document.activeElement !== target) return;
        try {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch {
          // Older iOS builds can throw on unsupported scroll options.
        }
      });
    });
  };

  const handleFocusOut = () => {
    window.setTimeout(() => {
      setViewportVars();
    }, 180);
  };

  window.addEventListener('resize', handleSafeAreaChange);
  window.addEventListener('orientationchange', handleSafeAreaChange);
  window.addEventListener('pageshow', handleDisplayModeChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', handleViewportChange);
  document.addEventListener('visibilitychange', handleViewportChange);
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);

  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
  standaloneQuery?.addEventListener?.('change', handleDisplayModeChange);
  standaloneQuery?.addListener?.(handleDisplayModeChange);

  setViewportVars();

  if (isIOSStandaloneWebApp()) {
    for (const delay of SAFE_AREA_RETRY_DELAYS_MS) {
      window.setTimeout(() => {
        if (cachedTopInset !== null && cachedBottomInset !== null) return;
        setViewportVars();
      }, delay);
    }
  }
}
