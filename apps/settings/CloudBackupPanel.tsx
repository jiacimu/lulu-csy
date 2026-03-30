
import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import Modal from '../../components/os/Modal';
import {
    uploadCloudBackup,
    listCloudBackups,
    downloadCloudBackup,
    deleteCloudBackup,
    isCloudBackupAvailable,
    CloudBackupMeta,
} from '../../utils/cloudBackup';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ─── Icons (pure SVG, no emoji) ──────────────────────────────────────────

const CloudIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 .75-7.425A4.502 4.502 0 0 0 13.5 7.5 4.5 4.5 0 0 0 9.075 9.75 3.75 3.75 0 0 0 2.25 15Z" />
    </svg>
);

const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
);

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
);

const RefreshIcon = ({ spinning }: { spinning?: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
);

const ShieldIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
);

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
);

// ─── Component ───────────────────────────────────────────────────────────

const CloudBackupPanel: React.FC = () => {
    const { exportSystem, importSystem, addToast, sysOperation } = useOS();

    const [available, setAvailable] = useState<boolean | null>(null);
    const [backups, setBackups] = useState<CloudBackupMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null);

    // Check availability on mount
    useEffect(() => {
        isCloudBackupAvailable().then(ok => {
            setAvailable(ok);
            if (ok) refreshList();
        });
    }, []);

    const refreshList = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listCloudBackups();
            setBackups(res.backups.reverse()); // newest first
        } catch (e: any) {
            console.warn('Cloud backup list failed:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Upload ──────────────────────────────────────────────────────────

    const handleUpload = async () => {
        if (uploading) return;
        setUploading(true);
        try {
            addToast('正在生成备份...', 'info');
            const blob = await exportSystem('full');
            addToast('正在上传到云端...', 'info');
            const label = new Date().toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });
            await uploadCloudBackup(blob, label);
            addToast('云备份上传成功', 'success');
            await refreshList();
        } catch (e: any) {
            addToast(e.message || '上传失败', 'error');
        } finally {
            setUploading(false);
        }
    };

    // ── Download & Restore ───────────────────────────────────────────────

    const handleRestore = async (key: string) => {
        setShowRestoreConfirm(null);
        setDownloadingKey(key);
        try {
            addToast('正在从云端下载...', 'info');
            const file = await downloadCloudBackup(key);
            await importSystem(file);
        } catch (e: any) {
            addToast(e.message || '恢复失败', 'error');
        } finally {
            setDownloadingKey(null);
        }
    };

    // ── Delete ───────────────────────────────────────────────────────────

    const handleDelete = async (key: string) => {
        setShowDeleteConfirm(null);
        try {
            await deleteCloudBackup(key);
            addToast('备份已删除', 'info');
            await refreshList();
        } catch (e: any) {
            addToast(e.message || '删除失败', 'error');
        }
    };

    // ── Not Available ────────────────────────────────────────────────────

    if (available === false) {
        return (
            <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                <div className="flex items-center gap-3 mb-3">
                    <div className="p-2.5 bg-stone-100 rounded-2xl text-stone-400">
                        <CloudIcon />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-stone-500 tracking-wide">云端备份</h2>
                        <p className="text-[10px] text-stone-400">未连接</p>
                    </div>
                </div>
                <p className="text-xs text-stone-400 leading-relaxed">
                    当前版本不支持云备份或后端服务未响应，请稍后再试。
                </p>
            </section>
        );
    }

    if (available === null) {
        return (
            <section className="bg-white/60 backdrop-blur-sm rounded-3xl p-5 shadow-sm border border-white/50">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-stone-100 rounded-2xl text-stone-400 animate-pulse">
                        <CloudIcon />
                    </div>
                    <span className="text-xs text-stone-400">正在检查云备份状态...</span>
                </div>
            </section>
        );
    }

    // ── Main UI ──────────────────────────────────────────────────────────

    return (
        <>
            <section className="bg-white/60 backdrop-blur-sm rounded-3xl shadow-sm border border-white/50 overflow-hidden">
                {/* Header */}
                <div className="p-5 pb-4">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-gradient-to-br from-green-50 to-emerald-100 rounded-2xl text-emerald-600 shadow-sm">
                                <CloudIcon />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-slate-700 tracking-wide">云端备份</h2>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-[10px] text-emerald-600 font-medium">已连接</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={refreshList}
                            disabled={loading}
                            className="p-2 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all active:scale-90"
                        >
                            <RefreshIcon spinning={loading} />
                        </button>
                    </div>
                </div>

                {/* Upload Button */}
                <div className="px-5 pb-3">
                    <button
                        onClick={handleUpload}
                        disabled={uploading || sysOperation.status !== 'idle'}
                        className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 rounded-2xl text-white text-xs font-bold shadow-lg shadow-emerald-200/60 active:scale-[0.97] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <RefreshIcon spinning />
                                <span>正在备份...</span>
                            </>
                        ) : (
                            <>
                                <UploadIcon />
                                <span>立即备份到云端</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Backup List */}
                <div className="px-5 pb-5">
                    {backups.length === 0 && !loading && (
                        <div className="py-6 text-center">
                            <div className="text-stone-300 mb-2">
                                <ShieldIcon />
                            </div>
                            <p className="text-xs text-stone-400">暂无云端备份</p>
                            <p className="text-[10px] text-stone-300 mt-1">点击上方按钮创建第一个备份</p>
                        </div>
                    )}

                    {backups.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-1 mb-1">
                                <span className="text-[10px] text-stone-400 font-medium tracking-wide">
                                    {backups.length} 个备份
                                </span>
                                <span className="text-[10px] text-stone-300">
                                    总计 {formatBytes(backups.reduce((sum, b) => sum + b.size, 0))}
                                </span>
                            </div>

                            {backups.map((backup) => (
                                <div
                                    key={backup.key}
                                    className="bg-white/80 rounded-2xl border border-stone-100 p-3.5 flex items-center gap-3 group hover:border-stone-200 transition-all"
                                >
                                    {/* Icon */}
                                    <div className="p-2 bg-stone-50 rounded-xl text-stone-400 shrink-0">
                                        <ShieldIcon />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-slate-700 truncate">
                                            {backup.label || formatTime(backup.uploaded)}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] text-stone-400">{formatBytes(backup.size)}</span>
                                            <span className="text-[10px] text-stone-300">·</span>
                                            <span className="text-[10px] text-stone-400">{formatTime(backup.uploaded)}</span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => setShowRestoreConfirm(backup.key)}
                                            disabled={downloadingKey === backup.key}
                                            className="p-2 rounded-xl text-emerald-500 hover:bg-emerald-50 active:scale-90 transition-all disabled:opacity-50"
                                            title="恢复此备份"
                                        >
                                            {downloadingKey === backup.key ? <RefreshIcon spinning /> : <DownloadIcon />}
                                        </button>
                                        <button
                                            onClick={() => setShowDeleteConfirm(backup.key)}
                                            className="p-2 rounded-xl text-stone-300 hover:text-red-400 hover:bg-red-50 active:scale-90 transition-all"
                                            title="删除此备份"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Tip */}
                <div className="px-5 pb-4">
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                        备份文件存储在 Cloudflare R2 云端，与本地 ZIP 格式完全兼容。
                        每个账号最多保留 10 个备份，超出后自动清理最旧的版本。
                    </p>
                </div>
            </section>

            {/* ── Restore Confirm Modal ── */}
            <Modal
                isOpen={!!showRestoreConfirm}
                title="恢复云端备份"
                onClose={() => setShowRestoreConfirm(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowRestoreConfirm(null)} className="flex-1 py-3 bg-stone-100 text-stone-600 font-bold rounded-2xl">取消</button>
                        <button onClick={() => showRestoreConfirm && handleRestore(showRestoreConfirm)} className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200">确认恢复</button>
                    </div>
                }
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-500">
                        <DownloadIcon />
                    </div>
                    <p className="text-center text-sm text-slate-600 font-medium leading-relaxed">
                        将从云端下载备份并<span className="text-emerald-600 font-bold">覆盖当前数据</span>，之后系统将自动重启。
                    </p>
                    <p className="text-center text-[10px] text-stone-400">
                        建议在恢复前先创建一份新的云端备份以防万一。
                    </p>
                </div>
            </Modal>

            {/* ── Delete Confirm Modal ── */}
            <Modal
                isOpen={!!showDeleteConfirm}
                title="删除备份"
                onClose={() => setShowDeleteConfirm(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-3 bg-stone-100 text-stone-600 font-bold rounded-2xl">保留</button>
                        <button onClick={() => showDeleteConfirm && handleDelete(showDeleteConfirm)} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">删除</button>
                    </div>
                }
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    <div className="p-3 bg-red-50 rounded-2xl text-red-400">
                        <TrashIcon />
                    </div>
                    <p className="text-center text-sm text-slate-600 font-medium">
                        此操作<span className="text-red-500 font-bold">不可撤销</span>，确定要删除这个备份吗？
                    </p>
                </div>
            </Modal>
        </>
    );
};

export default CloudBackupPanel;
