import React,{ useState,useEffect,useRef,useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile,PhoneEvidence,PhoneCustomApp } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { extractContent, extractJson, safeResponseJson } from '../utils/safeApi';
// === [Deprecated] 高德地图 POI 搜索已因额度耗尽停用，外卖商家改由大模型生成 ===
// import { searchNearbyRestaurants } from '../utils/mapService';
import MeituanTakeoutCard from '../components/chat/cards/phone/MeituanTakeoutCard';

// 朋友圈封面背景图池 —— 每次进入随机选一张
const MOMENTS_BG_POOL = [
    'https://i.postimg.cc/FKHSBpn0/Camera-1040g3k031roibveui4405pjvpo8gu1m2pj5m6bg.jpg',
    'https://i.postimg.cc/0NySBnHp/Camera-XHS-17719469368011040g2sg31dsqqr5ngccg5o6it4n098c9sr3goe0.jpg',
    'https://i.postimg.cc/W41ZH8fG/Camera-XHS-17719472040941040g2sg31enohhbkmi7g5pu896g399ls9l2jb1o.jpg',
    'https://i.postimg.cc/5yYqkgjj/Camera-XHS-17719473891901040g00831dne1qidge305o3i8irg8p0lbup6im0.jpg',
    'https://i.postimg.cc/prhY1Crw/Camera-XHS-17719479279871040g2sg30ttugsjr4m605ojdbvn8d1ctvlghth8.jpg',
    'https://i.postimg.cc/rs0CYjzK/mmexport1771947836221.jpg',
];

export const MAX_PHONE_RECORDS_PER_APP = 80;
export const MAX_PHONE_RECORDS_TOTAL = 640;
export const MAX_PHONE_VISIBLE_RECORDS = 60;
export const MAX_PHONE_TITLE_CHARS = 96;
export const MAX_PHONE_DETAIL_CHARS = 2400;
export const MAX_PHONE_CHAT_DETAIL_CHARS = 6000;
export const MAX_PHONE_PROMPT_MESSAGES = 50;
const MAX_PHONE_META_CHARS = 160;
const MAX_CHAT_DETAIL_LINES_RENDERED = 120;

