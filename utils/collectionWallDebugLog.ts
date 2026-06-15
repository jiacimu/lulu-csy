export type CollectionWallDebugLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface CollectionWallDebugLogEntry {
    id: number;
    ts: number;
    level: CollectionWallDebugLogLevel;
    text: string;
}

const DEBUG_MARKER = '[CollectionWallDebug]';
const STORAGE_KEY = 'sully_collection_wall_debug_logs';
const MAX_LOGS = 500;
const EVENT_NAME = 'sully:collection-wall-debug-log';

let installed = false;
let nextId = Date.now();
let memoryLogs: CollectionWallDebugLogEntry[] = [];

declare global {
    interface Window {
        __sullyCollectionWallDebugInstalled?: boolean;
    }
}

const isBrowser = (): boolean => typeof window !== 'undefined';

const safeStringify = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
        return JSON.stringify(value, (_key, nested) => {
            if (nested instanceof Error) {
                return { name: nested.name, message: nested.message, stack: nested.stack };
            }
            if (nested instanceof Blob) {
                return { blob: true, type: nested.type, size: nested.size };
            }
            return nested;
        });
    } catch {
        return String(value);
    }
};

const normalizeArgs = (args: unknown[]): string => args.map(safeStringify).join(' ');

const loadStoredLogs = (): CollectionWallDebugLogEntry[] => {
    if (!isBrowser()) return memoryLogs;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return memoryLogs;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(-MAX_LOGS) : memoryLogs;
    } catch {
        return memoryLogs;
    }
};

const persistLogs = (logs: CollectionWallDebugLogEntry[]): void => {
    memoryLogs = logs.slice(-MAX_LOGS);
    if (!isBrowser()) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryLogs));
    } catch {
        // Best effort only; the panel still keeps the in-memory buffer.
    }
};

export const captureCollectionWallDebugConsoleArgs = (
    level: CollectionWallDebugLogLevel,
    args: unknown[],
): boolean => {
    const text = normalizeArgs(args);
    if (!text.includes(DEBUG_MARKER)) return false;

    const logs = loadStoredLogs();
    const entry: CollectionWallDebugLogEntry = {
        id: nextId += 1,
        ts: Date.now(),
        level,
        text,
    };
    persistLogs([...logs, entry]);
    if (isBrowser()) {
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: entry }));
    }
    return true;
};

export const installCollectionWallDebugConsoleCapture = (): void => {
    if (!isBrowser() || installed || window.__sullyCollectionWallDebugInstalled) return;
    installed = true;
    window.__sullyCollectionWallDebugInstalled = true;
    memoryLogs = loadStoredLogs();

    (['log', 'info', 'warn', 'error', 'debug'] as CollectionWallDebugLogLevel[]).forEach((level) => {
        const original = console[level]?.bind(console);
        if (!original) return;
        console[level] = ((...args: unknown[]) => {
            captureCollectionWallDebugConsoleArgs(level, args);
            original(...args);
        }) as typeof console[typeof level];
    });
};

export const getCollectionWallDebugLogs = (): CollectionWallDebugLogEntry[] => loadStoredLogs();

export const clearCollectionWallDebugLogs = (): void => {
    persistLogs([]);
    if (isBrowser()) {
        window.dispatchEvent(new CustomEvent(EVENT_NAME));
    }
};

export const subscribeCollectionWallDebugLogs = (callback: () => void): (() => void) => {
    if (!isBrowser()) return () => {};
    const handler = () => callback();
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
};

export const formatCollectionWallDebugLogs = (logs = getCollectionWallDebugLogs()): string => (
    logs.map(entry => `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase()} ${entry.text}`).join('\n')
);

const parseDebugPayload = (entry: CollectionWallDebugLogEntry): { phase: string; payload: any | null } => {
    const phase = entry.text.match(/\[CollectionWallDebug\]\s+([^\s{]+)/)?.[1] || 'unknown';
    const jsonStart = entry.text.indexOf('{');
    if (jsonStart < 0) return { phase, payload: null };
    try {
        return { phase, payload: JSON.parse(entry.text.slice(jsonStart)) };
    } catch {
        return { phase, payload: null };
    }
};

export const formatCollectionWallDebugEntrySummary = (entry: CollectionWallDebugLogEntry): string => {
    const { phase, payload } = parseDebugPayload(entry);
    const time = new Date(entry.ts).toLocaleTimeString();
    if (!payload) return `${time} ${entry.level} ${entry.text.slice(0, 180)}`;

    const head = Array.isArray(payload.head)
        ? payload.head
        : Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.oldHead)
                ? payload.oldHead
                : [];
    const headText = head.slice(0, 4).map((item: any) => (
        `${item.index}:${String(item.id || '').slice(0, 18)} o${item.order} z${item.z} x${item.x ?? '-'} y${item.y ?? '-'}`
    )).join(' | ');
    const error = payload.error?.name ? ` error=${payload.error.name}` : '';
    const count = payload.itemCount ?? payload.deleteCount ?? head.length;
    const seq = payload.seq != null ? ` #${payload.seq}` : '';
    const wall = payload.wallId ? ` ${String(payload.wallId).slice(0, 18)}` : '';
    return `${time} ${entry.level} ${phase}${seq}${wall} count=${count}${error}${headText ? ` :: ${headText}` : ''}`;
};

export const formatCollectionWallDebugDiagnostics = (logs = getCollectionWallDebugLogs()): string => {
    const parsed = logs.map(entry => ({ entry, ...parseDebugPayload(entry) }));
    const snapshotLogs = parsed.filter(item => item.phase.startsWith('snapshot-'));
    const errors = parsed.filter(item => item.entry.level === 'error' || /error|abort/i.test(item.phase));
    const active = new Map<number, string>();
    const overlaps: string[] = [];

    for (const item of snapshotLogs) {
        const seq = Number(item.payload?.seq);
        if (!Number.isFinite(seq)) continue;
        if (item.phase === 'snapshot-enter') {
            if (active.size > 0) {
                overlaps.push(`${new Date(item.entry.ts).toLocaleTimeString()} enter #${seq} while active ${Array.from(active.keys()).join(',')}`);
            }
            active.set(seq, item.phase);
        }
        if (item.phase === 'snapshot-complete' || item.phase.includes('error') || item.phase.includes('abort')) {
            active.delete(seq);
        }
    }

    const header = [
        `CollectionWallDebug diagnostics`,
        `logs=${logs.length}`,
        `snapshotLogs=${snapshotLogs.length}`,
        `errors=${errors.length}`,
        `overlaps=${overlaps.length}`,
        logs.length > 0 ? `range=${new Date(logs[0].ts).toLocaleString()} -> ${new Date(logs[logs.length - 1].ts).toLocaleString()}` : 'range=empty',
    ];

    const errorLines = errors.slice(-20).map(item => formatCollectionWallDebugEntrySummary(item.entry));
    const overlapLines = overlaps.slice(-20).map(line => `OVERLAP ${line}`);
    const timeline = snapshotLogs.slice(-90).map(item => formatCollectionWallDebugEntrySummary(item.entry));
    return [
        ...header,
        '',
        'Recent overlaps/errors:',
        ...(overlapLines.length > 0 ? overlapLines : ['none']),
        ...(errorLines.length > 0 ? errorLines : []),
        '',
        'Recent snapshot timeline:',
        ...timeline,
    ].join('\n');
};
