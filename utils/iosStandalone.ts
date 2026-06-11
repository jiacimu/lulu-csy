let hasInstalledIOSStandaloneWorkaround = false;
let stableStandaloneHeight = 0;
let stableCandidate = 0;
let stableCandidateAt = 0;
let stableCandidateCount = 0;
let lastStandaloneAppHeight = 0;
let hasActiveTextEntry = false;
let lastStandaloneState: boolean | null = null;
let lastRestoreAt = Number.NEGATIVE_INFINITY;
let lastViewportEventAt = Number.NEGATIVE_INFINITY;
let lastInteractionAt = Number.NEGATIVE_INFINITY;
let interactionRepairArmed = false;

const KEYBOARD_INSET_THRESHOLD = 100;
const STABLE_GROWTH_MIN_SPAN = 150;
const STABLE_SHRINK_MIN_SPAN = 500;
const MAX_PINCH_SCALE_FOR_SCROLL_RESET = 1.01;
const SETTLE_DELAYS = [0, 100, 250, 600, 1200] as const;

export const IOS_STANDALONE_CHANGE_EVENT = 'sully:ios-standalone-change';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};
type SafeAreaEdge = 'top' | 'right' | 'bottom' | 'left';

const safeAreaCache: Partial<Record<SafeAreaEdge, number>> = {};

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function invalidateSafeAreaCache(): void {
  Object.keys(safeAreaCache).forEach(edge => {
    delete safeAreaCache[edge as SafeAreaEdge];
  });
}

function readSafeAreaInset(edge: SafeAreaEdge): number {
  if (safeAreaCache[edge] !== undefined) return safeAreaCache[edge] ?? 0;
  if (typeof document === 'undefined' || !document.body) return 0;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.setProperty(`padding-${edge}`, `env(safe-area-inset-${edge})`);
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const inset = parseFloat(computed.getPropertyValue(`padding-${edge}`)) || 0;

  document.body.removeChild(probe);
  safeAreaCache[edge] = Math.round(inset);
  return safeAreaCache[edge] ?? 0;
}

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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

  const isElementFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenElement);
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (!isElementFullscreen && window.matchMedia?.('(display-mode: fullscreen)').matches) ||
    (window.navigator as NavigatorWithStandalone).standalone,
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

function clearKeyboardArtifacts(): void {
  toggleClass(document.documentElement, 'keyboard-open', false);
  toggleClass(document.body, 'keyboard-open', false);
  toggleClass(document.body, 'ios-keyboard-open', false);
  setRootStyleProperty('--keyboard-inset', '0px');
  removeRootStyleProperty('--effective-safe-bottom');
}

function getScreenHeightLimit(): number {
  const width = Math.round(window.screen?.width || 0);
  const height = Math.round(window.screen?.height || 0);
  const longSide = Math.max(width, height);
  return longSide > 0 ? longSide + 2 : 0;
}

function clampStandaloneStableHeight(rawHeight: number): number {
  if (!Number.isFinite(rawHeight) || rawHeight <= 0) return 0;
  const screenHeightLimit = getScreenHeightLimit();
  if (screenHeightLimit <= 0) return Math.round(rawHeight);
  return Math.round(Math.min(rawHeight, screenHeightLimit));
}

function resetStableCandidate(): void {
  stableCandidate = 0;
  stableCandidateAt = 0;
  stableCandidateCount = 0;
}

function hasRestoreAnchor(): boolean {
  return Number.isFinite(lastRestoreAt);
}

function isViewportTrustedSinceRestore(): boolean {
  return !hasRestoreAnchor() || lastViewportEventAt > lastRestoreAt;
}

function hasInteractionSinceRestore(): boolean {
  return hasRestoreAnchor() && lastInteractionAt > lastRestoreAt;
}

function offerStableCandidate(height: number, timestamp: number): void {
  const viewportTrusted = isViewportTrustedSinceRestore();
  const interactedAfterRestore = hasInteractionSinceRestore();
  const shrinking = stableStandaloneHeight > 0 && height < stableStandaloneHeight;
  const untrustedRestore = hasRestoreAnchor() && !viewportTrusted && !interactedAfterRestore;

  if (untrustedRestore) return;
  if (shrinking && (!viewportTrusted || !interactedAfterRestore)) return;

  const minSpan = shrinking ? STABLE_SHRINK_MIN_SPAN : STABLE_GROWTH_MIN_SPAN;
  if (height !== stableCandidate) {
    stableCandidate = height;
    stableCandidateAt = timestamp;
    stableCandidateCount = 1;
    return;
  }

  stableCandidateCount += 1;
  if (stableCandidateCount >= 2 && timestamp - stableCandidateAt >= minSpan) {
    if (!stableStandaloneHeight || height > stableStandaloneHeight || shrinking) {
      stableStandaloneHeight = height;
    }
  }
}