const limitPhoneText = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars).trimEnd()}...`;
};

const normalizePhoneText = (value: unknown, fallback = '', maxChars = MAX_PHONE_DETAIL_CHARS): string => {
    let normalized = fallback;

    if (value == null) return fallback;
    if (typeof value === 'string') normalized = value.trim() || fallback;
    else if (typeof value === 'number' || typeof value === 'boolean') normalized = String(value);

    else if (Array.isArray(value)) {
        const parts = value.map(item => normalizePhoneText(item, '')).filter(Boolean);
        normalized = parts.join('; ') || fallback;
    }

    else if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const candidate = record.text ?? record.content ?? record.name ?? record.label ?? record.title ?? record.detail ?? record.status ?? record.amount ?? record.value ?? record.shop;
        if (candidate !== undefined && candidate !== value) {
            const normalized = normalizePhoneText(candidate, '');
            if (normalized) return limitPhoneText(normalized, maxChars);
        }

        try {
            normalized = JSON.stringify(value);
        } catch {
            normalized = fallback;
        }
    }

    return limitPhoneText(normalized, maxChars);
};

const normalizeOptionalPhoneText = (value: unknown, maxChars = MAX_PHONE_META_CHARS): string | undefined => {
    const normalized = normalizePhoneText(value, '', maxChars);
    return normalized || undefined;
};

const normalizeTimestamp = (value: unknown): number => {
    const timestamp = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

export const normalizeGeneratedPhoneItem = (item: unknown): Pick<PhoneEvidence, 'title' | 'detail' | 'value' | 'shop'> => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : { detail: item };
    return {
        title: normalizePhoneText(source.title ?? source.name ?? source.label, 'Unknown', MAX_PHONE_TITLE_CHARS),
        detail: normalizePhoneText(source.detail ?? source.content ?? source.text ?? source.items, '...', MAX_PHONE_DETAIL_CHARS),
        value: normalizeOptionalPhoneText(source.value ?? source.amount ?? source.price),
        shop: normalizeOptionalPhoneText(source.shop ?? source.store ?? source.status)
    };
};

export const normalizeStoredPhoneRecord = (record: PhoneEvidence): PhoneEvidence => {
    const unsafeRecord = record as unknown as Record<string, unknown>;
    const type = normalizePhoneText(unsafeRecord.type, 'generic', MAX_PHONE_META_CHARS);
    const detailLimit = type === 'chat' ? MAX_PHONE_CHAT_DETAIL_CHARS : MAX_PHONE_DETAIL_CHARS;
    const systemMessageId = typeof unsafeRecord.systemMessageId === 'number' ? unsafeRecord.systemMessageId : undefined;
    const value = normalizeOptionalPhoneText(unsafeRecord.value);
    const shop = normalizeOptionalPhoneText(unsafeRecord.shop);

    const normalized: PhoneEvidence = {
        id: normalizePhoneText(unsafeRecord.id, `rec-${normalizeTimestamp(unsafeRecord.timestamp) || 'unknown'}`, MAX_PHONE_META_CHARS),
        type,
        title: normalizePhoneText(unsafeRecord.title, 'Unknown', MAX_PHONE_TITLE_CHARS),
        detail: normalizePhoneText(unsafeRecord.detail, '...', detailLimit),
        timestamp: normalizeTimestamp(unsafeRecord.timestamp),
    };

    if (systemMessageId !== undefined) normalized.systemMessageId = systemMessageId;
    if (value !== undefined) normalized.value = value;
    if (shop !== undefined) normalized.shop = shop;

    return normalized;
};

export const prunePhoneRecords = (records: PhoneEvidence[]): PhoneEvidence[] => {
    const normalized = records
        .map((record, index) => ({ record: normalizeStoredPhoneRecord(record), index }))
        .sort((a, b) => (b.record.timestamp - a.record.timestamp) || (b.index - a.index));

    const countByType = new Map<string, number>();
    const kept: Array<{ record: PhoneEvidence; index: number }> = [];

    for (const item of normalized) {
        const typeCount = countByType.get(item.record.type) || 0;
        if (typeCount >= MAX_PHONE_RECORDS_PER_APP) continue;

        countByType.set(item.record.type, typeCount + 1);
        kept.push(item);

        if (kept.length >= MAX_PHONE_RECORDS_TOTAL) break;
    }

    return kept
        .sort((a, b) => (a.record.timestamp - b.record.timestamp) || (a.index - b.index))
        .map(item => item.record);
};

export interface NormalizedPhoneState {
    records: PhoneEvidence[];
    customApps: PhoneCustomApp[];
}

interface GenerateOptions {
    replaceExisting?: boolean;
}

export const normalizePhoneState = (
    phoneState: CharacterProfile['phoneState'] | undefined,
): NormalizedPhoneState => ({
    records: prunePhoneRecords(phoneState?.records || []),
    customApps: phoneState?.customApps || [],
});

const phoneRecordEquals = (a: PhoneEvidence, b: PhoneEvidence): boolean => {
    const aKeys = Object.keys(a as unknown as Record<string, unknown>).sort().join('|');
    const bKeys = Object.keys(b as unknown as Record<string, unknown>).sort().join('|');

    return (
        aKeys === bKeys &&
        a.id === b.id &&
        a.type === b.type &&
        a.title === b.title &&
        a.detail === b.detail &&
        a.timestamp === b.timestamp &&
        a.systemMessageId === b.systemMessageId &&
        a.value === b.value &&
        a.shop === b.shop
    );
};

export const phoneStateNeedsNormalization = (
    current: CharacterProfile['phoneState'] | undefined,
    normalized = normalizePhoneState(current),
): boolean => {
    const records = current?.records || [];
    if (records.length !== normalized.records.length) return true;
    for (let i = 0; i < records.length; i += 1) {
        if (!phoneRecordEquals(records[i], normalized.records[i])) return true;
    }
    return false;
};

export function buildPhoneSystemMessageDraft(input: {
    type: string;
    charName: string;
    charAvatar?: string;
    logPrefix: string;
    title: string;
    detail: string;
    value?: string;
    shop?: string;
}) {
    const detailLimit = input.type === 'chat' ? MAX_PHONE_CHAT_DETAIL_CHARS : MAX_PHONE_DETAIL_CHARS;
    const phoneDetail = normalizePhoneText(input.detail, '', detailLimit);
    const inlineDetail = phoneDetail.replace(/\n/g, ' ');
    const phoneLabel = input.logPrefix || input.type;
    const content = input.type === 'chat'
        ? `[系统: ${input.charName} 与 "${input.title}" 的聊天记录-内容涉及: ${inlineDetail}]`
        : `[系统: ${input.charName}的手机(${phoneLabel}) 显示: ${input.title} - ${inlineDetail}]`;

    return {
        content,
        metadata: {
            source: 'phone',
            phoneType: input.type,
            phoneLabel,
            phoneTitle: limitPhoneText(input.title, MAX_PHONE_TITLE_CHARS),
            phoneDetail,
            phoneValue: input.value ? limitPhoneText(input.value, MAX_PHONE_META_CHARS) : null,
            phoneShop: input.shop ? limitPhoneText(input.shop, MAX_PHONE_META_CHARS) : null,
            charName: input.charName,
            charAvatar: input.charAvatar
        }
    };
}

// --- Debug Component ---
const LayoutInspector: React.FC = () => {
    const [stats, setStats] = useState({ w: 0, h: 0, vh: 0, top: 0 });

    useEffect(() => {
        const update = () => {
            setStats({
                w: window.innerWidth,
                h: window.innerHeight,
                vh: window.visualViewport?.height || 0,
                top: window.visualViewport?.offsetTop || 0
            });
        };
        window.addEventListener('resize', update);
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        update();
        return () => {
            window.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
        };
    }, []);

    return (
        <div className="absolute top-0 right-0 z-[9999] bg-red-500/80 text-white text-[10px] font-mono p-1 pointer-events-none select-none">
            Win: {stats.w}x{stats.h}<br />
            VV: {stats.vh.toFixed(0)} (y:{stats.top.toFixed(0)})
        </div>
    );
};

// === [LEGACY] 原配合 searchNearbyRestaurants 使用，暂停 ===
// function shuffleAndPick<T>(arr: T[], count: number): T[] {
//     const shuffled = [...arr].sort(() => Math.random() - 0.5);
//     return shuffled.slice(0, count);
// }

const CheckPhone: React.FC = () => {
    const { closeApp, characters, updateCharacter, apiConfig, addToast, userProfile } = useOS();
    const [view, setView] = useState<'select' | 'phone'>('select');
    // activeAppId: 'home' | 'chat_detail' | 'app_id'
    const [activeAppId, setActiveAppId] = useState<string>('home');
    const [targetChar, setTargetChar] = useState<CharacterProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Chat Detail State
    const [selectedChatRecord, setSelectedChatRecord] = useState<PhoneEvidence | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Custom App Creation State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppIcon, setNewAppIcon] = useState('📱');
    const [newAppColor, setNewAppColor] = useState('#3b82f6');
    const [newAppPrompt, setNewAppPrompt] = useState('');

    // Debug Toggle
    const [showDebug, setShowDebug] = useState(false);

    // Derived state for evidence records
    const records = useMemo(
        () => prunePhoneRecords(targetChar?.phoneState?.records || []),
        [targetChar?.phoneState?.records]
    );
    const customApps = targetChar?.phoneState?.customApps || [];
    const getRecentRecordsByType = (type: string) =>
        records
            .filter(r => r.type === type)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_PHONE_VISIBLE_RECORDS);

    const normalizeTargetCharacter = (character: CharacterProfile): CharacterProfile => {
        const normalizedPhoneState = normalizePhoneState(character.phoneState);
        if (!phoneStateNeedsNormalization(character.phoneState, normalizedPhoneState)) return character;
        updateCharacter(character.id, { phoneState: normalizedPhoneState });
        return { ...character, phoneState: normalizedPhoneState };
    };

    useEffect(() => {
        if (targetChar) {
            // Keep targetChar in sync with global state if it updates (e.g. deletion)
            const updated = characters.find(c => c.id === targetChar.id);
            if (updated) {
                const normalizedCharacter = normalizeTargetCharacter(updated);
                setTargetChar(normalizedCharacter);
                // Update selected record ref if open
                if (selectedChatRecord) {
                    const freshRecord = normalizedCharacter.phoneState?.records?.find(r => r.id === selectedChatRecord.id);
                    if (freshRecord) setSelectedChatRecord(normalizeStoredPhoneRecord(freshRecord));
                }
            }
        }
    }, [characters]);

    // Reset page scroll on navigation to prevent mobile layout shift
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeAppId, view]);

    // 朋友圈封面：每次组件挂载随机选一张背景
    const momentsCoverBg = useMemo(() =>
        MOMENTS_BG_POOL[Math.floor(Math.random() * MOMENTS_BG_POOL.length)],
        []);

    // Auto scroll to bottom of chat detail
    // NOTE: Do NOT use scrollIntoView - it propagates to page scroll on mobile, shifting the entire layout up
    useEffect(() => {
        if (activeAppId === 'chat_detail' && chatEndRef.current) {
            const container = chatEndRef.current.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [selectedChatRecord?.detail, activeAppId]);

    const handleSelectChar = (c: CharacterProfile) => {
        setTargetChar(normalizeTargetCharacter(c));
        setView('phone');
        setActiveAppId('home');
    };

    const handleExitPhone = () => {
        setView('select');
        setTargetChar(null);
        setActiveAppId('home');
    };

    const handleDeleteRecord = async (record: PhoneEvidence) => {
        if (!targetChar) return;

        const newRecords = (targetChar.phoneState?.records || []).filter(r => r.id !== record.id);
        updateCharacter(targetChar.id, {
            phoneState: { ...targetChar.phoneState, records: newRecords }
        });

        if (record.systemMessageId) {
            await DB.deleteMessage(record.systemMessageId);
        }

        if (selectedChatRecord?.id === record.id) {
            setActiveAppId('chat'); // Go back to list
            setSelectedChatRecord(null);
        }

        addToast('记录已删除', 'success');
    };

    const handleDeleteApp = (appId: string) => {
        if (!targetChar) return;
        const newApps = (targetChar.phoneState?.customApps || []).filter(a => a.id !== appId);
        updateCharacter(targetChar.id, {
            phoneState: { ...targetChar.phoneState, customApps: newApps }
        });
        addToast('App 已卸载', 'success');
    };

    const handleCreateCustomApp = () => {
        if (!targetChar || !newAppName || !newAppPrompt) return;

        const newApp: PhoneCustomApp = {
            id: `app-${Date.now()}`,
            name: newAppName,
            icon: newAppIcon,
            color: newAppColor,
            prompt: newAppPrompt
        };

        const currentApps = targetChar.phoneState?.customApps || [];
        updateCharacter(targetChar.id, {
            phoneState: { ...targetChar.phoneState, customApps: [...currentApps, newApp] }
        });

        setShowCreateModal(false);
        setNewAppName('');
        setNewAppPrompt('');
        addToast(`已安装 ${newAppName}`, 'success');
    };

    // Calculate Time Gap - Duplicated logic from other apps for consistent experience
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是初次见面。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return '你们刚刚还在聊天。';
        if (diffMins < 60) return `距离上次互动只有 ${diffMins} 分钟。`;
        if (diffHours < 24) return `距离上次互动已经过了 ${diffHours} 小时。`;
        return `距离上次互动已经过了 ${diffDays} 天。`;
    };

    // --- Core Generation Logic ---

    const handleGenerate = async (type: string, customPrompt?: string, options: GenerateOptions = {}) => {
        if (!targetChar || !apiConfig.apiKey) {
            addToast('配置错误', 'error');
            return;
        }
        setIsLoading(true);

        try {
            const existingRecords = targetChar.phoneState?.records || [];
            const replacedRecords = options.replaceExisting
                ? existingRecords.filter(record => record.type === type)
                : [];
            const replacedSystemMessageIds = new Set(
                replacedRecords
                    .map(record => record.systemMessageId)
                    .filter((id): id is number => typeof id === 'number')
            );

            // Include full memory details for accuracy
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true);
            const msgs = await DB.getRecentMessagesByCharId(targetChar.id, MAX_PHONE_PROMPT_MESSAGES);
            const contextMsgs = msgs.filter(m => !replacedSystemMessageIds.has(m.id));

            const lastMsg = contextMsgs[contextMsgs.length - 1];
            const timeGap = getTimeGapHint(lastMsg?.timestamp);

            const recentMsgs = contextMsgs
                .slice(-50)
                .map(m => {
                    const roleName = m.role === 'user' ? userProfile.name : targetChar.name;
                    const content = m.type === 'text' ? m.content : `[${m.type}]`;
                    return `${roleName}: ${content}`;
                }).join('\n');

            let promptInstruction = "";
            let logPrefix = "";

            if (customPrompt) {
                promptInstruction = `用户正在查看你的手机 App: "${type}"。
