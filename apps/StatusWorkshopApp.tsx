import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import {
    CustomStatusTemplate,
    StatusWorkshopInteractionMode,
    StatusWorkshopReviewFlags,
    TemplateField,
} from '../types/statusCard';
import { STATUS_CARD_IFRAME_SHELL } from '../components/chat/statusCardIframe';
import { getSecondaryApiConfig } from '../utils/runtimeConfig';
import {
    LAYERED_STATUS_TEMPLATE_VERSION,
    composeCustomStatusTemplateHtml,
    hasLayeredStatusTemplate,
    splitStatusTemplateHtml,
} from '../utils/statusTemplateComposer';

type TabId = 'system' | 'protocol' | 'interaction' | 'html' | 'css' | 'js';
type GenerationStep = 'system' | 'protocol' | 'html' | 'css' | 'js';
type GenerationMode = 'iterate' | 'replace';
type ReviewFlag = keyof StatusWorkshopReviewFlags;

export type GeneratorField = {
    id: string;
    name: string;
    desc: string;
};

type DebouncedPreviewUpdate = ((html: string, allowScripts?: boolean) => void) & {
    cancel: () => void;
};

const DEFAULT_GENERATOR_FIELDS: GeneratorField[] = [
    { id: 'default-time', name: '时间', desc: '当前时间 HH:MM' },
    { id: 'default-location', name: '地点', desc: '角色所在位置' },
    { id: 'default-action', name: '动作', desc: '角色正在做什么' },
];

const WORKSHOP_TEXT_ENTRY_PROPS = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'none',
    spellCheck: false,
} as const;

const WORKSHOP_TEXT_INPUT_PROPS = {
    ...WORKSHOP_TEXT_ENTRY_PROPS,
    inputMode: 'text',
} as const;

const STATUS_WORKSHOP_EXPORT_TYPE = 'sully.statusWorkshop.templates';
const STATUS_WORKSHOP_EXPORT_VERSION = 1;

let generatorFieldIdCounter = 0;

function createGeneratorField(name = '', desc = ''): GeneratorField {
    generatorFieldIdCounter += 1;
    return {
        id: `generated-field-${Date.now()}-${generatorFieldIdCounter}`,
        name,
        desc,
    };
}

const GENERATION_LABELS: Record<GenerationStep, string> = {
    system: '生成状态写法',
    protocol: '生成字段协议',
    html: '生成 HTML 骨架',
    css: '生成 / 优化 CSS',
    js: '生成互动 JS',
};

const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'protocol', label: '1 字段协议' },
    { id: 'system', label: '2 TA 的状态写法' },
    { id: 'interaction', label: '3 互动需求' },
    { id: 'html', label: '4 HTML 骨架' },
    { id: 'css', label: '5 CSS 美化' },
    { id: 'js', label: '6 互动 JS' },
];

const INTERACTION_OPTIONS: Array<{
    id: StatusWorkshopInteractionMode;
    label: string;
    description: string;
}> = [
    { id: 'none', label: '无互动', description: '只展示状态卡，不生成 JS。' },
    { id: 'expand', label: '展开收起', description: '点击按钮展开更多字段或细节。' },
    { id: 'flip', label: '翻卡', description: '正反两面切换，适合隐藏心声或备注。' },
    { id: 'pages', label: '分页', description: '多页内容切换，适合字段较多的状态栏。' },
    { id: 'state', label: '状态切换', description: '点击切换心情、模式、重点字段等局部状态。' },
];

