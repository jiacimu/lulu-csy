import { getRuntimeRecoveryDiagnostics } from './runtimeRecovery';

type RuntimeHealthContext = {
    route?: string | null;
    charId?: string | null;
};

type RuntimeHealthCustom = Record<string, unknown>;

type RuntimeHealthProbeOptions = {
    intervalMs?: number;
    sampleRate?: number;
    enableInvasive?: boolean;
};

type RuntimeHealthProbeApi = {
    start: (options?: RuntimeHealthProbeOptions) => RuntimeHealthProbeApi;
    setContext: (patch: RuntimeHealthContext) => void;
    reportCustom: (patch: RuntimeHealthCustom) => void;
    tick: (reason?: string) => Promise<void>;
};

const STORAGE_KEY = 'csyos_runtime_health_log';
const FLAG_KEY = 'csyos_runtime_probe';
const ENDPOINT_KEY = 'csyos_runtime_probe_endpoint';
const COPY_BUTTON_ID = 'csyos-runtime-health-copy';
const FALLBACK_OVERLAY_ID = 'csyos-runtime-health-fallback';
const MAX_SNAPSHOTS = 32;
const DEFAULT_INTERVAL_MS = 15000;
const INVASIVE_FLAG_KEY = 'csyos_runtime_probe_invasive';
const IMPORT_RECOVERY_KEY = 'sullyos_import_in_progress_v1';

let started = false;
let enabled = false;
let intervalId: number | null = null;
let startedAt = 0;
let context: RuntimeHealthContext = {};
let custom: RuntimeHealthCustom = {};
let longTaskCount = 0;
let longTaskTotalMs = 0;
let lastError: RuntimeHealthCustom | null = null;
let invasiveInstalled = false;

const counters = {
    objectURLCreated: 0,
    objectURLRevoked: 0,
    liveObjectURLs: 0,
    intervalsCreated: 0,
    intervalsCleared: 0,
    activeIntervals: 0,
    listenersAdded: 0,
    listenersRemoved: 0,
    netListeners: 0,
    webglContexts: 0,
};

type NativeRuntimeRefs = {
    setInterval: typeof window.setInterval;
    clearInterval: typeof window.clearInterval;
    addEventListener: typeof window.addEventListener;
    createObjectURL?: typeof URL.createObjectURL;
    revokeObjectURL?: typeof URL.revokeObjectURL;
    targetAddEventListener: typeof EventTarget.prototype.addEventListener;
    targetRemoveEventListener: typeof EventTarget.prototype.removeEventListener;
    getContext: typeof HTMLCanvasElement.prototype.getContext;
};

let nativeRefs: NativeRuntimeRefs | null = null;
const observedWebglCanvases = new WeakSet<HTMLCanvasElement>();