该 App 的功能/用户想看的内容是: "${customPrompt}"。
请生成 2-4 条符合该 App 功能的记录。
必须符合你的人设（例如银行余额要符合身份，备忘录要符合性格）。
格式JSON数组: [{ "title": "标题/项目名", "detail": "详细内容/金额/状态", "value": "可选的数值状态(如 +100)" }, ...]`;
                const customApp = customApps.find(a => a.id === type);
                logPrefix = customApp ? customApp.name : type;
            } else {
                if (type === 'chat') {
                    promptInstruction = `生成 3 个该角色手机聊天软件(Message/Line)中的**对话片段**。
    要求：
    1. **自动匹配角色**: 根据人设，虚构 3 个合理的联系人（如：如果是学生，联系人可以是“辅导员”、“社团学长”；如果是杀手，联系人可以是“中间人”）。不要使用“User”作为联系人。
    2. **对话感**: 内容必须是有来有回的对话脚本（3-4句），体现他们之间的关系。
    3. **格式**: 必须严格使用 "我:..." 代表主角(你)，"对方:..." 或 "人名:..." 代表联系人。
    格式JSON数组: [{ "title": "联系人名称 (身份)", "detail": "对方: 最近怎么样？\\n我: 还活着。\\n对方: 那就好。" }, ...]`;
                    logPrefix = "聊天软件";
                } else if (type === 'call') {
                    promptInstruction = `生成 3 条该角色的近期**通话记录**。
    格式JSON数组: [{ "title": "联系人名称", "value": "呼入 (5分钟) / 未接 / 呼出 (30秒)", "detail": "关于下周聚会的事..." }, ...]`;
                    logPrefix = "通话记录";
                } else if (type === 'order') {
                    promptInstruction = `生成 3 条该角色最近的购物订单（淘宝/天猫）。
    要求：
    1. 商品名必须具体、生动，包含品牌名和型号（例如 "NIKE Air Max 270 黑白配色 男款"）。
    2. detail 必须包含 "规格 | 状态" 两部分，用 "|" 分隔（例如 "黑色/42码 | 已发货"）。
    3. value 是实付款金额，必须带 ¥ 前缀。
    4. shop 是店铺名（例如 "Nike官方旗舰店"）。
    格式JSON数组: [{ "title": "商品名", "detail": "规格 | 状态", "value": "¥金额", "shop": "店铺名" }, ...]`;
                    logPrefix = "购物APP";
                } else if (type === 'delivery') {
                    // ─── LLM-Native 外卖生成（无需地图 API）─────────────────
                    const cityOverride = targetChar.cityOverride?.trim();
                    const cityReferenceReal = targetChar.cityReferenceReal?.trim();

                    // 构建城市与美食文化上下文
                    let cityContext = '';
                    if (targetChar.isFictionalCity && cityOverride) {
                        if (cityReferenceReal) {
                            // 架空城市 + 有现实参照
                            cityContext = `你身处「${cityOverride}」——这是一个以「${cityReferenceReal}」为蓝本的架空城市。
