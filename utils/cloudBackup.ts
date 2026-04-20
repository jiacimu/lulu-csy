/**
 * Cloud Backup SDK - frontend helpers.
 *
 * Reuses systemBackup.ts export/import formats so cloud backups
 * remain compatible with the local SullyOS backup flow.
 */

import { buildBackendHeaders,getBackendToken,getBackendUrl } from './backendClient';

export interface CloudBackupMeta {
    key: string;
    size: number;
    uploaded: string;
    label?: string;
}

export interface CloudBackupListResponse {
    ok: boolean;
    backups: CloudBackupMeta[];
    count: number;
    maxCount: number;
    maxSizeMB?: number;
}

async function backupFetch(
    path: string,
    options: RequestInit = {},
): Promise<Response> {
    const backendUrl = getBackendUrl();
    const backendToken = getBackendToken();
    if (!backendUrl) {
        throw new Error('Backend URL is not configured.');
    }
    if (!backendToken) {
        throw new Error('Backend token is not configured.');
    }

    const headers = new Headers(buildBackendHeaders({ contentType: false }));
    for (const [key, value] of new Headers(options.headers || {})) {
        headers.set(key, value);
    }

    const res = await fetch(`${backendUrl}${path}`, {
        ...options,
        headers,
    });

    if (!res.ok && res.status !== 200) {
        const body = await res.text();
        throw new Error(`Backup API error ${res.status}: ${body}`);
    }

    return res;
}

export async function uploadCloudBackup(
    zipBlob: Blob,
    label?: string,
): Promise<{ key: string; size: number; uploaded: string }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/zip',
    };
    if (label) headers['X-Backup-Label'] = label;

    const res = await backupFetch('/api/backup/upload', {
        method: 'POST',
        headers,
        body: zipBlob,
    });

    return res.json();
}

export async function listCloudBackups(): Promise<CloudBackupListResponse> {
    const res = await backupFetch('/api/backup/list');
    return res.json();
}

export async function getLatestCloudBackup(): Promise<CloudBackupMeta | null> {
    const res = await backupFetch('/api/backup/latest');
    const data = await res.json();
    return data.latest || null;
}

export async function downloadCloudBackup(key: string): Promise<File> {
    const res = await backupFetch(`/api/backup/download?key=${encodeURIComponent(key)}`);
    const blob = await res.blob();
    const filename = key.split('/').pop() || 'backup.zip';
    return new File([blob], filename, { type: 'application/zip' });
}

export async function deleteCloudBackup(key: string): Promise<void> {
    await backupFetch(`/api/backup?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
    });
}

export async function isCloudBackupAvailable(): Promise<boolean> {
    try {
        if (!getBackendUrl()) return false;
        const res = await backupFetch('/api/backup/list');
        return res.ok;
    } catch {
        return false;
    }
}
