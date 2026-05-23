import React,{ useEffect,useMemo,useState } from 'react';
import { AppID,CharacterProfile,APIConfig,StoryPhoneCustomApp } from '../types';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { getChatContextMirror } from '../utils/chatContextMirror';
import { safeResponseJson } from '../utils/safeApi';
import { selectSecondaryApiConfig } from '../utils/runtimeConfig';
import { extractThinking } from '../utils/thinkingExtractor';
import Modal from '../components/os/Modal';
import { CaretLeft } from '@phosphor-icons/react';
import StoryPhoneScreen, {
    PHONE_APPS,
    pickRandomPhoneApp,
    type PhoneAppDef,
    type PhoneClue,
    type PhoneClueItem,
    type StoryPhoneAppId,
} from '../components/story-phone/StoryPhoneScreen';

const CUSTOM_APP_ID_PREFIX = 'story-custom-app-';
const CUSTOM_ICON_PRESETS = ['💳', '🗂️', '🔐', '🎧', '🍜', '🧾', '📍', '🪞'];
const CUSTOM_COLOR_PRESETS = ['#0ea5e9', '#10b981', '#f97316', '#e11d48', '#8b5cf6', '#0f172a'];

function extractJsonObject(raw: string): any | null {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last < first) return null;
    try {
        return JSON.parse(cleaned.slice(first, last + 1));
    } catch {
        return null;
    }
}

function toPhoneAppDef(app: StoryPhoneCustomApp): PhoneAppDef {
    return {
        id: app.id,
        name: app.name,
        icon: app.icon || '▣',
        color: app.color || '#0ea5e9',
        prompt: app.prompt,
        isCustom: true,
    };
}

function normalizeClue(value: any, app: PhoneAppDef): PhoneClue {
    const rawItems = Array.isArray(value?.items) ? value.items : [];
    const items = rawItems
        .slice(0, 6)
        .map((item: any): PhoneClueItem => ({
            label: String(item?.label || item?.title || '记录').slice(0, 40),
            value: String(item?.value || item?.content || item?.text || '').slice(0, 260),
            detail: item?.detail ? String(item.detail).slice(0, 320) : undefined,
        }))
        .filter((item: PhoneClueItem) => item.value.trim() || item.detail?.trim());

    return {
        appId: app.id,
        appName: String(value?.appName || app.name).slice(0, 20),
        title: String(value?.title || `${app.name}里亮了一下`).slice(0, 60),
        subtitle: value?.subtitle ? String(value.subtitle).slice(0, 80) : undefined,
        timestamp: value?.timestamp ? String(value.timestamp).slice(0, 40) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: items.length > 0 ? items : [{ label: '线索', value: String(value?.evidenceText || '屏幕上有一条没来得及藏好的记录。').slice(0, 260) }],
        evidenceText: String(value?.evidenceText || value?.insertSummary || '').slice(0, 800),
        insertSummary: String(value?.insertSummary || value?.evidenceText || '').slice(0, 800),
    };
}

function formatFallbackHistory(messages: Awaited<ReturnType<typeof DB.getMessagesByCharId>>, char: CharacterProfile, userName: string): string {
    const limit = char.contextLimit || 500;
    return messages.slice(-limit).map(message => {
        const speaker = message.role === 'user' ? userName : message.role === 'assistant' ? char.name : '系统';
        const content = message.type === 'text' ? message.content : `[${message.type}]`;
        return `${speaker}: ${content}`;
    }).join('\n');
}

function formatStoryPhoneContext(clue: PhoneClue, char: CharacterProfile, userName: string): string {
    const summary = clue.insertSummary || clue.evidenceText || `${userName} 查看了 ${char.name} 手机里的 ${clue.appName}。`;
    const itemLines = clue.items.map((item, index) => {
        const parts = [
            `${index + 1}. ${item.label}`,
            `   ${item.value}`,
            item.detail ? `   细节: ${item.detail}` : '',
        ].filter(Boolean);
        return parts.join('\n');
    }).join('\n');

    return `[系统: ${userName} 查看了 ${char.name} 手机中的「${clue.appName}」。]

【剧情摘要】
${summary}

【手机屏幕全量】
App: ${clue.appName}
标题: ${clue.title}
${clue.subtitle ? `状态: ${clue.subtitle}\n` : ''}${clue.timestamp ? `时间: ${clue.timestamp}\n` : ''}${itemLines || clue.evidenceText || '（没有可见条目）'}`;
}