function createEmptyTemplate(index: number): CustomStatusTemplate {
    return {
        id: `tpl_${Date.now()}`,
        name: `方案 ${index + 1}`,
        systemPrompt: '',
        extractRegex: '',
        htmlTemplate: '',
        htmlBody: '',
        cssTemplate: '',
        jsTemplate: '',
        templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
        allowScripts: false,
        interactionMode: 'none',
        interactionIdea: '',
        reviewFlags: {},
        renderMode: 'html',
        fields: DEFAULT_GENERATOR_FIELDS.map((field, fieldIndex) => ({
            id: `field_${fieldIndex + 1}`,
            name: field.name,
            description: field.desc,
            required: true,
        })),
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

function getValidGeneratorFields(fields: GeneratorField[]): GeneratorField[] {
    return fields
        .map(field => ({
            id: field.id,
            name: field.name.trim(),
            desc: field.desc.trim(),
        }))
        .filter(field => field.name);
}

function toTemplateFields(fields: GeneratorField[]): TemplateField[] {
    return getValidGeneratorFields(fields).map((field, index) => ({
        id: `field_${index + 1}`,
        name: field.name,
        description: field.desc,
        required: true,
    }));
}

function templateFieldsToGeneratorFields(fields: TemplateField[] | undefined): GeneratorField[] {
    if (!fields?.length) {
        return DEFAULT_GENERATOR_FIELDS.map(field => ({ ...field }));
    }

    return fields.map((field, index) => ({
        id: field.id || `field_${index + 1}`,
        name: field.name || '',
        desc: field.description || '',
    }));
}

function getTemplateFieldList(template: CustomStatusTemplate | null, fallbackFields: GeneratorField[]): TemplateField[] {
    if (template?.fields?.length) return template.fields;
    return toTemplateFields(fallbackFields);
}

function formatFieldList(fields: GeneratorField[] | TemplateField[]): string {
    return fields
        .map((field, index) => {
            const name = 'name' in field ? field.name : '';
            const description = 'desc' in field ? field.desc : field.description;
            return `- ${name}: ${description || `字段 ${index + 1} 的状态值`}（占位符 $${index + 1}）`;
        })
        .join('\n');
}

function normalizeInteractionMode(mode: StatusWorkshopInteractionMode | undefined): StatusWorkshopInteractionMode {
    return INTERACTION_OPTIONS.some(option => option.id === mode) ? mode! : 'none';
}

function getTemplateInteraction(template: CustomStatusTemplate | null | undefined): {
    mode: StatusWorkshopInteractionMode;
    idea: string;
} {
    return {
        mode: normalizeInteractionMode(template?.interactionMode),
        idea: template?.interactionIdea?.trim() || '',
    };
}

export function describeInteractionRequirement(
    mode: StatusWorkshopInteractionMode = 'none',
    idea = '',
): string {
    const option = INTERACTION_OPTIONS.find(item => item.id === mode) || INTERACTION_OPTIONS[0];
    const trimmedIdea = idea.trim();
    if (option.id === 'none') {
        return '无互动：HTML 不需要按钮或交互钩子，CSS 不需要互动状态，JS 应返回空字符串。';
    }

    return [
        `互动类型：${option.label}`,
        `默认行为：${option.description}`,
        trimmedIdea ? `用户补充：${trimmedIdea}` : '用户补充：无',
        'HTML 阶段必须预留按钮、面板、data-action/data-state 或可切换 class；CSS 阶段必须提供对应 .is-* 状态样式；JS 阶段只绑定这些已有结构。',
    ].join('\n');
}

function markReviewFlags(
    template: CustomStatusTemplate,
    flags: ReviewFlag[] = [],
): CustomStatusTemplate {
    if (flags.length === 0) return template;
    return {
        ...template,
        reviewFlags: {
            ...template.reviewFlags,
            ...flags.reduce<StatusWorkshopReviewFlags>((acc, flag) => {
                acc[flag] = true;
                return acc;
            }, {}),
        },
    };
}

function clearReviewFlags(
    template: CustomStatusTemplate,
    flags: ReviewFlag[] = [],
): CustomStatusTemplate {
    if (flags.length === 0) return template;
    return {
        ...template,
        reviewFlags: {
            ...template.reviewFlags,
            ...flags.reduce<StatusWorkshopReviewFlags>((acc, flag) => {
                acc[flag] = false;
                return acc;
            }, {}),
        },
    };
}

function extractJsonObject(content: string): any {
    const cleaned = (content || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start < 0 || end <= start) {
        throw new Error('生成器未返回有效 JSON');
    }

    return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeGeneratedFields(fields: any, fallback: GeneratorField[]): TemplateField[] {
    if (!Array.isArray(fields)) return toTemplateFields(fallback);

    const normalized = fields
        .map((field: any, index: number) => ({
            id: `field_${index + 1}`,
            name: String(field?.name || '').trim(),
            description: String(field?.description || field?.desc || '').trim(),
            required: field?.required !== false,
        }))
        .filter((field: TemplateField) => field.name);

    return normalized.length ? normalized : toTemplateFields(fallback);
}

function isPlainRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function normalizeImportedFields(fields: unknown): TemplateField[] {
    if (!Array.isArray(fields)) return toTemplateFields(DEFAULT_GENERATOR_FIELDS);

    const normalized = fields
        .map((field, index) => {
            if (!isPlainRecord(field)) return null;
            const name = safeString(field.name).trim();
            if (!name) return null;

            return {
                id: safeString(field.id).trim() || `field_${index + 1}`,
                name,
                description: safeString(field.description || field.desc).trim(),
                required: field.required !== false,
            };
        })
        .filter((field): field is TemplateField => Boolean(field));

    return normalized.length ? normalized : toTemplateFields(DEFAULT_GENERATOR_FIELDS);
}

function createImportedTemplateId(index: number): string {
    return `tpl_import_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeImportedTemplate(value: unknown, index: number): CustomStatusTemplate | null {
    if (!isPlainRecord(value)) return null;

    const fallback = createEmptyTemplate(index);
    const rawName = safeString(value.name).trim();
    const name = rawName ? `${rawName} 导入` : `导入方案 ${index + 1}`;
    const jsTemplate = safeString(value.jsTemplate);

    return {
        ...fallback,
        id: createImportedTemplateId(index),
        name,
        systemPrompt: safeString(value.systemPrompt),
        extractRegex: safeString(value.extractRegex),
        htmlTemplate: safeString(value.htmlTemplate),
        htmlBody: safeString(value.htmlBody),
        cssTemplate: safeString(value.cssTemplate),
        jsTemplate,
        templateVersion: typeof value.templateVersion === 'number' ? value.templateVersion : LAYERED_STATUS_TEMPLATE_VERSION,
        allowScripts: value.allowScripts === true && jsTemplate.trim().length > 0,
        interactionMode: normalizeInteractionMode(value.interactionMode),
        interactionIdea: safeString(value.interactionIdea),
        reviewFlags: {},
        renderMode: value.renderMode === 'text' ? 'text' : 'html',
        fields: normalizeImportedFields(value.fields),
        cardStyle: isPlainRecord(value.cardStyle) ? value.cardStyle as CustomStatusTemplate['cardStyle'] : undefined,
    };
}

export function buildStatusWorkshopExportPayload(templates: CustomStatusTemplate[]) {
    return {
        type: STATUS_WORKSHOP_EXPORT_TYPE,
        version: STATUS_WORKSHOP_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        templates,
    };
}

export function parseStatusWorkshopImportPayload(payload: unknown, startIndex = 0): CustomStatusTemplate[] {
    let rawTemplates: unknown[] = [];

    if (Array.isArray(payload)) {
        rawTemplates = payload;
    } else if (isPlainRecord(payload)) {
        if (Array.isArray(payload.templates)) {
            rawTemplates = payload.templates;
        } else if (isPlainRecord(payload.template)) {
            rawTemplates = [payload.template];
        } else if ('systemPrompt' in payload || 'extractRegex' in payload || 'htmlBody' in payload || 'htmlTemplate' in payload) {
            rawTemplates = [payload];
        }
    }

    return rawTemplates
        .map((template, index) => normalizeImportedTemplate(template, startIndex + index))
        .filter((template): template is CustomStatusTemplate => Boolean(template));
}

function sanitizeExportFilename(value: string): string {
    const cleaned = value
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 48);

    return cleaned || '状态栏方案';
}

export function buildSystemPromptPrompt(
    userIdea: string,
    fields: GeneratorField[] | TemplateField[],
    currentSystemPrompt = '',
): string {
    const currentBlock = currentSystemPrompt.trim()
        ? `\n\n当前状态文本规则（请在这个基础上改进，不要退回空泛模板）：\n${currentSystemPrompt.trim()}`
        : '';

    return `你是状态记录写法设计师。

用户想做的状态栏：
「${userIdea}」

字段协议：
${formatFieldList(fields)}

${currentBlock}

请只生成“TA 的状态写法”规则。它负责说明 TA 如何在正常回应末尾写出状态记录，不负责重新设计字段、提取正则、HTML、CSS 或 JS。

写法要求：
- 正常回应照常写，不要因为状态记录破坏 TA 的语气
- 每次回应末尾追加唯一的 <status>...</status> 块
- 必须逐一覆盖字段协议中的每个字段，说明该字段应该从哪里取材、写多短、写到什么具体程度
- 字段值必须贴近刚才的回应和当前对话，优先使用最新动作、地点、身体状态、情绪变化和关系动态
- 字段值要短、具体、可渲染，避免“正常”“很好”“无变化”“未知”这类空泛占位
- 缺失信息时给每个字段安排稳定兜底写法，不要留空，不要长篇解释
- 不要解释状态记录，不要输出 markdown，不要增加未定义字段
- 只输出 JSON，不要 markdown

输出：
{
  "systemPrompt": "可直接保存的状态文本规则",
  "qualityNotes": "一句话说明这些规则如何保证每个字段都具体可用"
}`;
}

export function buildProtocolPrompt(userIdea: string, fields: GeneratorField[]): string {
    return `你是状态栏字段协议与正则设计师。

用户想做的状态栏：
「${userIdea}」

用户需要展示的字段：
${formatFieldList(fields)}

请只设计字段协议和 extractRegex 正则。不要写状态文本规则，不要写视觉，不要写 HTML、CSS、JS。

要求：
- TA 必须在每次回应末尾输出 <status>...</status>
- 每个字段独占一行
- 字段顺序必须严格等于用户字段顺序
- 字段格式必须是：字段名: 值
- extractRegex 必须捕获每个字段值
- 使用 [\\s\\S]*? 或 \\s* 兼容换行和空白
- 只输出 JSON，不要 markdown

输出：
{
  "extractRegex": "用于提取 <status> 块和字段值的正则",
  "fields": [
    { "name": "字段名", "description": "字段说明", "placeholder": "$1" }
  ]
}`;
}

export function buildHtmlPrompt(
    userIdea: string,
    fields: TemplateField[],
    interaction: { mode: StatusWorkshopInteractionMode; idea: string },
    currentHtmlBody = '',
): string {
    const interactionRequirement = describeInteractionRequirement(interaction.mode, interaction.idea);
    const currentBlock = currentHtmlBody.trim()
        ? `\n\n当前 HTML 骨架（请在这个基础上修改，保留可用结构、占位符和 class 命名，不要推倒重写）：\n${currentHtmlBody.trim()}`
        : '';

    return `你是状态栏 HTML 结构工程师。

用户想做的状态栏：
「${userIdea}」

字段协议：
${formatFieldList(fields)}

互动需求：
${interactionRequirement}

${currentBlock}

请生成状态栏 body 内部 HTML 骨架。

要求：
- 只生成 body 内部结构，不要输出完整 html/head/body
- 不要写 <style>
- 不要写 <script>
- 必须使用 $1、$2、$3... 作为字段值占位符
- 不要改变字段顺序
- class 名必须语义清楚且稳定，方便 CSS 精修
- 结构要体现信息层级：标题/主状态/字段组/辅助信息
- 如果互动需求不是“无互动”，必须预留 button、data-action、data-state、aria-expanded 或可切换 class 等 JS 钩子
- 不要写 onclick 等 HTML 事件属性
- 宽度按 330px 小卡片设计，但不要在 HTML 上写固定宽度
- 只输出 JSON，不要 markdown

输出：
{
  "htmlBody": "body 内部 HTML",
  "structureNotes": "一句话说明结构"
}`;
}

export function buildCssPrompt(
    userIdea: string,
    htmlBody: string,
    interaction: { mode: StatusWorkshopInteractionMode; idea: string },
): string {
    return `你是资深 UI 视觉设计师，不是特效生成器。

用户想做的状态栏：
「${userIdea}」

已有 HTML 结构：
${htmlBody}

互动需求：
${describeInteractionRequirement(interaction.mode, interaction.idea)}

你的任务：只写 CSS，把这个状态栏做得精致、清晰、耐看。

设计原则：
- 先服务信息层级，再做装饰
- 视觉必须像一个真实可用的小型状态栏，不像宣传海报
- 宽度以 330px 为基准，自适应移动端
- 字体、间距、圆角、阴影要克制
- 正文文字对比度必须足够，不要低透明度灰字
- 字段值要比字段名更醒目
- 动效只能轻微增强状态感，不能抢内容

严格禁止：
- 不要紫蓝大渐变套娃，除非用户明确要求
- 不要霓虹赛博风，除非用户明确要求
- 不要满屏玻璃拟态和模糊背景
- 不要装饰性光球、blob、bokeh
- 不要过大的圆角、过重阴影、过亮描边
- 不要把所有元素都做成卡片套卡片
- 不要修改 HTML，不要新增字段，不要改 $1/$2 占位符

CSS 要求：
- 只使用已有 class / 标签选择器，可以使用 .status-card-frame
- 可以使用 CSS 变量组织颜色和间距
- 可以使用 transition、transform、@keyframes
- 动画时长 2s-6s，不能闪烁
- 使用 box-sizing: border-box
- 文本必须不会溢出容器
- 适配窄屏，避免横向滚动
- 如果互动需求不是“无互动”，必须提供对应 .is-expanded、.is-flipped、.is-active、[data-state] 等状态样式
- 只输出 JSON，不要 markdown

输出：
{
  "cssTemplate": "只包含 CSS",
  "designIntent": "一句话说明视觉方向",
  "qualityCheck": [
    "信息层级是否清楚",
    "文字是否清晰可读",
    "是否避免廉价渐变和过度装饰"
  ]
}`;
}

export function buildCssPolishPrompt(
    userIdea: string,
    htmlBody: string,
    cssTemplate: string,
    interaction: { mode: StatusWorkshopInteractionMode; idea: string },
): string {
    return `你是 CSS 审美质检和修复专家。

用户想做的状态栏：
「${userIdea}」

HTML 结构：
${htmlBody}

当前 CSS：
${cssTemplate}

互动需求：
${describeInteractionRequirement(interaction.mode, interaction.idea)}

请只优化 CSS。目标是去掉明显模板感，让视觉更稳、更干净、更耐看。必须基于当前 CSS 继续精修，保留已有有效视觉特征、选择器和互动状态，不要退回首版，不要随意重写成另一种风格。

重点：
- 统一间距、字号、行高和圆角
- 减弱过重阴影、描边、模糊和高饱和装饰
- 提高文字对比度和字段值识别度
- 保留用户明确要求的方向，但不要额外套风格
- 如果互动需求不是“无互动”，保留并完善 .is-expanded、.is-flipped、.is-active、[data-state] 等状态样式
- 不要修改 HTML，不要新增字段，不要改占位符
- 只输出 JSON，不要 markdown

输出：
{
  "cssTemplate": "优化后的完整 CSS",
  "designIntent": "一句话说明优化结果"
}`;
}

export function buildJsPrompt(
    interaction: { mode: StatusWorkshopInteractionMode; idea: string },
    htmlBody: string,
    cssTemplate: string,
): string {
    return `你是状态栏轻互动工程师。

互动需求：
${describeInteractionRequirement(interaction.mode, interaction.idea)}

已有 HTML：
${htmlBody}

已有 CSS：
${cssTemplate}

请生成少量内联 classic JavaScript。如果互动需求是“无互动”，返回空字符串。

要求：
- 只生成 JS 代码，不要 <script> 标签
- 只能使用 document.querySelector / querySelectorAll / addEventListener
- 只能绑定已有 HTML 结构和已有 class/data-* 钩子
- 只能做点击展开、翻页、切换、翻卡、局部状态变化
- 不要请求网络
- 不要使用 fetch、XMLHttpRequest、WebSocket、localStorage
- 不要使用 alert、confirm、prompt
- 不要使用 onclick 等 HTML 事件属性
- 不要死循环，不要高频 interval
- 不要重写整段 HTML
- 只输出 JSON，不要 markdown

输出：
{
  "jsTemplate": "JS 代码或空字符串",
  "interactionNotes": "一句话说明互动"
}`;
}

interface StatusWorkshopGeneratorFieldListProps {
    fields: GeneratorField[];
    setFields: React.Dispatch<React.SetStateAction<GeneratorField[]>>;
}

export const StatusWorkshopGeneratorFieldList: React.FC<StatusWorkshopGeneratorFieldListProps> = ({ fields, setFields }) => (
    <div className="space-y-2">
        {fields.map((field, index) => (
            <div
                key={field.id}
                className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-2.5 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
            >
                <div className="grid grid-cols-[minmax(0,1fr),40px] gap-2 sm:grid-cols-[108px,minmax(0,1fr),40px]">
                    <input
                        type="text"
                        value={field.name}
                        onChange={e => setFields(prev => prev.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, name: e.target.value } : item
                        )))}
                        placeholder="字段名"
                        className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 text-[12px] text-white/75 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                        {...WORKSHOP_TEXT_INPUT_PROPS}
                    />
                    <button
                        onClick={() => setFields(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
                        disabled={fields.length === 1}
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border text-[12px] transition-all sm:order-3 ${
                            fields.length === 1
                                ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/15'
                                : 'border-white/[0.05] bg-white/[0.05] text-white/40 hover:bg-white/[0.08]'
                        }`}
                    >
                        x
                    </button>
                    <input
                        type="text"
                        value={field.desc}
                        onChange={e => setFields(prev => prev.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, desc: e.target.value } : item
                        )))}
                        placeholder="字段说明"
                        className="col-span-2 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 text-[12px] text-white/75 outline-none transition-colors placeholder:text-white/20 focus:border-white/15 sm:order-2 sm:col-span-1"
                        {...WORKSHOP_TEXT_INPUT_PROPS}
                    />
                </div>
            </div>
        ))}
    </div>
);

const StatusWorkshopApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, addToast, updateCharacter } = useOS();
    const frameChannel = useId().replace(/:/g, '_');

    const activeChar = useMemo(
        () => characters.find(c => c.id === activeCharacterId),
        [characters, activeCharacterId],
    );

    const [activeTab, setActiveTab] = useState<TabId>('protocol');
    const [templates, setTemplates] = useState<CustomStatusTemplate[]>(() => activeChar?.customStatusTemplates || []);
    const [activeTemplateId, setActiveTemplateId] = useState(
        () => activeChar?.activeCustomTemplateId || activeChar?.customStatusTemplates?.[0]?.id || '',
    );
    const [genDescription, setGenDescription] = useState('');
    const [cssIdea, setCssIdea] = useState('');
    const [genFields, setGenFields] = useState<GeneratorField[]>(DEFAULT_GENERATOR_FIELDS);
    const [generatingStep, setGeneratingStep] = useState<GenerationStep | null>(null);
    const [previewHeight, setPreviewHeight] = useState(240);
    const [previewReady, setPreviewReady] = useState(false);
    const [showMobilePreview, setShowMobilePreview] = useState(false);

    const previewRef = useRef<HTMLIFrameElement>(null);
    const templateNameInputRef = useRef<HTMLInputElement>(null);
    const systemPromptRef = useRef<HTMLTextAreaElement>(null);
    const importFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const nextTemplates = activeChar?.customStatusTemplates || [];
        const nextActiveId = activeChar?.activeCustomTemplateId && nextTemplates.some(t => t.id === activeChar.activeCustomTemplateId)
            ? activeChar.activeCustomTemplateId
            : nextTemplates[0]?.id || '';

        setTemplates(nextTemplates);
        setActiveTemplateId(nextActiveId);
        const nextActiveTemplate = nextTemplates.find(template => template.id === nextActiveId);
        setGenFields(templateFieldsToGeneratorFields(nextActiveTemplate?.fields));
    }, [activeChar]);

    const activeTemplate = useMemo(
        () => templates.find(t => t.id === activeTemplateId) || null,
        [templates, activeTemplateId],
    );

    const updateActiveTemplate = useCallback((patch: Partial<CustomStatusTemplate>, reviewFlags: ReviewFlag[] = []) => {
        if (!activeTemplateId) return;
        setTemplates(prev => prev.map(template => (
            template.id === activeTemplateId
                ? markReviewFlags({ ...template, ...patch }, reviewFlags)
                : template
        )));
    }, [activeTemplateId]);

    const updateGeneratorFields = useCallback<React.Dispatch<React.SetStateAction<GeneratorField[]>>>((updater) => {
        setGenFields(updater);
        updateActiveTemplate({}, ['system', 'html', 'css', 'js']);
    }, [updateActiveTemplate]);

    const handleSelectTemplate = useCallback((templateId: string) => {
        const nextTemplate = templates.find(template => template.id === templateId);
        setActiveTemplateId(templateId);
        setGenFields(templateFieldsToGeneratorFields(nextTemplate?.fields));
    }, [templates]);

    const handleCreateTemplate = useCallback(() => {
        const nextTemplate = createEmptyTemplate(templates.length);
        setTemplates(prev => [...prev, nextTemplate]);
        setActiveTemplateId(nextTemplate.id);
        setGenFields(templateFieldsToGeneratorFields(nextTemplate.fields));
        setActiveTab('protocol');
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
        setGenFields(templateFieldsToGeneratorFields(copiedTemplate.fields));
        setActiveTab('protocol');
    }, [activeTemplate, addToast]);

    const handleDeleteTemplate = useCallback((templateId: string) => {
        setTemplates(prev => {
            const currentIndex = prev.findIndex(template => template.id === templateId);
            const next = prev.filter(template => template.id !== templateId);

            if (templateId === activeTemplateId) {
                const fallback = next[currentIndex] || next[currentIndex - 1] || next[0];
                setActiveTemplateId(fallback?.id || '');
                setGenFields(templateFieldsToGeneratorFields(fallback?.fields));
            }

            return next;
        });
    }, [activeTemplateId]);

    const exportTemplatesToFile = useCallback((templatesToExport: CustomStatusTemplate[], baseName: string) => {
        const payload = buildStatusWorkshopExportPayload(templatesToExport);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = `${sanitizeExportFilename(baseName)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, []);

    const handleExportCurrentTemplate = useCallback(() => {
        if (!activeTemplate) {
            addToast('请先选择一个方案', 'error');
            return;
        }

        exportTemplatesToFile([activeTemplate], `${activeTemplate.name || '当前方案'}_状态栏方案`);
        addToast('已导出当前方案', 'success');
    }, [activeTemplate, addToast, exportTemplatesToFile]);

    const handleExportAllTemplates = useCallback(() => {
        if (templates.length === 0) {
            addToast('当前没有可导出的方案', 'error');
            return;
        }

        exportTemplatesToFile(templates, '全部状态栏方案');
        addToast(`已导出 ${templates.length} 个方案`, 'success');
    }, [addToast, exportTemplatesToFile, templates]);

    const handleImportTemplateFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;

        try {
            const raw = await file.text();
            const parsed = JSON.parse(raw);
            const importedTemplates = parseStatusWorkshopImportPayload(parsed, templates.length);

            if (importedTemplates.length === 0) {
                throw new Error('没有识别到状态栏方案');
            }

            setTemplates(prev => [...prev, ...importedTemplates]);
            setActiveTemplateId(importedTemplates[0].id);
            setGenFields(templateFieldsToGeneratorFields(importedTemplates[0].fields));
            setActiveTab('protocol');
            addToast(`已导入 ${importedTemplates.length} 个方案`, 'success');
        } catch (error: any) {
            addToast(`导入失败: ${error?.message || '文件格式不正确'}`, 'error');
        }
    }, [addToast, templates.length]);

    const handleEditCurrentTemplate = useCallback(() => {
        if (!activeTemplate) {
            addToast('请先选择一个方案', 'error');
            return;
        }

        setActiveTab('protocol');

        window.setTimeout(() => {
            if (!activeTemplate.name.trim()) {
                templateNameInputRef.current?.focus();
            }
        }, 0);
    }, [activeTemplate, addToast]);

    const buildPreviewHtml = useCallback((template: CustomStatusTemplate | null) => {
        if (!template) {
            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);box-sizing:border-box;padding:24px;color:rgba(255,255,255,0.72);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC',sans-serif;"><div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.38;">Status Workshop</div><div style="margin-top:16px;font-size:18px;font-weight:600;">新建一个方案开始编辑</div><div style="margin-top:10px;font-size:13px;line-height:1.7;opacity:0.58;">分层编辑 HTML、CSS 和可选 JS，预览会实时更新。</div></div>`;
        }

        const previewFields = getTemplateFieldList(template, genFields);

        if (template.renderMode === 'text') {
            const lines = previewFields.map((field, index) => `${field.name}: [字段${index + 1}]`);
            const textPreview = lines.length > 0
                ? lines.join('\n')
                : '字段1: [字段1]\n字段2: [字段2]\n字段3: [字段3]';

            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;background:linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.08);box-sizing:border-box;padding:22px;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC',sans-serif;box-shadow:0 18px 40px rgba(0,0,0,0.28);"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><div style="font-size:15px;font-weight:600;">文本模式预览</div><div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.48;">Text</div></div><pre style="margin:18px 0 0;white-space:pre-wrap;font:500 13px/1.8 'SF Mono','Fira Code',monospace;color:rgba(236,253,245,0.88);">${escapeHtml(textPreview)}</pre></div>`;
        }

        if (!hasLayeredStatusTemplate(template) && !template.htmlTemplate?.trim()) {
            return `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;border:1px dashed rgba(255,255,255,0.12);background:rgba(13,13,26,0.86);box-sizing:border-box;padding:24px;color:rgba(255,255,255,0.58);font-family:'SF Mono','Fira Code',monospace;"><div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.38;">Layered Template</div><div style="margin-top:16px;font-size:13px;line-height:1.8;">先生成协议，再生成 HTML 骨架和 CSS。这里会用 [字段1]、[字段2]… 替换占位符。</div></div>`;
        }

        const previewValues = previewFields.length > 0
            ? previewFields.map((field, index) => `[${field.name || `字段${index + 1}`}]`)
            : ['[字段1]', '[字段2]', '[字段3]'];

        const composedHtml = composeCustomStatusTemplateHtml(template, {
            previewValues,
            includeScripts: template.allowScripts === true,
        });

        return composedHtml || `<div style="width:330px;max-width:100%;min-height:200px;border-radius:24px;border:1px dashed rgba(255,255,255,0.12);background:rgba(13,13,26,0.86);box-sizing:border-box;padding:24px;color:rgba(255,255,255,0.58);font-family:'SF Mono','Fira Code',monospace;">HTML 骨架还是空的。</div>`;
    }, [genFields]);

    const debouncedUpdate = useMemo<DebouncedPreviewUpdate>(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const send = ((html: string, allowScripts = false) => {
            if (timer) clearTimeout(timer);

            timer = setTimeout(() => {
                previewRef.current?.contentWindow?.postMessage(
                    { type: 'preview-update', channel: frameChannel, html, allowScripts },
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
    }, [frameChannel]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<{ type?: string; channel?: string; height?: number }>) => {
            if (event.source !== previewRef.current?.contentWindow) return;
            if (event.data?.type !== 'preview-height') return;
            if (event.data.channel !== frameChannel) return;

            const nextHeight = typeof event.data.height === 'number'
                ? Math.max(event.data.height + 16, 220)
                : 240;

            setPreviewHeight(nextHeight);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [frameChannel]);

    useEffect(() => {
        if (!previewReady) return;
        debouncedUpdate(
            buildPreviewHtml(activeTemplate),
            activeTemplate?.renderMode === 'html' && activeTemplate.allowScripts === true,
        );
    }, [activeTemplate, buildPreviewHtml, debouncedUpdate, previewReady]);

    useEffect(() => () => debouncedUpdate.cancel(), [debouncedUpdate]);

    const callSecondaryJson = useCallback(async (prompt: string, temperature: number) => {
        const config = getSecondaryApiConfig();
        if (!config?.apiKey) {
            throw new Error('请先在全局设置中配置副 API');
        }

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
                temperature,
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
        return extractJsonObject(content);
    }, []);

    const resolveTargetTemplate = useCallback(() => {
        let targetTemplate = activeTemplate;
        let targetTemplateId = activeTemplateId;

        if (!targetTemplate) {
            targetTemplate = createEmptyTemplate(templates.length);
            targetTemplateId = targetTemplate.id;
            setActiveTemplateId(targetTemplate.id);
            setTemplates(prev => (
                prev.some(template => template.id === targetTemplate!.id)
                    ? prev
                    : [...prev, targetTemplate!]
            ));
        }

        return { targetTemplate, targetTemplateId };
    }, [activeTemplate, activeTemplateId, templates.length]);

    const handleGenerateStep = useCallback(async (step: GenerationStep, mode: GenerationMode = 'iterate') => {
        const userIdea = genDescription.trim();
        const visualIdea = cssIdea.trim()
            ? `${userIdea}\n\nCSS 视觉想法：${cssIdea.trim()}`
            : userIdea;
        const validFields = getValidGeneratorFields(genFields);

        if ((step === 'system' || step === 'protocol' || step === 'html') && userIdea.length < 4) {
            addToast('先把想要的状态栏说清楚一点，再生成', 'error');
            return;
        }

        if (step === 'protocol' && validFields.length === 0) {
            addToast('请至少填写一个字段', 'error');
            return;
        }

        const { targetTemplate, targetTemplateId } = resolveTargetTemplate();
        if (!targetTemplate || !targetTemplateId) return;

        const templateFields = getTemplateFieldList(targetTemplate, validFields);
        const interaction = getTemplateInteraction(targetTemplate);

        if (step === 'system' && (!targetTemplate.extractRegex?.trim() || templateFields.length === 0)) {
            addToast('先完成字段协议，再生成 TA 的状态写法', 'error');
            setActiveTab('protocol');
            return;
        }

        if (step === 'html' && (!targetTemplate.extractRegex?.trim() || templateFields.length === 0)) {
            addToast('先完成字段协议和提取正则，再生成 HTML 骨架', 'error');
            setActiveTab('protocol');
            return;
        }

        if ((step === 'css' || step === 'js') && !targetTemplate.htmlBody?.trim()) {
            addToast('先生成或填写 HTML 骨架', 'error');
            setActiveTab('html');
            return;
        }

        if (step === 'js' && interaction.mode === 'none') {
            addToast('当前互动需求是“无互动”，JS 可以保持为空', 'info');
            setActiveTab('interaction');
            return;
        }

        if (step === 'html' && mode === 'replace' && targetTemplate.htmlBody?.trim()) {
            const confirmed = window.confirm('重新生成会覆盖当前 HTML 骨架，CSS 和 JS 会保留但标记为需复核。确定继续吗？');
            if (!confirmed) return;
        }

        if (step === 'css' && mode === 'replace' && targetTemplate.cssTemplate?.trim()) {
            const confirmed = window.confirm('重新生成会覆盖当前 CSS。确定继续吗？');
            if (!confirmed) return;
        }

        if (step === 'system' && mode === 'replace' && targetTemplate.systemPrompt?.trim()) {
            const confirmed = window.confirm('重新生成会覆盖当前状态写法，HTML/CSS/JS 会保留但标记为需复核。确定继续吗？');
            if (!confirmed) return;
        }

        if (step === 'protocol' && mode === 'replace' && targetTemplate.extractRegex?.trim()) {
            const confirmed = window.confirm('重新生成会覆盖当前字段协议和提取正则，并标记状态写法、HTML/CSS/JS 需复核。确定继续吗？');
            if (!confirmed) return;
        }

        if (step === 'js' && !targetTemplate.cssTemplate?.trim()) {
            addToast('先生成或填写 CSS，再生成互动 JS', 'error');
            setActiveTab('css');
            return;
        }

        setGeneratingStep(step);

        try {
            let prompt = '';
            let temperature = 0.6;

            if (step === 'system') {
                prompt = buildSystemPromptPrompt(
                    userIdea,
                    templateFields,
                    mode === 'replace' ? '' : targetTemplate.systemPrompt || '',
                );
                temperature = 0.45;
            } else if (step === 'protocol') {
                prompt = buildProtocolPrompt(userIdea, validFields);
                temperature = 0.35;
            } else if (step === 'html') {
                prompt = buildHtmlPrompt(
                    userIdea,
                    templateFields,
                    interaction,
                    mode === 'replace' ? '' : targetTemplate.htmlBody || '',
                );
                temperature = 0.55;
            } else if (step === 'css') {
                if (targetTemplate.cssTemplate?.trim() && mode !== 'replace') {
                    prompt = buildCssPolishPrompt(visualIdea, targetTemplate.htmlBody || '', targetTemplate.cssTemplate || '', interaction);
                    temperature = 0.45;
                } else {
                    prompt = buildCssPrompt(visualIdea, targetTemplate.htmlBody || '', interaction);
                    temperature = 0.72;
                }
            } else {
                prompt = buildJsPrompt(interaction, targetTemplate.htmlBody || '', targetTemplate.cssTemplate || '');
                temperature = 0.4;
            }

            const result = await callSecondaryJson(prompt, temperature);
            const generatedProtocolFields = step === 'protocol'
                ? normalizeGeneratedFields(result.fields, validFields)
                : null;

            setTemplates(prev => {
                const base = prev.some(template => template.id === targetTemplateId)
                    ? prev
                    : [...prev, targetTemplate];

                return base.map(template => {
                    if (template.id !== targetTemplateId) return template;

                    if (step === 'system') {
                        const downstreamFlags: ReviewFlag[] = interaction.mode === 'none' ? ['html', 'css'] : ['html', 'css', 'js'];
                        return markReviewFlags(clearReviewFlags({
                            ...template,
                            systemPrompt: result.systemPrompt || template.systemPrompt,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            renderMode: 'html',
                        }, ['system']), downstreamFlags);
                    }

                    if (step === 'protocol') {
                        const downstreamFlags: ReviewFlag[] = interaction.mode === 'none' ? ['system', 'html', 'css'] : ['system', 'html', 'css', 'js'];
                        return markReviewFlags(clearReviewFlags({
                            ...template,
                            extractRegex: result.extractRegex || template.extractRegex,
                            fields: generatedProtocolFields || template.fields,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            renderMode: 'html',
                        }, ['protocol']), downstreamFlags);
                    }

                    if (step === 'html') {
                        const downstreamFlags: ReviewFlag[] = interaction.mode === 'none' ? ['css'] : ['css', 'js'];
                        return markReviewFlags(clearReviewFlags({
                            ...template,
                            htmlBody: result.htmlBody || template.htmlBody,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            renderMode: 'html',
                        }, ['html']), downstreamFlags);
                    }

                    if (step === 'css') {
                        return clearReviewFlags({
                            ...template,
                            cssTemplate: result.cssTemplate || template.cssTemplate,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            renderMode: 'html',
                        }, interaction.mode === 'none' ? ['css', 'js'] : ['css']);
                    }

                    return clearReviewFlags({
                        ...template,
                        jsTemplate: typeof result.jsTemplate === 'string' ? result.jsTemplate : template.jsTemplate,
                        allowScripts: Boolean(result.jsTemplate?.trim()) || template.allowScripts === true,
                        templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                        renderMode: 'html',
                    }, ['js']);
                });
            });

            if (generatedProtocolFields) {
                setGenFields(generatedProtocolFields.map((field, index) => ({
                    id: `generated-field-${index + 1}`,
                    name: field.name,
                    desc: field.description,
                })));
            }

            if (step === 'protocol') setActiveTab('system');
            if (step === 'system') setActiveTab('interaction');
            if (step === 'html') setActiveTab('css');
            if (step === 'css') setActiveTab(interaction.mode === 'none' ? 'css' : 'js');
            if (step === 'js') setActiveTab('js');

            addToast(`${GENERATION_LABELS[step]}完成`, 'success');
        } catch (e: any) {
            addToast(`${GENERATION_LABELS[step]}失败: ${e.message || ''}`, 'error');
        } finally {
            setGeneratingStep(null);
        }
    }, [addToast, callSecondaryJson, cssIdea, genDescription, genFields, resolveTargetTemplate]);

    const handleSplitLegacyTemplate = useCallback(() => {
        if (!activeTemplate?.htmlTemplate?.trim()) {
            addToast('当前方案没有旧版完整 HTML 可拆分', 'error');
            return;
        }

        const split = splitStatusTemplateHtml(activeTemplate.htmlTemplate);
        if (!split.htmlBody.trim()) {
            addToast('拆分失败：没有识别到 body 内容', 'error');
            return;
        }

        updateActiveTemplate({
            htmlBody: split.htmlBody,
            cssTemplate: split.cssTemplate,
            jsTemplate: split.jsTemplate,
            allowScripts: split.jsTemplate.trim() ? activeTemplate.allowScripts === true : activeTemplate.allowScripts,
            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
            renderMode: 'html',
        });
        setActiveTab('html');
        addToast('已拆成 HTML / CSS / JS，可继续微调', 'success');
    }, [activeTemplate, addToast, updateActiveTemplate]);

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

    const renderEmptyState = (message: string) => (
        <div className="animate-fade-in rounded-[28px] border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm p-6 text-white/60">
            <div className="text-[13px] font-semibold text-white/80">还没有方案</div>
            <p className="mt-2 text-[12px] leading-6 text-white/40">{message}</p>
            <button
                onClick={handleCreateTemplate}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.08] px-4 py-2.5 text-[12px] font-semibold text-white/80 transition-all hover:bg-white/10 active:scale-[0.98]"
            >
                <span className="text-base leading-none">+</span>
                新建方案
            </button>
        </div>
    );

    const renderStepButton = (
        step: GenerationStep,
        options: { label?: string; mode?: GenerationMode; extraClass?: string; disabled?: boolean } = {},
    ) => (
        <button
            onClick={() => handleGenerateStep(step, options.mode)}
            disabled={generatingStep !== null || options.disabled === true}
            className={`rounded-2xl px-4 py-2.5 text-[12px] font-semibold transition-all ${
                generatingStep === step
                    ? 'cursor-wait bg-white/[0.05] text-white/35'
                    : generatingStep || options.disabled
                        ? 'cursor-not-allowed bg-white/[0.03] text-white/22'
                        : 'bg-white/[0.10] text-white/82 hover:bg-white/[0.14] active:scale-[0.98]'
            } ${options.extraClass || ''}`}
        >
            {generatingStep === step ? '生成中...' : options.label || GENERATION_LABELS[step]}
        </button>
    );

    const renderReviewNotice = (flag: ReviewFlag, message: string) => {
        if (!activeTemplate?.reviewFlags?.[flag]) return null;

        return (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-[11px] leading-5 text-amber-100/72">
                {message}
            </div>
        );
    };

    const renderSystemStep = () => {
        if (!activeTemplate) {
            return renderEmptyState('先新建一个方案，再写 TA 的状态写法。');
        }

        const hasProtocol = Boolean(activeTemplate.extractRegex?.trim() && getTemplateFieldList(activeTemplate, genFields).length > 0);
        const downstreamFlags: ReviewFlag[] = normalizeInteractionMode(activeTemplate.interactionMode) === 'none'
            ? ['html', 'css']
            : ['html', 'css', 'js'];

        return (
            <div className="space-y-4 animate-fade-in">
                {renderReviewNotice('system', '字段协议刚刚改过，当前状态写法会保留，但建议检查每个字段的写法规则是否仍然匹配。')}
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3">
                        <div className="text-[13px] font-semibold text-white/80">TA 的状态写法</div>
                        <p className="mt-1 text-[11px] leading-5 text-white/30">字段已经定好后，这里写每个字段要怎么表达：短、具体、贴近刚才回应，不写空泛占位。</p>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                        {renderStepButton('system', {
                            label: activeTemplate.systemPrompt?.trim() ? '基于当前写法改进' : '生成状态写法',
                            disabled: !hasProtocol,
                        })}
                        {activeTemplate.systemPrompt?.trim() && renderStepButton('system', {
                            label: '重新生成 / 覆盖',
                            mode: 'replace',
                            disabled: !hasProtocol,
                        })}
                    </div>
                    {!hasProtocol && (
                        <div className="mb-3 rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[11px] leading-5 text-white/35">
                            先完成字段协议，状态写法才能逐字段说明每一行应该怎么写。
                        </div>
                    )}
                    <label className="mb-3 block text-[11px] font-semibold tracking-wide text-white/45">状态文本规则</label>
                    <textarea
                        ref={systemPromptRef}
                        value={activeTemplate.systemPrompt}
                        onChange={e => updateActiveTemplate({
                            systemPrompt: e.target.value,
                            reviewFlags: { ...activeTemplate.reviewFlags, system: false },
                        }, downstreamFlags)}
                        placeholder="告诉TA：正常回应照常写；末尾按字段协议补一段状态记录。每个字段都要短、具体、贴近刚才的回应，不写空泛占位。"
                        className="h-48 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-4 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/18 focus:border-white/15 sm:h-56"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                    <p className="mt-3 text-[11px] leading-6 text-white/28">这里决定每个字段要怎么写：短、具体、贴近刚才的回应，不写空泛占位。</p>
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

    const renderProtocolStep = () => {
        if (!activeTemplate) {
            return renderEmptyState('先创建一个方案，再定义字段协议。');
        }

        return (
            <div className="space-y-4 animate-fade-in">
                {renderReviewNotice('protocol', '当前字段协议需复核，建议检查字段顺序、占位符和提取正则是否一致。')}
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3">
                        <div className="text-[13px] font-semibold text-white/80">字段协议</div>
                        <p className="mt-1 text-[11px] leading-5 text-white/30">这里决定 TA 要留下哪些状态字段，以及正则如何把它们抓成 $1、$2、$3。</p>
                    </div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-white/45">状态栏想法</label>
                    <textarea
                        value={genDescription}
                        onChange={e => setGenDescription(e.target.value)}
                        placeholder="说清楚你想做什么：像什么物件、展示哪些信息、整体情绪、哪些元素不要。描述太空泛就不会替你套模板。"
                        className="mb-4 h-28 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                    <div className="mb-2 flex items-center justify-between">
                        <label className="text-[11px] font-semibold tracking-wide text-white/45">字段列表</label>
                        <button
                            onClick={() => updateGeneratorFields(prev => [...prev, createGeneratorField()])}
                            className="rounded-xl border border-white/[0.05] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-white/60 transition-all hover:bg-white/[0.08]"
                        >
                            + 添加字段
                        </button>
                    </div>
                    <StatusWorkshopGeneratorFieldList fields={genFields} setFields={updateGeneratorFields} />
                    <div className="mt-4 flex flex-wrap gap-2">
                        {renderStepButton('protocol', {
                            label: activeTemplate.extractRegex?.trim() ? '基于当前字段协议更新' : '生成字段协议',
                        })}
                        {activeTemplate.extractRegex?.trim() && renderStepButton('protocol', {
                            label: '重新生成 / 覆盖',
                            mode: 'replace',
                        })}
                    </div>
                </div>

                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <label className="mb-3 block text-[11px] font-semibold tracking-wide text-white/45">提取正则</label>
                    <textarea
                        value={activeTemplate.extractRegex}
                        onChange={e => updateActiveTemplate({ extractRegex: e.target.value }, ['system', 'html', 'css', 'js'])}
                        placeholder="<status>\\s*时间:\\s*(.*?)\\s*地点:\\s*(.*?)\\s*动作:\\s*(.*?)\\s*<\\/status>"
                        className="h-24 w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-emerald-300/60 outline-none transition-colors placeholder:text-white/15 focus:border-white/15 sm:h-28"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                    <p className="mt-3 text-[11px] leading-6 text-white/28">正则匹配成功后，第 1 个捕获组就是 $1，第 2 个捕获组就是 $2，会按顺序填进 HTML 骨架。</p>
                </div>
            </div>
        );
    };

    const renderInteractionStep = () => {
        if (!activeTemplate) {
            return renderEmptyState('先创建一个方案，再选择是否需要轻互动。');
        }

        const interactionMode = normalizeInteractionMode(activeTemplate.interactionMode);

        return (
            <div className="space-y-4 animate-fade-in">
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3">
                        <div className="text-[13px] font-semibold text-white/80">互动需求</div>
                        <p className="mt-1 text-[11px] leading-5 text-white/30">如果要翻卡、分页、展开，就先在这里定下来；HTML 会预留结构，CSS 会写状态样式，JS 只绑定行为。</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {INTERACTION_OPTIONS.map(option => (
                            <button
                                key={option.id}
                                onClick={() => updateActiveTemplate({ interactionMode: option.id }, ['html', 'css', 'js'])}
                                className={`min-h-[78px] rounded-2xl border px-4 py-3 text-left transition-all ${
                                    interactionMode === option.id
                                        ? 'bg-white/10 border-white/15 text-white/80'
                                        : 'bg-white/[0.03] border-white/[0.05] text-white/38 hover:bg-white/[0.06]'
                                }`}
                            >
                                <span className="block text-[12px] font-semibold">{option.label}</span>
                                <span className="mt-1 block text-[10px] leading-4 opacity-70">{option.description}</span>
                            </button>
                        ))}
                    </div>
                    <label className="mb-2 mt-4 block text-[11px] font-semibold tracking-wide text-white/45">互动补充</label>
                    <textarea
                        value={activeTemplate.interactionIdea || ''}
                        onChange={e => updateActiveTemplate({ interactionIdea: e.target.value }, ['html', 'css', 'js'])}
                        placeholder="比如：点击展开第二页、点击按钮切换心情、点卡片翻面。如果没有明确互动需求，保持为空。"
                        className="h-24 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab('html')}
                            className="rounded-2xl bg-white/[0.10] px-4 py-2.5 text-[12px] font-semibold text-white/82 transition-all hover:bg-white/[0.14] active:scale-[0.98]"
                        >
                            下一步：HTML 骨架
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderHtmlTab = () => {
        if (!activeTemplate) {
            return renderEmptyState('先创建一个方案，再开始编写 HTML 骨架。');
        }

        return (
            <div className="space-y-4 animate-fade-in">
                {renderReviewNotice('html', '字段协议或互动需求改过，当前 HTML 会保留，但建议检查占位符、data-* 钩子和结构是否仍匹配。')}
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                            <div className="text-[11px] font-semibold tracking-wide text-white/45">HTML 骨架</div>
                            <div className="mt-1 text-[10px] leading-4 text-white/25">$1, $2, $3 会按正则捕获组顺序替换；互动结构要在这里预留。</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {renderStepButton('html', {
                                label: activeTemplate.htmlBody?.trim() ? '基于当前骨架修改' : '生成 HTML 骨架',
                            })}
                            {activeTemplate.htmlBody?.trim() && renderStepButton('html', {
                                label: '重新生成 / 覆盖',
                                mode: 'replace',
                            })}
                        </div>
                    </div>
                    <textarea
                        value={activeTemplate.htmlBody || ''}
                        onChange={e => updateActiveTemplate({
                            htmlBody: e.target.value,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            reviewFlags: { ...activeTemplate.reviewFlags, html: false },
                        }, normalizeInteractionMode(activeTemplate.interactionMode) === 'none' ? ['css'] : ['css', 'js'])}
                        placeholder="<section class=&quot;status-card&quot;>...</section>"
                        className="h-[42svh] min-h-[280px] w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-emerald-300/60 outline-none transition-colors placeholder:text-white/15 focus:border-white/15 sm:h-[440px] sm:min-h-0"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                </div>

                {activeTemplate.htmlTemplate?.trim() && (
                    <div className="rounded-[24px] border border-white/[0.05] bg-white/[0.03] p-4 text-[11px] leading-6 text-white/34">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>检测到旧版完整 HTML。可以一键拆成 HTML / CSS / JS；旧内容会继续保留作为兼容备份。</div>
                            <button
                                onClick={handleSplitLegacyTemplate}
                                className="min-h-[40px] rounded-2xl border border-white/[0.06] bg-white/[0.07] px-4 py-2 text-[12px] font-semibold text-white/72 transition-all hover:bg-white/[0.10] active:scale-[0.98]"
                            >
                                拆分旧模板
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderCssTab = () => {
        if (!activeTemplate) {
            return renderEmptyState('先创建一个方案，再开始编写 CSS。');
        }

        return (
            <div className="space-y-4 animate-fade-in">
                {renderReviewNotice('css', 'HTML 或互动需求改过，当前 CSS 会保留，但建议检查选择器和互动状态样式是否仍匹配。')}
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                            <div className="text-[11px] font-semibold tracking-wide text-white/45">CSS 美化</div>
                            <p className="mt-1 text-[10px] leading-4 text-white/25">默认基于当前 CSS 精修；需要从头抽卡时再点覆盖。</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {renderStepButton('css', {
                                label: activeTemplate.cssTemplate?.trim() ? '基于当前 CSS 优化' : '生成 CSS',
                            })}
                            {activeTemplate.cssTemplate?.trim() && renderStepButton('css', {
                                label: '重新生成 / 覆盖',
                                mode: 'replace',
                            })}
                        </div>
                    </div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-white/45">CSS 视觉想法</label>
                    <textarea
                        value={cssIdea}
                        onChange={e => setCssIdea(e.target.value)}
                        placeholder={'视觉方向（可选）：比如更像杂志内页、极简主义、字段值更醒目。这里会影响「生成 CSS」和「优化 CSS 审美」。'}
                        className="mb-4 h-24 w-full resize-none rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[12px] leading-6 text-white/80 outline-none transition-colors placeholder:text-white/20 focus:border-white/15"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                    <textarea
                        value={activeTemplate.cssTemplate || ''}
                        onChange={e => updateActiveTemplate({
                            cssTemplate: e.target.value,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            reviewFlags: { ...activeTemplate.reviewFlags, css: false },
                        })}
                        placeholder=".status-card { ... }"
                        className="h-[48svh] min-h-[320px] w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-sky-200/70 outline-none transition-colors placeholder:text-white/15 focus:border-white/15 sm:h-[500px] sm:min-h-0"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                </div>

                <div className="rounded-[24px] border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[11px] leading-6 text-white/32">
                    CSS 质量闸门：稳间距、清晰文字、克制阴影。不要光球、blob、廉价渐变和卡片套卡片。
                </div>
            </div>
        );
    };

    const renderJsTab = () => {
        if (!activeTemplate) {
            return renderEmptyState('先创建一个方案，再添加可选互动。');
        }

        return (
            <div className="space-y-4 animate-fade-in">
                {renderReviewNotice('js', 'HTML、CSS 或互动需求改过，当前 JS 会保留，但建议检查 querySelector、data-action 和 classList 是否仍匹配。')}
                <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-5 backdrop-blur-sm">
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3">
                        <div className="min-w-0 flex-1 pr-2">
                            <div className="text-[12px] font-semibold text-white/70">启用脚本</div>
                            <div className="mt-1 text-[10px] leading-4 text-white/28">只运行内联 classic script；外链、网络请求和弹窗会被拦截。</div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={activeTemplate.allowScripts === true}
                            onClick={() => updateActiveTemplate({ allowScripts: activeTemplate.allowScripts !== true })}
                            className={`relative flex h-8 w-14 flex-none items-center rounded-full p-1 transition-colors ${
                                activeTemplate.allowScripts === true ? 'bg-emerald-400/70' : 'bg-white/[0.12]'
                            }`}
                        >
                            <span
                                className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                                    activeTemplate.allowScripts === true ? 'translate-x-6' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                            <div className="text-[11px] font-semibold tracking-wide text-white/45">JS 互动代码</div>
                            <p className="mt-1 text-[10px] leading-4 text-white/25">JS 只绑定 HTML 已有结构，不负责补 HTML。</p>
                        </div>
                        {renderStepButton('js', {
                            label: '生成互动 JS',
                            disabled: normalizeInteractionMode(activeTemplate.interactionMode) === 'none',
                        })}
                    </div>
                    <textarea
                        value={activeTemplate.jsTemplate || ''}
                        onChange={e => updateActiveTemplate({
                            jsTemplate: e.target.value,
                            templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
                            reviewFlags: { ...activeTemplate.reviewFlags, js: false },
                        })}
                        placeholder="document.querySelector('.status-card')?.addEventListener('click', () => { ... });"
                        className="h-[34svh] min-h-[240px] w-full resize-none rounded-2xl border border-white/[0.05] bg-[#0d0d1a] px-4 py-4 font-mono text-[12px] leading-6 text-amber-200/70 outline-none transition-colors placeholder:text-white/15 focus:border-white/15 sm:h-[360px] sm:min-h-0"
                        {...WORKSHOP_TEXT_ENTRY_PROPS}
                    />
                </div>

                <div className="rounded-[24px] border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[11px] leading-6 text-white/32">
                    允许：addEventListener、classList、局部展开/翻页/翻卡。禁止：fetch、XMLHttpRequest、WebSocket、localStorage、onclick、alert、死循环。
                </div>
            </div>
        );
    };

    const getStepStatusLabel = (step: TabId) => {
        if (!activeTemplate) return '待开始';
        if (step !== 'interaction' && activeTemplate.reviewFlags?.[step]) {
            if (step === 'system' && !activeTemplate.systemPrompt?.trim()) return '待完成';
            if (step === 'protocol' && !activeTemplate.extractRegex?.trim()) return '待完成';
            if (step === 'js' && normalizeInteractionMode(activeTemplate.interactionMode) === 'none') return '可选';
            return '需复核';
        }

        if (step === 'system') return activeTemplate.systemPrompt?.trim() ? '已完成' : '待完成';
        if (step === 'protocol') return activeTemplate.extractRegex?.trim() ? '已完成' : '待完成';
        if (step === 'interaction') {
            const mode = normalizeInteractionMode(activeTemplate.interactionMode);
            return mode === 'none' ? '无互动' : '已选择';
        }
        if (step === 'html') return activeTemplate.htmlBody?.trim() ? '已完成' : '待完成';
        if (step === 'css') return activeTemplate.cssTemplate?.trim() ? '已完成' : '待完成';
        if (normalizeInteractionMode(activeTemplate.interactionMode) === 'none') return '可选';
        return activeTemplate.jsTemplate?.trim() ? '已完成' : '待完成';
    };

    return (
        <div className="relative flex h-full w-full flex-col overflow-x-hidden overflow-y-auto bg-[#0a0a14] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 right-[-56px] h-64 w-64 rounded-full bg-sky-500/[0.08] blur-[90px]" />
                <div className="absolute bottom-[-90px] left-[-70px] h-72 w-72 rounded-full bg-emerald-500/[0.05] blur-[110px]" />
            </div>

            <div className="relative z-10 flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
                <button
                    onClick={closeApp}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] backdrop-blur-sm transition-all hover:bg-white/10 active:scale-90"
                    aria-label="返回"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 text-white/70">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>

                <div className="min-w-0 flex-1 px-1 text-center">
                    <h1 className="text-[15px] font-semibold tracking-wide text-white/90">状态栏工坊</h1>
                    <p className="mt-0.5 truncate text-[10px] text-white/30">
                        {activeChar ? `为 ${activeChar.name} 管理多套方案` : '请先选择角色'}
                    </p>
                </div>

                <button
                    onClick={handleSave}
                    className="min-h-[42px] shrink-0 rounded-full border border-white/[0.06] bg-white/[0.08] px-4 py-2 text-[12px] font-semibold text-white/80 transition-all hover:bg-white/12 active:scale-95"
                >
                    保存
                </button>
            </div>

            <div className="relative z-10 px-4 pb-3 sm:pb-4">
                <div className="rounded-[30px] border border-white/[0.06] bg-white/[0.04] p-4 backdrop-blur-sm">
                    <div className="overflow-x-auto pb-1">
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
                                            onClick={() => handleSelectTemplate(template.id)}
                                            className="rounded-xl px-2 py-1 text-[12px] font-medium transition-opacity hover:opacity-100"
                                        >
                                            {template.name || '未命名方案'}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteTemplate(template.id)}
                                            className="flex h-6 w-6 items-center justify-center rounded-lg text-[14px] text-white/35 transition-all hover:bg-white/[0.08] hover:text-white/70"
                                            title="删除方案"
                                        >
                                            x
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

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            onClick={handleCreateTemplate}
                            className="min-h-[42px] flex-1 rounded-2xl border border-white/[0.05] bg-white/[0.06] px-3 py-2 text-[12px] font-semibold text-white/75 transition-all hover:bg-white/10 active:scale-[0.98] sm:flex-none"
                        >
                            + 新建方案
                        </button>
                        <button
                            onClick={handleEditCurrentTemplate}
                            disabled={!activeTemplate}
                            className={`min-h-[42px] flex-1 rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all sm:flex-none ${
                                activeTemplate
                                    ? 'border-white/[0.05] bg-white/[0.05] text-white/75 hover:bg-white/10 active:scale-[0.98]'
                                    : 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/20'
                            }`}
                        >
                            编辑当前方案
                        </button>
                        <button
                            onClick={handleCopyTemplate}
                            disabled={!activeTemplate}
                            className={`min-h-[42px] flex-1 rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all sm:flex-none ${
                                activeTemplate
                                    ? 'border-white/[0.05] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] active:scale-[0.98]'
                                    : 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/20'
                            }`}
                        >
                            复制当前方案
                        </button>
                        <button
                            onClick={() => importFileInputRef.current?.click()}
                            className="min-h-[42px] flex-1 rounded-2xl border border-white/[0.05] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-white/65 transition-all hover:bg-white/[0.08] active:scale-[0.98] sm:flex-none"
                        >
                            导入方案
                        </button>
                        <button
                            onClick={handleExportCurrentTemplate}
                            disabled={!activeTemplate}
                            className={`min-h-[42px] flex-1 rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all sm:flex-none ${
                                activeTemplate
                                    ? 'border-white/[0.05] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] active:scale-[0.98]'
                                    : 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/20'
                            }`}
                        >
                            导出当前
                        </button>
                        <button
                            onClick={handleExportAllTemplates}
                            disabled={templates.length === 0}
                            className={`min-h-[42px] flex-1 rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all sm:flex-none ${
                                templates.length > 0
                                    ? 'border-white/[0.05] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] active:scale-[0.98]'
                                    : 'cursor-not-allowed border-white/[0.04] bg-white/[0.03] text-white/20'
                            }`}
                        >
                            导出全部
                        </button>
                        <input
                            ref={importFileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={handleImportTemplateFile}
                        />
                    </div>

                    {activeTemplate && (
                        <div className="mt-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <label className="block text-[11px] font-semibold tracking-wide text-white/40">方案名称</label>
                                <span className="truncate text-[10px] text-white/28">
                                    当前编辑: {activeTemplate.name || '未命名方案'}
                                </span>
                            </div>
                            <input
                                type="text"
                                ref={templateNameInputRef}
                                value={activeTemplate.name}
                                onChange={e => updateActiveTemplate({ name: e.target.value })}
                                placeholder="给当前方案起个名字"
                                className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-3 text-[13px] text-white/80 outline-none transition-colors placeholder:text-white/18 focus:border-white/15"
                                {...WORKSHOP_TEXT_INPUT_PROPS}
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="relative z-10 flex flex-col gap-4 px-4 pb-24 sm:pb-4 lg:min-h-0 lg:flex-1 lg:flex-row">
                <div className="lg:order-2 lg:min-w-[360px] lg:max-w-[480px] lg:flex-1">
                    <div className="rounded-[32px] border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold text-white/80">实时预览</div>
                                <p className="mt-1 text-[11px] text-white/28">预览和聊天渲染共用同一套 HTML 组装逻辑。</p>
                            </div>
                            <button
                                onClick={() => setShowMobilePreview(prev => !prev)}
                                className="min-h-[42px] shrink-0 rounded-full border border-white/[0.05] bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-white/65 transition-all hover:bg-white/[0.09] active:scale-[0.98] lg:hidden"
                                aria-expanded={showMobilePreview}
                            >
                                {showMobilePreview ? '收起预览' : '展开预览'}
                            </button>
                            <div className="hidden rounded-full border border-white/[0.05] bg-white/[0.05] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/30 lg:block">
                                preview
                            </div>
                        </div>

                        <div
                            className={`transition-all duration-300 ${
                                showMobilePreview
                                    ? 'mt-3 max-h-[960px] opacity-100'
                                    : 'max-h-0 opacity-0 pointer-events-none'
                            } lg:mt-3 lg:max-h-none lg:opacity-100 lg:pointer-events-auto`}
                        >
                            <div className="flex min-h-[200px] items-center justify-center rounded-[28px] border border-white/[0.05] bg-[#06060d] px-3 py-5 sm:min-h-[220px]">
                                <iframe
                                    ref={previewRef}
                                    srcDoc={STATUS_CARD_IFRAME_SHELL}
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

                <div className="flex flex-col gap-4 lg:order-1 lg:min-h-0 lg:flex-1 lg:rounded-[32px] lg:border lg:border-white/[0.06] lg:bg-white/[0.03] lg:p-4 lg:backdrop-blur-sm">
                    <div className="grid grid-cols-2 gap-2 rounded-[28px] border border-white/[0.06] bg-white/[0.04] p-2 backdrop-blur-sm lg:mb-0 lg:flex lg:flex-wrap lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-0">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`min-h-[54px] min-w-0 rounded-[20px] px-3 py-2.5 text-left transition-all lg:flex-1 xl:flex-none xl:px-4 ${
                                    activeTab === tab.id
                                        ? 'bg-white/10 border border-white/15 text-white/80'
                                        : 'bg-white/[0.03] text-white/35 hover:bg-white/[0.06]'
                                }`}
                            >
                                <span className="block text-[12px] font-semibold">{tab.label}</span>
                                <span className={`mt-1 block text-[10px] font-medium ${
                                    getStepStatusLabel(tab.id) === '需复核' ? 'text-amber-200/75' : 'text-white/28'
                                }`}>
                                    {getStepStatusLabel(tab.id)}
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="min-h-0 flex-1 pb-3 sm:pb-4 lg:pr-1">
                        {activeTab === 'system' && renderSystemStep()}
                        {activeTab === 'protocol' && renderProtocolStep()}
                        {activeTab === 'interaction' && renderInteractionStep()}
                        {activeTab === 'html' && renderHtmlTab()}
                        {activeTab === 'css' && renderCssTab()}
                        {activeTab === 'js' && renderJsTab()}
                    </div>
                </div>
            </div>

            <button
                onClick={handleSave}
                className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/15 shadow-lg shadow-black/40 backdrop-blur-xl transition-all active:scale-90 sm:hidden"
                aria-label="保存"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 text-white/90">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
            </button>
        </div>
    );
};

export default StatusWorkshopApp;
