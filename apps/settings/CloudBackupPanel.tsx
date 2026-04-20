
import React,{ useState,useEffect,useCallback } from 'react';
import { useOS } from '../../context/OSContext';
import Modal from '../../components/os/Modal';
import {
  uploadCloudBackup,
  getLatestCloudBackup,
  downloadCloudBackup,
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

function formatFullDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
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

const CheckCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
);

const ClockIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
);


// ─── Component ───────────────────────────────────────────────────────────

const CloudBackupPanel: React.FC = () => {
    const { exportSystem, importSystem, addToast, sysOperation } = useOS();

    const [available, setAvailable] = useState<boolean | null>(null);
    const [latestBackup, setLatestBackup] = useState<CloudBackupMeta | null>(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

    // Check availability on mount
    useEffect(() => {
        isCloudBackupAvailable().then(ok => {
            setAvailable(ok);
            if (ok) refreshLatest();
        });
    }, []);

    const refreshLatest = useCallback(async () => {
        setLoading(true);
        try {
            const latest = await getLatestCloudBackup();
            setLatestBackup(latest);
        } catch (e: any) {
            console.warn('Cloud backup check failed:', e);
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
            await refreshLatest();
        } catch (e: any) {
            addToast(e.message || '上传失败', 'error');
        } finally {
            setUploading(false);
        }
    };

    // ── Download & Restore ───────────────────────────────────────────────

    const handleRestore = async () => {
        if (!latestBackup) return;
        setShowRestoreConfirm(false);
        setDownloading(true);
        try {
            addToast('正在从云端下载...', 'info');
            const file = await downloadCloudBackup(latestBackup.key);
            await importSystem(file);
        } catch (e: any) {
            addToast(e.message || '恢复失败', 'error');
        } finally {
            setDownloading(false);
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

    // ── Backup Status ────────────────────────────────────────────────────

    const isRecent = latestBackup
        ? (Date.now() - new Date(latestBackup.uploaded).getTime()) < 24 * 60 * 60 * 1000
        : false;

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
                                    <span className="text-[10px] text-emerald-600 font-medium">已连接 · 500MB</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={refreshLatest}
                            disabled={loading}
                            className="p-2 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all active:scale-90"
                        >
                            <RefreshIcon spinning={loading} />
                        </button>
                    </div>
                </div>

                {/* Latest Backup Status Card */}
                <div className="px-5 pb-3">
                    {latestBackup ? (
                        <div className="bg-white/80 rounded-2xl border border-stone-100 p-4">
                            {/* Status Badge */}
                            <div className="flex items-center justify-between mb-3">
                                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                                    isRecent
                                        ? 'bg-emerald-50 text-emerald-600'
                                        : 'bg-amber-50 text-amber-600'
                                }`}>
                                    {isRecent ? <CheckCircleIcon /> : <ClockIcon />}
                                    <span>{isRecent ? '已更新' : '待更新'}</span>
                                </div>
                                {latestBackup.label && (
                                    <span className="text-[10px] text-stone-400">{latestBackup.label}</span>
                                )}
                            </div>

                            {/* Info Row */}
                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <div className="text-[10px] text-stone-400 mb-0.5">最近备份</div>
                                    <div className="text-xs font-semibold text-slate-700">
                                        {formatTime(latestBackup.uploaded)}
                                    </div>
                                    <div className="text-[10px] text-stone-400 mt-0.5">
                                        {formatFullDate(latestBackup.uploaded)}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="text-[10px] text-stone-400 mb-0.5">备份大小</div>
                                    <div className="text-xs font-semibold text-slate-700">
                                        {formatBytes(latestBackup.size)}
                                    </div>
                                </div>
                            </div>

                            {/* Restore Button */}
                            <button
                                onClick={() => setShowRestoreConfirm(true)}
                                disabled={downloading}
                                className="w-full mt-3 py-2.5 bg-stone-50 hover:bg-stone-100 rounded-xl text-xs font-semibold text-slate-600 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] disabled:opacity-50"
                            >
                                {downloading ? (
                                    <>
                                        <RefreshIcon spinning />
                                        <span>正在恢复...</span>
                                    </>
                                ) : (
                                    <>
                                        <DownloadIcon />
                                        <span>从云端恢复</span>
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="py-6 text-center">
                            <div className="text-stone-300 mb-2 flex justify-center">
                                <ShieldIcon />
                            </div>
                            <p className="text-xs text-stone-400">暂无云端备份</p>
                            <p className="text-[10px] text-stone-300 mt-1">点击下方按钮创建第一个备份</p>
                        </div>
                    )}
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

                {/* Footer Tip */}
                <div className="px-5 pb-4">
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                        每天自动备份一次，新备份会覆盖旧备份。数据存储在 Cloudflare R2 云端，换设备登录即可恢复。
                    </p>
                </div>
            </section>

            {/* ── Restore Confirm Modal ── */}
            <Modal
                isOpen={showRestoreConfirm}
                title="恢复云端备份"
                onClose={() => setShowRestoreConfirm(false)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setShowRestoreConfirm(false)} className="flex-1 py-3 bg-stone-100 text-stone-600 font-bold rounded-2xl">取消</button>
                        <button onClick={handleRestore} className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200">确认恢复</button>
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
                    {latestBackup && (
                        <p className="text-center text-[10px] text-stone-400">
                            备份时间: {formatFullDate(latestBackup.uploaded)} · {formatBytes(latestBackup.size)}
                        </p>
                    )}
                </div>
            </Modal>
        </>
    );
};

export default CloudBackupPanel;