生成外卖订单时请遵循以下规则：
- 商家名称和菜品风格要融合「${cityReferenceReal}」的真实饮食文化特色（比如当地知名菜系、连锁品牌的本地化变体）
- 但商家名必须做世界观改编：可以谐音、化用、加上符合设定的前缀后缀（如"阿卡姆速递"、"璃月港茶餐厅"），让它听起来像真实存在于「${cityOverride}」的店
- 菜品种类和价位仍然以「${cityReferenceReal}」的真实消费水平为参照
- 鼓励混入 1-2 个纯原创的、只可能存在于你的世界观里的特色美食`;
                        } else {
                            // 架空城市 + 无现实参照 → 完全自由创作
                            cityContext = `你身处「${cityOverride}」——这是一个架空/虚构城市。
生成外卖订单时请完全根据你的世界观和人设自由创作：
- 商家名称应该听起来像真实存在于这个世界里的店（符合世界观的语言风格和文化氛围）
- 菜品要符合这个世界的设定（如果是魔法世界可以有"龙息辣翅"，赛博朋克可以有"合成蛋白套餐"）
- 价格体系要自洽（可以用你世界里的货币单位，但也可以用 ¥ 方便展示）
- 整体风格要让人一看就知道"这是那个世界的外卖"`;
                        }
                    } else if (cityOverride) {
                        // 真实城市
                        cityContext = `你身处「${cityOverride}」。
生成外卖订单时请体现这座城市的真实饮食文化特色：
- 优先使用当地真实存在的知名餐饮品牌和连锁店（包括全国连锁在该城市的分店，以及当地独有的老字号/网红店）
- 菜品要符合「${cityOverride}」的地方饮食特色（比如成都多川菜/串串/火锅、广州多粤式茶餐厅/肠粉、长沙多湘菜/臭豆腐/奶茶）
- 商家名格式带上分店名（如 "蜜雪冰城(春熙路店)"、"文和友(海信广场店)"）
- 价格要符合当地真实消费水平`;
                    } else {
                        // 未设城市 → 通用
                        cityContext = `你没有设置具体城市，请根据你的人设和生活环境合理推断你可能在哪类城市，并据此生成合理的外卖订单。
可以使用全国常见的连锁品牌（如华莱士、蜜雪冰城、张亮麻辣烫、瑞幸咖啡、肯德基等），也可以虚构符合你身份的本地小店。`;
                    }

                    promptInstruction = `生成 3 条你最近的外卖订单记录。

【你的地理与饮食文化背景】
${cityContext}

