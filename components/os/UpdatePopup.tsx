import React,{ useState,useEffect } from 'react';

const UPDATE_VERSION_KEY = 'sullyos_update_seen_version';
export const CURRENT_VERSION = 'v2.8.0';

const UPDATE_LOGS = [
    {
        title: '☁️ 云端备份与记忆',
        desc: '新增云端备份与云端记忆功能，对网络代理的要求大幅降低，理论上免梯子环境下也可顺畅使用。'
    },
    {
        title: '🔔 真实主动消息推送',
        desc: '现在只需打开浏览器系统级授权，即可在应用挂后台时接收真实的消息弹窗（仅测试支持 Chrome / Edge）。'
    },
    {
        title: '🧠 认知网络联想进化',
        desc: '完善了记忆调用的联想机制：短期内提取记忆快照，聚集关联语意；长期逐步塑造、沉淀出角色的深度认知。'
    },
    {
        title: '🤣 表情包系统优化',
        desc: '表情面板体验进阶，现在可以直观看到表情包名字，并且大幅提升了根据聊天文字识别自动弹出表情的准度。'
    },
    {
        title: '🎭 线下模式视角选择',
        desc: '沉浸感再升级！原本的线下约会模式新增了“人称视角选择器”，可随心配置你们俩互动的叙事维度。'
    },
    {
        title: '🍉 微博实况吃瓜阵地',
        desc: '打通了真实微博接口！在系统里即可刷热搜，还可以跟 char 随时探讨微博词条，他甚至会自主去搜索吃瓜！'
    },
    {
        title: '📱 桌面级 PWA 全屏',
        desc: '初步上线了 PWA 全屏沉浸显示支持，让它在你的手机和电脑桌面上看起来更像一个真正的原生 App。'
    }
];

interface UpdatePopupProps {
    canShow: boolean; // Control whether it's allowed to show (e.g., after disclaimer)
}

const UpdatePopup: React.FC<UpdatePopupProps> = ({ canShow }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (canShow) {
            try {
                const seenVersion = localStorage.getItem(UPDATE_VERSION_KEY);
                if (seenVersion !== CURRENT_VERSION) {
                    // Delay a tiny bit for smooth transition if needed, avoid stacking animations
                    setTimeout(() => setIsVisible(true), 300);
                }
            } catch (e) {
                setIsVisible(true);
            }
        }
    }, [canShow]);

    const handleClose = () => {
        try {
            localStorage.setItem(UPDATE_VERSION_KEY, CURRENT_VERSION);
        } catch (e) { /* ignore */ }
        setIsVisible(false);
    };

    if (!isVisible || !canShow) return null;

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={handleClose} />
            <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
                {/* Header */}
                <div className="pt-7 pb-4 px-6 text-center">
                    <div className="text-4xl mb-3 animate-bounce">🎊</div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">发现新版本 {CURRENT_VERSION}</h2>
                    </div>
                    <p className="text-[12px] text-slate-400 mt-1 font-medium">SullyOS 更新日志</p>
                </div>

                {/* Content */}
                <div className="px-6 pb-6 max-h-[55vh] overflow-y-auto no-scrollbar space-y-4">
                    {UPDATE_LOGS.map((log, i) => (
                        <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                            <h3 className="text-[14px] font-bold text-slate-800 mb-1.5">{log.title}</h3>
                            <p className="text-[12px] text-slate-500 leading-relaxed font-medium">
                                {log.desc}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-6 pb-7 pt-2">
                    <button
                        onClick={handleClose}
                        className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-transform text-sm tracking-wide"
                    >
                        我知道了，不再提示
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpdatePopup;
