import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CustomStatusTemplate } from '../types/statusCard';
import { getSecondaryApiConfig } from '../utils/runtimeConfig';

type TabId = 'prompt' | 'html';

type GeneratorField = {
    name: string;
    desc: string;
};

type DebouncedPreviewUpdate = ((html: string) => void) & {
    cancel: () => void;
};

const PREVIEW_SHELL = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
html, body {
    margin: 0;
    padding: 0;
    background: transparent;
}
body {
    min-height: 100%;
}
#root {
    width: 100%;
}
</style>
</head>
<body>
<div id="styles"></div>
<div id="root"></div>
<script>
(function () {
    var root = document.getElementById('root');
    var styles = document.getElementById('styles');

    function reportHeight() {
        var nextHeight = Math.max(
            document.documentElement.scrollHeight || 0,
            document.body.scrollHeight || 0,
            root ? root.scrollHeight || 0 : 0
        );
        parent.postMessage({ type: 'preview-height', height: nextHeight }, '*');
    }

    window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'preview-update') return;

        var html = typeof e.data.html === 'string' ? e.data.html : '';

        try {
            var parsed = new DOMParser().parseFromString(html, 'text/html');
            var headNodes = [];

            if (parsed.head && parsed.head.children) {
                Array.prototype.forEach.call(parsed.head.children, function (node) {
                    if (node && typeof node.outerHTML === 'string') {
                        headNodes.push(node.outerHTML);
                    }
                });
            }

            styles.innerHTML = headNodes.join('');
            root.innerHTML = parsed.body && parsed.body.innerHTML ? parsed.body.innerHTML : html;
            document.body.style.cssText = 'margin:0;background:transparent;';

            if (parsed.body && parsed.body.getAttribute('style')) {
                document.body.style.cssText += parsed.body.getAttribute('style');
            }
        } catch (error) {
            styles.innerHTML = '';
            root.innerHTML = html;
            document.body.style.cssText = 'margin:0;background:transparent;';
        }

        requestAnimationFrame(function () {
            requestAnimationFrame(reportHeight);
        });
    });

    reportHeight();
})();
</script>
</body>
</html>`;

const DEFAULT_GENERATOR_FIELDS: GeneratorField[] = [
    { name: '时间', desc: '当前时间 HH:MM' },
    { name: '地点', desc: '角色所在位置' },
    { name: '动作', desc: '角色正在做什么' },
];

function createEmptyTemplate(index: number): CustomStatusTemplate {
    return {
        id: `tpl_${Date.now()}`,
        name: `方案 ${index + 1}`,
        systemPrompt: '',
        extractRegex: '',
        htmlTemplate: '',
        renderMode: 'html',
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const StatusWorkshopApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, addToast, updateCharacter } = useOS();

    const activeChar = useMemo(
        () => characters.find(c => c.id === activeCharacterId),
        [characters, activeCharacterId],
    );

    const [activeTab, setActiveTab] = useState<TabId>('prompt');
    const [templates, setTemplates] = useState<CustomStatusTemplate[]>(() => activeChar?.customStatusTemplates || []);
    const [activeTemplateId, setActiveTemplateId] = useState(
        () => activeChar?.activeCustomTemplateId || activeChar?.customStatusTemplates?.[0]?.id || '',
    );
    const [showGenerator, setShowGenerator] = useState(false);
    const [genDescription, setGenDescription] = useState('');
    const [genFields, setGenFields] = useState<GeneratorField[]>(DEFAULT_GENERATOR_FIELDS);
    const [isGenerating, setIsGenerating] = useState(false);
    const [previewHeight, setPreviewHeight] = useState(240);
    const [previewReady, setPreviewReady] = useState(false);

    const previewRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const nextTemplates = activeChar?.customStatusTemplates || [];
        const nextActiveId = activeChar?.activeCustomTemplateId && nextTemplates.some(t => t.id === activeChar.activeCustomTemplateId)
            ? activeChar.activeCustomTemplateId
            : nextTemplates[0]?.id || '';

        setTemplates(nextTemplates);
        setActiveTemplateId(nextActiveId);
    }, [activeChar]);

    const activeTemplate = useMemo(
        () => templates.find(t => t.id === activeTemplateId) || null,
        [templates, activeTemplateId],
    );

    const updateActiveTemplate = useCallback((patch: Partial<CustomStatusTemplate>) => {
        if (!activeTemplateId) return;
        setTemplates(prev => prev.map(template => (
            template.id === activeTemplateId
                ? { ...template, ...patch }
                : template
        )));
    }, [activeTemplateId]);

    const handleCreateTemplate = useCallback(() => {
        const nextTemplate = createEmptyTemplate(templates.length);
        setTemplates(prev => [...prev, nextTemplate]);
        setActiveTemplateId(nextTemplate.id);
        setActiveTab('prompt');
    }, [templates.length]);

    const handleCopyTemplate = useCallback(() => {
        if (!activeTemplate) {
            addToast('请先选择一个方案', 'error');
            return;
        }

        const copiedTemplate: CustomStatusTemplate = {
            ...activeTemplate,
            id: `tpl_${Date.now()}`,
            name: `${activeTemplate.name || '未命名方案'} 副本`,
        };

        setTemplates(prev => [...prev, copiedTemplate]);
        setActiveTemplateId(copiedTemplate.id);
        setActiveTab('prompt');
    }, [activeTemplate, addToast]);

    const handleDeleteTemplate = useCallback((templateId: string) => {
        setTemplates(prev => {
            const currentIndex = prev.findIndex(template => template.id === templateId);
            const next = prev.filter(template => template.id !== templateId);

            if (templateId === activeTemplateId) {
                const fallback = next[currentIndex] || next[currentIndex - 1] || next[0];
                setActiveTemplateId(fallback?.id || '');
            }

            return next;
        });
    }, [activeTemplateId]);

    const buildPreviewHtml = useCallback((template: CustomStatusTemplate | null) => {
        if (!template) {
            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);box-sizing:border-box;padding:24px;color:rgba(255,255,255,0.72);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC',sans-serif;"><div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.38;">Status Workshop</div><div style="margin-top:16px;font-size:18px;font-weight:600;">新建一个方案开始编辑</div><div style="margin-top:10px;font-size:13px;line-height:1.7;opacity:0.58;">这里会实时预览 HTML 模板。预览更新走 postMessage，不会反复重建 iframe。</div></div>`;
        }

        if (template.renderMode === 'text') {
            const lines = genFields
                .filter(field => field.name.trim())
                .map((field, index) => `${field.name}: [字段${index + 1}]`);
            const textPreview = lines.length > 0
                ? lines.join('\n')
                : '字段1: [字段1]\n字段2: [字段2]\n字段3: [字段3]';

            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;background:linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.08);box-sizing:border-box;padding:22px;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC',sans-serif;box-shadow:0 18px 40px rgba(0,0,0,0.28);"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><div style="font-size:15px;font-weight:600;">文本模式预览</div><div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.48;">Text</div></div><pre style="margin:18px 0 0;white-space:pre-wrap;font:500 13px/1.8 'SF Mono','Fira Code',monospace;color:rgba(236,253,245,0.88);">${escapeHtml(textPreview)}</pre></div>`;
        }

        if (!template.htmlTemplate?.trim()) {
            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;border:1px dashed rgba(255,255,255,0.12);background:rgba(13,13,26,0.86);box-sizing:border-box;padding:24px;color:rgba(255,255,255,0.58);font-family:'SF Mono','Fira Code',monospace;"><div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.38;">HTML Template</div><div style="margin-top:16px;font-size:13px;line-height:1.8;">在右侧编辑器里写入完整 HTML，这里会用 [字段1]、[字段2]… 替换捕获组占位符并实时预览。</div></div>`;
        }

        return (template.htmlTemplate || '').replace(/\$(\d+)/g, (_, n) => `[字段${n}]`);
    }, [genFields]);

    const debouncedUpdate = useMemo<DebouncedPreviewUpdate>(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const send = ((html: string) => {
            if (timer) clearTimeout(timer);

            timer = setTimeout(() => {
                previewRef.current?.contentWindow?.postMessage(
                    { type: 'preview-update', html },
                    '*',
                );
            }, 200);
        }) as DebouncedPreviewUpdate;

        send.cancel = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };

        return send;
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<{ type?: string; height?: number }>) => {
            if (event.source !== previewRef.current?.contentWindow) return;
            if (event.data?.type !== 'preview-height') return;

            const nextHeight = typeof event.data.height === 'number'
                ? Math.min(Math.max(event.data.height + 16, 220), 560)
                : 240;

            setPreviewHeight(nextHeight);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        if (!previewReady) return;
        debouncedUpdate(buildPreviewHtml(activeTemplate));
    }, [activeTemplate, buildPreviewHtml, debouncedUpdate, previewReady]);

    useEffect(() => () => debouncedUpdate.cancel(), [debouncedUpdate]);

    const handleSave = async () => {
        if (!activeChar) {
            addToast('请先选择一个角色', 'error');
            return;
        }

        const selectedTemplateId = activeTemplateId || templates[0]?.id;

        try {
            await updateCharacter(activeChar.id, {
                customStatusTemplates: templates,
                activeCustomTemplateId: selectedTemplateId,
                statusBarMode: 'custom',
            });
            addToast('模板已保存', 'success');
        } catch (e: any) {
            addToast('保存失败: ' + (e.message || ''), 'error');
        }
    };

    const handleGenerate = async () => {
        const config = getSecondaryApiConfig();
        if (!config?.apiKey) {
            addToast('请先在全局设置中配置副 API', 'error');
            return;
        }

        const validFields = genFields.filter(field => field.name.trim());
        if (validFields.length === 0) {
            addToast('请至少填写一个字段', 'error');
            return;
        }

        let targetTemplateId = activeTemplateId;
        if (!targetTemplateId) {
            const nextTemplate = createEmptyTemplate(templates.length);
            setTemplates(prev => [...prev, nextTemplate]);
            setActiveTemplateId(nextTemplate.id);
            targetTemplateId = nextTemplate.id;
        }

        setIsGenerating(true);

        try {
            const fieldListStr = validFields
                .map(field => `- ${field.name}: ${field.desc}`)
                .join('\n');

            const prompt = `你是一个前端开发专家和 UI 设计师。用户想要一个聊天状态栏卡片模板。
用户描述的风格：「${genDescription || '简约深色风格'}」
需要展示的字段：
${fieldListStr}
请生成以下三项内容，用 JSON 格式输出：
{
  "systemPrompt": "给角色 AI 的 system prompt 片段，告诉它在每次回复末尾用 <status>...</status> 标签输出结构化状态数据。每个字段占一行，格式是 '字段名: 值'。",
  "extractRegex": "从 AI 回复中提取 <status> 块并捕获各字段值的正则表达式。使用 \\\\s* 匹配空白。",
  "htmlTemplate": "完整的 HTML 字符串。宽度 330px，自适应高度。内联样式，不依赖外部资源。用 $1, $2, $3... 代替各字段值（按字段顺序）。视觉效果要精致，可以用渐变、阴影、圆角等 CSS。必须包含 <meta charset='UTF-8'>。"
}
要求：
- 只输出 JSON，不要多余文字
- HTML 必须是完整可渲染的
- systemPrompt 要清晰告诉 AI 输出格式
- extractRegex 要能正确匹配 systemPrompt 要求的格式`;

            const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    stream: false,
                }),
            });

            const raw = await res.text();
            let data: any = {};

            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `副 API 返回了无效响应 (${res.status})`);
            }

            if (!res.ok) {
                throw new Error(data?.error?.message || data?.message || `生成失败 (${res.status})`);
            }

            const content = data.choices?.[0]?.message?.content || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('AI 未返回有效 JSON');
            }

            const result = JSON.parse(jsonMatch[0]);

            setTemplates(prev => prev.map(template => (
                template.id === targetTemplateId
                    ? {
                        ...template,
                        systemPrompt: result.systemPrompt || template.systemPrompt,
                        extractRegex: result.extractRegex || template.extractRegex,
                        htmlTemplate: result.htmlTemplate || template.htmlTemplate,
                        renderMode: 'html',
                    }
                    : template
            )));

            addToast('生成完成！请检查并微调', 'success');
        } catch (e: any) {
            addToast('生成失败: ' + (e.message || ''), 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const renderPromptTab = () => {
        if (!activeTemplate) {
            return (
                <div className="animate-fade-in rounded-[28px] border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm p-6 text-white/60">
                    <div className="text-[13px] font-semibold text-white/80">还没有方案</div>
                    <p className="mt-2 text-[12px] leading-6 text-white/40">先新建一个方案，再编辑 system prompt、提取正则和 HTML 模板。</p>
                    <button
                        onClick={handleCreateTemplate}
                        className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.08] px-4 py-2.5 text-[12px] font-semibold text-white/80 transition-all hover:bg-white/10 active:scale-[0.98]"
                    >
                        <span className="text-base leading-none">+</span>
                        新建方案
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-4 animate-fade-in">
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm">
                    <button
                        onClick={() => setShowGenerator(prev => !prev)}
                        className="flex w-full items-center justify-between px-5 py-4 text-left"
                    >
                        <div>
                            <div className="text-[13px] font-semibold text-white/80">AI 生成</div>
                            <p className="mt-1 text-[11px] leading-5 text-white/30">描述风格、配置字段，一键让副 API 生成 prompt / regex / HTML 三件套。</p>
                        </div>
                        <div className={`text-white/40 transition-transform ${showGenerator ? 'rotate-180' : ''}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-4 w-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                        </div>
                    </button>

                    {showGenerator && (
                        <div className="space-y-4 border-t border-white/[0.05] px-5 pb-5 pt-4">
                            <div>
                                <label className="mb-2 block text-[11px] font-semibold tracking-wide text-white/45">风格描述</label>
                                <textarea
                                    value={genDescription}
                                    onChange={e => setGenDescription(e.target.value)}
                                    placeholder="描述你想要的卡片风格，如：赛博朋克风格，深色背景，霓虹边框…"
                                    className="h-24 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                                />
                            </div>

                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <label className="text-[11px] font-semibold tracking-wide text-white/45">字段列表</label>
                                    <button
                                        onClick={() => setGenFields(prev => [...prev, { name: '', desc: '' }])}
                                        className="rounded-xl border border-white/[0.05] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-white/60 transition-all hover:bg-white/[0.08]"
                                    >
                                        + 添加字段
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {genFields.map((field, index) => (
                                        <div key={`${index}-${field.name}`} className="grid grid-cols-[108px,1fr,40px] gap-2">
                                            <input
                                                value={field.name}
                                                onChange={e => setGenFields(prev => prev.map((item, itemIndex) => (
                                                    itemIndex === index
                                                        ? { ...item, name: e.target.value }
                                                        : item
                                                )))}
                                                placeholder="字段名"
                                                className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 text-[12px] text-white/75 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                                            />
                                            <input
                                                value={field.desc}
                                                onChange={e => setGenFields(prev => prev.map((item, itemIndex) => (
                                                    itemIndex === index
                                                        ? { ...item, desc: e.target.value }
                                                        : item
                                                )))}
                                                placeholder="字段说明"
                                                className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 text-[12px] text-white/75 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                                            />
                                            <button
                                                onClick={() => setGenFields(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
                                                disabled={genFields.length === 1}
                                                className={`rounded-xl border text-[12px] transition-all ${
                                                    genFields.length === 1
                                                        ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/15'
                                                        : 'border-white/[0.05] bg-white/[0.05] text-white/40 hover:bg-white/[0.08]'
                                                }`}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/[0.04] bg-[#0d0d1a] px-4 py-3 text-[11px] leading-6 text-white/35">
                                生成会覆盖当前方案的 system prompt、提取正则和 HTML 模板。结果建议先预览，再按需要微调。
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                    className={`rounded-2xl px-4 py-2.5 text-[12px] font-semibold transition-all ${
                                        isGenerating
                                            ? 'cursor-wait bg-white/[0.05] text-white/35'
                                            : 'bg-white/[0.10] text-white/85 hover:bg-white/[0.14] active:scale-[0.98]'
                                    }`}
                                >
                                    {isGenerating ? '生成中…' : '生成'}
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                    className={`rounded-2xl border border-white/[0.05] px-4 py-2.5 text-[12px] font-semibold transition-all ${
                                        isGenerating
                                            ? 'cursor-wait bg-white/[0.03] text-white/25'
                                            : 'bg-white/[0.04] text-white/65 hover:bg-white/[0.07] active:scale-[0.98]'
                                    }`}
                                >
                                    重新生成
                                </button>
                                <button
                                    disabled
                                    title="即将推出"
                                    className="cursor-not-allowed rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-2.5 text-[12px] font-semibold text-white/25 opacity-30"
                                >
                                    微调
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <label className="mb-3 block text-[11px] font-semibold tracking-wide text-white/45">System Prompt</label>
                    <textarea
                        value={activeTemplate.systemPrompt}
                        onChange={e => updateActiveTemplate({ systemPrompt: e.target.value })}
                        placeholder="告诉角色 AI 应该如何在回复末尾输出 <status>...</status> 结构化数据。"
                        className="h-56 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-4 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/18 focus:border-white/15"
                        spellCheck={false}
                    />
                    <p className="mt-3 text-[11px] leading-6 text-white/28">这段提示会注入到副模型，决定它输出的状态块格式和字段顺序。</p>
                </div>

                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <label className="mb-3 block text-[11px] font-semibold tracking-wide text-white/45">提取正则</label>
                    <textarea
                        value={activeTemplate.extractRegex}
                        onChange={e => updateActiveTemplate({ extractRegex: e.target.value })}
                        placeholder="<status>\\s*时间:\\s*(.*?)\\s*地点:\\s*(.*?)\\s*动作:\\s*(.*?)\\s*<\\/status>"
                        className="h-28 w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-emerald-300/60 outline-none transition-colors placeholder:text-white/15 focus:border-white/15"
                        spellCheck={false}
                    />
                </div>

                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3 text-[11px] font-semibold tracking-wide text-white/45">渲染模式</div>
                    <div className="grid grid-cols-2 gap-2">
                        {(['html', 'text'] as const).map(mode => (
                            <button
                                key={mode}
                                onClick={() => updateActiveTemplate({ renderMode: mode })}
                                className={`rounded-2xl border px-4 py-3 text-[12px] font-semibold transition-all ${
                                    activeTemplate.renderMode === mode
                                        ? 'bg-white/10 border-white/15 text-white/80'
                                        : 'bg-white/[0.03] border-white/[0.05] text-white/38 hover:bg-white/[0.06]'
                                }`}
                            >
                                {mode === 'html' ? 'HTML 卡片' : '文本卡片'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderHtmlTab = () => {
        if (!activeTemplate) {
            return (
                <div className="animate-fade-in rounded-[28px] border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm p-6 text-[12px] leading-6 text-white/40">
                    先创建一个方案，再开始编写 HTML 模板。
                </div>
            );
        }

        return (
            <div className="space-y-4 animate-fade-in">
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold tracking-wide text-white/45">HTML 模板</div>
                        <div className="text-[10px] text-white/25">$1, $2, $3… 会按正则捕获组顺序替换</div>
                    </div>
                    <textarea
                        value={activeTemplate.htmlTemplate || ''}
                        onChange={e => updateActiveTemplate({ htmlTemplate: e.target.value })}
                        placeholder="<html><head><meta charset='UTF-8'></head><body>...</body></html>"
                        className="h-[460px] w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-emerald-300/60 outline-none transition-colors placeholder:text-white/15 focus:border-white/15"
                        spellCheck={false}
                    />
                </div>

                <div className="rounded-[24px] border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[11px] leading-6 text-white/32">
                    建议输出完整 HTML 文档，并在模板中内联样式。预览区会保留 head 里的样式节点，并通过 postMessage 增量刷新内容。
                </div>
            </div>
        );
    };

    return (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0a0a14] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 right-[-56px] h-64 w-64 rounded-full bg-sky-500/[0.08] blur-[90px]" />
                <div className="absolute bottom-[-90px] left-[-70px] h-72 w-72 rounded-full bg-emerald-500/[0.05] blur-[110px]" />
            </div>

            <div className="relative z-10 flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
                <button
                    onClick={closeApp}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] backdrop-blur-sm transition-all hover:bg-white/10 active:scale-90"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 text-white/70">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>

                <div className="px-4 text-center">
                    <h1 className="text-[15px] font-semibold tracking-wide text-white/90">状态栏工坊</h1>
                    <p className="mt-0.5 text-[10px] text-white/30">
                        {activeChar ? `为 ${activeChar.name} 管理多套方案` : '请先选择角色'}
                    </p>
                </div>

                <button
                    onClick={handleSave}
                    className="rounded-full border border-white/[0.06] bg-white/[0.08] px-4 py-2 text-[12px] font-semibold text-white/80 transition-all hover:bg-white/12 active:scale-95"
                >
                    保存
                </button>
            </div>

            <div className="relative z-10 px-4 pb-4">
                <div className="rounded-[30px] border border-white/[0.06] bg-white/[0.04] p-4 backdrop-blur-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex-1 overflow-x-auto pb-1">
                            <div className="flex min-w-max gap-2">
                                {templates.map(template => {
                                    const isActive = template.id === activeTemplateId;
                                    return (
                                        <div
                                            key={template.id}
                                            className={`flex items-center gap-1 rounded-2xl border px-2 py-1 ${
                                                isActive
                                                    ? 'bg-white/10 border-white/15 text-white/80'
                                                    : 'bg-white/[0.04] border-white/[0.05] text-white/45'
                                            }`}
                                        >
                                            <button
                                                onClick={() => setActiveTemplateId(template.id)}
                                                className="rounded-xl px-2 py-1 text-[12px] font-medium transition-opacity hover:opacity-100"
                                            >
                                                {template.name || '未命名方案'}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTemplate(template.id)}
                                                className="flex h-6 w-6 items-center justify-center rounded-lg text-[14px] text-white/35 transition-all hover:bg-white/[0.08] hover:text-white/70"
                                                title="删除方案"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    );
                                })}

                                {templates.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-2 text-[12px] text-white/28">
                                        还没有任何方案
                                    </div>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={handleCreateTemplate}
                            className="rounded-2xl border border-white/[0.05] bg-white/[0.06] px-3 py-2 text-[12px] font-semibold text-white/75 transition-all hover:bg-white/10 active:scale-[0.98]"
                        >
                            + 新建方案
                        </button>
                        <button
                            onClick={handleCopyTemplate}
                            disabled={!activeTemplate}
                            className={`rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all ${
                                activeTemplate
                                    ? 'border-white/[0.05] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] active:scale-[0.98]'
                                    : 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/20'
                            }`}
                        >
                            复制当前方案
                        </button>
                    </div>

                    {activeTemplate && (
                        <div className="mt-3">
                            <label className="mb-2 block text-[11px] font-semibold tracking-wide text-white/40">方案名称</label>
                            <input
                                value={activeTemplate.name}
                                onChange={e => updateActiveTemplate({ name: e.target.value })}
                                placeholder="给当前方案起个名字"
                                className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[13px] text-white/80 outline-none transition-colors placeholder:text-white/18 focus:border-white/15"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 lg:flex-row">
                <div className="min-h-0 flex-1 rounded-[32px] border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-sm">
                    <div className="mb-4 flex gap-2">
                        {([
                            { id: 'prompt', label: 'Prompt / 提取' },
                            { id: 'html', label: 'HTML 模板' },
                        ] as const).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`rounded-2xl px-4 py-2.5 text-[12px] font-semibold transition-all ${
                                    activeTab === tab.id
                                        ? 'bg-white/10 border border-white/15 text-white/80'
                                        : 'bg-white/[0.03] text-white/35 hover:bg-white/[0.06]'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="h-[calc(100%-52px)] overflow-y-auto pr-1">
                        {activeTab === 'prompt' ? renderPromptTab() : renderHtmlTab()}
                    </div>
                </div>

                <div className="lg:w-[400px]">
                    <div className="rounded-[32px] border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-sm">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <div className="text-[13px] font-semibold text-white/80">实时预览</div>
                                <p className="mt-1 text-[11px] text-white/28">iframe 只加载一次，后续通过 postMessage 更新内容。</p>
                            </div>
                            <div className="rounded-full border border-white/[0.05] bg-white/[0.05] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/30">
                                preview
                            </div>
                        </div>

                        <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-[28px] border border-white/[0.05] bg-[#06060d] px-3 py-5">
                            <iframe
                                ref={previewRef}
                                srcDoc={PREVIEW_SHELL}
                                sandbox="allow-scripts"
                                title="状态栏预览"
                                className="w-full rounded-[24px] border-0 bg-transparent"
                                style={{ height: `${previewHeight}px` }}
                                onLoad={() => setPreviewReady(true)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StatusWorkshopApp;
