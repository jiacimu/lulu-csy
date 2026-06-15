import { Capacitor } from '@capacitor/core';
import { getFrontendOrigin } from './backendConfig';

type CapacitorGlobal = {
    isNativePlatform?: () => boolean;
};

function isRelativeProxyUrl(value: string): boolean {
    return value.startsWith('/') && !value.startsWith('//');
}

export function isNativeProxyRuntime(): boolean {
    try {
        if (Capacitor.isNativePlatform()) return true;
    } catch {
        // Fall through to the global bridge check below.
    }

    try {
        const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
        return capacitor?.isNativePlatform?.() === true;
    } catch {
        return false;
    }
}

export function resolveProxyEndpoint(endpoint: string): string {
    const normalized = endpoint.trim();
    if (!isRelativeProxyUrl(normalized) || !isNativeProxyRuntime()) return normalized;

    try {
        return new URL(normalized, `${getFrontendOrigin()}/`).toString();
    } catch {
        return normalized;
    }
}

export function resolveProxyBaseUrl(baseUrl: string | undefined, fallback: string): string {
    const normalized = (baseUrl || fallback).trim() || fallback;
    return resolveProxyEndpoint(normalized).replace(/\/+$/, '');
}
