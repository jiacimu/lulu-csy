import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import type { CustomStatusTemplate } from '../types/statusCard';
import {
    DATE_STATUS_BUILTIN_MODULE_TEMPLATES,
    DATE_STATUS_BUILTIN_TEMPLATES,
    DATE_STATUS_MODULE_REGISTRY,
    DEFAULT_DATE_STATUS_MODULE_IDS,
    DEFAULT_DATE_STATUS_TEMPLATE_ID,
    buildDateStatusInlineInstruction,
    buildLatestDateStatusSnapshotBlock,
    createDateStatusCardDataFromRaw,
    createDateStatusTemplateFromModuleIds,
    extractDateStatusCardFromMainOutput,
    getDateStatusTemplateOptions,
    getSelectedDateStatusModuleIds,
    resolveDateStatusTemplate,
} from './dateStatusTemplates';

const customTemplate: CustomStatusTemplate = {
    id: 'custom-status-1',
    name: '自定义雨声',
    systemPrompt: '输出状态。',
    extractRegex: '',
    htmlBody: '<section>{{心情}}</section>',
    cssTemplate: '',
    jsTemplate: '',
    renderMode: 'html',
    fields: [{ id: 'field_1', name: '心情', description: '当前心情', required: true }],
};

const customRegexTemplate: CustomStatusTemplate = {
    id: 'custom-regex-status-1',
    name: '正则工坊',
    systemPrompt: '输出 <status>心情=当前心情</status>。',
    extractRegex: '心情=([^\\n<]+)',
    htmlTemplate: '<section class="regex-card">$1</section>',
    renderMode: 'html',
    fields: [],
};

const createCharacter = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-1',
    name: '测试角色',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    contextLimit: 500,
    ...overrides,
});

const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: overrides.id || 1,
    charId: 'char-1',
    role: overrides.role || 'assistant',
    type: overrides.type || 'text',
    content: overrides.content || '',
    timestamp: overrides.timestamp || 1000,
    metadata: overrides.metadata,
});

