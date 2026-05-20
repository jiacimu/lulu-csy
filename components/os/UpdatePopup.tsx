import React,{ useState,useEffect } from 'react';

const UPDATE_VERSION_KEY = 'sullyos_update_seen_version';
export const CURRENT_VERSION = 'v2.10.0';

const UPDATE_LOGS = [
    {
        title: '520 特别更新 · 约会功能上线',
        desc: '聊天框里的喜欢，终于有了可以抵达的地方。\n\n现在，你可以和他一起进入线下地图，像乙游约会一样，在不同地点触发属于你们的互动。'
    },
    {
        title: '5.20 Csy 特别功能 · 轨迹正式上线',
        desc: '回到过去的时间节点看看他，看看那些你们还未曾相遇的日子。\n\n一个人不是从被看见的那一刻才开始存在的。在遇见你之前，他也已经独自活过很久了。\n\n现在，你可以回去看看那些日子，回头看看他原本走过的路，也可以看见自己是从什么时候开始，慢慢进入他的人生。'
    },
    {
        title: '5.21 Csy 特别功能 · 对影',
        desc: '这是同一个人，在不同时间里的相逢。\n\n也是你第一次如此清楚地看见——原来他并不是突然变成了今天的样子。\n\n也看他们在某一瞬间忽然意识到：原来某个人，真的让命运偏离过原本的方向。\n\n举杯邀明月，对影成几人。'
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
                    <div className="text-4xl mb-3 animate-bounce">💌</div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">发现新版本 {CURRENT_VERSION}</h2>
                    </div>
                    <p className="text-[12px] text-slate-400 mt-1 font-medium">520 特别更新 · Csy 二改糯米机</p>
                </div>

                {/* Content */}
                <div className="px-6 pb-6 max-h-[55vh] overflow-y-auto no-scrollbar space-y-4">
                    {UPDATE_LOGS.map((log, i) => (
                        <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                            <h3 className="text-[14px] font-bold text-slate-800 mb-1.5">{log.title}</h3>
                            <p className="text-[12px] text-slate-500 leading-relaxed font-medium whitespace-pre-line">
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
