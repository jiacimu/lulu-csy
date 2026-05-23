import React from 'react';
import {
    BatteryHigh,
    CalendarDots,
    CaretLeft,
    CellSignalFull,
    ChatCircleText,
    Clock,
    EnvelopeSimple,
    GearSix,
    GlobeHemisphereWest,
    Heartbeat,
    ImageSquare,
    MapTrifold,
    MusicNotes,
    NotePencil,
    Plus,
    Wallet,
    WifiHigh,
} from '@phosphor-icons/react';

export type StoryPhoneAppId = string;

export interface PhoneAppDef {
    id: StoryPhoneAppId;
    name: string;
    icon: string;
    color: string;
    prompt: string;
    isCustom?: boolean;
}

export interface PhoneClueItem {
    label: string;
    value: string;
    detail?: string;
}

export interface PhoneClue {
    appId: StoryPhoneAppId;
    appName: string;
    title: string;
    subtitle?: string;
    timestamp?: string;
    items: PhoneClueItem[];
    evidenceText: string;
    insertSummary: string;
}

export const PHONE_APPS: PhoneAppDef[] = [
    { id: 'messages', name: '信息', icon: '💬', color: 'from-emerald-400 to-green-600', prompt: '生成一段手机聊天/未发送消息/置顶会话线索。' },
    { id: 'notes', name: '备忘录', icon: '📝', color: 'from-amber-200 to-yellow-500', prompt: '生成一条备忘录、清单或私密随手记。' },
    { id: 'photos', name: '相册', icon: '🖼️', color: 'from-fuchsia-300 to-sky-400', prompt: '生成几张相册缩略图的文字描述，像用户翻到了相册最近项目。' },
    { id: 'calendar', name: '日历', icon: '📅', color: 'from-red-400 to-rose-600', prompt: '生成一个日历提醒、纪念日、行程或被隐藏的预约。' },
    { id: 'browser', name: '浏览器', icon: '🌐', color: 'from-blue-400 to-cyan-500', prompt: '生成近期搜索记录、浏览历史或未关闭网页标题。' },
    { id: 'music', name: '音乐', icon: '🎵', color: 'from-rose-400 to-pink-600', prompt: '生成最近循环、收藏歌词、歌单或播放记录。' },
    { id: 'maps', name: '地图', icon: '🧭', color: 'from-indigo-400 to-violet-600', prompt: '生成最近去过的地点、收藏地点或路线记录。' },
    { id: 'clock', name: '时钟', icon: '⏰', color: 'from-slate-600 to-slate-900', prompt: '生成闹钟、倒计时或某个异常时间提醒。' },
    { id: 'wallet', name: '钱包', icon: '💳', color: 'from-lime-400 to-emerald-600', prompt: '生成转账、订单付款、票据或余额变化线索。' },
    { id: 'mail', name: '邮件', icon: '✉️', color: 'from-sky-400 to-blue-600', prompt: '生成一封邮件标题、草稿或通知摘要。' },
    { id: 'health', name: '健康', icon: '♡', color: 'from-teal-300 to-emerald-500', prompt: '生成睡眠、步数、心率、用药或情绪记录线索。' },
    { id: 'settings', name: '设置', icon: '⚙️', color: 'from-zinc-400 to-zinc-700', prompt: '生成手机设置页里暴露的壁纸、专注模式、联系人备注或隐私状态。' },
];

export const pickRandomPhoneApp = (apps: PhoneAppDef[] = PHONE_APPS) => apps[Math.floor(Math.random() * apps.length)] || PHONE_APPS[0];

export function getStoryPhoneAppById(appId?: string, apps: PhoneAppDef[] = PHONE_APPS): PhoneAppDef | undefined {
    return apps.find(app => app.id === appId) || PHONE_APPS.find(app => app.id === appId);
}

type StoryPhoneIcon = React.ComponentType<{
    className?: string;
    size?: number | string;
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}>;

