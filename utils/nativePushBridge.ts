import { Capacitor,type PermissionState } from '@capacitor/core';
import {
    PushNotifications,
    type ActionPerformed,
    type PermissionStatus,
    type Token,
} from '@capacitor/push-notifications';
import capacitorConfig from '../capacitor.config.json';
import { buildBackendHeaders,getBackendUrl } from './backendClient';
import { safeTimeoutSignal } from './safeTimeout';

const NATIVE_PUSH_APP_ID = typeof capacitorConfig.appId === 'string'
    ? capacitorConfig.appId
    : 'com.aetheros.simulator';
const NATIVE_PUSH_DEVICE_ID_KEY = 'csyos_native_push_device_id';
const NATIVE_PUSH_TOKEN_KEY = 'csyos_native_push_fcm_token';
const NATIVE_PUSH_PENDING_CLICK_KEY = 'csyos_native_push_pending_click';
const NATIVE_PUSH_REGISTRATION_TIMEOUT_MS = 30000;

export const NATIVE_PUSH_NOTIFICATION_CLICK_EVENT = 'csyos-native-push-notification-click';

export interface NativePushClickDetail {
    charId: string;
    data?: unknown;
}

export interface NativePushDebugInfo {
    channel: 'native-fcm' | 'unavailable';
    provider: string;
    status: string;
    permission: string;
    registered: boolean;
    offlineCapable: boolean;
    needsResubscribe: boolean;
    tokenPreview: string;
    deviceIdPreview: string;
    appId: string;
    error: string;
}

interface PendingTokenRequest {
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

type NativePushRequestOptions = {
    sendTest?: boolean;
};

type NativePushRegisterPayload = {
    provider: 'fcm';
    platform: 'android';
    token: string;
    deviceId: string;
    appId: string;
};

type NativePushDevicePayload = Omit<NativePushRegisterPayload, 'token'> & {
    token?: string;
};

let nativePushDebugInfo: NativePushDebugInfo = {
    channel: 'unavailable',
    provider: '不可用',
    status: '未初始化',
    permission: '未知',
    registered: false,
    offlineCapable: false,
    needsResubscribe: false,
    tokenPreview: '',
    deviceIdPreview: '',
    appId: NATIVE_PUSH_APP_ID,
    error: '',
};

let listenersReadyPromise: Promise<void> | null = null;
let registerInFlightPromise: Promise<NativePushDebugInfo> | null = null;
let pendingTokenRequest: PendingTokenRequest | null = null;
let pendingClickInMemory: NativePushClickDetail | null = null;

export function isCapacitorAndroid(): boolean {
    try {
        return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    } catch {
        return false;
    }
}

export function getNativePushDebugInfo(): NativePushDebugInfo {
    hydrateNativePushStoredPreviews();
    return { ...nativePushDebugInfo };
}

export async function checkNativePushPermission(): Promise<PermissionStatus | null> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return null;
    }

    try {
        const permission = await PushNotifications.checkPermissions();
        setNativePushDebugInfo({
            permission: formatNativePermission(permission.receive),
            channel: 'native-fcm',
            provider: '原生 FCM',
        });
        return permission;
    } catch (error: any) {
        setNativePushDebugInfo({
            status: '原生推送权限检查失败',
            error: normalizeErrorMessage(error),
            permission: '未知',
            channel: 'native-fcm',
            provider: '原生 FCM',
            offlineCapable: false,
            needsResubscribe: true,
        });
        return null;
    }
}

export async function requestNativePushPermission(): Promise<PermissionStatus | null> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return null;
    }

    try {
        const permission = await PushNotifications.requestPermissions();
        setNativePushDebugInfo({
            permission: formatNativePermission(permission.receive),
            channel: 'native-fcm',
            provider: '原生 FCM',
        });
        return permission;
    } catch (error: any) {
        setNativePushDebugInfo({
            status: '原生推送权限请求失败',
            error: normalizeErrorMessage(error),
            permission: '未知',
            channel: 'native-fcm',
            provider: '原生 FCM',
            offlineCapable: false,
            needsResubscribe: true,
        });
        return null;
    }
}

export async function registerNativePush(
    options: NativePushRequestOptions = {},
): Promise<NativePushDebugInfo> {
    if (registerInFlightPromise) {
        return registerInFlightPromise;
    }

    registerInFlightPromise = registerNativePushInternal(options).finally(() => {
        registerInFlightPromise = null;
    });
    return registerInFlightPromise;
}

