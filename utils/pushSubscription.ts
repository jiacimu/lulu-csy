/**
 * Push Subscription Manager
 *
 * Called after app boot. Safe to call repeatedly.
 */

import { buildBackendHeaders,getBackendUrl } from './backendClient';
import { safeTimeoutSignal } from './safeTimeout';

let _pushStatus = '未初始化';
let _pushEndpoint = '';
let _pushError = '';

class PushFeatureUnavailableError extends Error {}

type PushSyncResult = 'synced' | 'disabled';

export function getPushDebugInfo(): { status: string; endpoint: string; error: string } {
    return { status: _pushStatus, endpoint: _pushEndpoint, error: _pushError };
}

export async function disablePushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        _pushStatus = '浏览器不支持 Web Push';
        _pushEndpoint = '';
        _pushError = '';
        return;
    }

    _pushError = '';

    try {
        const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
        if (!registration) {
            _pushStatus = '推送通知已禁用';
            _pushEndpoint = '';
            return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            _pushStatus = '推送通知已禁用';
            _pushEndpoint = '';
            return;
        }

        await syncUnsubscribeToBackend(subscription).catch((error: any) => {
            console.warn('[Push] Failed to sync unsubscribe to backend:', error.message);
        });

        await subscription.unsubscribe();
        _pushStatus = '推送通知已禁用';
        _pushEndpoint = '';
    } catch (error: any) {
        _pushStatus = '禁用推送失败';
        _pushError = error.message || String(error);
        throw error;
    }
}

export async function initPushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        _pushStatus = '浏览器不支持 Web Push';
        console.log('[Push] Not supported in this browser');
        return;
    }

    if (
        typeof (window as any)?.Capacitor?.isNativePlatform === 'function'
        && (window as any).Capacitor.isNativePlatform()
    ) {
        _pushStatus = '原生环境，跳过 Web Push';
        return;
    }

    const backendUrl = getBackendUrl();
    if (!backendUrl) {
        _pushStatus = '未配置后端地址';
        console.log('[Push] No backend URL configured, skipping');
        return;
    }

    _pushStatus = '正在注册...';
    _pushError = '';

    try {
        const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        console.log('[Push] Service Worker registered');

        let subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            _pushStatus = '已订阅，正在同步到后端...';
            _pushEndpoint = `${subscription.endpoint.slice(0, 60)}...`;
            console.log('[Push] Already subscribed, syncing to backend...');

            const syncResult = await syncSubscriptionToBackend(backendUrl, subscription);
            if (syncResult === 'disabled') {
                _pushStatus = '当前环境未启用推送订阅接口';
                return;
            }

            _pushStatus = '已订阅，推送就绪';
            return;
        }

        if (Notification.permission === 'default') {
            _pushStatus = '等待通知权限...';
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                _pushStatus = '通知权限被拒绝';
                _pushError = '请在浏览器设置中开启通知权限。';
                console.log('[Push] Notification permission denied');
                return;
            }
        } else if (Notification.permission === 'denied') {
            _pushStatus = '通知权限已被禁用';
            _pushError = '通知权限已被禁用，请在浏览器站点设置里开启。';
            console.log('[Push] Notification permission previously denied');
            return;
        }

        _pushStatus = '正在获取 VAPID 公钥...';

        let vapidPublicKey = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const keyResponse = await fetch(`${backendUrl}/api/push/vapid-key`, {
                    headers: buildBackendHeaders({ contentType: false }),
                    signal: safeTimeoutSignal(30000),
                });

                if (!keyResponse.ok) {
                    throw new Error(`HTTP ${keyResponse.status}`);
                }

                const keyData = await keyResponse.json();
                vapidPublicKey = keyData.vapidPublicKey;
                break;
            } catch (error: any) {
                console.warn(`[Push] VAPID key fetch attempt ${attempt}/3 failed:`, error.message);
                if (attempt === 3) {
                    _pushStatus = '获取 VAPID 公钥失败';
                    _pushError = `VAPID 公钥获取失败: ${error.message}`;
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        if (!vapidPublicKey) {
            _pushStatus = 'VAPID 公钥为空';
            _pushError = 'VAPID key empty from server';
            console.warn('[Push] VAPID key empty');
            return;
        }

        _pushStatus = '正在创建推送订阅...';

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
                });
                break;
            } catch (error: any) {
                console.warn(`[Push] Subscribe attempt ${attempt}/3 failed:`, error.message);
                if (attempt === 3) {
                    _pushStatus = '推送订阅创建失败';
                    _pushError = `创建推送订阅失败: ${error.message}`;
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        if (!subscription) {
            _pushStatus = '推送订阅为空';
            return;
        }

        _pushEndpoint = `${subscription.endpoint.slice(0, 60)}...`;
        console.log('[Push] Subscribed to push notifications');
        _pushStatus = '正在同步订阅到后端...';

        const syncResult = await syncSubscriptionToBackend(backendUrl, subscription);
        if (syncResult === 'disabled') {
            _pushStatus = '当前环境未启用推送订阅接口';
            return;
        }

        _pushStatus = '推送通知已就绪';
        console.log('[Push] Push notification setup complete');

        try {
            _pushStatus = '正在发送测试通知...';
            await sendTestPush(backendUrl);
            _pushStatus = '推送通知已就绪（测试通知已发送）';
        } catch (error: any) {
            console.warn('[Push] Test push failed (non-critical):', error.message);
            _pushStatus = '推送通知已就绪（测试通知发送失败，但订阅成功）';
        }
    } catch (error: any) {
        _pushStatus = '初始化失败';
        _pushError = error.message || String(error);
        console.warn('[Push] Initialization failed:', error.message);
    }
}