describe('dateStatusTemplates', () => {
    it('uses the default built-in template when nothing is selected', () => {
        const template = resolveDateStatusTemplate(createCharacter());

        expect(template.id).toBe(DEFAULT_DATE_STATUS_TEMPLATE_ID);
        expect(template.name).toBe('此幕');
        expect(template.fields?.length).toBeGreaterThan(0);
        expect(template.systemPrompt).toContain('<status>');
    });

    it('registers ten built-in status modules without mode presets', () => {
        expect(DATE_STATUS_MODULE_REGISTRY).toHaveLength(10);
        expect(DEFAULT_DATE_STATUS_MODULE_IDS).toEqual(['scene_progress']);
        expect(DATE_STATUS_BUILTIN_MODULE_TEMPLATES).toHaveLength(10);
        expect(DATE_STATUS_BUILTIN_TEMPLATES).toHaveLength(DATE_STATUS_BUILTIN_MODULE_TEMPLATES.length);
    });

    it('creates a combined template from selected built-in modules', () => {
        const template = createDateStatusTemplateFromModuleIds(['scene_progress', 'player_condition']);

        expect(template?.name).toBe('此幕 + 此身');
        expect(template?.fields?.some(field => field.name === '此幕-当前场景')).toBe(true);
        expect(template?.fields?.some(field => field.name === '此身-身份')).toBe(true);
    });

    it('migrates legacy mode selections to the compact default module', () => {
        const selectedIds = getSelectedDateStatusModuleIds(createCharacter({
            dateStatusTemplateId: 'builtin_date_status_mode_story',
        }));

        expect(selectedIds).toEqual(DEFAULT_DATE_STATUS_MODULE_IDS);
    });

    it('keeps hidden and mixed modules visible in generated cards', () => {
        const plotAnchorTemplate = DATE_STATUS_BUILTIN_MODULE_TEMPLATES.find(template => template.id.endsWith('plot_anchor'));

        expect(plotAnchorTemplate).toBeTruthy();
        expect(plotAnchorTemplate?.htmlBody).toContain('class="flip"');
        expect(plotAnchorTemplate?.htmlBody).toContain('命途-暗线·勿泄');
        expect(plotAnchorTemplate?.allowScripts).toBe(true);
        expect(plotAnchorTemplate?.systemPrompt).toContain('【内核】只是不在玩家界面强调');
    });

    it('builds a main API inline instruction for status generation', () => {
        const template = resolveDateStatusTemplate(createCharacter());
        const instruction = buildDateStatusInlineInstruction(template);

        expect(instruction).toContain('你仍然要先正常输出线下剧情正文');
        expect(instruction).toContain('可以参考【当前线下状态快照】');
        expect(instruction).toContain('不要原样复制旧字段');
        expect(instruction).toContain('<status>');
        expect(instruction).toContain(template.fields?.[0].name);
    });

    it('keeps inactive built-in modules out of the main API inline instruction', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            dateStatusModuleIds: ['scene_progress'],
        }));
        const instruction = buildDateStatusInlineInstruction(template);

        expect(instruction).toContain('此幕-当前场景');
        expect(instruction).toContain('此幕-场景目标');
        expect(instruction).not.toContain('命途-当前弧线');
        expect(instruction).not.toContain('怦然-心动');
        expect(instruction).not.toContain('执笔-当前基调');
    });

    it('does not duplicate enabled field lists when a template already embeds its field protocol', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            dateStatusModuleIds: ['clue_foreshadow', 'romance_affection'],
        }));
        const instruction = buildDateStatusInlineInstruction(template);
        const protocolMatches = instruction.match(/字段协议：/g) || [];

        expect(instruction).toContain('### 当前启用模块');
        expect(instruction).not.toContain('当前实际启用字段');
        expect(protocolMatches).toHaveLength(1);
    });

    it('uses compact fallback rules for workshop templates without a system prompt', () => {
        const instruction = buildDateStatusInlineInstruction({
            ...customTemplate,
            systemPrompt: '',
        });

        expect(instruction).toContain('心情');
        expect(instruction).not.toContain('命途-当前弧线');
        expect(instruction).not.toContain('怦然-心动');
    });

    it('builds a compact current status snapshot from the latest Date status card only', () => {
        const olderCard = createDateStatusCardDataFromRaw(
            '<status>\n【此幕】\n此幕-当前场景: 旧场景\n</status>',
            resolveDateStatusTemplate(createCharacter()),
        );
        const latestCard = createDateStatusCardDataFromRaw(
            '<status>\n【此幕】\n此幕-当前场景: 雨夜 · 窗边餐桌\n此幕-场景目标: 先不要挑破\n</status>',
            resolveDateStatusTemplate(createCharacter()),
        );

        const block = buildLatestDateStatusSnapshotBlock([
            createMessage({
                id: 1,
                timestamp: 1000,
                metadata: { source: 'date', hasDateStatusCard: true, statusCardData: olderCard },
            }),
            createMessage({
                id: 2,
                timestamp: 2000,
                metadata: { source: 'date', hasDateStatusCard: true, statusCardData: latestCard },
            }),
            createMessage({
                id: 3,
                role: 'user',
                timestamp: 3000,
                content: '你是不是有话没说？',
                metadata: { source: 'date' },
            }),
        ]);

        expect(block).toContain('### 【当前线下状态快照】');
        expect(block).toContain('不是用户输入，不是角色台词');
        expect(block).toContain('哪些禁忌写法需要遵守');
        expect(block).toContain('雨夜 · 窗边餐桌');
        expect(block).not.toContain('旧场景');
        expect(block).not.toContain('<status>');
        expect(block).not.toContain('html');
    });

    it('renders built-in status cards with the v2 skin structure', () => {
        const template = resolveDateStatusTemplate(createCharacter());

        expect(template.htmlBody).toContain('class="date-registry__module play"');
        expect(template.htmlBody).toContain('<details class="bk">');
        expect(template.cssTemplate).toContain('.play');
        expect(template.cssTemplate).toContain('.date-status-v2');
        expect(template.cssTemplate).toContain('.back .fields{position:relative');
        expect(template.cssTemplate).toContain('max-height:292px');
        expect(template.cssTemplate).toContain('rgba(218,176,88,.25)');
        expect(template.headTemplate).toContain('fonts.googleapis.com');
    });

    it('extracts a status card from main API output and strips it from content', () => {
        const template = resolveDateStatusTemplate(createCharacter());
        const statusLines = (template.fields || []).map(field => (
            field.type === 'list'
                ? `${field.name}:\n  - ${field.name}值1\n  - ${field.name}值2`
                : `${field.name}: ${field.name}值`
        )).join('\n');

        const result = extractDateStatusCardFromMainOutput(
            `[happy] 他把声音放轻了一点。\n\n<status>\n${statusLines}\n</status>`,
            template,
        );

        expect(result.content).toBe('[happy] 他把声音放轻了一点。');
        expect(result.cardData?.cardType).toBe('freeform');
        expect(result.cardData?.meta?.html).toContain(template.name);
        expect(result.cardData?.meta?.dateStatusRaw).toContain('此幕-当前场景');
        expect(result.cardData?.meta?.html).not.toContain('<status>');
    });

    it('honors workshop regex captures before falling back to status block parsing', () => {
        const result = extractDateStatusCardFromMainOutput(
            '[happy] 他把伞往她那边又偏了一点。\n\n<status>心情=柔软</status>',
            customRegexTemplate,
        );

        expect(result.content).toBe('[happy] 他把伞往她那边又偏了一点。');
        expect(result.cardData?.cardType).toBe('freeform');
        expect(result.cardData?.meta?.html).toContain('柔软');
        expect(result.cardData?.meta?.html).not.toContain('$1');
    });

    it('rebuilds editable status cards from raw field text', () => {
        const template = resolveDateStatusTemplate(createCharacter());
        const rawStatus = '此幕-当前场景: 雨窗边\n此幕-场景目标: 慢慢靠近';

        const cardData = createDateStatusCardDataFromRaw(rawStatus, template);

        expect(cardData?.cardType).toBe('freeform');
        expect(cardData?.meta?.html).toContain('雨窗边');
        expect(cardData?.meta?.dateStatusRaw).toContain('此幕-当前场景');
    });

    it('keeps the old field prefix parseable while rendering the new v2 prefix', () => {
        const template = resolveDateStatusTemplate(createCharacter());
        const rawStatus = '场景推进栏-当前场景: 雨窗边\n场景推进栏-场景目标: 慢慢靠近';

        const cardData = createDateStatusCardDataFromRaw(rawStatus, template);

        expect(cardData?.meta?.dateStatusFields).toMatchObject({
            '此幕-当前场景': '雨窗边',
            '此幕-场景目标': '慢慢靠近',
        });
    });

    it('renders all ten v2 cards, folded kernels, flip card scripts, and numeric derived values', () => {
        const template = createDateStatusTemplateFromModuleIds(DATE_STATUS_MODULE_REGISTRY.map(module => module.id));
        expect(template).toBeTruthy();

        const statusLines = (template?.fields || []).map(field => {
            if (field.type === 'list') {
                return `${field.name}: 示例1 - 示例2`;
            }
            if (field.name.endsWith('-心动') || field.name.endsWith('-信任') || field.name.endsWith('-威胁等级')) {
                return `${field.name}: 82 藏不住了`;
            }
            return `${field.name}: ${field.name}值`;
        }).join('\n');

        const cardData = createDateStatusCardDataFromRaw(`<status>\n${statusLines}\n</status>`, template);
        const html = String(cardData?.meta?.html || '');

        expect(html).toContain('class="date-registry__module flip-scene"');
        expect(html).toContain('class="date-registry__module play"');
        expect(html).toContain('class="date-registry__module clue"');
        expect(html).toContain('class="date-registry__module file"');
        expect(html).toContain('class="date-registry__module plan"');
        expect(html).toContain('class="date-registry__module letter"');
        expect(html).toContain('class="date-registry__module pass"');
        expect(html).toContain('class="date-registry__module news"');
        expect(html).toContain('class="date-registry__module cable"');
        expect(html).toContain('class="date-registry__module editor"');
        expect(html).toContain('<details class="bk">');
        expect(html).toContain('<details class="editor-core">');
        expect(html).toContain('style="width:82%');
        expect(cardData?.meta?.allowScripts).toBe(true);
    });

    it('renders the v2 prompt sample status block', () => {
        const template = createDateStatusTemplateFromModuleIds([
            'plot_anchor',
            'scene_progress',
            'romance_affection',
            'event_trigger',
            'narrative_control',
        ]);
        const sample = `<status>
【命途】
命途-当前弧线: 查纵火真相 × 对嫌疑人动心
命途-锚点阶段: 逼近（铺垫 → ●逼近 → 触发)
命途-主线锚点: 他须在雨夜亲口承认那晚在场
命途-触发条件: 信任≥60 且 拿到照片背面号码 -> 自白
命途-暗线·勿泄: 真凶其实是替他顶罪的人
命途-下一推进: 让录音笔"恰好"录下他的一瞬犹豫
【此幕】
此幕-当前场景: 雨夜 · 废仓库
此幕-场景目标: 套出他那晚到底在不在场
此幕-节拍进度: ✓ 借故入仓 - ✓ 他递来围巾 - … 尚未问到正题
此幕-退出条件: 他起疑 或 巡捕靠近 -> 切场
此幕-下一场景候选: 屋顶避雨 - 被迫分别
此幕-场景节奏: 升温（走小步,本轮不切场)
【怦然】
怦然-对象: 沈聿
怦然-关系阶段: 心动初期
怦然-心动: 78 又往上跳了一下
怦然-亲密: 52 敢并肩了
怦然-安心: 40 还不敢全信
怦然-心动信号: 他披围巾时指尖蹭到你耳朵,两人都顿了半秒
怦然-此刻边界: 可以靠近、被直视会躲;此刻不接受告白
怦然-可解锁恋爱事件: 雨夜送伞告白（需 安心≥60 且单独)-> 本轮未满足,仅给暗示
【伏机】
伏机-已激活: 初次单独相处 - 当面提及那场火
伏机-待命事件: 信任≥60 -> 解锁他的自白
伏机-限时事件: 子时收网倒计时 01:52 -> 逾时撞收网,被迫离场
伏机-冷却中: 围巾梗（剩 1 场)
【执笔】
执笔-当前基调: 雨夜暗涌,克制的心动
执笔-火候: 升温 · 中冲突 · 信息留白
执笔-本轮写作目标: 让读者替她心跳又替她捏汗;别急着让谁告白
执笔-下一步写法: 贴他视角写一瞬心软,落点留在他没出口的那句话
执笔-禁止风格: 说教 - 上帝视角剧透 - OOC
</status>`;

        const cardData = createDateStatusCardDataFromRaw(sample, template);
        const html = String(cardData?.meta?.html || '');

        expect(html).toContain('查纵火真相 × 对嫌疑人动心');
        expect(html).toContain('雨夜 · 废仓库');
        expect(html).toContain('又往上跳了一下 78');
        expect(html).toContain('初次单独相处');
        expect(html).toContain('编辑内核');
        expect(html).toContain('class="flip"');
        expect(html).toContain('<details class="bk">');
        expect(cardData?.meta?.dateStatusFields?.['此幕-节拍进度']).toEqual([
            '✓ 借故入仓',
            '✓ 他递来围巾',
            '… 尚未问到正题',
        ]);
    });

    it('can resolve a workshop template selected for DateApp', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            customStatusTemplates: [customTemplate],
            dateStatusTemplateId: customTemplate.id,
        }));

        expect(template).toBe(customTemplate);
    });

    it('prioritizes a selected workshop template over default built-in modules', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            customStatusTemplates: [customTemplate],
            dateStatusModuleIds: undefined,
            dateStatusTemplateId: customTemplate.id,
        }));

        expect(template).toBe(customTemplate);
    });

    it('does not use the chat workshop active template when DateApp has no workshop selection', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            customStatusTemplates: [customTemplate],
            activeCustomTemplateId: customTemplate.id,
        }));

        expect(template.id).toBe(DEFAULT_DATE_STATUS_TEMPLATE_ID);
        expect(template).not.toBe(customTemplate);
    });

    it('keeps selected built-in modules when a chat workshop template is active', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            customStatusTemplates: [customTemplate],
            activeCustomTemplateId: customTemplate.id,
            dateStatusModuleIds: ['scene_progress', 'player_condition'],
        }));

        expect(template?.name).toBe('此幕 + 此身');
        expect(template?.fields?.some(field => field.name === '此身-身份')).toBe(true);
    });

    it('falls back to the default when the selected workshop template was removed', () => {
        const template = resolveDateStatusTemplate(createCharacter({
            dateStatusTemplateId: 'missing-template',
        }));

        expect(template.id).toBe(DEFAULT_DATE_STATUS_TEMPLATE_ID);
    });

    it('lists built-in templates before workshop templates', () => {
        const options = getDateStatusTemplateOptions(createCharacter({
            customStatusTemplates: [customTemplate],
        }));

        expect(options.slice(0, DATE_STATUS_BUILTIN_TEMPLATES.length).every(option => option.source === 'builtin_module')).toBe(true);
        expect(options[options.length - 1]).toMatchObject({ id: customTemplate.id, source: 'workshop' });
    });
});