function readStorage(key: string): string {
    try {
        return window.localStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

function readQueryFlag(name: string): string {
    try {
        const params = new URLSearchParams(`${window.location.search || ''}&${(window.location.hash || '').replace(/^#/, '')}`);
        return params.get(name) || '';
    } catch {
        return '';
    }
}

function readBooleanFlag(storageKey: string, queryKey: string): boolean | null {
    const queryValue = readQueryFlag(queryKey).trim().toLowerCase();
    if (['1', 'true', 'on', 'enabled'].includes(queryValue)) {
        writeStorage(storageKey, '1');
        return true;
    }
    if (['0', 'false', 'off', 'disabled'].includes(queryValue)) {
        writeStorage(storageKey, '0');
        return false;
    }

    const storageValue = readStorage(storageKey).trim().toLowerCase();
    if (['1', 'true', 'on', 'enabled'].includes(storageValue)) return true;
    if (['0', 'false', 'off', 'disabled'].includes(storageValue)) return false;
    return null;
}

function writeStorage(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Best effort only.
    }
}

function isMobileChromiumLike(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android|Mobile/i.test(ua) && /(EdgA|EdgiOS|Chrome|CriOS|Chromium)/i.test(ua);
}

function shouldEnable(sampleRate: number): boolean {
    const flag = readBooleanFlag(FLAG_KEY, 'csyos_diag');
    if (flag !== null) return flag;
    if (!isMobileChromiumLike()) return false;
    return Math.random() < Math.max(0, Math.min(1, sampleRate));
}

function shouldEnableInvasive(optionValue?: boolean): boolean {
    if (optionValue !== undefined) return optionValue;
    return readBooleanFlag(INVASIVE_FLAG_KEY, 'csyos_diag_invasive') === true;
}

function shouldShowCopyButton(): boolean {
    return ['1', 'true', 'on', 'enabled'].includes(readQueryFlag('csyos_diag').trim().toLowerCase());
}

function getMemorySnapshot(): RuntimeHealthCustom {
    const perf = performance as Performance & {
        memory?: {
            usedJSHeapSize?: number;
            totalJSHeapSize?: number;
            jsHeapSizeLimit?: number;
        };
    };

    if (!perf.memory) return { src: 'none' };
    return {
        src: 'jsHeap',
        usedJSHeapSize: perf.memory.usedJSHeapSize ?? null,
        totalJSHeapSize: perf.memory.totalJSHeapSize ?? null,
        jsHeapSizeLimit: perf.memory.jsHeapSizeLimit ?? null,
    };
}

function getDomSnapshot(): RuntimeHealthCustom {
    const loadedImages = Array.from(document.images).filter(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    const imagePixels = loadedImages.reduce((sum, img) => {
        const pixels = img.naturalWidth * img.naturalHeight;
        return Number.isFinite(pixels) ? sum + pixels : sum;
    }, 0);

    return {
        domNodes: document.getElementsByTagName('*').length,
        iframeCount: document.getElementsByTagName('iframe').length,
        freeformIframeCount: document.querySelectorAll('iframe[title="Freeform creative card"]').length,
        imageCount: document.images.length,
        loadedImageCount: loadedImages.length,
        loadedImagePixels: imagePixels,
        canvasCount: document.getElementsByTagName('canvas').length,
        videoCount: document.getElementsByTagName('video').length,
        statusOverlayOpen: Boolean(document.querySelector('[data-testid="status-card-overlay-shell"]')),
        newspaperDeliveryNodes: document.querySelectorAll('.yn-delivery,.yn-delivery-modal,.yn-delivery-stack').length,
    };
}

function getImportRecoveryHealth(): RuntimeHealthCustom {
    try {
        const raw = readStorage(IMPORT_RECOVERY_KEY);
        if (!raw) {
            return {
                importPhase: null,
                importCurrent: null,
                importItemDone: null,
                importItemTotal: null,
                importCurrentFile: null,
                importCurrentFileSize: null,
                importAssetDone: null,
                importAssetTotal: null,
            };
        }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            importPhase: parsed.phase ?? null,
            importCurrent: parsed.current ?? null,
            importItemDone: parsed.itemDone ?? null,
            importItemTotal: parsed.itemTotal ?? null,
            importCurrentFile: parsed.currentFile ?? null,
            importCurrentFileSize: parsed.currentFileSize ?? null,
            importAssetDone: parsed.assetDone ?? null,
            importAssetTotal: parsed.assetTotal ?? null,
        };
    } catch {
        return {
            importPhase: 'unreadable',
            importCurrent: null,
            importItemDone: null,
            importItemTotal: null,
            importCurrentFile: null,
            importCurrentFileSize: null,
            importAssetDone: null,
            importAssetTotal: null,
        };
    }
}

function getRuntimeHealthFields(): RuntimeHealthCustom {
    const recovery = getRuntimeRecoveryDiagnostics();
    return {
        ...getImportRecoveryHealth(),
        chatPhase: custom.chatPhase ?? null,
        backgroundTask: custom.backgroundTask ?? null,
        buildProbePaused: recovery.buildProbePaused,
        autoReloadSuspendCount: recovery.autoReloadSuspendCount,
        autoReloadSuspendReason: recovery.autoReloadSuspendReason,
        pendingBuildId: recovery.pendingBuildId,
        reloadQueued: recovery.reloadQueued,
    };
}

function persistSnapshot(payload: RuntimeHealthCustom): void {
    const previous = (() => {
        try {
            const parsed = JSON.parse(readStorage(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    })();

    previous.push(payload);
    writeStorage(STORAGE_KEY, JSON.stringify(previous.slice(-MAX_SNAPSHOTS)));

    const endpoint = readStorage(ENDPOINT_KEY).trim();
    if (!endpoint) return;

    try {
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        } else {
            void fetch(endpoint, { method: 'POST', body, keepalive: true });
        }
    } catch {
        // Diagnostics must never affect the app.
    }
}

function readSnapshots(): RuntimeHealthCustom[] {
    try {
        const parsed = JSON.parse(readStorage(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildDiagnosticExport(): string {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return JSON.stringify({
        kind: 'csyos-runtime-health-export',
        exportedAt: Date.now(),
        exportedAtText: new Date().toISOString(),
        url: location.href,
        userAgent: navigator.userAgent,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        },
        deviceMemoryGB: nav.deviceMemory ?? null,
        flags: {
            diag: readStorage(FLAG_KEY),
            invasive: readStorage(INVASIVE_FLAG_KEY),
        },
        current: {
            uptimeMs: Math.round(performance.now() - startedAt),
            visibility: document.visibilityState,
            ...getRuntimeHealthFields(),
            context: { ...context },
            custom: { ...custom },
            counters: { ...counters },
            memory: getMemorySnapshot(),
            dom: getDomSnapshot(),
            lastError,
        },
        snapshots: readSnapshots(),
    }, null, 2);
}

function selectTextArea(textarea: HTMLTextAreaElement): void {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
}

function showFallbackOverlay(text: string): void {
    document.getElementById(FALLBACK_OVERLAY_ID)?.remove();

    const overlay = document.createElement('div');
    overlay.id = FALLBACK_OVERLAY_ID;
    overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(15,23,42,0.96)',
        'padding:calc(14px + env(safe-area-inset-top,0px)) 14px calc(14px + env(safe-area-inset-bottom,0px))',
        'box-sizing:border-box',
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;color:white;font-size:13px;';
    const label = document.createElement('div');
    label.textContent = '诊断日志';
    label.style.cssText = 'flex:1;font-weight:700;';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.style.cssText = 'border:0;border-radius:999px;padding:8px 12px;background:rgba(255,255,255,0.14);color:white;font-size:12px;';
    close.onclick = () => overlay.remove();
    bar.append(label, close);

    const hint = document.createElement('div');
    hint.textContent = '如果没有自动复制，请长按下面文本，全选复制后发给开发者。';
    hint.style.cssText = 'color:rgba(255,255,255,0.72);font-size:12px;line-height:1.5;';

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = [
        'flex:1',
        'width:100%',
        'min-height:0',
        'box-sizing:border-box',
        'border:0',
        'border-radius:12px',
        'padding:12px',
        'background:white',
        'color:#111827',
        'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'resize:none',
        'outline:none',
    ].join(';');

    overlay.append(bar, hint, textarea);
    document.body.appendChild(overlay);
    selectTextArea(textarea);
}

async function copyDiagnosticLog(): Promise<boolean> {
    await tick('manual-copy');
    const text = buildDiagnosticExport();
    try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        showFallbackOverlay(text);
        return false;
    }
}

function installCopyButton(): void {
    if (!shouldShowCopyButton()) return;

    const mount = () => {
        if (!document.body || document.getElementById(COPY_BUTTON_ID)) return;

        const button = document.createElement('button');
        button.id = COPY_BUTTON_ID;
        button.type = 'button';
        button.textContent = '复制诊断';
        button.setAttribute('aria-label', '复制诊断日志');
        button.style.cssText = [
            'position:fixed',
            'left:10px',
            'top:calc(12px + env(safe-area-inset-top,0px))',
            'z-index:2147483646',
            'border:0',
            'border-radius:999px',
            'padding:9px 12px',
            'background:rgba(17,24,39,0.82)',
            'color:white',
            'font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'box-shadow:0 8px 24px rgba(15,23,42,0.22)',
            'backdrop-filter:blur(8px)',
            'opacity:0.72',
            'touch-action:manipulation',
        ].join(';');
        button.onmouseenter = () => { button.style.opacity = '1'; };
        button.onmouseleave = () => { button.style.opacity = '0.72'; };
        button.onclick = async () => {
            button.disabled = true;
            const previous = button.textContent || '复制诊断';
            button.textContent = '复制中...';
            const copied = await copyDiagnosticLog();
            button.textContent = copied ? '已复制' : '长按复制';
            window.setTimeout(() => {
                button.textContent = previous;
                button.disabled = false;
            }, copied ? 1600 : 2600);
        };
        document.body.appendChild(button);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
        mount();
    }
}

async function tick(reason = 'interval'): Promise<void> {
    if (!enabled || typeof document === 'undefined') return;
    const payload: RuntimeHealthCustom = {
        kind: 'runtime-health',
        reason,
        ts: Date.now(),
        uptimeMs: Math.round(performance.now() - startedAt),
        visibility: document.visibilityState,
        deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        route: context.route ?? null,
        charId: context.charId ?? null,
        ...getRuntimeHealthFields(),
        memory: getMemorySnapshot(),
        longTasks: {
            count: longTaskCount,
            totalMs: Math.round(longTaskTotalMs),
        },
        counters: { ...counters },
        dom: getDomSnapshot(),
        custom: { ...custom },
        lastError,
    };
    persistSnapshot(payload);
}

function captureNativeRefs(): NativeRuntimeRefs {
    return {
        setInterval: window.setInterval.bind(window) as typeof window.setInterval,
        clearInterval: window.clearInterval.bind(window) as typeof window.clearInterval,
        addEventListener: window.addEventListener.bind(window) as typeof window.addEventListener,
        createObjectURL: typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL.bind(URL) as typeof URL.createObjectURL
            : undefined,
        revokeObjectURL: typeof URL.revokeObjectURL === 'function'
            ? URL.revokeObjectURL.bind(URL) as typeof URL.revokeObjectURL
            : undefined,
        targetAddEventListener: EventTarget.prototype.addEventListener,
        targetRemoveEventListener: EventTarget.prototype.removeEventListener,
        getContext: HTMLCanvasElement.prototype.getContext,
    };
}

function installInvasiveCounters(refs: NativeRuntimeRefs): void {
    if (invasiveInstalled) return;
    invasiveInstalled = true;

    if (refs.createObjectURL && refs.revokeObjectURL) {
        URL.createObjectURL = ((obj: Blob | MediaSource) => {
            counters.objectURLCreated += 1;
            counters.liveObjectURLs += 1;
            return refs.createObjectURL?.(obj) || '';
        }) as typeof URL.createObjectURL;

        URL.revokeObjectURL = ((url: string) => {
            counters.objectURLRevoked += 1;
            counters.liveObjectURLs = Math.max(0, counters.liveObjectURLs - 1);
            return refs.revokeObjectURL?.(url);
        }) as typeof URL.revokeObjectURL;
    }

    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        counters.intervalsCreated += 1;
        counters.activeIntervals += 1;
        return refs.setInterval(handler, timeout, ...args);
    }) as typeof window.setInterval;

    window.clearInterval = ((id?: number) => {
        counters.intervalsCleared += 1;
        counters.activeIntervals = Math.max(0, counters.activeIntervals - 1);
        return refs.clearInterval(id);
    }) as typeof window.clearInterval;

    EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof EventTarget.prototype.addEventListener>) {
        counters.listenersAdded += 1;
        counters.netListeners += 1;
        return refs.targetAddEventListener.apply(this, args);
    };

    EventTarget.prototype.removeEventListener = function (this: EventTarget, ...args: Parameters<typeof EventTarget.prototype.removeEventListener>) {
        counters.listenersRemoved += 1;
        counters.netListeners = Math.max(0, counters.netListeners - 1);
        return refs.targetRemoveEventListener.apply(this, args);
    };

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement,
        type: string,
        options?: CanvasRenderingContext2DSettings | ImageBitmapRenderingContextSettings | WebGLContextAttributes,
    ) {
        if (/webgl/i.test(type) && !observedWebglCanvases.has(this)) {
            observedWebglCanvases.add(this);
            counters.webglContexts += 1;
        }
        return (refs.getContext as any).call(this, type, options);
    } as typeof HTMLCanvasElement.prototype.getContext;
}

function installLongTaskObserver(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                longTaskCount += 1;
                longTaskTotalMs += entry.duration;
            }
        });
        observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    } catch {
        // Unsupported in some WebViews.
    }
}