const APP_ICON_MAP: Record<string, StoryPhoneIcon> = {
    messages: ChatCircleText,
    notes: NotePencil,
    photos: ImageSquare,
    calendar: CalendarDots,
    browser: GlobeHemisphereWest,
    music: MusicNotes,
    maps: MapTrifold,
    clock: Clock,
    wallet: Wallet,
    mail: EnvelopeSimple,
    health: Heartbeat,
    settings: GearSix,
};

const DOCK_APP_IDS = ['messages', 'mail', 'maps', 'settings'];

function renderAppGlyph(app: PhoneAppDef, className: string) {
    const Icon = APP_ICON_MAP[app.id];
    if (Icon) {
        return <Icon weight="regular" className={className} />;
    }
    const emojiSizeClass = className.includes('h-9')
        ? 'text-[2rem]'
        : className.includes('h-7')
            ? 'text-[1.55rem]'
            : className.includes('h-6')
                ? 'text-[1.35rem]'
                : 'text-[1.1rem]';
    return <span className={`${className} flex items-center justify-center leading-none ${emojiSizeClass}`}>{app.icon}</span>;
}

function getWallpaperStyle(wallpaper?: string): React.CSSProperties {
    const fallback = 'linear-gradient(145deg, #f7f8f5 0%, #eef0ef 48%, #dfe3e1 100%)';
    const value = wallpaper || fallback;
    if (value.startsWith('linear-gradient') || value.startsWith('radial-gradient')) {
        return { background: value };
    }
    return {
        backgroundImage: `url(${value})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    };
}

interface StoryPhoneScreenProps {
    charName: string;
    charAvatar?: string;
    wallpaper?: string;
    apps?: PhoneAppDef[];
    activeAppId: StoryPhoneAppId | 'home';
    spotlightApp?: PhoneAppDef;
    clue?: PhoneClue | null;
    isLoading?: boolean;
    inserted?: boolean;
    compact?: boolean;
    currentTime?: string;
    onBackHome?: () => void;
    onOpenApp?: (app: PhoneAppDef) => void;
    onGenerateApp?: (app: PhoneAppDef) => void;
    onInstallApp?: () => void;
    onUninstallApp?: (app: PhoneAppDef) => void;
    onPeekOnly?: () => void;
    onInsertContext?: () => void;
}

const StoryPhoneScreen: React.FC<StoryPhoneScreenProps> = ({
    charName,
    charAvatar,
    wallpaper,
    apps = PHONE_APPS,
    activeAppId,
    spotlightApp = PHONE_APPS[0],
    clue,
    isLoading = false,
    inserted = false,
    compact = false,
    currentTime,
    onBackHome,
    onOpenApp,
    onGenerateApp,
    onInstallApp,
    onUninstallApp,
    onPeekOnly,
    onInsertContext,
}) => {
    const phoneApps = apps.length > 0 ? apps : PHONE_APPS;
    const currentApp = activeAppId === 'home' ? undefined : getStoryPhoneAppById(activeAppId, phoneApps);
    const timeLabel = currentTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const hasActions = Boolean(clue && clue.appId === activeAppId && !isLoading && (onPeekOnly || onInsertContext));
    const dockApps = DOCK_APP_IDS.map(appId => getStoryPhoneAppById(appId, phoneApps)).filter((app): app is PhoneAppDef => Boolean(app)).slice(0, 4);
    const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    const frameClass = compact
        ? 'relative aspect-[9/16] w-full rounded-[1.75rem] bg-[#050506] p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.22)] ring-1 ring-black/10'
        : 'relative h-full max-h-[45rem] min-h-[34rem] w-full rounded-[2.65rem] bg-[#050506] p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.48)] ring-1 ring-white/10';
    const notchClass = compact
        ? 'absolute left-1/2 top-2 z-30 h-3.5 w-20 -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
        : 'absolute left-1/2 top-4 z-30 h-6 w-[7.5rem] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_10px_24px_rgba(0,0,0,0.28)]';
    const screenRadius = compact ? 'rounded-[1.28rem]' : 'rounded-[2rem]';

    return (
        <div className={frameClass}>
            <div className={notchClass} />
            <div className={`relative h-full overflow-hidden ${screenRadius} bg-[#eef0ef]`} style={getWallpaperStyle(wallpaper)}>
                <div className="absolute inset-0 bg-[#eef0ef]/65" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_6%,rgba(255,255,255,0.78),transparent_34%),radial-gradient(circle_at_92%_70%,rgba(209,213,210,0.34),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.28),rgba(238,240,239,0.68))]" />
                <div className="pointer-events-none absolute -right-8 top-40 h-36 w-24 rotate-12 border border-[#b9b6ac]/15 bg-white/20" />
                <div className="pointer-events-none absolute bottom-28 left-4 h-px w-28 bg-[#9b927f]/18" />
                <div className="relative z-10 flex h-full flex-col">
                    <div className={`flex items-center justify-between text-[#3e4245] ${compact ? 'h-7 px-4 pt-1 text-[8px] font-semibold' : 'h-12 px-6 pt-2 text-[12px] font-bold'}`}>
                        <span>{timeLabel}</span>
                        <div className="flex items-center gap-1.5 text-[#3e4245]/80">
                            <CellSignalFull weight="fill" className={compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
                            <WifiHigh weight="bold" className={compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
                            <span>5G</span>
                            <BatteryHigh weight="fill" className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                        </div>
                    </div>

                    {activeAppId === 'home' ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <div className={compact ? 'px-4 pb-2 pt-2' : 'px-5 pb-2 pt-2'}>
                                <div className={`relative overflow-hidden border border-[rgba(120,120,120,0.18)] bg-white/70 text-[#3e4245] shadow-[0_14px_30px_rgba(64,69,71,0.08),inset_0_1px_0_rgba(255,255,255,0.82)] ${compact ? 'rounded-2xl px-3 py-2.5' : 'rounded-[1.55rem] px-4 py-2.5'}`}>
                                    <div className="pointer-events-none absolute -right-3 -top-2 h-8 w-16 rotate-6 bg-[#d8d2c6]/45 shadow-[inset_0_0_0_1px_rgba(120,120,120,0.08)]" />
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className={compact ? 'text-[10px] font-medium text-[#3e4245]/55' : 'text-[11px] font-medium text-[#3e4245]/55'}>{dateLabel}</div>
                                            <div className={compact ? 'mt-1 text-base font-semibold leading-tight' : 'mt-1 text-[1.55rem] font-semibold leading-none'}>{charName}</div>
                                            <div className={compact ? 'mt-1 text-[9px] text-[#3e4245]/55' : 'mt-1.5 text-[11px] text-[#3e4245]/60'}>刚刚留下的痕迹，还停在屏幕上。</div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className={compact ? 'text-xl font-light leading-none' : 'text-[2.15rem] font-light leading-none tracking-normal'}>{timeLabel}</div>
                                            <div className={compact ? 'mt-1 text-[8px] text-[#3e4245]/42' : 'mt-2 text-[11px] text-[#3e4245]/45'}>主题桌面</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={`grid grid-cols-[0.88fr_1.12fr] gap-3 ${compact ? 'px-4 pb-1 pt-1' : 'px-5 pb-2 pt-2'}`}>
                                <div className={`relative flex items-center justify-center ${compact ? 'min-h-[7rem]' : 'min-h-[7.8rem]'}`}>
                                    <div className={`absolute rotate-[-5deg] rounded-[1.1rem] border border-[rgba(120,120,120,0.16)] bg-white/75 shadow-[0_12px_26px_rgba(64,69,71,0.09)] ${compact ? 'h-20 w-20' : 'h-24 w-24'}`} />
                                    <div className={`relative flex items-center justify-center overflow-hidden rounded-full border border-white/80 bg-[#f3f4f2] shadow-[0_16px_28px_rgba(64,69,71,0.11),inset_0_0_0_7px_rgba(255,255,255,0.58)] ${compact ? 'h-20 w-20' : 'h-24 w-24'}`}>
                                        {charAvatar ? (
                                            <img src={charAvatar} className="h-full w-full object-cover grayscale-[35%] contrast-[0.92] saturate-[0.55]" alt={charName} />
                                        ) : (
                                            <ChatCircleText weight="regular" className={compact ? 'h-8 w-8 text-[#62676b]' : 'h-11 w-11 text-[#62676b]'} />
                                        )}
                                    </div>
                                    {!compact && (
                                        <div className="absolute bottom-0 left-1 -rotate-3 border border-[rgba(120,120,120,0.12)] bg-[#f8f6f1]/90 px-2.5 py-1 text-[9px] font-medium text-[#3e4245]/62 shadow-sm">
                                            记得按时吃饭。
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => onGenerateApp?.(spotlightApp)}
                                    className={`group relative overflow-hidden border border-[rgba(120,120,120,0.18)] bg-white/72 text-left text-[#3e4245] shadow-[0_14px_28px_rgba(64,69,71,0.09),inset_0_1px_0_rgba(255,255,255,0.82)] active:scale-[0.985] ${compact ? 'rounded-2xl p-3' : 'rounded-[1.35rem] p-3'}`}
                                    aria-label={`读取 ${spotlightApp.name}`}
                                >
                                    <div className="pointer-events-none absolute right-2 top-2 h-7 w-10 rotate-12 bg-[#ded8cb]/45 shadow-[inset_0_0_0_1px_rgba(120,120,120,0.08)]" />
                                    <div className={compact ? 'text-[10px] font-semibold text-[#3e4245]/68' : 'text-sm font-semibold tracking-wide text-[#3e4245]'}>
                                        最后停留
                                    </div>
                                    <div className="mt-2.5 flex items-center gap-3">
                                        <span className={`relative flex shrink-0 items-center justify-center rounded-full border border-[#8b8f91]/22 bg-[#f3f4f2] text-[#62676b] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] ${compact ? 'h-10 w-10' : 'h-12 w-12'}`}>
                                            {renderAppGlyph(spotlightApp, compact ? 'h-5 w-5 text-[#62676b]' : 'h-6 w-6 text-[#62676b]')}
                                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#a76666] shadow-[0_0_0_2px_rgba(255,255,255,0.8)]" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className={compact ? 'block truncate text-[11px] font-semibold' : 'block truncate text-[13px] font-semibold'}>{spotlightApp.name} · {timeLabel}</span>
                                            <span className={compact ? 'mt-1 line-clamp-2 block text-[9px] leading-relaxed text-[#3e4245]/58' : 'mt-1 line-clamp-2 block text-[10px] leading-relaxed text-[#3e4245]/60'}>
                                                他来不及藏好的东西，停在这里。
                                            </span>
                                        </span>
                                    </div>
                                    <div className={compact ? 'mt-3 border-t border-[#8b8f91]/14 pt-2 text-[8px] text-[#3e4245]/36' : 'mt-3 border-t border-[#8b8f91]/14 pt-2 text-[10px] text-[#3e4245]/36'}>昨晚 23:07</div>
                                </button>
                            </div>

                            <div className={`story-phone-scroll min-h-0 flex-1 overflow-y-auto ${compact ? 'px-4 pb-3 pt-3' : 'px-5 pb-3 pt-4'}`}>
                                <div className={`grid grid-cols-4 ${compact ? 'gap-x-2 gap-y-4' : 'gap-x-3 gap-y-4'}`}>
                                    {phoneApps.map(app => {
                                        const active = app.id === spotlightApp.id;
                                        return (
                                            <div
                                                key={app.id}
                                                className="relative flex flex-col items-center gap-1.5"
                                            >
                                                <button
                                                    onClick={() => active ? onGenerateApp?.(app) : onOpenApp?.(app)}
                                                    className="group flex min-w-0 flex-col items-center gap-1.5 active:scale-95"
                                                aria-label={active ? `读取 ${app.name}` : `打开 ${app.name}`}
                                            >
                                                <span
                                                        className={`relative flex ${compact ? 'h-10 w-10 rounded-xl' : 'h-12 w-12 rounded-[1.05rem]'} items-center justify-center overflow-hidden border border-[rgba(120,120,120,0.15)] bg-white/76 text-[#62676b] shadow-[0_8px_18px_rgba(64,69,71,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]`}
                                                    >
                                                        {renderAppGlyph(app, compact ? 'relative z-10 h-5 w-5 text-[#62676b]' : 'relative z-10 h-6 w-6 text-[#62676b]')}
                                                        {active && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#a76666] shadow-[0_0_0_2px_rgba(255,255,255,0.82)]" />}
                                                    </span>
                                                    <span className={`${compact ? 'max-w-[3rem] text-[8px]' : 'max-w-[4rem] text-[10px]'} truncate font-medium text-[#3e4245]/70`}>{app.name}</span>
                                                </button>
                                                {app.isCustom && onUninstallApp && !compact && (
                                                    <button
                                                        onClick={() => onUninstallApp(app)}
                                                        className="absolute -right-1 -top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-white/70 bg-[#9b927f]/82 text-[12px] font-bold text-white shadow-sm active:scale-90"
                                                        aria-label={`卸载 ${app.name}`}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {onInstallApp && !compact && (
                                        <button onClick={onInstallApp} className="flex flex-col items-center gap-1.5 active:scale-95">
                                            <span className="flex h-12 w-12 items-center justify-center rounded-[1.05rem] border border-[rgba(120,120,120,0.15)] bg-white/60 text-[#62676b] shadow-[0_8px_18px_rgba(64,69,71,0.07),inset_0_1px_0_rgba(255,255,255,0.85)]">
                                                <Plus weight="regular" className="h-6 w-6" />
                                            </span>
                                            <span className="max-w-[4rem] truncate text-[10px] font-medium text-[#3e4245]/70">安装</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {!compact && (
                                <div className="px-5 pb-5">
                                    <div className="grid grid-cols-4 gap-2.5 rounded-[2rem] border border-[rgba(120,120,120,0.16)] bg-white/58 p-2.5 shadow-[0_16px_30px_rgba(64,69,71,0.1),inset_0_1px_0_rgba(255,255,255,0.82)]">
                                        {dockApps.map(app => (
                                            <button
                                                key={`dock-${app.id}`}
                                                onClick={() => app.id === spotlightApp.id ? onGenerateApp?.(app) : onOpenApp?.(app)}
                                                className="group flex items-center justify-center active:scale-95"
                                                aria-label={`打开 ${app.name}`}
                                            >
                                                <span
                                                    className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[1.05rem] border border-[rgba(120,120,120,0.14)] bg-white/76 text-[#62676b] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                                                >
                                                    {renderAppGlyph(app, 'relative z-10 h-5 w-5 text-[#62676b]')}
                                                    {app.id === spotlightApp.id && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#a76666] shadow-[0_0_0_2px_rgba(255,255,255,0.82)]" />}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="relative flex min-h-0 flex-1 flex-col bg-[#f6f7fb] text-slate-900">
                            <div className={`flex items-center justify-between border-b border-slate-200/80 bg-white/90 ${compact ? 'h-9 px-3' : 'h-12 px-4'}`}>
                                {onBackHome ? (
                                    <button onClick={onBackHome} className={`${compact ? 'h-7 w-7' : 'h-8 w-8'} flex items-center justify-center rounded-full text-slate-500 active:scale-95`} aria-label="返回桌面">
                                        <CaretLeft weight="bold" className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
                                    </button>
                                ) : (
                                    <span className={compact ? 'w-4' : 'w-5'} />
                                )}
                                <div className={`${compact ? 'text-xs' : 'text-sm'} min-w-0 truncate font-bold`}>{currentApp?.name || clue?.appName || 'App'}</div>
                                {onGenerateApp && currentApp ? (
                                    <button
                                        onClick={() => onGenerateApp(currentApp)}
                                        className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-bold text-slate-500`}
                                    >
                                        刷新
                                    </button>
                                ) : (
                                    <span className={compact ? 'w-5' : 'w-8'} />
                                )}
                            </div>

                            <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
                                {isLoading ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                                        <div className={`${compact ? 'h-7 w-7' : 'h-8 w-8'} animate-spin rounded-full border-2 border-slate-200 border-t-slate-500`} />
                                        <div className={compact ? 'text-[10px]' : 'text-xs'}>正在读取屏幕...</div>
                                    </div>
                                ) : clue && clue.appId === activeAppId ? (
                                    <div className={compact ? 'space-y-2' : 'space-y-3'}>
                                        <div className={`${compact ? 'rounded-xl p-3' : 'rounded-2xl p-4'} bg-white shadow-sm`}>
                                            <div className={compact ? 'text-[9px] text-slate-400' : 'text-[11px] text-slate-400'}>{clue.timestamp}</div>
                                            <div className={`${compact ? 'mt-0.5 text-sm' : 'mt-1 text-lg'} font-bold text-slate-900`}>{clue.title}</div>
                                            {clue.subtitle && <div className={`${compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs'} text-slate-500`}>{clue.subtitle}</div>}
                                        </div>
                                        {clue.items.map((item, index) => (
                                            <div key={`${item.label}-${index}`} className={`${compact ? 'rounded-xl p-3' : 'rounded-2xl p-4'} bg-white shadow-sm`}>
                                                <div className={compact ? 'text-[9px] font-bold text-slate-400' : 'text-[11px] font-bold text-slate-400'}>{item.label}</div>
                                                <div className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-sm'} whitespace-pre-wrap leading-relaxed text-slate-800`}>{item.value}</div>
                                                {item.detail && <div className={`${compact ? 'mt-1 text-[10px]' : 'mt-2 text-xs'} whitespace-pre-wrap leading-relaxed text-slate-500`}>{item.detail}</div>}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
                                        <div className={`flex items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ${compact ? 'h-12 w-12' : 'h-16 w-16'}`}>
                                            {currentApp ? renderAppGlyph(currentApp, compact ? 'h-7 w-7' : 'h-9 w-9') : <ChatCircleText weight="duotone" className={compact ? 'h-7 w-7' : 'h-9 w-9'} />}
                                        </div>
                                        <div className={compact ? 'text-[10px]' : 'text-xs'}>这里暂时没有新内容</div>
                                        {currentApp && onGenerateApp && (
                                            <button
                                                onClick={() => onGenerateApp(currentApp)}
                                                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white active:scale-95"
                                            >
                                                生成这页
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {hasActions && (
                                <div className={`grid grid-cols-2 gap-2 border-t border-slate-200 bg-white/95 ${compact ? 'p-2' : 'p-3'}`}>
                                    <button
                                        onClick={onPeekOnly}
                                        className={`${compact ? 'rounded-xl py-2 text-[10px]' : 'rounded-2xl py-3 text-xs'} bg-slate-100 font-bold text-slate-500 active:scale-95`}
                                    >
                                        只看看
                                    </button>
                                    <button
                                        onClick={onInsertContext}
                                        disabled={inserted}
                                        className={`${compact ? 'rounded-xl py-2 text-[10px]' : 'rounded-2xl py-3 text-xs'} bg-slate-900 font-bold text-white active:scale-95 disabled:bg-emerald-500`}
                                    >
                                        {inserted ? '已放进剧情' : '放进剧情'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {charAvatar && (
                    <div className={`absolute bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 p-1 pr-2 text-white shadow-lg ${compact || activeAppId === 'home' ? 'hidden' : ''}`}>
                        <img src={charAvatar} className="h-6 w-6 rounded-full object-cover" alt={charName} />
                        <span className="max-w-[7rem] truncate text-[10px] font-semibold">{charName}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StoryPhoneScreen;
