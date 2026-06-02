import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../os/Modal';
import {
    checkWeixinQrStatus,
    generateWeixinQr,
    getWeixinReadiness,
    listWeixinBindings,
    repairWeixinClientBinding,
    type WeixinBinding,
    type WeixinBindingStatus,
    type WeixinQrResponse,
    type WeixinQrStatus,
} from '../../utils/backendClient';
import { DB } from '../../utils/db';

interface CharacterWeixinBindingCardProps {
    charId: string;
    charName: string;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type BindingLoadState = 'loading' | 'ready' | 'error';
type RepairState = 'idle' | 'checking' | 'repairing' | 'repaired' | 'conflict' | 'error';

const DEFAULT_REPAIR_LOOKBACK_DAYS = 7;
const WEIXIN_REPAIR_SUCCESS_MESSAGE = '已把最近微信记录同步到这台小手机';
const WEIXIN_REPAIR_CONFLICT_MESSAGE = '这条微信绑定已属于另一台设备，重新扫码可切换到当前设备';

function buildQrCodeServiceCandidates(rawValue: string): string[] {
    const encoded = encodeURIComponent(rawValue);
    return [
        `https://quickchart.io/qr?text=${encoded}&size=320`,
        `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encoded}`,
    ];
}

function isLikelyDirectImageUrl(source: string): boolean {
    try {
        const url = new URL(source);
        return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(url.pathname);
    } catch {
        return false;
    }
}

function resolveQrImageCandidates(source: string | null | undefined): string[] {
    const trimmed = source?.trim();
    if (!trimmed) {
        return [];
    }

    if (
        trimmed.startsWith('data:')
        || trimmed.startsWith('blob:')
    ) {
        return [trimmed];
    }

    if (/^<svg[\s>]/i.test(trimmed)) {
        return [`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(trimmed)}`];
    }

    const compact = trimmed.replace(/\s+/g, '');
    if (
        compact.startsWith('iVBOR')
        || compact.startsWith('/9j/')
        || compact.startsWith('R0lGOD')
        || compact.startsWith('UklGR')
        || /^[A-Za-z0-9+/=]+$/.test(compact)
    ) {
        return [`data:image/png;base64,${compact}`];
    }

    if (/^(https?:)?\/\//i.test(trimmed)) {
        return isLikelyDirectImageUrl(trimmed)
            ? [trimmed]
            : buildQrCodeServiceCandidates(trimmed);
    }

    return buildQrCodeServiceCandidates(trimmed);
}

function getBindingSummary(binding: WeixinBinding | null, loadState: BindingLoadState, errorMessage: string): {
    title: string;
    subtitle: string;
    badge: string;
    badgeClassName: string;
    buttonLabel: string;
} {
    if (loadState === 'loading') {
        return {
            title: '正在读取微信连接状态',
            subtitle: '稍等一下，我在确认这个角色有没有连上真实微信',
            badge: '读取中',
            badgeClassName: 'bg-slate-100 text-slate-500',
            buttonLabel: '稍候',
        };
    }

    if (loadState === 'error') {
        return {
            title: '暂时没读到微信状态',
            subtitle: errorMessage || '你依然可以直接打开二维码重新扫码',
            badge: '异常',
            badgeClassName: 'bg-rose-50 text-rose-500',
            buttonLabel: '重新获取',
        };
    }

    if (!binding) {
        return {
            title: '还没绑定真实微信',
            subtitle: '打开二维码后，用微信扫码把这个角色接到真实消息链路里',
            badge: '未绑定',
            badgeClassName: 'bg-amber-50 text-amber-600',
            buttonLabel: '打开扫码',
        };
    }

    const statusMap: Record<WeixinBindingStatus, {
        title: string;
        subtitle: string;
        badge: string;
        badgeClassName: string;
        buttonLabel: string;
    }> = {
        active: {
            title: binding.weixinBotName ? `${binding.weixinBotName} 已连接` : '真实微信已连接',
            subtitle: '如果你想换号或补登一次，直接重新打开二维码就行',
            badge: '已连接',
            badgeClassName: 'bg-emerald-50 text-emerald-600',
            buttonLabel: '重新扫码',
        },
        disconnected: {
            title: '微信连接已断开',
            subtitle: 'Bridge 侧看起来已经掉线了，重新扫码最稳',
            badge: '已断开',
            badgeClassName: 'bg-rose-50 text-rose-500',
            buttonLabel: '重新扫码',
        },
        login_required: {
            title: '需要重新登录微信',
            subtitle: '原有登录态失效了，重新扫一次码就能续上',
            badge: '待重登',
            badgeClassName: 'bg-amber-50 text-amber-600',
            buttonLabel: '重新扫码',
        },
        disabled: {
            title: '微信绑定已停用',
            subtitle: '重新扫一次码可以重新激活这条连接',
            badge: '已停用',
            badgeClassName: 'bg-slate-100 text-slate-500',
            buttonLabel: '重新扫码',
        },
    };

    return statusMap[binding.status] || statusMap.login_required;
}

function getQrStatusText(status: WeixinQrStatus | 'idle' | 'generating' | 'error', errorMessage: string): string {
    switch (status) {
        case 'generating':
            return '正在生成微信二维码...';
        case 'scaned':
            return '手机已经扫到码了，请继续在微信里确认登录。';
        case 'confirmed':
            return '绑定完成，这个角色已经接上真实微信。';
        case 'expired':
            return '这张二维码已经过期了，重新生成一张新的就行。';
        case 'error':
            return errorMessage || '二维码流程出错了，可以直接重新生成。';
        case 'wait':
        case 'idle':
        default:
            return '请用微信扫一扫，扫码后继续在手机里确认登录。';
    }
}

function getRepairStateText(repairState: RepairState): string {
    switch (repairState) {
        case 'checking':
            return '正在确认这台小手机的微信同步状态。';
        case 'repairing':
            return '正在自动同步最近微信记录。';
        case 'repaired':
            return WEIXIN_REPAIR_SUCCESS_MESSAGE;
        case 'conflict':
            return WEIXIN_REPAIR_CONFLICT_MESSAGE;
        case 'error':
            return '微信历史同步暂时没完成，稍后打开这里会再试一次。';
        case 'idle':
        default:
            return '';
    }
}

function getRepairStateClassName(repairState: RepairState): string {
    if (repairState === 'conflict') {
        return 'bg-amber-50/80 border-amber-100 text-amber-700';
    }

    if (repairState === 'error') {
        return 'bg-rose-50/80 border-rose-100 text-rose-600';
    }

    return 'bg-emerald-50/70 border-emerald-100 text-emerald-700';
}

const CharacterWeixinBindingCard: React.FC<CharacterWeixinBindingCardProps> = memo(({
    charId,
    charName,
    addToast,
}) => {
    const [binding, setBinding] = useState<WeixinBinding | null>(null);
    const [loadState, setLoadState] = useState<BindingLoadState>('loading');
    const [loadError, setLoadError] = useState('');
    const [repairState, setRepairState] = useState<RepairState>('idle');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [qrPayload, setQrPayload] = useState<WeixinQrResponse | null>(null);
    const [qrStatus, setQrStatus] = useState<WeixinQrStatus | 'idle' | 'generating' | 'error'>('idle');
    const [qrError, setQrError] = useState('');
    const [qrImageIndex, setQrImageIndex] = useState(0);
    const [qrImageLoadError, setQrImageLoadError] = useState(false);
    const pollTimerRef = useRef<number | null>(null);

    const clearPollTimer = useCallback(() => {
        if (pollTimerRef.current !== null) {
            window.clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const resetQrState = useCallback(() => {
        clearPollTimer();
        setQrPayload(null);
        setQrStatus('idle');
        setQrError('');
        setQrImageIndex(0);
        setQrImageLoadError(false);
    }, [clearPollTimer]);

    const runAutoRepairIfNeeded = useCallback(async (nextBinding: WeixinBinding | null): Promise<boolean> => {
        if (nextBinding?.status !== 'active') {
            setRepairState('idle');
            return false;
        }

        setRepairState('checking');

        try {
            const readiness = await getWeixinReadiness(charId);
            const repair = readiness.repair;

            if (repair?.conflict) {
                setRepairState('conflict');
                addToast(WEIXIN_REPAIR_CONFLICT_MESSAGE, 'info');
                return false;
            }

            if (repair?.needed && repair.available) {
                setRepairState('repairing');
                const repairResult = await repairWeixinClientBinding(charId, DEFAULT_REPAIR_LOOKBACK_DAYS);

                if (repairResult.conflict || repairResult.repair?.conflict) {
                    setRepairState('conflict');
                    addToast(WEIXIN_REPAIR_CONFLICT_MESSAGE, 'info');
                    return false;
                }

                setRepairState('repaired');
                addToast(WEIXIN_REPAIR_SUCCESS_MESSAGE, 'success');
                return true;
            }

            setRepairState('idle');
            return false;
        } catch (error) {
            console.warn('[Weixin] Auto repair failed', error);
            setRepairState('error');
            return false;
        }
    }, [addToast, charId]);

    const refreshBinding = useCallback(async (options?: { silent?: boolean }) => {
        if (!options?.silent) {
            setLoadState('loading');
            setLoadError('');
        }

        try {
            const bindings = await listWeixinBindings();
            const contentCharId = await DB.resolveCharacterContentId(charId);
            const nextBinding = bindings.find(item => item.charId === contentCharId || item.charId === charId) || null;
            setBinding(nextBinding);
            setLoadState('ready');
            setLoadError('');

            const repaired = await runAutoRepairIfNeeded(nextBinding);
            if (repaired) {
                try {
                    const refreshedBindings = await listWeixinBindings();
                    const refreshedBinding = refreshedBindings.find(
                        item => item.charId === contentCharId || item.charId === charId,
                    ) || null;
                    setBinding(refreshedBinding);
                } catch (error) {
                    console.warn('[Weixin] Binding refresh after repair failed', error);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : '微信状态读取失败';
            setBinding(null);
            setLoadState('error');
            setLoadError(message);
            setRepairState('idle');
        }
    }, [charId, runAutoRepairIfNeeded]);

    const startQrFlow = useCallback(async () => {
        setIsModalOpen(true);
        clearPollTimer();
        setQrPayload(null);
        setQrStatus('generating');
        setQrError('');
        setQrImageIndex(0);
        setQrImageLoadError(false);

        try {
            const nextPayload = await generateWeixinQr(charId, charName.trim() || '未命名角色');
            setQrPayload(nextPayload);
            setQrStatus('wait');
        } catch (error) {
            const message = error instanceof Error ? error.message : '二维码生成失败';
            setQrStatus('error');
            setQrError(message);
            addToast(message, 'error');
        }
    }, [addToast, charId, charName, clearPollTimer]);

    const handlePrimaryAction = useCallback(() => {
        if (loadState === 'error') {
            void refreshBinding();
            return;
        }

        void startQrFlow();
    }, [loadState, refreshBinding, startQrFlow]);

    const handleCloseModal = useCallback(() => {
        setIsModalOpen(false);
        resetQrState();
    }, [resetQrState]);

    useEffect(() => {
        setIsModalOpen(false);
        setRepairState('idle');
        resetQrState();
        void refreshBinding();
    }, [charId, refreshBinding, resetQrState]);

    useEffect(() => () => {
        clearPollTimer();
    }, [clearPollTimer]);

    useEffect(() => {
        if (!isModalOpen || !qrPayload?.qrcode) {
            return;
        }

        let active = true;

        const pollStatus = async () => {
            try {
                const result = await checkWeixinQrStatus(qrPayload.qrcode);
                if (!active) return;

                const nextStatus = result.status || 'wait';
                setQrStatus(nextStatus);
                setQrError('');

                if (nextStatus === 'confirmed') {
                    await refreshBinding({ silent: true });
                    if (!active) return;
                    addToast('微信绑定成功，现在可以在 staging 里继续测试了', 'success');
                    return;
                }

                if (nextStatus === 'expired') {
                    return;
                }

                pollTimerRef.current = window.setTimeout(
                    pollStatus,
                    nextStatus === 'scaned' ? 1200 : 2200,
                );
            } catch (error) {
                if (!active) return;
                const message = error instanceof Error ? error.message : '二维码状态检查失败';
                setQrStatus('error');
                setQrError(message);
            }
        };

        pollTimerRef.current = window.setTimeout(pollStatus, 1600);

        return () => {
            active = false;
            clearPollTimer();
        };
    }, [addToast, clearPollTimer, isModalOpen, qrPayload?.qrcode, refreshBinding]);

    const summary = getBindingSummary(binding, loadState, loadError);
    const qrImageCandidates = resolveQrImageCandidates(qrPayload?.qrcodeImgUrl || qrPayload?.qrcode);
    const qrImageSrc = qrImageCandidates[qrImageIndex] || null;
    const qrStatusText = getQrStatusText(qrStatus, qrError);
    const qrPanelHint = qrImageLoadError
        ? '二维码图片服务暂时没响应，请点下方“重新生成”再试一次。'
        : qrStatusText;
    const repairStateText = getRepairStateText(repairState);
    const repairStateClassName = getRepairStateClassName(repairState);

    return (
        <>
            <div className="bg-white rounded-3xl p-5 shadow-sm border border-white/70">
                <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-3 block">
                    微信绑定
                </label>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="text-sm font-medium text-slate-700 truncate">
                                {summary.title}
                            </div>
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${summary.badgeClassName}`}>
                                {summary.badge}
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-400 leading-relaxed">
                            {summary.subtitle}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handlePrimaryAction}
                        disabled={loadState === 'loading'}
                        className="shrink-0 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-3 py-2 rounded-full hover:bg-emerald-100 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {summary.buttonLabel}
                    </button>
                </div>
                <div className="mt-3 text-[10px] text-slate-400 leading-relaxed">
                    扫码成功后，真实微信消息会通过 staging 的 bridge 接到这个角色身上。
                </div>
                {repairStateText && (
                    <div
                        className={`mt-3 rounded-2xl border px-3 py-2 text-[10px] leading-relaxed ${repairStateClassName}`}
                        aria-live="polite"
                    >
                        {repairStateText}
                    </div>
                )}
            </div>

            <Modal
                isOpen={isModalOpen}
                title="微信扫码绑定"
                onClose={handleCloseModal}
                footer={(
                    <>
                        <button
                            type="button"
                            onClick={handleCloseModal}
                            className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
                        >
                            关闭
                        </button>
                        <button
                            type="button"
                            onClick={() => void startQrFlow()}
                            className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-2xl active:scale-95 transition-transform"
                        >
                            重新生成
                        </button>
                    </>
                )}
            >
                <div className="space-y-4">
                    <div className="text-center">
                        <div className="text-sm font-semibold text-slate-700">
                            {charName || '这个角色'}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                            打开微信扫一扫，扫完后别关这个窗口，等它自动确认就行。
                        </div>
                    </div>

                    <div className="bg-slate-50 rounded-[2rem] border border-slate-100 p-4">
                        <div className="aspect-square w-full rounded-[1.5rem] bg-white border border-slate-100 overflow-hidden flex items-center justify-center">
                            {qrImageSrc && !qrImageLoadError ? (
                                <img
                                    src={qrImageSrc}
                                    alt="微信扫码二维码"
                                    className="w-full h-full object-contain"
                                    onError={() => {
                                        if (qrImageIndex + 1 < qrImageCandidates.length) {
                                            setQrImageIndex(current => current + 1);
                                            return;
                                        }
                                        setQrImageLoadError(true);
                                    }}
                                />
                            ) : (
                                <div className="text-center px-4">
                                    <div className="w-8 h-8 mx-auto mb-3 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
                                    <div className="text-[11px] text-slate-400">{qrPanelHint}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 px-4 py-3">
                        <div className="text-[12px] font-semibold text-emerald-700">当前状态</div>
                        <div className="text-[11px] text-emerald-700/80 leading-relaxed mt-1">
                            {qrPanelHint}
                        </div>
                    </div>

                    {qrPayload?.qrcode && (
                        <div className="text-[10px] text-slate-400 break-all bg-slate-50 rounded-2xl px-3 py-2 border border-slate-100">
                            二维码 ID：{qrPayload.qrcode}
                        </div>
                    )}
                </div>
            </Modal>
        </>
    );
});

CharacterWeixinBindingCard.displayName = 'CharacterWeixinBindingCard';

export default CharacterWeixinBindingCard;