export async function unregisterNativePush(): Promise<NativePushDebugInfo> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return getNativePushDebugInfo();
    }

    const token = readStoredNativePushToken();
    const deviceId = getOrCreateNativePushDeviceId();
    setNativePushDebugInfo({
        status: '正在注销原生推送...',
        error: '',
        channel: 'native-fcm',
        provider: '原生 FCM',
        deviceIdPreview: shortenSensitiveValue(deviceId),
        tokenPreview: shortenSensitiveValue(token),
        offlineCapable: false,
        registered: false,
    });

    const errors: string[] = [];

    try {
        await postNativePushDevice('/api/push/native/unregister', {
            provider: 'fcm',
            platform: 'android',
            token: token || undefined,
            deviceId,
            appId: NATIVE_PUSH_APP_ID,
        });
    } catch (error: any) {
        errors.push(`后端注销失败: ${normalizeErrorMessage(error)}`);
    }

    try {
        await PushNotifications.unregister();
    } catch (error: any) {
        errors.push(`系统注销失败: ${normalizeErrorMessage(error)}`);
    }

    if (errors.length > 0) {
        setNativePushDebugInfo({
            status: '原生推送注销失败',
            error: errors.join('；'),
            needsResubscribe: true,
        });
        return getNativePushDebugInfo();
    }

    clearStoredNativePushToken();
    setNativePushDebugInfo({
        status: '原生推送已注销',
        error: '',
        registered: false,
        offlineCapable: false,
        needsResubscribe: false,
        tokenPreview: '',
    });
    return getNativePushDebugInfo();
}

export async function sendNativeTestPush(): Promise<NativePushDebugInfo> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return getNativePushDebugInfo();
    }

    try {
        const token = readStoredNativePushToken();
        const deviceId = getOrCreateNativePushDeviceId();
        setNativePushDebugInfo({
            status: '正在发送原生测试推送...',
            error: '',
            channel: 'native-fcm',
            provider: '原生 FCM',
            deviceIdPreview: shortenSensitiveValue(deviceId),
            tokenPreview: shortenSensitiveValue(token),
        });
        await postNativePushDevice('/api/push/native/test', {
            provider: 'fcm',
            platform: 'android',
            token: token || undefined,
            deviceId,
            appId: NATIVE_PUSH_APP_ID,
        });
        setNativePushDebugInfo({
            status: '原生测试推送已发送',
            error: '',
        });
    } catch (error: any) {
        setNativePushDebugInfo({
            status: '原生测试推送失败',
            error: normalizeErrorMessage(error),
        });
    }

    return getNativePushDebugInfo();
}

export async function ensureNativePushClickBridge(): Promise<NativePushDebugInfo> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return getNativePushDebugInfo();
    }

    try {
        await ensureNativePushListeners();
        setNativePushDebugInfo({
            channel: 'native-fcm',
            provider: '原生 FCM',
        });
    } catch (error: any) {
        setNativePushDebugInfo({
            status: '原生通知点击监听失败',
            error: normalizeErrorMessage(error),
            channel: 'native-fcm',
            provider: '原生 FCM',
            needsResubscribe: true,
        });
    }

    return getNativePushDebugInfo();
}

export function consumePendingNativePushClick(): NativePushClickDetail | null {
    const memoryClick = pendingClickInMemory;
    pendingClickInMemory = null;

    if (typeof window === 'undefined') {
        return memoryClick;
    }

    try {
        const raw = window.sessionStorage.getItem(NATIVE_PUSH_PENDING_CLICK_KEY);
        window.sessionStorage.removeItem(NATIVE_PUSH_PENDING_CLICK_KEY);
        if (!raw) return memoryClick;
        const parsed = JSON.parse(raw) as Partial<NativePushClickDetail>;
        if (typeof parsed?.charId === 'string' && parsed.charId.trim()) {
            return {
                charId: parsed.charId.trim(),
                data: parsed.data,
            };
        }
    } catch {
        return memoryClick;
    }

    return memoryClick;
}

