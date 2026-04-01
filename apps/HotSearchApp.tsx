import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, ArrowsClockwise, Fire, TrendUp, ArrowSquareOut } from '@phosphor-icons/react';

interface HotItem {
    index: number;
    title: string;
    hot: number;
    url: string;
    desc: string;
}

interface HotlistResponse {
    success: boolean;
    title?: string;
    subtitle?: string;
    update_time?: string;
    type?: string;
    data?: HotItem[];
    error?: string;
    _cached?: boolean;
}

const HotSearchApp: React.FC = () => {
    const { closeApp, theme } = useOS();
    const contentColor = theme.contentColor || '#ffffff';
    
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState<HotlistResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchHotlist = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        
        try {
            // Fetch directly from our Cloudflare Proxy
            // Append timestamp to prevent aggressive browser caching on refresh
            const url = `https://sully-n.sully-tts-proxy.workers.dev/hotlist?type=wbHot${isRefresh ? '&t=' + Date.now() : ''}`;
            const res = await fetch(url);
            
            if (!res.ok) {
                throw new Error(`请求失败 (HTTP ${res.status})`);
            }
            
            const json = await res.json() as HotlistResponse;
            if (!json.success) {
                throw new Error(json.error || '获取数据失败');
            }
            // Sort by index to ensure correct rank order
            if (json.data) {
                json.data.sort((a, b) => a.index - b.index);
            }
            setData(json);
        } catch (err: any) {
            setError(err.message || '网络连接错误');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchHotlist();
    }, [fetchHotlist]);

    const formatHotValue = (num: number) => {
        if (num >= 10000) return (num / 10000).toFixed(1) + '万';
        return num.toString();
    };

    const formatTime = (isoString?: string) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    const getRankStyle = (index: number) => {
        if (index === 1) return 'bg-red-500 text-white shadow-red-500/40 shadow-lg scale-110';
        if (index === 2) return 'bg-orange-500 text-white shadow-orange-500/30 shadow-md scale-105';
        if (index === 3) return 'bg-amber-500 text-white shadow-amber-500/20 shadow-md scale-100';
        return 'bg-white/10 text-white/70 font-semibold';
    };

    const handleOpenLink = (url: string) => {
        window.open(url, '_blank');
    };

    return (
        <div className="h-full w-full flex flex-col font-sans animate-fade-in relative overflow-hidden bg-slate-900 absolute inset-0 text-white pb-[env(safe-area-inset-bottom)]">
            {/* Background Decorations */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-red-500/10 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-orange-500/10 rounded-full blur-[80px] pointer-events-none translate-y-1/2 -translate-x-1/4"></div>

            {/* Header */}
            <div className="flex-none pt-12 pb-4 px-4 bg-slate-900/80 backdrop-blur-2xl border-b border-white/5 z-20 sticky top-0">
                <div className="flex items-center justify-between">
                    <button
                        onClick={closeApp}
                        className="p-2 rounded-full hover:bg-white/10 active:bg-white/20 transition-all text-white/80 shrink-0"
                    >
                        <CaretLeft className="w-6 h-6" />
                    </button>
                    
                    <div className="flex flex-col items-center justify-center min-w-0 px-4">
                        <div className="flex items-center gap-2">
                            <TrendUp weight="bold" className="text-orange-400 w-5 h-5" />
                            <h2 className="text-lg font-bold tracking-wider text-white truncate">
                                实时热搜
                            </h2>
                        </div>
                        <div className="text-[10px] font-medium opacity-50 tracking-widest uppercase flex items-center gap-1">
                            {refreshing ? 'Updating...' : data?._cached ? 'Cached' : 'Live'}
                            {data?.update_time && !loading && !refreshing && (
                                <> • {formatTime(data.update_time)}</>
                            )}
                        </div>
                    </div>
                    
                    <button
                        onClick={() => fetchHotlist(true)}
                        disabled={loading || refreshing}
                        className={`p-2 rounded-full transition-all shrink-0 ${loading || refreshing ? 'opacity-50' : 'hover:bg-white/10 active:bg-white/20 text-white/80'}`}
                    >
                        <ArrowsClockwise className={`w-5 h-5 ${(loading || refreshing) ? 'animate-spin text-orange-400' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar pb-32 z-10">
                {loading && !data ? (
                    <div className="flex flex-col items-center justify-center p-12 h-[60vh] text-center opacity-60">
                        <div className="w-12 h-12 border-4 border-white/20 border-t-orange-500 rounded-full animate-spin mb-4"></div>
                        <p className="text-sm font-medium tracking-widest">Loading Trends...</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center p-8 h-[60vh] text-center">
                        <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mb-4">
                            <Fire weight="fill" className="w-8 h-8 opacity-50" />
                        </div>
                        <p className="text-red-300 font-medium mb-4">{error}</p>
                        <button 
                            onClick={() => fetchHotlist(true)}
                            className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm font-bold tracking-widest transition-all active:scale-95"
                        >
                            RETRY
                        </button>
                    </div>
                ) : (
                    <div className="px-4 py-4 space-y-3">
                        {data?.data?.map((item) => (
                            <div 
                                key={item.index}
                                onClick={() => handleOpenLink(item.url)}
                                className="group relative flex items-center p-4 bg-white/[0.03] hover:bg-white/[0.06] active:bg-white/[0.08] backdrop-blur-md rounded-2xl border border-white/[0.05] transition-all cursor-pointer overflow-hidden"
                            >
                                {/* Rank Number */}
                                <div className="w-12 shrink-0 flex justify-center items-center">
                                    <div className={`w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-all ${getRankStyle(item.index)}`}>
                                        {item.index}
                                    </div>
                                </div>
                                
                                {/* Content */}
                                <div className="flex-1 min-w-0 pl-3 pr-2 flex flex-col justify-center">
                                    <div className="flex items-start gap-2 mb-1.5">
                                        <span className="text-[15px] font-medium text-white/90 leading-snug group-hover:text-white transition-colors">
                                            {item.title}
                                        </span>
                                        {item.desc && (
                                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold leading-none mt-0.5 ${
                                                item.desc === '新' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                                                item.desc === '沸' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 
                                                item.desc === '爆' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 
                                                'bg-white/10 text-white/50 border border-white/10'
                                            }`}>
                                                {item.desc}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-white/40 font-medium">
                                        <Fire weight="fill" className={`w-3.5 h-3.5 ${item.index <= 3 ? 'text-orange-400/80' : 'opacity-60'}`} />
                                        {formatHotValue(item.hot)}
                                    </div>
                                </div>
                                
                                {/* Right Arrow */}
                                <div className="w-8 shrink-0 flex justify-end opacity-0 group-hover:opacity-40 transition-opacity">
                                    <ArrowSquareOut className="w-4 h-4" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HotSearchApp;