const StoryPhoneApp: React.FC = () => {
    const { characters, activeCharacterId, apiConfig, userProfile, appParams, openApp, closeApp, addToast, updateCharacter } = useOS();
    const targetCharId = typeof appParams?.targetCharId === 'string' ? appParams.targetCharId : activeCharacterId;
    const char = useMemo(
        () => characters.find(c => c.id === targetCharId) || characters.find(c => c.id === activeCharacterId) || characters[0],
        [activeCharacterId, characters, targetCharId],
    );

    const customApps = useMemo(
        () => char?.storyPhoneState?.customApps || [],
        [char?.storyPhoneState?.customApps],
    );
    const installedApps = useMemo(
        () => [...PHONE_APPS, ...customApps.map(toPhoneAppDef)],
        [customApps],
    );

    const [spotlightApp, setSpotlightApp] = useState<PhoneAppDef>(() => pickRandomPhoneApp(PHONE_APPS));
    const [activeAppId, setActiveAppId] = useState<StoryPhoneAppId | 'home'>('home');
    const [clue, setClue] = useState<PhoneClue | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [inserted, setInserted] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppIcon, setNewAppIcon] = useState(CUSTOM_ICON_PRESETS[0]);
    const [newAppColor, setNewAppColor] = useState(CUSTOM_COLOR_PRESETS[0]);
    const [newAppPrompt, setNewAppPrompt] = useState('');

    useEffect(() => {
        setSpotlightApp(pickRandomPhoneApp(installedApps));
        setActiveAppId('home');
        setClue(null);
        setInserted(false);
    }, [char?.id]);

    useEffect(() => {
        const appStillInstalled = installedApps.some(app => app.id === activeAppId);
        if (activeAppId !== 'home' && !appStillInstalled) {
            setActiveAppId('home');
            setClue(null);
            setInserted(false);
        }
        if (!installedApps.some(app => app.id === spotlightApp.id)) {
            setSpotlightApp(pickRandomPhoneApp(installedApps));
        }
    }, [activeAppId, installedApps, spotlightApp.id]);

    const handleBack = () => {
        if (activeAppId !== 'home') {
            setActiveAppId('home');
            return;
        }
        if (appParams?.returnApp === AppID.Chat && char?.id) {
            openApp(AppID.Chat, { targetCharId: char.id });
            return;
        }
        closeApp();
    };

    const resetInstallForm = () => {
        setNewAppName('');
        setNewAppIcon(CUSTOM_ICON_PRESETS[0]);
        setNewAppColor(CUSTOM_COLOR_PRESETS[0]);
        setNewAppPrompt('');
    };

    const handleOpenInstallModal = () => {
        resetInstallForm();
        setShowInstallModal(true);
    };

    const handleInstallApp = () => {
        if (!char) return;
        const name = newAppName.trim().slice(0, 14);
        const prompt = newAppPrompt.trim().slice(0, 500);
        if (!name || !prompt) {
            addToast('App 名称和生成方向都要填', 'error');
            return;
        }

        const app: StoryPhoneCustomApp = {
            id: `${CUSTOM_APP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            icon: newAppIcon.trim().slice(0, 4) || CUSTOM_ICON_PRESETS[0],
            color: newAppColor,
            prompt,
            installedAt: Date.now(),
        };
        const nextCustomApps = [...customApps, app];
        const appDef = toPhoneAppDef(app);

        updateCharacter(char.id, {
            storyPhoneState: {
                ...char.storyPhoneState,
                customApps: nextCustomApps,
            },
        });
        setSpotlightApp(appDef);
        setActiveAppId(appDef.id);
        setClue(null);
        setInserted(false);
        setShowInstallModal(false);
        resetInstallForm();
        addToast(`已安装 ${app.name}`, 'success');
    };

    const handleUninstallApp = (app: PhoneAppDef) => {
        if (!char || !app.isCustom) return;
        const nextCustomApps = customApps.filter(item => item.id !== app.id);
        const nextInstalledApps = [...PHONE_APPS, ...nextCustomApps.map(toPhoneAppDef)];

        updateCharacter(char.id, {
            storyPhoneState: {
                ...char.storyPhoneState,
                customApps: nextCustomApps,
            },
        });
        if (activeAppId === app.id) {
            setActiveAppId('home');
            setClue(null);
            setInserted(false);
        }
        if (spotlightApp.id === app.id) {
            setSpotlightApp(pickRandomPhoneApp(nextInstalledApps));
        }
        addToast(`已卸载 ${app.name}`, 'success');
    };

    const buildGenerationMessages = async (app: PhoneAppDef, config: APIConfig) => {
        if (!char) return null;
        const mirror = await getChatContextMirror(char.id);
        const task = `### [Task: 剧情查手机]
你正在生成 ${char.name} 手机里「${app.name}」App 的可见内容。

App 生成方向：
${app.prompt}

输出 JSON 对象，字段必须如下：
{
  "appName": "${app.name}",
  "title": "屏幕标题",
  "subtitle": "可选的一句状态/时间/联系人",
  "timestamp": "可选时间",
  "items": [{ "label": "屏幕字段/列表名", "value": "手机屏幕上逐字或近似逐字可见的内容", "detail": "可选的小字、时间、地点、备注" }],
  "evidenceText": "用自然语言说明这些屏幕内容意味着什么",
  "insertSummary": "如果用户选择放进剧情，要写入聊天上下文的一到两句话摘要"
}

硬性要求：
- 内容必须紧贴当前聊天、完整人设、世界观、关系阶段和 ${char.name} 的本轮 thinking。
- 可以读 thinking 来贴近潜台词，但不要复述 thinking，不要提到“思考链”。
- items 是手机界面上看到的原文/列表项/标题/记录，不要写成剧情摘要；除非 App 本身是备忘录或邮件正文，否则不要把 item.value 写成一整段旁白。
- insertSummary 是给后续剧情用的摘要，不能简单复制 items 的全文。
- evidenceText 可以解释用户看到了什么，但不要和 insertSummary 逐字重复。
- 这是手机屏幕里的证据，不是旁白；不要替用户或角色做出后续反应。
- 如果这是用户安装的自定义 App，也要把它当作 ${char.name} 手机里真实存在的 App 来写。
- 只输出 JSON，不要 Markdown。`;

        if (mirror) {
            return [
                ...mirror.messages,
                {
                    role: 'user',
                    content: `### [Main Chat Mirror]
以下是主聊天刚刚完成后的镜像信息，供你对齐剧情后台。

【${char.name} 本轮可见回复】
${mirror.assistantReply || '（无）'}

【${char.name} 本轮 thinking / 思考链】
${mirror.thinking || '（无）'}

【镜像元信息】
主聊天实际上下文消息数：${mirror.historyMsgCount}
角色上下文上限：${mirror.contextLimit}
模型：${mirror.model || config.model}

${task}`,
                },
            ];
        }

        const messages = await DB.getMessagesByCharId(char.id);
        const fallbackContext = ContextBuilder.buildCoreContext(char, userProfile, true);
        return [{
            role: 'user',
            content: `${fallbackContext}

### [Chat Context: fallback uses character contextLimit]
${formatFallbackHistory(messages, char, userProfile.name)}

${task}`,
        }];
    };

    const generateForApp = async (app: PhoneAppDef) => {
        if (!char) return;
        const config = (selectSecondaryApiConfig() || apiConfig) as APIConfig;
        if (!config?.baseUrl || !config.apiKey || !config.model) {
            addToast('先配置可用的副模型或主模型 API', 'error');
            return;
        }

        setActiveAppId(app.id);
        setIsLoading(true);
        setInserted(false);
        try {
            const messages = await buildGenerationMessages(app, config);
            if (!messages) return;
            const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages,
                    temperature: 0.82,
                    stream: false,
                }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await safeResponseJson(response);
            const raw = data.choices?.[0]?.message?.content
                || data.choices?.[0]?.message?.reasoning_content
                || data.choices?.[0]?.message?.thinking
                || '';
            const extracted = extractThinking(String(raw));
            const parsed = extractJsonObject(extracted.content || String(raw));
            if (!parsed) throw new Error('JSON parse failed');
            setClue(normalizeClue(parsed, app));
        } catch (error) {
            console.error('[StoryPhone] generate failed:', error);
            addToast('手机内容没生成出来，再点一次试试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const wallpaper = char?.dateBackground || char?.chatBackground || 'linear-gradient(145deg, #1f2937 0%, #0f172a 46%, #4c1d95 100%)';

    const handleInsertContext = async () => {
        if (!char || !clue || inserted) return;
        const sourceApp = installedApps.find(app => app.id === clue.appId);
        const fullContext = formatStoryPhoneContext(clue, char, userProfile.name);
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: fullContext,
            metadata: {
                source: 'story_phone',
                phonePeekAppId: clue.appId,
                phonePeekAppName: clue.appName,
                phonePeekTitle: clue.title,
                phonePeekSubtitle: clue.subtitle,
                phonePeekTimestamp: clue.timestamp,
                phonePeekItems: clue.items,
                phonePeekEvidence: clue.evidenceText,
                phonePeekInsertSummary: clue.insertSummary,
                phonePeekWallpaper: wallpaper,
                phonePeekAppIcon: sourceApp?.icon,
                phonePeekAppColor: sourceApp?.color,
                phonePeekAppIsCustom: sourceApp?.isCustom,
                charName: char.name,
                charAvatar: char.avatar,
            },
        });
        setInserted(true);
        addToast('已放进剧情上下文', 'success');
    };

    if (!char) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-white">
                <button onClick={closeApp} className="rounded-full bg-white/10 px-4 py-2 text-sm">返回</button>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-hidden bg-[#e8ebe9] text-[#3e4245]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(255,255,255,0.78),transparent_34%),radial-gradient(circle_at_88%_18%,rgba(210,214,211,0.42),transparent_30%),linear-gradient(180deg,#f2f4f2_0%,#e8ebe9_54%,#d9ddda_100%)]" />
            <div className="absolute left-10 top-24 h-px w-36 bg-[#9b927f]/18" />
            <div className="absolute bottom-24 right-8 h-24 w-16 rotate-12 border border-[#9b927f]/10 bg-white/20" />

            <div className="relative z-10 flex h-full flex-col px-4 pb-5 pt-10">
                <div className="mb-3 flex items-center justify-between">
                    <button
                        onClick={handleBack}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(120,120,120,0.18)] bg-white/70 text-[#3e4245] shadow-[0_10px_22px_rgba(64,69,71,0.1),inset_0_1px_0_rgba(255,255,255,0.88)] active:scale-95"
                        aria-label="返回"
                    >
                        <CaretLeft weight="bold" className="h-5 w-5" />
                    </button>
                    <div className="min-w-0 text-center">
                        <div className="text-[15px] font-semibold tracking-wide">{char.name} 的手机</div>
                        <div className="text-[10px] font-medium text-[#3e4245]/45">剧情查手机</div>
                    </div>
                    <img src={char.avatar} className="h-10 w-10 rounded-2xl object-cover grayscale-[25%] saturate-[0.72] shadow-[0_10px_22px_rgba(64,69,71,0.14)] ring-1 ring-white/80" alt={char.name} />
                </div>

                <div className="mx-auto flex min-h-0 w-full max-w-[23rem] flex-1 items-center justify-center">
                    <StoryPhoneScreen
                        charName={char.name}
                        charAvatar={char.avatar}
                        wallpaper={wallpaper}
                        apps={installedApps}
                        activeAppId={activeAppId}
                        spotlightApp={spotlightApp}
                        clue={clue}
                        isLoading={isLoading}
                        inserted={inserted}
                        onBackHome={() => setActiveAppId('home')}
                        onOpenApp={app => setActiveAppId(app.id)}
                        onGenerateApp={app => void generateForApp(app)}
                        onInstallApp={handleOpenInstallModal}
                        onUninstallApp={handleUninstallApp}
                        onPeekOnly={() => setActiveAppId('home')}
                        onInsertContext={handleInsertContext}
                    />
                </div>
            </div>

            <Modal
                isOpen={showInstallModal}
                title="安装 App"
                onClose={() => setShowInstallModal(false)}
                footer={(
                    <>
                        <button
                            onClick={() => setShowInstallModal(false)}
                            className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-500 active:scale-95"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleInstallApp}
                            disabled={!newAppName.trim() || !newAppPrompt.trim()}
                            className="flex-1 rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
                        >
                            安装
                        </button>
                    </>
                )}
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <div
                            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl text-white shadow-lg ring-1 ring-black/5"
                            style={{ background: newAppColor }}
                        >
                            {newAppIcon}
                        </div>
                        <div className="min-w-0 flex-1">
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">App 名称</label>
                            <input
                                value={newAppName}
                                onChange={event => setNewAppName(event.target.value)}
                                maxLength={14}
                                placeholder="银行 / 邮箱 / 秘密相册"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-slate-400">图标</label>
                        <div className="grid grid-cols-8 gap-2">
                            {CUSTOM_ICON_PRESETS.map(icon => (
                                <button
                                    key={icon}
                                    onClick={() => setNewAppIcon(icon)}
                                    className={`flex h-8 w-8 items-center justify-center rounded-xl text-lg active:scale-95 ${newAppIcon === icon ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                                    aria-label={`选择图标 ${icon}`}
                                >
                                    {icon}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-slate-400">颜色</label>
                        <div className="flex items-center gap-2">
                            {CUSTOM_COLOR_PRESETS.map(color => (
                                <button
                                    key={color}
                                    onClick={() => setNewAppColor(color)}
                                    className={`h-8 w-8 rounded-xl ring-offset-2 active:scale-95 ${newAppColor === color ? 'ring-2 ring-slate-900' : 'ring-1 ring-slate-200'}`}
                                    style={{ background: color }}
                                    aria-label={`选择颜色 ${color}`}
                                />
                            ))}
                            <input
                                type="color"
                                value={newAppColor}
                                onChange={event => setNewAppColor(event.target.value)}
                                className="h-8 w-10 cursor-pointer rounded-xl border border-slate-200 bg-white"
                                aria-label="自定义颜色"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">生成方向</label>
                        <textarea
                            value={newAppPrompt}
                            onChange={event => setNewAppPrompt(event.target.value)}
                            maxLength={500}
                            placeholder="例如：生成近期银行卡流水、余额变动和一条不太想被看到的转账备注。"
                            className="h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 outline-none focus:border-slate-400"
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default StoryPhoneApp;