function findScrollableAncestor(target: HTMLElement): HTMLElement | null {
  let current = target.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const computed = window.getComputedStyle(current);
    const overflowY = computed.overflowY || computed.getPropertyValue('overflow-y');
    const canScroll = /auto|scroll|overlay/i.test(overflowY);
    if (canScroll && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

function resetStrayScroll(): void {
  if (!isIOSDevice()) return;

  const visualViewport = window.visualViewport;
  if (visualViewport && visualViewport.scale > MAX_PINCH_SCALE_FOR_SCROLL_RESET) return;
  if (isTextEntryElement(document.activeElement)) return;

  const scrollingElement = document.scrollingElement || document.documentElement;
  const hasStrayScroll = (window.scrollY || 0) > 0 || (scrollingElement.scrollTop || 0) > 0;
  if (!hasStrayScroll) return;

  try {
    window.scrollTo(0, 0);
  } catch {
    // Some test and embedded WebView environments expose scrollTo but do not implement it.
  }
  scrollingElement.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
}

function setViewportVars(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const shouldStabilizeHeight = syncIOSStandaloneState();
  const timestamp = now();
  const innerHeight = Math.round(window.innerHeight || 0);
  const visualViewport = window.visualViewport;
  const viewportHeight = Math.round(visualViewport?.height || innerHeight);
  const viewportOffsetTop = Math.round(visualViewport?.offsetTop || 0);
  const layoutViewportHeight = Math.round(document.documentElement.clientHeight || 0);
  const visualViewportBottom = viewportHeight + viewportOffsetTop;
  const rawLayoutAppHeight = Math.max(innerHeight, layoutViewportHeight) || visualViewportBottom;
  const layoutAppHeight = Math.round(rawLayoutAppHeight);
  const keyboardBaselineHeight = stableStandaloneHeight || stableCandidate || layoutAppHeight;
  const obscuredHeight = Math.max(0, keyboardBaselineHeight - visualViewportBottom);
  const hasFocusedTextEntry = hasActiveTextEntry || isTextEntryElement(document.activeElement);
  const viewportTrusted = isViewportTrustedSinceRestore();
  const isKeyboardOpen = hasFocusedTextEntry && viewportTrusted && obscuredHeight >= KEYBOARD_INSET_THRESHOLD;
  const keyboardInset = isKeyboardOpen ? obscuredHeight : 0;
  const topSafeInset = readSafeAreaInset('top');
  const bottomSafeInset = readSafeAreaInset('bottom');
  const standaloneBottomSafeInset = shouldStabilizeHeight ? bottomSafeInset : 0;

  if (shouldStabilizeHeight) {
    if (!isKeyboardOpen && !isDocumentHidden() && layoutAppHeight > 0) {
      offerStableCandidate(clampStandaloneStableHeight(layoutAppHeight), timestamp);
    }
  } else {
    stableStandaloneHeight = 0;
    lastStandaloneAppHeight = 0;
    resetStableCandidate();
  }

  const standaloneAppHeight = stableStandaloneHeight || (isKeyboardOpen ? stableCandidate : 0) || layoutAppHeight;
  const untrustedRestore = shouldStabilizeHeight && hasRestoreAnchor() && !viewportTrusted && !hasInteractionSinceRestore();
  const guardedStandaloneAppHeight = untrustedRestore
    && lastStandaloneAppHeight > 0
    && standaloneAppHeight > 0
    && standaloneAppHeight < lastStandaloneAppHeight
    ? lastStandaloneAppHeight
    : standaloneAppHeight;
  const appHeight = shouldStabilizeHeight
    ? guardedStandaloneAppHeight
    : layoutAppHeight;

  toggleClass(document.documentElement, 'keyboard-open', isKeyboardOpen);
  toggleClass(document.body, 'keyboard-open', isKeyboardOpen);
  toggleClass(document.body, 'ios-keyboard-open', isKeyboardOpen);
  setRootStyleProperty('--app-height', `${appHeight}px`);
  if (shouldStabilizeHeight && appHeight > 0) {
    lastStandaloneAppHeight = appHeight;
  }
  setRootStyleProperty('--visual-viewport-height', `${viewportHeight}px`);
  setRootStyleProperty('--keyboard-inset', `${keyboardInset}px`);
  setRootStyleProperty('--standalone-safe-area-bottom', `${standaloneBottomSafeInset}px`);
  setRootStyleProperty('--hardware-safe-top', `${topSafeInset}px`);
  setRootStyleProperty('--hardware-safe-bottom', `${bottomSafeInset}px`);

  if (isKeyboardOpen) {
    setRootStyleProperty('--effective-safe-bottom', '0px');
  } else {
    removeRootStyleProperty('--effective-safe-bottom');
  }

  if (shouldStabilizeHeight) {
    setRootStyleProperty('--safe-top', `${topSafeInset}px`);
    setRootStyleProperty('--safe-bottom', `${bottomSafeInset}px`);
  } else {
    removeRootStyleProperty('--safe-top');
    removeRootStyleProperty('--safe-bottom');
  }

  if (!isKeyboardOpen) {
    resetStrayScroll();
  }
}

function markViewportEvent(): void {
  if (!isDocumentHidden()) {
    lastViewportEventAt = now();
  }
}

function markUserInteraction(): void {
  lastInteractionAt = now();
}

function handleUserInteraction(): void {
  markUserInteraction();
  if (interactionRepairArmed) {
    interactionRepairArmed = false;
    setViewportVars();
    resetStrayScroll();
  }
}

function armFirstInteractionRepair(): void {
  interactionRepairArmed = true;
}

function scheduleSettle(options: { includeImmediate?: boolean } = {}): void {
  const includeImmediate = options.includeImmediate ?? true;
  SETTLE_DELAYS.forEach(delay => {
    if (!includeImmediate && delay === 0) return;
    window.setTimeout(() => {
      if (isDocumentHidden()) return;
      setViewportVars();
      resetStrayScroll();
    }, delay);
  });
  armFirstInteractionRepair();
}

export function installIOSStandaloneWorkaround(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (hasInstalledIOSStandaloneWorkaround) return;

  hasInstalledIOSStandaloneWorkaround = true;

  const handleViewportChange = () => {
    if (isDocumentHidden()) return;
    markViewportEvent();
    setViewportVars();
  };

  const handlePageShow = () => {
    lastRestoreAt = now();
    scheduleSettle();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      hasActiveTextEntry = false;
      const active = document.activeElement;
      if (isTextEntryElement(active)) {
        active.blur();
      }
      clearKeyboardArtifacts();
      return;
    }

    lastRestoreAt = now();
    scheduleSettle();
  };

  const handleOrientationChange = () => {
    stableStandaloneHeight = 0;
    lastStandaloneAppHeight = 0;
    resetStableCandidate();
    invalidateSafeAreaCache();
    scheduleSettle({ includeImmediate: false });
  };

  const handleDisplayModeChange = () => {
    invalidateSafeAreaCache();
    setViewportVars();
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!isIOSDevice()) return;
    const target = event.target;
    if (!isTextEntryElement(target)) return;
    hasActiveTextEntry = true;
    setViewportVars();

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (document.activeElement !== target) return;
        if (!findScrollableAncestor(target)) return;
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
      if (!isIOSDevice() || !isTextEntryElement(document.activeElement)) {
        hasActiveTextEntry = false;
        clearKeyboardArtifacts();
      }

      if (!isDocumentHidden()) {
        setViewportVars();
        resetStrayScroll();
      }
    }, 180);
  };

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('touchstart', handleUserInteraction, { capture: true, passive: true });
  window.addEventListener('wheel', handleUserInteraction, { capture: true, passive: true });
  window.addEventListener('keydown', handleUserInteraction, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', handleViewportChange);

  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
  const fullscreenQuery = window.matchMedia?.('(display-mode: fullscreen)');
  [standaloneQuery, fullscreenQuery].forEach(query => {
    query?.addEventListener?.('change', handleDisplayModeChange);
    query?.addListener?.(handleDisplayModeChange);
  });

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);

  setViewportVars();
}