async function registerNativePushInternal(
    options: NativePushRequestOptions,
): Promise<NativePushDebugInfo> {
    if (!isCapacitorAndroid()) {
        markNativePushUnavailable();
        return getNativePushDebugInfo();
    }

    const backendUrl = getBackendUrl();
    const deviceId = getOrCreateNativePushDeviceId();
    setNativePushDebugInfo({
        channel: 'native-fcm',
        provider: '原生 FCM',
        status: '正在检查原生推送权限...',
        error: '',
        appId: NATIVE_PUSH_APP_ID,
        deviceIdPreview: shortenSensitiveValue(deviceId),
        needsResubscribe: false,
    });

    if (!backendUrl) {
        setNativePushDebugInfo({
            status: '未配置后端地址',
            error: '',
            registered: false,
            offlineCapable: false,
        });
        return getNativePushDebugInfo();
    }

    try {
        await ensureNativePushListeners();

        let permission = await checkNativePushPermission();
        if (permission?.receive !== 'granted') {
            setNativePushDebugInfo({ status: '等待原生通知权限...' });
            permission = await requestNativePushPermission();
        }

        if (permission?.receive !== 'granted') {
            setNativePushDebugInfo({
                status: '通知权限未允许',
                error: '请在 Android 系统设置中允许通知权限。',
                permission: formatNativePermission(permission?.receive),
                registered: false,
                offlineCapable: false,
                needsResubscribe: true,
            });
            return getNativePushDebugInfo();
        }

        setNativePushDebugInfo({
            status: '正在向 FCM 注册...',
            permission: formatNativePermission(permission.receive),
        });

        const token = await requestNativeRegistrationToken();
        storeNativePushToken(token);
        setNativePushDebugInfo({
            status: '正在同步 FCM token 到后端...',
            tokenPreview: shortenSensitiveValue(token),
            deviceIdPreview: shortenSensitiveValue(deviceId),
        });

        await postNativePushRegister('/api/push/native/register', {
            provider: 'fcm',
            platform: 'android',
            token,
            deviceId,
            appId: NATIVE_PUSH_APP_ID,
        });

        setNativePushDebugInfo({
            status: '原生 FCM 推送已就绪',
            error: '',
            registered: true,
            offlineCapable: true,
            needsResubscribe: false,
        });

        if (options.sendTest) {
            const beforeTestStatus = getNativePushDebugInfo().status;
            const testInfo = await sendNativeTestPush();
            if (testInfo.error) {
                setNativePushDebugInfo({
                    status: `${beforeTestStatus}（测试通知发送失败）`,
                    registered: true,
                    offlineCapable: true,
                    needsResubscribe: false,
                });
            } else {
                setNativePushDebugInfo({
                    status: `${beforeTestStatus}（测试通知已发送）`,
                    registered: true,
                    offlineCapable: true,
                    needsResubscribe: false,
                });
            }
        }
    } catch (error: any) {
        setNativePushDebugInfo({
            status: '原生 FCM 初始化失败',
            error: normalizeErrorMessage(error),
            registered: false,
            offlineCapable: false,
            needsResubscribe: true,
        });
    }

    return getNativePushDebugInfo();
}

async function ensureNativePushListeners(): Promise<void> {
    if (listenersReadyPromise) {
        return listenersReadyPromise;
    }

    listenersReadyPromise = Promise.all([
        PushNotifications.addListener('registration', handleNativePushRegistration),
        PushNotifications.addListener('registrationError', handleNativePushRegistrationError),
        PushNotifications.addListener('pushNotificationActionPerformed', handleNativePushActionPerformed),
    ]).then(() => undefined);

    return listenersReadyPromise;
}

function handleNativePushRegistration(token: Token): void {
    const value = token?.value || '';
    if (!value) {
        handleNativePushRegistrationError({ error: 'FCM token is empty' });
        return;
    }

    storeNativePushToken(value);
    setNativePushDebugInfo({
        channel: 'native-fcm',
        provider: '原生 FCM',
        tokenPreview: shortenSensitiveValue(value),
        error: '',
    });

    if (pendingTokenRequest) {
        const current = pendingTokenRequest;
        pendingTokenRequest = null;
        clearTimeout(current.timeoutId);
        current.resolve(value);
        return;
    }

    void syncNativePushTokenRefresh(value);
}

function handleNativePushRegistrationError(error: { error?: string }): void {
    const message = error?.error || 'Native push registration failed';
    setNativePushDebugInfo({
        status: 'FCM token 注册失败',
        error: message,
        registered: false,
        offlineCapable: false,
        needsResubscribe: true,
    });

    if (pendingTokenRequest) {
        const current = pendingTokenRequest;
        pendingTokenRequest = null;
        clearTimeout(current.timeoutId);
        current.reject(new Error(message));
    }
}

