import { runtimeHealthProbe } from './runtimeHealthProbe';
import { resumeAutoReload, suspendAutoReload } from './runtimeRecovery';

type RuntimeTask = () => Promise<void> | void;

type RuntimeTaskOptions = {
    delayMs?: number;
};

let iosTaskChain: Promise<void> = Promise.resolve();

function isIOSWebKitRuntime(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /iP(hone|ad|od)/i.test(navigator.userAgent || '');
}

function delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function waitForVisible(): Promise<void> {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            document.removeEventListener('visibilitychange', onVisible);
            resolve();
        };
        document.addEventListener('visibilitychange', onVisible);
    });
}

async function runTask(name: string, task: RuntimeTask, options: RuntimeTaskOptions = {}): Promise<void> {
    const token = suspendAutoReload(`background:${name}`);
    runtimeHealthProbe.reportCustom({
        backgroundTask: name,
        backgroundTaskQueued: false,
        buildProbePaused: true,
    });

    try {
        await delay(options.delayMs ?? (isIOSWebKitRuntime() ? 1200 : 0));
        await waitForVisible();
        await task();
    } finally {
        runtimeHealthProbe.reportCustom({
            backgroundTask: null,
            buildProbePaused: false,
        });
        resumeAutoReload(token);
    }
}

export function scheduleRuntimeBackgroundTask(
    name: string,
    task: RuntimeTask,
    options: RuntimeTaskOptions = {},
): void {
    runtimeHealthProbe.reportCustom({
        backgroundTaskQueued: true,
        backgroundTaskQueuedName: name,
    });

    if (isIOSWebKitRuntime()) {
        iosTaskChain = iosTaskChain
            .then(() => runTask(name, task, options))
            .catch(error => {
                console.error(`[RuntimeTaskQueue] ${name}:`, error);
            });
        return;
    }

    void runTask(name, task, options).catch(error => {
        console.error(`[RuntimeTaskQueue] ${name}:`, error);
    });
}
