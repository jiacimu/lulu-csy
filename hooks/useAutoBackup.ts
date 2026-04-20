/**
 * useAutoBackup — 每日自动云端备份
 *
 * 触发时机:
 *   1. 应用启动（OSDataProvider 挂载后）
 *   2. 用户从后台切回前台（visibilitychange）
 *
 * 逻辑:
 *   - 调 GET /api/backup/latest 检查最后备份时间
 *   - 距上次备份 ≥ 24h → 生成 ZIP 并上传
 *   - 上传前预检大小 ≤ 500MB
 *   - 静默运行，不阻塞 UI；失败仅 console.warn
 */

import { useEffect, useRef, useCallback } from 'react';
import {
    getLatestCloudBackup,
    uploadCloudBackup,
    isCloudBackupAvailable,
} from '../utils/cloudBackup';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const MAX_BACKUP_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * @param exportSystem  OSContext 的 exportSystem('full') — 返回 Blob
 * @param isDataLoaded  数据是否加载完毕
 */
export function useAutoBackup(
    exportSystem: (mode: 'text_only' | 'media_only' | 'full') => Promise<Blob>,
    isDataLoaded: boolean,
) {
    const runningRef = useRef(false);

    const checkAutoBackup = useCallback(async () => {
        // 防止并发
        if (runningRef.current) return;
        runningRef.current = true;

        try {
            // 0. 后端可达？
            const ok = await isCloudBackupAvailable();
            if (!ok) {
                console.log('[AutoBackup] 后端不可达，跳过');
                return;
            }

            // 1. 查最近一次备份
            const latest = await getLatestCloudBackup();
            const now = Date.now();
            const lastBackupTime = latest ? new Date(latest.uploaded).getTime() : 0;

            if (now - lastBackupTime < TWENTY_FOUR_HOURS) {
                console.log('[AutoBackup] 24h 内已有备份，跳过');
                return;
            }

            // 2. 生成 ZIP
            console.log('[AutoBackup] 开始生成备份...');
            const blob = await exportSystem('full');

            // 3. 预检大小
            if (blob.size > MAX_BACKUP_BYTES) {
                console.warn(`[AutoBackup] 数据 ${(blob.size / 1024 / 1024).toFixed(1)}MB 超过 500MB，跳过`);
                return;
            }

            // 4. 上传
            const label = `auto-${new Date().toISOString().slice(0, 10)}`;
            await uploadCloudBackup(blob, label);
            console.log('[AutoBackup] ✅ 自动备份完成');

        } catch (e: any) {
            console.warn('[AutoBackup] 自动备份失败 (非致命):', e?.message || e);
        } finally {
            runningRef.current = false;
        }
    }, [exportSystem]);

    useEffect(() => {
        if (!isDataLoaded) return;

        // 启动时延迟 10s 执行，避免阻塞初始化
        const timer = setTimeout(() => {
            checkAutoBackup();
        }, 10_000);

        // visibilitychange: 用户从后台切回前台
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                checkAutoBackup();
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [isDataLoaded, checkAutoBackup]);
}