function handleNativePushActionPerformed(action: ActionPerformed): void {
    const data = action.notification?.data;
    const charId = extractNativePushCharId(action);
    if (!charId) {
        setNativePushDebugInfo({
            status: '收到原生通知点击但缺少 charId',
            error: '通知 payload 中没有 charId，无法自动跳转聊天页。',
        });
        return;
    }

    const detail: NativePushClickDetail = { charId, data };
    publishNativePushClick(detail);
    setNativePushDebugInfo({
        status: '收到原生通知点击',
        error: '',
    });
}

function publishNativePushClick(detail: NativePushClickDetail): void {
    pendingClickInMemory = detail;

    if (typeof window === 'undefined') return;

    try {
        window.sessionStorage.setItem(NATIVE_PUSH_PENDING_CLICK_KEY, JSON.stringify(detail));
    } catch {
        // In-memory fallback above is enough for the current JS runtime.
    }

    window.dispatchEvent(new CustomEvent<NativePushClickDetail>(
        NATIVE_PUSH_NOTIFICATION_CLICK_EVENT,
        { detail },
    ));
}

async function requestNativeRegistrationToken(): Promise<string> {
    if (pendingTokenRequest) {
        return new Promise((resolve, reject) => {
            const existing = pendingTokenRequest as PendingTokenRequest;
            const previousResolve = existing.resolve;
            const previousReject = existing.reject;
            existing.resolve = (token) => {
                previousResolve(token);
                resolve(token);
            };
            existing.reject = (error) => {
                previousReject(error);
                reject(error);
            };
        });
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (!pendingTokenRequest) return;
            pendingTokenRequest = null;
            reject(new Error('等待 FCM token 超时'));
        }, NATIVE_PUSH_REGISTRATION_TIMEOUT_MS);

        pendingTokenRequest = { resolve, reject, timeoutId };

        PushNotifications.register().catch((error: any) => {
            if (!pendingTokenRequest) return;
            pendingTokenRequest = null;
            clearTimeout(timeoutId);
            reject(new Error(normalizeErrorMessage(error)));
        });
    });
}

async function syncNativePushTokenRefresh(token: string): Promise<void> {
    if (!isCapacitorAndroid()) return;

    const backendUrl = getBackendUrl();
    if (!backendUrl) {
        setNativePushDebugInfo({
            status: '收到 FCM token，但未配置后端地址',
            registered: false,
            offlineCapable: false,
        });
        return;
    }

    try {
        const deviceId = getOrCreateNativePushDeviceId();
        setNativePushDebugInfo({
            status: '收到新的 FCM token，正在同步...',
            tokenPreview: shortenSensitiveValue(token),
            deviceIdPreview: shortenSensitiveValue(deviceId),
        });
        await postNativePushRegister('/api/push/native/register', {
            provider: 'fcm',
            platform: 'android',
            token,
            deviceId,
            appId: NATIVE_PUSH_APP_ID,
        });
        setNativePushDebugInfo({
            status: '原生 FCM 推送已就绪',
            error: '',
            registered: true,
            offlineCapable: true,
            needsResubscribe: false,
        });
    } catch (error: any) {
        setNativePushDebugInfo({
            status: 'FCM token 自动同步失败',
            error: normalizeErrorMessage(error),
            registered: false,
            offlineCapable: false,
            needsResubscribe: true,
        });
    }
}

async function postNativePushRegister(
    path: '/api/push/native/register',
    payload: NativePushRegisterPayload,
): Promise<void> {
    await postNativePush(path, payload);
}

async function postNativePushDevice(
    path: '/api/push/native/unregister' | '/api/push/native/test',
    payload: NativePushDevicePayload,
): Promise<void> {
    await postNativePush(path, payload);
}

async function postNativePush(
    path: string,
    payload: NativePushRegisterPayload | NativePushDevicePayload,
): Promise<void> {
    const backendUrl = getBackendUrl();
    if (!backendUrl) {
        throw new Error('未配置后端地址');
    }

    const headers = new Headers(buildBackendHeaders());
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${backendUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: safeTimeoutSignal(30000),
    });

    if (response.ok) return;

    throw new Error(await readNativePushBackendError(response));
}