export async function forceResubscribe(): Promise<void> {
    try {
        const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
        if (registration) {
            const existingSubscription = await registration.pushManager.getSubscription();
            if (existingSubscription) {
                await existingSubscription.unsubscribe();
                console.log('[Push] Unsubscribed existing subscription');
            }
        }
    } catch {
        // Continue into a clean re-init path.
    }

    await initPushSubscription();
}

async function syncSubscriptionToBackend(
    backendUrl: string,
    subscription: PushSubscription,
): Promise<PushSyncResult> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const headers = new Headers(buildBackendHeaders());
            headers.set('Content-Type', 'application/json');

            const response = await fetch(`${backendUrl}/api/push/subscribe`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ subscription: subscription.toJSON() }),
                signal: safeTimeoutSignal(30000),
            });

            if (response.ok) {
                const data = await response.json();
                console.log(`[Push] Subscription synced to backend (${data.subscriptionCount || 1} device(s))`);
                return 'synced';
            }

            if (response.status === 405) {
                throw new PushFeatureUnavailableError('Push subscription endpoint is not enabled in this environment (HTTP 405)');
            }

            throw new Error(`HTTP ${response.status}`);
        } catch (error: any) {
            if (error instanceof PushFeatureUnavailableError) {
                _pushStatus = '当前环境未启用推送订阅接口';
                _pushError = '';
                console.warn('[Push] Subscription endpoint returned 405, skipping push setup for this environment');
                return 'disabled';
            }

            console.warn(`[Push] Backend sync attempt ${attempt}/3 failed:`, error.message);
            if (attempt === 3) {
                _pushError = `后端同步失败: ${error.message}`;
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }

    return 'disabled';
}

async function syncUnsubscribeToBackend(subscription: PushSubscription): Promise<void> {
    const backendUrl = getBackendUrl();
    if (!backendUrl) return;

    const headers = new Headers(buildBackendHeaders());
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${backendUrl}/api/push/unsubscribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: safeTimeoutSignal(10000),
    });

    if (response.ok || response.status === 405) {
        return;
    }

    throw new Error(`HTTP ${response.status}`);
}

async function sendTestPush(backendUrl: string): Promise<void> {
    const headers = new Headers(buildBackendHeaders());
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${backendUrl}/api/push/test`, {
        method: 'POST',
        headers,
        signal: safeTimeoutSignal(30000),
    });

    if (response.ok) {
        console.log('[Push] Test notification sent');
        return;
    }

    if (response.status === 405) {
        console.warn('[Push] Test push endpoint returned 405, skipping test notification');
        return;
    }

    const text = await response.text().catch(() => '');
    console.warn('[Push] Test push failed:', response.status, text);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