function installErrorListeners(): void {
    window.addEventListener('error', event => {
        lastError = {
            kind: 'error',
            message: String(event.message || 'runtime error').slice(0, 240),
            ts: Date.now(),
        };
        void tick('error');
    });

    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason instanceof Error
            ? event.reason.message
            : String(event.reason || 'unhandled rejection');
        lastError = {
            kind: 'unhandledrejection',
            message: reason.slice(0, 240),
            ts: Date.now(),
        };
        void tick('unhandledrejection');
    });
}

function start(options: RuntimeHealthProbeOptions = {}): RuntimeHealthProbeApi {
    if (typeof window === 'undefined' || started) return runtimeHealthProbe;
    started = true;
    startedAt = performance.now();
    nativeRefs = captureNativeRefs();
    enabled = shouldEnable(options.sampleRate ?? 1);
    if (!enabled) return runtimeHealthProbe;

    if (shouldEnableInvasive(options.enableInvasive)) {
        installInvasiveCounters(nativeRefs);
    }
    installCopyButton();
    installLongTaskObserver();
    installErrorListeners();

    const intervalMs = Math.max(5000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    intervalId = nativeRefs.setInterval(() => {
        void tick('interval');
    }, intervalMs);

    nativeRefs.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void tick('hidden');
    });
    nativeRefs.addEventListener('pagehide', () => {
        if (intervalId !== null) nativeRefs?.clearInterval(intervalId);
        intervalId = null;
        void tick('pagehide');
    });

    void tick('start');
    return runtimeHealthProbe;
}

function setContext(patch: RuntimeHealthContext): void {
    context = { ...context, ...patch };
}

function reportCustom(patch: RuntimeHealthCustom): void {
    custom = { ...custom, ...patch };
}

export const runtimeHealthProbe: RuntimeHealthProbeApi = {
    start,
    setContext,
    reportCustom,
    tick,
};

export function startRuntimeHealthProbe(options?: RuntimeHealthProbeOptions): RuntimeHealthProbeApi {
    const api = runtimeHealthProbe.start(options);
    try {
        (window as Window & { __csyosRuntimeHealth?: RuntimeHealthProbeApi }).__csyosRuntimeHealth = api;
    } catch {
        // Global hook is optional.
    }
    return api;
}