async function readNativePushBackendError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    const trimmed = text.trim();

    if (!trimmed) return `HTTP ${response.status}`;

    try {
        const data = JSON.parse(trimmed) as {
            error?: unknown;
            message?: unknown;
            details?: unknown;
            reason?: unknown;
        };
        const detail = [data.error, data.message, data.details, data.reason]
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .join(' | ');
        return detail ? `HTTP ${response.status}: ${detail.slice(0, 700)}` : `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}: ${trimmed.slice(0, 700)}`;
    }
}

function markNativePushUnavailable(): void {
    setNativePushDebugInfo({
        channel: 'unavailable',
        provider: '不可用',
        status: '当前环境不是 Capacitor Android',
        permission: '不适用',
        registered: false,
        offlineCapable: false,
        needsResubscribe: false,
        tokenPreview: '',
        error: '',
    });
}

function setNativePushDebugInfo(patch: Partial<NativePushDebugInfo>): void {
    nativePushDebugInfo = {
        ...nativePushDebugInfo,
        ...patch,
        appId: NATIVE_PUSH_APP_ID,
    };
}

function hydrateNativePushStoredPreviews(): void {
    if (!isCapacitorAndroid()) return;

    const token = readStoredNativePushToken();
    const deviceId = getOrCreateNativePushDeviceId();
    setNativePushDebugInfo({
        channel: 'native-fcm',
        provider: '原生 FCM',
        tokenPreview: shortenSensitiveValue(token),
        deviceIdPreview: shortenSensitiveValue(deviceId),
    });
}

function getOrCreateNativePushDeviceId(): string {
    const existing = readStorageValue(NATIVE_PUSH_DEVICE_ID_KEY);
    if (existing) return existing;

    const id = `android-${createRandomId()}`;
    writeStorageValue(NATIVE_PUSH_DEVICE_ID_KEY, id);
    return id;
}

function createRandomId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // Fall through to non-crypto fallback.
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function storeNativePushToken(token: string): void {
    writeStorageValue(NATIVE_PUSH_TOKEN_KEY, token);
}

function readStoredNativePushToken(): string {
    return readStorageValue(NATIVE_PUSH_TOKEN_KEY);
}

function clearStoredNativePushToken(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
    } catch {
        // Ignore storage failures.
    }
}

function readStorageValue(key: string): string {
    if (typeof window === 'undefined') return '';
    try {
        return window.localStorage.getItem(key)?.trim() || '';
    } catch {
        return '';
    }
}

function writeStorageValue(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Ignore storage failures.
    }
}

function shortenSensitiveValue(value: string, head = 10, tail = 8): string {
    const normalized = value.trim();
    if (!normalized) return '';
    if (normalized.length <= head + tail + 3) {
        const visibleHead = Math.min(6, normalized.length);
        const visibleTail = Math.min(4, Math.max(0, normalized.length - visibleHead));
        return `${normalized.slice(0, visibleHead)}...${visibleTail ? normalized.slice(-visibleTail) : ''}`;
    }
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function formatNativePermission(permission: PermissionState | undefined): string {
    if (permission === 'granted') return '已允许';
    if (permission === 'denied') return '已拒绝';
    if (permission === 'prompt' || permission === 'prompt-with-rationale') return '未决定';
    return '未知';
}

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function extractNativePushCharId(action: ActionPerformed): string {
    const notification = action.notification;
    const data = notification?.data;
    return readCharIdFromUnknown(data)
        || readCharIdFromUnknown(notification)
        || readCharIdFromUrl(notification?.link)
        || readCharIdFromUrl(notification?.click_action)
        || '';
}

function readCharIdFromUnknown(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'string') {
        const fromUrl = readCharIdFromUrl(value);
        if (fromUrl) return fromUrl;

        try {
            return readCharIdFromUnknown(JSON.parse(value));
        } catch {
            return '';
        }
    }

    if (typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    const direct = readFirstString(record, [
        'charId',
        'char_id',
        'notif_charId',
        'notifCharId',
        'characterId',
        'character_id',
        'contentCharId',
        'content_char_id',
    ]);
    if (direct) return direct;

    return readCharIdFromUnknown(record.data)
        || readCharIdFromUnknown(record.payload)
        || readCharIdFromUnknown(record.extra)
        || '';
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
}

function readCharIdFromUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';

    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
        const url = new URL(value, base);
        return url.searchParams.get('notif_charId')?.trim()
            || url.searchParams.get('charId')?.trim()
            || '';
    } catch {
        return '';
    }
}
