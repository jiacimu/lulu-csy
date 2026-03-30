/**
 * Cloud Backup SDK — 前端工具函数
 * 
 * 复用 systemBackup.ts 的 exportSystemData() 生成 ZIP，再上传到 R2。
 * 下载后直接用 importSystemData() 恢复。
 * 格式与原版 SullyOS 100% 兼容。
 */

// ─── Types ───────────────────────────────────────────

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
}

// ─── Config ──────────────────────────────────────────

function getBackendConfig(): { url: string; token: string } | null {
    // Hardcoded to match backendClient.ts deployment
    return {
        url: 'https://csyos-backend.sully-tts-proxy.workers.dev',
        token: 'change-me-to-a-random-string'
    };
}

function getUserId(): string {
    return localStorage.getItem('csyos_user_id') || 'default';
}

// ─── API Helpers ─────────────────────────────────────

async function backupFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    const config = getBackendConfig();
    if (!config) throw new Error('后端未配置。请先在设置中配置后端 URL 和 Token。');

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${config.token}`);
    headers.set('X-User-Id', getUserId());

    const res = await fetch(`${config.url}${path}`, {
        ...options,
        headers,
    });

    if (!res.ok && res.status !== 200) {
        const body = await res.text();
        throw new Error(`Backup API error ${res.status}: ${body}`);
    }

    return res;
}

// ─── Public API ──────────────────────────────────────

/**
 * 上传备份 ZIP 到云端
 * @param zipBlob - exportSystemData() 返回的 Blob
 * @param label - 可选备注标签
 */
export async function uploadCloudBackup(
    zipBlob: Blob,
    label?: string
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

/**
 * 列出云端所有备份
 */
export async function listCloudBackups(): Promise<CloudBackupListResponse> {
    const res = await backupFetch('/api/backup/list');
    return res.json();
}

/**
 * 获取最新备份信息
 */
export async function getLatestCloudBackup(): Promise<CloudBackupMeta | null> {
    const res = await backupFetch('/api/backup/latest');
    const data = await res.json();
    return data.latest || null;
}

/**
 * 下载云端备份 ZIP
 * @param key - 备份的 R2 key（从 listCloudBackups 获取）
 * @returns File 对象，可直接传给 importSystemData()
 */
export async function downloadCloudBackup(key: string): Promise<File> {
    const res = await backupFetch(`/api/backup/download?key=${encodeURIComponent(key)}`);
    const blob = await res.blob();
    const filename = key.split('/').pop() || 'backup.zip';
    return new File([blob], filename, { type: 'application/zip' });
}

/**
 * 删除云端备份
 */
export async function deleteCloudBackup(key: string): Promise<void> {
    await backupFetch(`/api/backup?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
    });
}

/**
 * 检查云备份是否可用（后端已配置 + R2 可访问）
 */
export async function isCloudBackupAvailable(): Promise<boolean> {
    try {
        const config = getBackendConfig();
        if (!config) return false;
        const res = await backupFetch('/api/backup/list');
        return res.ok;
    } catch {
        return false;
    }
}