【通用要求】
1. title 是商家名称，要有店名特色和辨识度。
2. 菜品必须符合该商家的菜系特征（如奶茶店只出饮品甜品，烧烤店出烤串烤肉）。
3. 根据你的人设和经济状况，选择符合你身份的商家下单。富人挑精致的，学生挑实惠的。
4. detail 是点的菜品列表，用「;」分隔，包含数量（例如 "招牌奶茶×1;芋泥波波×2"）。
5. value 是订单总价，必须带 ¥ 前缀，价格要合理。
6. shop 是订单状态（例如 "已完成"、"骑手正在配送"、"已取消"、"待评价"）。
格式JSON数组: [{ "title": "商家名", "detail": "菜品1×数量;菜品2×数量;...", "value": "¥总价", "shop": "订单状态" }, ...]`;
                    logPrefix = "外卖APP";

                    // === [LEGACY] 以下为原版高德 POI API 搜索逻辑，因额度耗尽停用 ===
                    // const realShops = queryCity ? await searchNearbyRestaurants(queryCity, 15) : [];
                    // const selectedShops = realShops.length > 0 ? shuffleAndPick(realShops, Math.min(5, Math.max(3, realShops.length))) : [];
                    // if (selectedShops.length > 0) { ... 用真实 POI 构建 prompt ... }
                    // === [/LEGACY] ===
                } else if (type === 'social') {
                    promptInstruction = `生成 2 条该角色的朋友圈/社交媒体动态。
    格式JSON数组: [{ "title": "时间/状态", "detail": "正文内容" }, ...]`;
                    logPrefix = "朋友圈";
                }
            }

            const fullPrompt = `${context}\n\n### [Current Status]\n时间距离上次互动: ${timeGap}\n\n### [Recent Chat Context]\n${recentMsgs}\n\n### [Task]\n${promptInstruction}\n请根据[Current Status]和人设调整生成内容的时间戳和情绪。如果很久没聊天，记录可能是近期的独处状态；如果刚聊过，记录可能与聊天内容相关。`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: fullPrompt }],
                    temperature: 0.8
                })
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            const content = extractContent(data);
            if (!content) throw new Error('API 未返回可用内容');

            const parsed = extractJson(content);
            const json = Array.isArray(parsed) ? parsed : [];
            if (json.length === 0) throw new Error('未解析出有效手机记录');

            const newRecordsToAdd: PhoneEvidence[] = [];

            if (Array.isArray(json)) {
                for (const item of json) {
                    const normalizedItem = normalizeGeneratedPhoneItem(item);
                    const recordTitle = normalizedItem.title;
                    const recordDetail = normalizedItem.detail;

                    const systemDraft = buildPhoneSystemMessageDraft({
                        type,
                        charName: targetChar.name,
                        charAvatar: targetChar.avatar,
                        logPrefix,
                        title: recordTitle,
                        detail: recordDetail,
                        value: normalizedItem.value,
                        shop: normalizedItem.shop
                    });

                    const systemMessageId = await DB.saveMessage({
                        charId: targetChar.id,
                        role: 'system',
                        type: 'text',
                        content: systemDraft.content,
                        metadata: systemDraft.metadata
                    });

                    newRecordsToAdd.push({
                        id: `rec-${Date.now()}-${Math.random()}`,
                        type: type,
                        title: recordTitle,
                        detail: recordDetail,
                        value: normalizedItem.value,
                        shop: normalizedItem.shop,
                        timestamp: Date.now(),
                        systemMessageId
                    });

                    await new Promise(r => setTimeout(r, 50));
                }
            }

            const baseRecords = options.replaceExisting
                ? existingRecords.filter(record => record.type !== type)
                : existingRecords;
            const nextRecords = prunePhoneRecords([...baseRecords, ...newRecordsToAdd]);
            const prunedCount = baseRecords.length + newRecordsToAdd.length - nextRecords.length;
            updateCharacter(targetChar.id, {
                phoneState: { ...targetChar.phoneState, records: nextRecords }
            });

            if (replacedSystemMessageIds.size > 0) {
                await DB.deleteMessages(Array.from(replacedSystemMessageIds));
            }

            addToast(
                options.replaceExisting
                    ? `已重Roll ${newRecordsToAdd.length} 条数据`
                    : prunedCount > 0
                    ? `已刷新 ${newRecordsToAdd.length} 条数据，整理了 ${prunedCount} 条旧记录`
                    : `已刷新 ${newRecordsToAdd.length} 条数据`,
                'success'
            );

        } catch (e: any) {
            console.error(e);
            addToast('解析失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Continue Chat Logic ---

    const handleContinueChat = async () => {
        if (!selectedChatRecord || !targetChar || !apiConfig.apiKey) return;
        setIsLoading(true);

        try {
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true); // Enable detailed context
            const prompt = `${context}

### [Task: Continue Conversation]
Roleplay: You are "${targetChar.name}". You are chatting on your phone with "${selectedChatRecord.title}".
Current History:
"""
${selectedChatRecord.detail}
"""

Task: Please continue this conversation for 3-5 more turns. 
Style: Casual, IM style.
Format: 
- Use "我: ..." for yourself (${targetChar.name}).
- Use "对方: ..." for the contact (${selectedChatRecord.title}).
- Only output the new dialogue lines. Do NOT repeat history.
`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.85
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                const content = extractContent(data);
                let newLines = normalizePhoneText(content, '', MAX_PHONE_CHAT_DETAIL_CHARS);
                if (!newLines) throw new Error('API 未返回可用续写内容');

                // Clean up any markdown
                newLines = newLines.replace(/```/g, '');

                // Append to existing record
                const updatedDetail = limitPhoneText(`${selectedChatRecord.detail}\n${newLines}`, MAX_PHONE_CHAT_DETAIL_CHARS);

                // Update Local State
                const updatedRecord = normalizeStoredPhoneRecord({ ...selectedChatRecord, detail: updatedDetail, timestamp: Date.now() });
                setSelectedChatRecord(updatedRecord);

                // Update Character Profile
                const allRecords = targetChar.phoneState?.records || [];
                const updatedRecords = prunePhoneRecords(allRecords.map(r => r.id === updatedRecord.id ? updatedRecord : r));
                updateCharacter(targetChar.id, {
                    phoneState: { ...targetChar.phoneState, records: updatedRecords }
                });

                // Inject a system message so the chat timeline (and AI context) reflects the continuation
                const continuationSummary = newLines.replace(/\n/g, ' ').substring(0, 80);
                await DB.saveMessage({
                    charId: targetChar.id,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${userProfile.name} 偷看了 ${targetChar.name} 与 "${selectedChatRecord.title}" 的后续对话: ${continuationSummary}...]`,
                    metadata: {
                        source: 'phone',
                        phoneType: 'chat',
                        phoneLabel: '聊天软件',
                        phoneTitle: selectedChatRecord.title,
                        phoneDetail: newLines,
                        charName: targetChar.name
                    }
                });

                // Also update the original system message's metadata if it exists
                if (selectedChatRecord.systemMessageId) {
                    try {
                        await DB.updateMessageMetadata(selectedChatRecord.systemMessageId, {
                            phoneDetail: updatedDetail
                        });
                    } catch (e) { /* Original message may have been deleted, safe to ignore */ }
                }
            }

        } catch (e) {
            console.error(e);
            addToast('续写失败', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Renderers ---

    const renderHeader = (title: string, backAction: () => void, extraAction?: React.ReactNode) => (
        <div className="h-14 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200">
            <button onClick={backAction} className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <span className="font-bold text-base tracking-wide truncate max-w-[200px]">{title}</span>
            <div className="w-8 flex justify-end">{extraAction}</div>
        </div>
    );

    const renderChatList = () => {
        const list = getRecentRecordsByType('chat');
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader('Message', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无聊天记录</div>}
                    {list.map(r => (
                        <div
                            key={r.id}
                            onClick={() => { setSelectedChatRecord(r); setActiveAppId('chat_detail'); }}
                            className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative group animate-slide-up active:scale-98 transition-transform cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-xl shadow-inner shrink-0">
                                    👤
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="font-bold text-slate-700 text-sm truncate">{r.title}</div>
                                        <div className="text-[10px] text-slate-400">{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">
                                        {r.detail.split('\n').pop() || '...'}
                                    </div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(r); }} className="absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
                        </div>
                    ))}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('chat')} className="pointer-events-auto bg-green-500 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '连接中...' : '刷新消息列表'}
                    </button>
                </div>
            </div>
        );
    };

    const renderChatDetail = () => {
        if (!selectedChatRecord || !targetChar) return null;

        // Parse logic: look for "Me:" or "我:" vs others
        const lines = selectedChatRecord.detail.split('\n').filter(l => l.trim()).slice(-MAX_CHAT_DETAIL_LINES_RENDERED);
        const parsedLines = lines.map(line => {
            const isMe = line.startsWith('我') || line.startsWith('Me') || line.startsWith('Me:') || line.startsWith('我:');
            const content = line.replace(/^(我|Me|对方|Them|[\w\u4e00-\u9fa5]+)[:：]\s*/, '');
            return { isMe, content };
        });

        return (
            // 关键修复：添加不透明背景色，确保完全覆盖
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f2f2f2] z-[100] overflow-hidden">
                {renderHeader(selectedChatRecord.title, () => setActiveAppId('chat'))}

                {/* 聊天内容区域 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar overscroll-contain min-h-0">
                    {parsedLines.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                            {!msg.isMe && (
                                <div className="w-9 h-9 rounded-md bg-gray-300 flex items-center justify-center text-xs text-gray-500 mr-2 shrink-0">
                                    {selectedChatRecord.title[0]}
                                </div>
                            )}
                            <div className={`px-3 py-2 rounded-lg max-w-[75%] text-sm leading-relaxed shadow-sm break-words relative ${msg.isMe ? 'bg-[#95ec69] text-black' : 'bg-white text-black'}`}>
                                {msg.isMe && <div className="absolute top-2 -right-1.5 w-3 h-3 bg-[#95ec69] rotate-45"></div>}
                                {!msg.isMe && <div className="absolute top-3 -left-1 w-2.5 h-2.5 bg-white rotate-45"></div>}
                                <span className="relative z-10">{msg.content}</span>
                            </div>
                            {msg.isMe && (
                                <img src={targetChar.avatar} className="w-9 h-9 rounded-md object-cover ml-2 shrink-0 shadow-sm" />
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-center py-4">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* 底部按钮 - 关键修复：移除复杂的 env() 计算，使用固定 padding */}
                <div className="shrink-0 w-full p-4 bg-[#f7f7f7] border-t border-gray-200">
                    <button
                        onClick={handleContinueChat}
                        disabled={isLoading}
                        className="w-full py-3 bg-white border border-gray-300 rounded-xl text-sm font-bold text-slate-600 shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {isLoading ? '对方正在输入...' : '👀 偷看后续 / 拱火'}
                    </button>
                </div>
            </div>
        );
    };


    // ─── Taobao App List (仿淘宝订单列表) ─────────────────────────
    const renderTaobaoList = () => {
        const list = getRecentRecordsByType('order');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f5f5f5] z-10">
                {/* ── Header: Taobao style ── */}
                <div className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
                    style={{ background: 'linear-gradient(135deg, #FF5000, #FF2800)' }}>
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-bold text-white text-base tracking-wide">我的订单</span>
                    <div className="w-8"></div>
                </div>

                {/* ── Order list ── */}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">📦</span>
                            <span className="text-xs">暂无订单</span>
                        </div>
                    )}
                    <div className="p-3 space-y-2.5">
                        {list.map(r => {
                            // Parse "规格 | 状态"
                            const detailParts = (r.detail || '').split(/[|｜]/).map(s => s.trim()).filter(Boolean);
                            const spec = detailParts.length > 1 ? detailParts[0] : '';
                            const status = detailParts.length > 1 ? detailParts.slice(1).join(' · ') : r.detail;

                            const statusColor = status.includes('已完成') || status.includes('已签收') || status.includes('交易成功')
                                ? 'text-green-600'
                                : status.includes('已发货') || status.includes('运输中')
                                    ? 'text-orange-500'
                                    : status.includes('待付款')
                                        ? 'text-red-500'
                                        : 'text-slate-500';

                            return (
                                <div key={r.id} className="bg-white rounded-lg overflow-hidden relative group animate-slide-up" style={{ border: '1px solid #f0f0f0' }}>
                                    {/* Shop header */}
                                    <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid #f5f5f5' }}>
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-black text-white shrink-0"
                                                style={{ background: 'linear-gradient(135deg, #FF5000, #FF2800)' }}>
                                                淘
                                            </div>
                                            <span className="text-[11px] text-slate-600 font-medium truncate max-w-[150px]">
                                                {r.shop || '淘宝商家'}
                                            </span>
                                        </div>
                                        <span className={`text-[10px] font-medium ${statusColor}`}>{status}</span>
                                    </div>

                                    {/* Product row */}
                                    <div className="px-3 py-2.5 flex gap-3">
                                        {/* Image placeholder */}
                                        <div className="w-20 h-20 rounded-md shrink-0 flex items-center justify-center"
                                            style={{ background: '#f7f7f7' }}>
                                            <span className="text-2xl text-slate-300 select-none">
                                                {(r.title || '?')[0]}
                                            </span>
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                                            <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-2">
                                                {r.title}
                                            </div>
                                            {spec && (
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{spec}</div>
                                            )}
                                            <div className="flex items-center justify-end mt-1">
                                                {r.value && (
                                                    <span className="text-[14px] font-bold" style={{ color: '#FF5000' }}>
                                                        {(r.value.startsWith('¥') || r.value.startsWith('￥')) ? r.value : `¥${r.value}`}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <button onClick={() => handleDeleteRecord(r)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10">×</button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Refresh button ── */}
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('order')}
                        className="pointer-events-auto text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform"
                        style={{ background: 'linear-gradient(135deg, #FF5000, #FF2800)' }}
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新订单
                    </button>
                </div>
            </div>
        );
    };

    // ─── Meituan Waimai App List (仿美团外卖订单列表) ─────────────────────
    const renderMeituanList = () => {
        const list = getRecentRecordsByType('delivery');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f5f5f5] z-10">
                {/* ── Header: Meituan style ── */}
                <div className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
                    style={{ background: 'linear-gradient(135deg, #FFD000, #FFC300)' }}>
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full hover:bg-black/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#111" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-bold text-[#111] text-base tracking-wide">美团外卖</span>
                    <div className="w-8"></div>
                </div>

                {/* ── Order list ── */}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">🍔</span>
                            <span className="text-xs">暂无外卖订单</span>
                        </div>
                    )}
                    <div className="p-3 space-y-2.5">
                        {list.map(r => (
                            <div key={r.id} className="relative group animate-slide-up">
                                <MeituanTakeoutCard
                                    title={r.title}
                                    detail={r.detail}
                                    value={r.value}
                                    shop={r.shop}
                                />
                                <button onClick={() => handleDeleteRecord(r)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10">×</button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Refresh button ── */}
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('delivery')}
                        className="pointer-events-auto text-[#111] px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform"
                        style={{ background: 'linear-gradient(135deg, #FFD000, #FFC300)' }}
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-[#111]/30 border-t-[#111] rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新订单
                    </button>
                </div>
            </div>
        );
    };

    const renderGenericList = (appId: string, appName: string, customPrompt?: string) => {
        const list = getRecentRecordsByType(appId);

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader(appName, () => setActiveAppId('home'))}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">📭</span>
                            <span className="text-xs">暂无数据</span>
                        </div>
                    )}
                    {list.map(r => (
                        <div key={r.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm relative group animate-slide-up">
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-slate-700 text-sm line-clamp-1">{r.title}</span>
                                {r.value && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">{r.value}</span>}
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed">{r.detail}</div>
                            <div className="text-[10px] text-slate-300 mt-2 text-right">{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>

                            <button onClick={() => handleDeleteRecord(r)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md">×</button>
                        </div>
                    ))}
                </div>

                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate(appId, customPrompt)}
                        className="pointer-events-auto bg-slate-800 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform hover:bg-slate-700"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新数据
                    </button>
                </div>
            </div>
        );
    };

    const renderMomentsList = () => {
        const list = getRecentRecordsByType('social');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-white z-10">
                {/* WeChat Header */}
                <div className="h-14 flex items-center justify-between px-4 bg-white/90 backdrop-blur-md text-[#111111] shrink-0 z-20 border-b border-gray-100">
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full active:bg-gray-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-medium text-base tracking-wide">朋友圈</span>
                    <button className="p-2 -mr-2 rounded-full active:bg-gray-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain bg-white">
                    {/* Moments Cover Image Area */}
                    <div className="h-64 bg-gray-100 relative mb-12">
                        <img src={targetChar?.dateBackground || momentsCoverBg} className="w-full h-full object-cover" />
                        <div className="absolute -bottom-8 right-4 flex items-end gap-4">
                            <span className="text-white text-lg font-bold drop-shadow-md mb-2">{targetChar?.name}</span>
                            <div className="w-16 h-16 rounded-lg bg-gray-200 p-[2px] bg-white shadow-sm shrink-0">
                                {targetChar?.avatar ? (
                                    <img src={targetChar.avatar} className="w-full h-full object-cover rounded-md" />
                                ) : (
                                    <div className="w-full h-full bg-slate-300 rounded-md"></div>
                                )}
                            </div>
                        </div>
                    </div>

                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                            <span className="text-sm">暂无动态</span>
                        </div>
                    )}

                    {/* Moments List */}
                    <div className="divide-y divide-gray-100">
                        {list.map(r => (
                            <div key={r.id} className="p-4 flex gap-3 relative group animate-slide-up bg-white">
                                {/* Avatar */}
                                <div className="w-10 h-10 rounded-md shrink-0 bg-gray-200">
                                    {targetChar?.avatar ? (
                                        <img src={targetChar.avatar} className="w-full h-full rounded-md object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500 font-medium">{(targetChar?.name || '?')[0]}</div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[#576b95] font-medium text-[15px] mb-1 leading-tight">{targetChar?.name}</div>
                                    <div className="text-[#111111] text-[15px] leading-relaxed whitespace-pre-wrap break-words">{r.detail}</div>

                                    <div className="flex items-center justify-between mt-2.5">
                                        <div className="text-[#b2b2b2] text-[13px] flex items-center gap-2">
                                            <span>{r.title}</span>
                                            <button
                                                onClick={() => handleDeleteRecord(r)}
                                                className="text-[#576b95] px-1.5 py-0.5 rounded active:bg-[#f5f5f5] transition-colors"
                                            >
                                                删除
                                            </button>
                                        </div>
                                        <div className="w-8 h-5 bg-[#f5f5f5] rounded flex items-center justify-center cursor-pointer active:bg-gray-200 transition-colors">
                                            <div className="flex gap-1">
                                                <span className="w-1 h-1 rounded-full bg-[#576b95]"></span>
                                                <span className="w-1 h-1 rounded-full bg-[#576b95]"></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 px-4 pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('social')}
                        className="pointer-events-auto bg-green-500 text-white px-4 py-2.5 rounded-full shadow-lg font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新朋友圈
                    </button>
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('social', undefined, { replaceExisting: true })}
                        className="pointer-events-auto bg-[#576b95] text-white px-4 py-2.5 rounded-full shadow-lg font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5M16.5 3 21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>}
                        重Roll
                    </button>
                </div>
            </div>
        );
    };

    const AppIcon = ({ icon, color, label, onClick, onDelete }: { icon: string, color: string, label: string, onClick: () => void, onDelete?: () => void }) => (
        <div className="flex flex-col items-center gap-1.5 relative group">
            <button
                onClick={onClick}
                className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] flex items-center justify-center text-2xl shadow-lg border border-white/10 active:scale-95 transition-transform relative overflow-hidden"
                style={{ background: color }}
            >
                <div className="absolute inset-0 bg-gradient-to-tr from-black/10 to-transparent"></div>
                <div className="relative z-10 drop-shadow-md text-white">{icon}</div>
            </button>
            <span className="text-[10px] font-medium text-white/90 drop-shadow-md tracking-wide px-1 py-0.5 rounded bg-black/10 backdrop-blur-[2px]">{label}</span>
            {onDelete && (
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-1 -right-1 w-5 h-5 bg-slate-400 text-white rounded-full flex items-center justify-center text-[10px] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-red-500">×</button>
            )}
        </div>
    );

    const renderDesktop = () => {
        const bgStyle = targetChar?.dateBackground
            ? { backgroundImage: `url(${targetChar.dateBackground})` }
            : { background: 'linear-gradient(to bottom, #1e293b, #0f172a)' };

        return (
            <div className="absolute inset-0 flex flex-col z-0" style={{ ...bgStyle, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"></div>

                <div className="h-8 flex justify-between px-5 items-center text-white/80 text-[10px] font-bold z-20 relative">
                    <span>12:00</span>
                    <div className="flex gap-1.5 items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.204 3.182a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182a1.5 1.5 0 0 1 2.122 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0l-.53-.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        <div className="w-4 h-2 border border-current rounded-[2px] relative"><div className="absolute left-0 top-0 bottom-0 bg-current w-3/4"></div></div>
                    </div>
                </div>

                <div className="flex-1 p-5 z-10 overflow-y-auto no-scrollbar overscroll-none">
                    <div className="grid grid-cols-4 gap-y-6 gap-x-2 place-items-center content-start">
                        <AppIcon icon="💬" color="linear-gradient(135deg, #10b981, #059669)" label="Message" onClick={() => setActiveAppId('chat')} />
                        <AppIcon icon="🛍️" color="linear-gradient(135deg, #f97316, #ea580c)" label="Taobao" onClick={() => setActiveAppId('taobao')} />
                        <AppIcon icon="🍔" color="linear-gradient(135deg, #eab308, #ca8a04)" label="Food" onClick={() => setActiveAppId('waimai')} />
                        <AppIcon icon="⭕" color="linear-gradient(135deg, #6366f1, #4f46e5)" label="Moments" onClick={() => setActiveAppId('social')} />

                        {customApps.map(app => (
                            <AppIcon
                                key={app.id}
                                icon={app.icon}
                                color={app.color}
                                label={app.name}
                                onClick={() => setActiveAppId(app.id)}
                                onDelete={() => handleDeleteApp(app.id)}
                            />
                        ))}

                        <button onClick={() => setShowCreateModal(true)} className="flex flex-col items-center gap-1.5 group">
                            <div className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-2xl text-white shadow-lg active:scale-95 transition-transform hover:bg-white/30">
                                +
                            </div>
                            <span className="text-[10px] font-medium text-white/90 drop-shadow-md">Add App</span>
                        </button>

                        <button onClick={handleExitPhone} className="flex flex-col items-center gap-1.5 group">
                            <div className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] bg-red-500/20 backdrop-blur-md border border-red-400/50 flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-red-500/40">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>
                            </div>
                            <span className="text-[10px] font-medium text-white/90 drop-shadow-md">断开连接</span>
                        </button>

                        {/* Debug Toggle */}
                        <button onClick={() => setShowDebug(!showDebug)} className="flex flex-col items-center gap-1.5 group opacity-50 hover:opacity-100 transition-opacity">
                            <div className="w-[3.8rem] h-[3.8rem] rounded-[1.2rem] bg-black/20 backdrop-blur-md border border-white/10 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                                <span className="text-xl">🛠️</span>
                            </div>
                            <span className="text-[10px] font-medium text-white/90 drop-shadow-md">Debug UI</span>
                        </button>

                    </div>
                </div>

                <div className="p-4 z-20">
                    <div className="bg-white/20 backdrop-blur-xl rounded-[2rem] p-3 flex justify-around items-center border border-white/10 shadow-lg">
                        <button onClick={() => { }} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center text-2xl shadow-sm">📞</div></button>
                        <button onClick={() => setActiveAppId('chat')} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center text-2xl shadow-sm">💬</div></button>
                        <button onClick={() => { }} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm">🧭</div></button>
                        <button onClick={() => { }} className="p-2 rounded-xl active:bg-white/20 transition-colors"><div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-2xl shadow-sm">⚙️</div></button>
                    </div>
                </div>
            </div>
        );
    };

    if (view === 'select') {
        return (
            <div className="absolute inset-0 flex flex-col bg-slate-900 font-light overflow-hidden">
                <div className="h-20 pt-4 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10 shrink-0">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-white/10 text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-white tracking-widest uppercase text-sm">Target Device</span>
                    <div className="w-8"></div>
                </div>
                <div className="flex-1 min-h-0 p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar overscroll-contain content-start">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleSelectChar(c)} className="aspect-[3/4] bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col items-center justify-center gap-4 cursor-pointer active:scale-95 transition-all group hover:border-green-500 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                            <div className="w-20 h-20 rounded-full p-[2px] border-2 border-slate-600 group-hover:border-green-500 transition-colors">
                                <img src={c.avatar} className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                            </div>
                            <div className="text-center">
                                <div className="font-bold text-slate-300 text-sm group-hover:text-green-400">{c.name}</div>
                                <div className="text-[10px] text-slate-500 font-mono mt-1">
                                    CONNECT &gt;
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Phone View Container
    // FIXED: Use absolute inset-0 to force fill parent container properly
    return (
        <div className="absolute inset-0 bg-slate-900 overflow-hidden font-sans overscroll-none">
            {showDebug && <LayoutInspector />}
            {activeAppId === 'home' ? renderDesktop() : (
                <>
                    {activeAppId === 'chat' && renderChatList()}
                    {activeAppId === 'chat_detail' && renderChatDetail()}
                    {activeAppId === 'taobao' && renderTaobaoList()}
                    {activeAppId === 'waimai' && renderMeituanList()}
                    {activeAppId === 'social' && renderMomentsList()}

                    {/* Render Custom Apps */}
                    {customApps.find(a => a.id === activeAppId) && (
                        (() => {
                            const app = customApps.find(a => a.id === activeAppId)!;
                            return renderGenericList(app.id, app.name, app.prompt);
                        })()
                    )}
                </>
            )}

            {/* Create App Modal */}
            <Modal isOpen={showCreateModal} title="安装自定义 App" onClose={() => setShowCreateModal(false)} footer={<button onClick={handleCreateCustomApp} className="w-full py-3 bg-blue-500 text-white font-bold rounded-2xl">安装到桌面</button>}>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-md border-2 border-slate-100 shrink-0" style={{ background: newAppColor }}>
                            {newAppIcon}
                        </div>
                        <div className="flex-1 space-y-2">
                            <input value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="App 名称 (如: 银行)" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" />
                            <div className="flex gap-2">
                                <input value={newAppIcon} onChange={e => setNewAppIcon(e.target.value)} placeholder="Emoji" className="w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-center" />
                                <input type="color" value={newAppColor} onChange={e => setNewAppColor(e.target.value)} className="h-9 flex-1 cursor-pointer rounded-lg bg-transparent" />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">功能指令 (AI Prompt)</label>
                        <textarea
                            value={newAppPrompt}
                            onChange={e => setNewAppPrompt(e.target.value)}
                            placeholder="例如: 显示该用户的存款余额、近期的转账记录以及理财收益。"
                            className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs resize-none"
                        />
                        <p className="text-[9px] text-slate-400 mt-1">AI 将根据此指令生成该 App 内部的数据。</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default CheckPhone;
