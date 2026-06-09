let hasInstalledIOSStandaloneWorkaround = false;
let stableStandaloneHeight = 0;
let lastStandaloneState: boolean | null = null;

export const IOS_STANDALONE_CHANGE_EVENT = 'sully:ios-standalone-change';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

function readSafeAreaInset(edge: 'top' | 'right' | 'bottom' | 'left'): number {
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
  return Math.round(inset);
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
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (window.navigator as NavigatorWithStandalone).standalone,
  );
}

export function isIOSStandaloneWebApp(): boolean {
  return isIOSDevice() && (isStandaloneDisplayMode() || isCapacitorIOS());
}

export function isIOSStandaloneBrowserWebApp(): boolean {
  return isIOSDevice() && isStandaloneDisplayMode() && !isCapacitorIOS();
}

function syncIOSStandaloneState(): boolean {
  const useStandaloneFixes = isIOSStandaloneWebApp();
  document.documentElement.classList.toggle('ios-standalone', useStandaloneFixes);
  document.body?.classList.toggle('ios-standalone', useStandaloneFixes);
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

function setViewportVars(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const shouldStabilizeHeight = syncIOSStandaloneState();
  const innerHeight = Math.round(window.innerHeight);
  const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
  const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
  const layoutViewportHeight = Math.round(document.documentElement.clientHeight || 0);
  const topSafeInset = readSafeAreaInset('top');
  const bottomSafeInset = readSafeAreaInset('bottom');
  const standaloneBottomSafeInset = shouldStabilizeHeight ? bottomSafeInset : 0;
  const obscuredHeight = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
  const keyboardInset = obscuredHeight > 120 ? obscuredHeight : 0;
  const nextViewportHeight = Math.max(innerHeight, layoutViewportHeight, viewportHeight + viewportOffsetTop);
  const nextAppHeight = nextViewportHeight;

  if (shouldStabilizeHeight) {
    if (!keyboardInset || !stableStandaloneHeight) {
      stableStandaloneHeight = Math.max(stableStandaloneHeight, nextAppHeight);
    }
  } else {
    stableStandaloneHeight = 0;
  }

  const appHeight = shouldStabilizeHeight
    ? (stableStandaloneHeight || nextAppHeight)
    : nextAppHeight;
  document.documentElement.style.setProperty('--app-height', `${appHeight}px`);
  document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
  document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
  document.documentElement.style.setProperty('--standalone-safe-area-bottom', `${standaloneBottomSafeInset}px`);
  document.documentElement.style.setProperty('--hardware-safe-top', `${topSafeInset}px`);
  document.documentElement.style.setProperty('--hardware-safe-bottom', `${bottomSafeInset}px`);

  if (shouldStabilizeHeight) {
    document.documentElement.style.setProperty('--safe-top', `${topSafeInset}px`);
    document.documentElement.style.setProperty('--safe-bottom', `${bottomSafeInset}px`);
  } else {
    document.documentElement.style.removeProperty('--safe-top');
    document.documentElement.style.removeProperty('--safe-bottom');
  }
}

export function installIOSStandaloneWorkaround(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (hasInstalledIOSStandaloneWorkaround) return;

  hasInstalledIOSStandaloneWorkaround = true;

  const handleViewportChange = () => {
    setViewportVars();
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!isIOSDevice()) return;
    if (!isTextEntryElement(event.target)) return;
    document.body?.classList.add('ios-keyboard-open');
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
      if (!isIOSDevice() || !isTextEntryElement(document.activeElement)) {
        document.body?.classList.remove('ios-keyboard-open');
      }
      setViewportVars();
    }, 180);
  };

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', handleViewportChange);
  window.addEventListener('pageshow', handleViewportChange);
  document.addEventListener('visibilitychange', handleViewportChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', handleViewportChange);

  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
  const fullscreenQuery = window.matchMedia?.('(display-mode: fullscreen)');
  [standaloneQuery, fullscreenQuery].forEach(query => {
    query?.addEventListener?.('change', handleViewportChange);
    query?.addListener?.(handleViewportChange);
  });

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);

  setViewportVars();
}
