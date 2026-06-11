import type { CharacterProfile, Message } from '../types';
import type { CustomStatusTemplate, StatusCardData, TemplateField } from '../types/statusCard';
import { parseStatusBlock } from './statusBlockParser';
import { composeCustomStatusTemplateHtml, LAYERED_STATUS_TEMPLATE_VERSION } from './statusTemplateComposer';

export const DATE_STATUS_BUILTIN_PREFIX = 'builtin_date_status_';
export const DATE_STATUS_MODE_PREFIX = `${DATE_STATUS_BUILTIN_PREFIX}mode_`;
export const DEFAULT_DATE_STATUS_MODULE_IDS = ['scene_progress'];
export const DEFAULT_DATE_STATUS_TEMPLATE_ID = `${DATE_STATUS_BUILTIN_PREFIX}${DEFAULT_DATE_STATUS_MODULE_IDS[0]}`;

export type StatusBarVisibility = 'public' | 'hidden' | 'mixed';
export type DateStatusFieldType = 'string' | 'number' | 'string[]' | 'enum' | 'object';
export type DateStatusFieldLevel = 'display' | 'kernel';
export type DateStatusTemplateSource = 'builtin_module' | 'workshop';

export interface DateStatusFieldDefinition {
    key: string;
    label: string;
    type: DateStatusFieldType;
    level: DateStatusFieldLevel;
    visibleToPlayer: boolean;
    effect: string;
    enumValues?: string[];
}

export interface DateStatusModuleDefinition {
    id: string;
    name: string;
    oldName: string;
    visibility: StatusBarVisibility;
    defaultEnabled: boolean;
    priority: number;
    genreTags?: string[];
    description: string;
    accent: string;
    skinClass: string;
    fields: DateStatusFieldDefinition[];
}

export interface DateStatusTemplateOption {
    id: string;
    name: string;
    source: DateStatusTemplateSource;
    template: CustomStatusTemplate;
}

export interface DateStatusMainOutputResult {
    content: string;
    cardData?: StatusCardData;
    templateId?: string;
}

const DATE_STATUS_SNAPSHOT_MAX_CHARS = 2400;

const DATE_STATUS_FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;500;600;700;900&family=Playfair+Display:ital,wght@0,500;0,700;0,900;1,500;1,700&family=Special+Elite&display=swap" rel="stylesheet">`;

export const DATE_STATUS_SYSTEM_PROMPT_V2 = `你是这场线下剧情的「状态栏导演」。每当主回复结束,你负责生成追加在正文后的一个 <status>...</status> 块。它有三重职责:**如实记录**刚发生的、**埋下钩子**让下一段演得出来、**把控节奏**让剧情不快不慢地往前走。

### 一、输出格式(硬性)
- 状态栏只允许有一个 <status>...</status> 块;不要为状态栏追加解释、Markdown 或 JSON。
- 每个模块用 \`【模块名】\` 起头;字段标签 \`模块名-字段名:\` **逐字照抄**,顺序不变,每个字段都要有值。
- 【展示】和【内核】字段**都要写**;【内核】只是不在玩家界面强调,绝不能省略。
- \`数值\` 字段 = 0–100 整数 + 一句情绪词,例:\`心动: 82 藏不住了\`。
- \`列表\` 字段 = 短横线 1–3 条;\`映射\` 字段 = \`条件/对象 -> 结果\`;\`文本\` 字段 = 一句具体、能被下一段直接用上的话。
- 一切取材于**最近一次互动、角色刚才的反应、当前身体状态与真实上下文**,不得凭空制造重大事件。

### 二、两条铁律(决定质量)
1. **分层。**【展示】写给玩家的情绪与剧情;【内核】写给你自己导航——主线、暗线、触发条件、禁止项。两者不混。
2. **每个字段都给下一轮埋钩子。** \`心动信号 / 此刻边界 / 未说出口 / 可解锁 / 下一推进 / 触发条件 / 拉扯动作\` 这类字段,必须落到**下一段能直接照着演**的具体东西——一个动作、一句没说出口的话、一道能被触碰的边界、一处具体身体反应,而不是抽象总结或无用形容。

### 三、节奏控制(最重要:防快防慢)
- **一轮只走一小步。** 每轮至多推进一个节拍、或一处数值小幅变化(通常 ±3~8)。不要一轮连跳几个阶段、几段关系。
- **大事件上锁。** 告白、真相揭破、自白、关系跃迁、锚点触发这类「大 beat」,**只有当其【触发条件】明确满足**(如 信任≥60、拿到某物、单独相处)才允许发生。
- **防过快。** 玩家想一步到位、催着要时,用 \`此刻边界 / 红线·禁止 / 戒备 / 克制\` 把它挡回「还差一点」,只在 \`心动信号 / 暧昧张力\` 给「接近」的暗示,把张力存着,留到条件满足再爆发。
- **防过慢。** 若连续 2–3 轮 \`节拍进度\` 不动、关系数值停滞,主动在 \`下一推进 / 下一场景候选 / 待命事件\` 放一个**小推力**:一条新线索、一句越界的话、一件外部事件,把剧情顶前一格;必要时让 \`限时事件\` 的倒计时逼近,用外部压力催动。
- **看三块「油门表」。** \`锚点阶段(铺垫→逼近→触发)\`、\`场景节奏\`、\`火候\` 指示当前该快该慢:**铺垫期**多埋少推、**逼近期**加快小步、**触发期**才允许大 beat。其余字段据此调。
- **不自相矛盾。** 数值、情绪词、阶段、事件要彼此自洽——别在 \`安心: 30\` 时解锁深度告白,也别在「铺垫期」抖出真相。

### 四、模块与字段(v2;每条标〔类型|层级〕)

**【命途】** 主线导航
- 命途-当前弧线 〔标签|展示〕这段走在哪条线上
- 命途-锚点阶段 〔标签|展示〕铺垫/逼近/触发——节奏油门
- 命途-主线锚点 〔文本|内核〕必须命中的关键节点
- 命途-触发条件 〔映射|内核〕满足什么 -> 锚点点燃
- 命途-暗线·勿泄 〔列表|内核〕现在绝不能让玩家知道的
- 命途-下一推进 〔文本|内核〕下一轮往锚点推一步的具体动作

**【此幕】** 场景推进
- 此幕-当前场景 〔标签|展示〕此刻在哪、做什么
- 此幕-场景目标 〔文本|展示〕这场戏要拿到的(情绪/信息/关系)
- 此幕-节拍进度 〔列表|展示〕✓已完成 / …进行中
- 此幕-退出条件 〔映射|内核〕满足什么 -> 切场
- 此幕-下一场景候选 〔列表|内核〕1–2 个去向
- 此幕-场景节奏 〔标签|内核〕慢热/升温/转折/收束

**【草蛇灰线】** 线索伏笔
- 草蛇灰线-已掌握线索 〔列表|展示〕玩家已知
- 草蛇灰线-关键物品 〔列表|展示〕在场/在手的要紧物
- 草蛇灰线-误导线索 〔列表|内核〕烟雾弹(标真/假)
- 草蛇灰线-未浮现线索 〔列表|内核〕玩家还不知道的
- 草蛇灰线-伏笔账本 〔映射|内核〕待回收 / 已回收
- 草蛇灰线-信息边界 〔文本|内核〕这轮不能说破的那条线

**【人心向背】** 角色立场
- 人心向背-角色 〔标签|展示〕谁
- 人心向背-立场 〔标签|展示〕盟友/中立/对立/不明
- 人心向背-信任 〔数值|展示〕对玩家的信任
- 人心向背-戒备 〔数值|展示〕警惕(情绪词带出恐惧来源)
- 人心向背-隐藏动机 〔文本|内核〕他真正想要的
- 人心向背-关系筹码 〔文本|内核〕谁欠谁、忠于谁,可被利用
- 人心向背-可解锁信息 〔映射|内核〕信任/条件达成 -> 松口的;否则锁定

**【怦然】** 恋爱心动
- 怦然-对象 〔标签|展示〕心动对象
- 怦然-关系阶段 〔标签|展示〕陌生/心动初期/暧昧/确认
- 怦然-心动 〔数值|展示〕怦然程度
- 怦然-亲密 〔数值|展示〕靠近/舒适
- 怦然-安心 〔数值|展示〕对关系的笃定(依赖在此用情绪词体现)
- 怦然-心动信号 〔文本|展示〕他刚刚那个具体小动作
- 怦然-此刻边界 〔文本|展示〕她现在愿意/不愿意
- 怦然-可解锁恋爱事件 〔映射|内核〕下一颗糖 + 触发条件

**【暗涌】** 恋爱拉扯
- 暗涌-对象 〔标签|展示〕拉扯对象
- 暗涌-暧昧张力 〔数值|展示〕空气里的电流
- 暗涌-占有欲 〔数值|展示〕吃醋/想独占
- 暗涌-克制 〔数值|展示〕他在多用力忍,高=快绷断
- 暗涌-当前距离 〔标签|展示〕贴近/试探/拉开/僵持(情绪词带出误会)
- 暗涌-未说出口 〔文本|展示〕此刻他咽下去的那句(含脆弱暴露)
- 暗涌-拉扯动作 〔文本|内核〕下一轮制造张力的具体动作
- 暗涌-红线·禁止 〔列表|内核〕此刻绝不能做的

**【此身】** 玩家状态
- 此身-身份 〔标签|展示〕对外身份/伪装
- 此身-身体 〔数值|展示〕体力/状态(负面状态用情绪词带出)
- 此身-心神 〔数值|展示〕镇定,高=稳低=濒临崩
- 此身-暴露度 〔数值|展示〕身份/秘密被看穿的风险
- 此身-持有物 〔列表|展示〕关键随身物
- 此身-可打的牌 〔列表|内核〕此刻能用的本事/手段
- 此身-可触发剧情 〔映射|内核〕我方状态达到 X -> 解锁

**【风云录】** 世界势力
- 风云录-此刻 〔文本|展示〕时间+地点+天气一句(天气作氛围)
- 风云录-威胁等级 〔数值|展示〕当前危险度
- 风云录-活跃势力 〔列表|展示〕在场/相关势力
- 风云录-势力动态 〔映射|内核〕哪股势力做什么 -> 对玩家的影响
- 风云录-限时事件 〔映射|内核〕倒计时 -> 不处理的后果
- 风云录-限制区域 〔列表|内核〕现在不能去/被封锁的

**【伏机】** 事件触发
- 伏机-已激活 〔列表|展示〕已点亮的关键 flag(让玩家感到留痕)
- 伏机-待命事件 〔映射|内核〕满足 X -> 触发
- 伏机-限时事件 〔映射|内核〕倒计时 -> 后果
- 伏机-冷却中 〔列表|内核〕暂不会再触发的,带剩余冷却

**【执笔】** 叙事控制(全内核,导演台)
- 执笔-当前基调 〔标签|内核〕甜/虐/悬/暖
- 执笔-火候 〔标签|内核〕节奏+冲突+信息密度一句
- 执笔-本轮写作目标 〔文本|内核〕这一轮要让读者感受到什么
- 执笔-下一步写法 〔文本|内核〕具体怎么写下一段(视角/聚焦/留白)
- 执笔-禁止风格 〔列表|内核〕不要的写法(说教/上帝视角/OOC)

### 五、输出骨架
按第四节的模块与字段顺序逐条输出,整体包在一个 <status>...</status> 块内;\`列表\`/\`映射\` 字段每条以两个空格缩进的短横线起一行。`;

const DATE_STATUS_COMPACT_SYSTEM_PROMPT_V2 = `你是这场线下剧情的「状态栏导演」。每当主回复结束，你负责生成追加在正文后的一个 <status>...</status> 块。它有三重职责：如实记录刚发生的、埋下钩子让下一段演得出来、把控节奏让剧情不快不慢地往前走。

### 一、输出格式（硬性）
- 状态栏只允许有一个 <status>...</status> 块；不要为状态栏追加解释、Markdown 或 JSON。
- 每个启用模块用 \`【模块名】\` 起头；字段标签 \`模块名-字段名:\` 必须逐字照抄，顺序不变，每个字段都要有值。
- 【展示】和【内核】字段都要写；【内核】只是不在玩家界面强调，绝不能省略。
- \`数值\` 字段 = 0-100 整数 + 一句情绪词，例如：\`心动: 82 藏不住了\`。
- \`列表\` 字段 = 短横线 1-3 条；\`映射\` 字段 = \`条件/对象 -> 结果\`；\`文本\` 字段 = 一句具体、能被下一段直接用上的话。
- 一切取材于最近一次互动、角色刚才的反应、当前身体状态与真实上下文，不得凭空制造重大事件。

### 二、两条铁律（决定质量）
1. 分层。【展示】写给玩家的情绪与剧情；【内核】写给你自己导航：主线、暗线、触发条件、禁止项。两者不混。
2. 每个字段都给下一轮埋钩子。凡是心动信号、边界、未说出口、可解锁、下一推进、触发条件、拉扯动作，都必须给出下一轮能直接照着演的具体东西：一个动作、一句没说出口的话、一道能被触碰的边界、一处具体身体反应，而不是抽象总结或无用形容。

### 三、节奏控制（最重要：防快防慢）
- 一轮只走一小步。每轮至多推进一个节拍，或一处数值小幅变化（通常 +/- 3-8）。
- 大事件上锁。告白、真相揭破、自白、关系跃迁、锚点触发这类大 beat，只有当对应触发条件明确满足时才允许发生。
- 防过快。玩家想一步到位、催着要时，用边界、红线、戒备、克制把它挡回“还差一点”，只给接近的暗示，把张力存着。
- 防过慢。若连续 2-3 轮进度不动，主动放一个小推力：一条新线索、一句越界的话、一件外部事件。
- 不自相矛盾。数值、情绪词、阶段、事件要彼此自洽。`;

const field = (
    key: string,
    label: string,
    type: DateStatusFieldType,
    level: DateStatusFieldLevel,
    effect: string,
    enumValues?: string[],
): DateStatusFieldDefinition => ({
    key,
    label,
    type,
    level,
    visibleToPlayer: level === 'display',
    effect,
    enumValues,
});

export const DATE_STATUS_MODULE_REGISTRY: DateStatusModuleDefinition[] = [
    {
        id: 'plot_anchor',
        name: '命途',
        oldName: '剧情锚点栏',
        visibility: 'hidden',
        defaultEnabled: true,
        priority: 100,
        description: '主线导航：锁住弧线、锚点、触发条件与下一推进。',
        accent: '#c2cdde',
        skinClass: 'flip',
        fields: [
            field('currentArc', '当前弧线', 'enum', 'display', '这段感情/事件走在哪条线上，定大方向。'),
            field('anchorPhase', '锚点阶段', 'enum', 'display', '铺垫 / 逼近 / 触发 / 已过，定逼近感。', ['铺垫', '逼近', '触发', '已过']),
            field('mainAnchor', '主线锚点', 'string', 'kernel', '这条弧线必须命中的关键节点。'),
            field('triggerConditions', '触发条件', 'object', 'kernel', '满足什么 -> 锚点点燃，定何时引爆。'),
            field('forbiddenReveals', '暗线·勿泄', 'string[]', 'kernel', '现在绝不能让玩家知道的 1-3 条。'),
            field('nextNudge', '下一推进', 'string', 'kernel', '下一轮往锚点推一步的具体动作，含谁/在哪。'),
        ],
    },
    {
        id: 'scene_progress',
        name: '此幕',
        oldName: '场景推进栏',
        visibility: 'mixed',
        defaultEnabled: true,
        priority: 90,
        description: '场景推进：记录此刻、目标、节拍和自然切场条件。',
        accent: '#9c2f3a',
        skinClass: 'play',
        fields: [
            field('currentScene', '当前场景', 'enum', 'display', '此刻在哪、在做什么。'),
            field('sceneGoal', '场景目标', 'string', 'display', '这场戏要拿到的情绪、信息或关系。'),
            field('beatProgress', '节拍进度', 'string[]', 'display', '已完成 / 进行中，1-3 条，给推进感。'),
            field('exitConditions', '退出条件', 'object', 'kernel', '满足什么 -> 切场。'),
            field('nextSceneCandidates', '下一场景候选', 'string[]', 'kernel', '1-2 个自然去向。'),
            field('sceneTempo', '场景节奏', 'enum', 'kernel', '慢热 / 升温 / 转折 / 收束。', ['慢热', '升温', '转折', '收束']),
        ],
    },
    {
        id: 'clue_foreshadow',
        name: '草蛇灰线',
        oldName: '线索伏笔栏',
        visibility: 'hidden',
        defaultEnabled: true,
        priority: 85,
        genreTags: ['悬疑', '推理', '冒险', '都市怪谈', '无限流'],
        description: '线索伏笔：区分已知、未知、误导与本轮信息边界。',
        accent: '#a83232',
        skinClass: 'clue',
        fields: [
            field('knownClues', '已掌握线索', 'string[]', 'display', '玩家已知的 1-3 条。'),
            field('keyItems', '关键物品', 'string[]', 'display', '在场或在手的要紧物。'),
            field('falseLeads', '误导线索', 'string[]', 'kernel', '故意烟雾弹，标真/假。'),
            field('unknownClues', '未浮现线索', 'string[]', 'kernel', '玩家还不知道的。'),
            field('foreshadowLedger', '伏笔账本', 'object', 'kernel', '待回收 / 已回收各一条。'),
            field('informationLimits', '信息边界', 'string', 'kernel', '这轮绝不能说破的那条线。'),
        ],
    },
    {
        id: 'character_stance',
        name: '人心向背',
        oldName: '角色立场栏',
        visibility: 'mixed',
        defaultEnabled: true,
        priority: 80,
        description: '角色立场：非恋爱阵营态度，追踪信任、戒备与可解锁信息。',
        accent: '#8f3242',
        skinClass: 'file',
        fields: [
            field('characterName', '角色', 'enum', 'display', '正在追踪的人物。'),
            field('attitude', '立场', 'enum', 'display', '盟友 / 中立 / 对立 / 不明。', ['盟友', '中立', '对立', '不明']),
            field('trust', '信任', 'number', 'display', '对玩家的信任，高时愿意托付。'),
            field('suspicion', '戒备', 'number', 'display', '警惕与防备，情绪词带出恐惧来源。'),
            field('hiddenIntent', '隐藏动机', 'string', 'kernel', '这角色真正想要的，玩家未必知道。'),
            field('relationshipLeverage', '关系筹码', 'string', 'kernel', '谁欠谁、忠于谁，可被利用的点。'),
            field('unlockableInfo', '可解锁信息', 'object', 'kernel', '信任/条件达成 -> 松口的；否则锁定。'),
        ],
    },
    {
        id: 'romance_affection',
        name: '怦然',
        oldName: '恋爱心动栏',
        visibility: 'mixed',
        defaultEnabled: false,
        priority: 82,
        genreTags: ['恋爱', '乙女', '纯爱', '暧昧', '陪伴'],
        description: '恋爱甜面：记录心动、亲密、安心、信号与边界。',
        accent: '#e87f9d',
        skinClass: 'plan',
        fields: [
            field('target', '对象', 'enum', 'display', '心动对象。'),
            field('relationshipStage', '关系阶段', 'enum', 'display', '陌生 / 心动初期 / 暧昧 / 确认。', ['陌生', '心动初期', '暧昧', '确认', '热恋', '裂痕', '复合']),
            field('affection', '心动', 'number', 'display', '怦然程度，高时藏不住。'),
            field('intimacy', '亲密', 'number', 'display', '靠近与舒适度。'),
            field('comfort', '安心', 'number', 'display', '对这段关系的笃定，依赖在情绪词里体现。'),
            field('heartSignal', '心动信号', 'string', 'display', '他刚刚那个具体小动作。'),
            field('softBoundary', '此刻边界', 'string', 'display', '她现在愿意 / 不愿意什么。'),
            field('availableRomanceBeats', '可解锁恋爱事件', 'object', 'kernel', '下一颗糖 + 触发条件。'),
        ],
    },
    {
        id: 'romance_tension',
        name: '暗涌',
        oldName: '恋爱拉扯栏',
        visibility: 'hidden',
        defaultEnabled: false,
        priority: 83,
        genreTags: ['恋爱', '强强', '宿敌', '追妻', '破镜重圆', '禁忌'],
        description: '恋爱张力面：吃醋、占有、克制、未说出口都在这里。',
        accent: '#7c3a57',
        skinClass: 'letter',
        fields: [
            field('target', '对象', 'enum', 'display', '拉扯对象。'),
            field('tension', '暧昧张力', 'number', 'display', '空气里的电流。'),
            field('possessiveness', '占有欲', 'number', 'display', '吃醋 / 想独占。'),
            field('restraint', '克制', 'number', 'display', '他在多用力忍，高时快绷断。'),
            field('distance', '当前距离', 'enum', 'display', '贴近 / 试探 / 拉开 / 僵持，情绪词带出误会。', ['贴近', '试探', '拉开', '僵持']),
            field('unsaidThought', '未说出口', 'string', 'display', '此刻他咽下去的那句，含脆弱暴露。'),
            field('pushPullAction', '拉扯动作', 'string', 'kernel', '下一轮制造张力的具体动作。'),
            field('forbiddenActions', '红线·禁止', 'string[]', 'kernel', '这段关系此刻绝不能做的。'),
        ],
    },
    {
        id: 'player_condition',
        name: '此身',
        oldName: '玩家状态栏',
        visibility: 'public',
        defaultEnabled: true,
        priority: 75,
        description: '玩家状态：对外身份、身体、心神、暴露度与可打的牌。',
        accent: '#3d6b5f',
        skinClass: 'pass',
        fields: [
            field('identity', '身份', 'enum', 'display', '当前对外身份或伪装。'),
            field('health', '身体', 'number', 'display', '体力/状态，负面状态用情绪词带出。'),
            field('mentalState', '心神', 'number', 'display', '镇定程度，高=稳，低=濒临崩。'),
            field('exposure', '暴露度', 'number', 'display', '身份或秘密被看穿的风险。'),
            field('inventory', '持有物', 'string[]', 'display', '关键随身物。'),
            field('abilities', '可打的牌', 'string[]', 'kernel', '此刻能用的本事或手段。'),
            field('triggerableEvents', '可触发剧情', 'object', 'kernel', '我方状态达到 X -> 解锁的行动。'),
        ],
    },
    {
        id: 'world_faction',
        name: '风云录',
        oldName: '世界势力栏',
        visibility: 'hidden',
        defaultEnabled: false,
        priority: 70,
        genreTags: ['奇幻', '末日', '权谋', '宫斗', '战争', '修仙', '赛博朋克'],
        description: '世界势力：时局、危险度、势力动态和限制区域。',
        accent: '#97291f',
        skinClass: 'news',
        fields: [
            field('currentMoment', '此刻', 'string', 'display', '时间 + 地点 + 天气一句话，天气作氛围。'),
            field('worldThreatLevel', '威胁等级', 'number', 'display', '当前危险度。'),
            field('activeFactions', '活跃势力', 'string[]', 'display', '在场 / 相关势力 1-3。'),
            field('factionMoves', '势力动态', 'object', 'kernel', '哪股势力在做什么 -> 对玩家的影响，含世界事件。'),
            field('deadlineEvents', '限时事件', 'object', 'kernel', '倒计时 -> 不处理的后果。'),
            field('restrictedAreas', '限制区域', 'string[]', 'kernel', '现在不能去 / 被封锁的。'),
        ],
    },
    {
        id: 'event_trigger',
        name: '伏机',
        oldName: '事件触发栏',
        visibility: 'hidden',
        defaultEnabled: true,
        priority: 88,
        description: '事件触发：flag、待命事件、限时后果和冷却。',
        accent: '#2f4a6b',
        skinClass: 'cable',
        fields: [
            field('activeFlags', '已激活', 'string[]', 'display', '已点亮的关键 flag，1-3 条。'),
            field('standbyEvents', '待命事件', 'object', 'kernel', '满足 X -> 触发，含未激活/条件事件。'),
            field('timedEvents', '限时事件', 'object', 'kernel', '倒计时 -> 后果。'),
            field('cooldowns', '冷却中', 'string[]', 'kernel', '暂不会再触发的，带剩余冷却。'),
        ],
    },
    {
        id: 'narrative_control',
        name: '执笔',
        oldName: '叙事控制栏',
        visibility: 'hidden',
        defaultEnabled: true,
        priority: 60,
        description: '导演台：基调、火候、本轮目标、下一步写法和禁止风格。',
        accent: '#a8324a',
        skinClass: 'editor',
        fields: [
            field('tone', '当前基调', 'enum', 'kernel', '甜 / 虐 / 悬 / 暖。', ['甜', '虐', '悬', '暖']),
            field('heat', '火候', 'enum', 'kernel', '节奏 + 冲突 + 信息密度一句。'),
            field('currentNarrativeGoal', '本轮写作目标', 'string', 'kernel', '这一轮要让读者感受到什么。'),
            field('nextWritingMove', '下一步写法', 'string', 'kernel', '具体怎么写下一段，视角/聚焦/留白。'),
            field('forbiddenStyles', '禁止风格', 'string[]', 'kernel', '不要的写法，说教/上帝视角/OOC。'),
        ],
    },
];

const moduleById = new Map(DATE_STATUS_MODULE_REGISTRY.map(module => [module.id, module]));
const fieldTypeByName = new Map<string, DateStatusFieldType>();

for (const module of DATE_STATUS_MODULE_REGISTRY) {
    for (const fieldDef of module.fields) {
        fieldTypeByName.set(`${module.name}-${fieldDef.label}`, fieldDef.type);
    }
}

function resolveModules(moduleIds: string[]): DateStatusModuleDefinition[] {
    return moduleIds
        .map(moduleId => moduleById.get(moduleId))
        .filter((module): module is DateStatusModuleDefinition => Boolean(module))
        .sort((a, b) => b.priority - a.priority);
}

function getTemplateFieldName(module: DateStatusModuleDefinition, fieldDef: DateStatusFieldDefinition): string {
    return `${module.name}-${fieldDef.label}`;
}

function toTemplateField(module: DateStatusModuleDefinition, fieldDef: DateStatusFieldDefinition): TemplateField {
    return {
        id: `date_${module.id}_${fieldDef.key}`,
        name: getTemplateFieldName(module, fieldDef),
        description: `〔${getTypeHint(fieldDef)}|${fieldDef.level === 'display' ? '展示' : '内核'}〕${fieldDef.label}。影响：${fieldDef.effect}${fieldDef.enumValues?.length ? ` 可选：${fieldDef.enumValues.join('、')}` : ''}`,
        required: true,
        type: fieldDef.type === 'string[]' || fieldDef.type === 'object' ? 'list' : 'text',
    };
}

function createTemplateFields(modules: DateStatusModuleDefinition[]): TemplateField[] {
    return modules.flatMap(module => module.fields.map(fieldDef => toTemplateField(module, fieldDef)));
}

function getTypeHint(fieldDef: DateStatusFieldDefinition): string {
    if (fieldDef.type === 'number') return '数值';
    if (fieldDef.type === 'string[]') return '列表';
    if (fieldDef.type === 'object') return '映射';
    if (fieldDef.type === 'enum') return '标签';
    return '文本';
}

function createStatusProtocol(modules: DateStatusModuleDefinition[]): string {
    const lines: string[] = ['<status>'];

    for (const module of modules) {
        lines.push(`【${module.name}】`);
        for (const fieldDef of module.fields) {
            const name = getTemplateFieldName(module, fieldDef);
            if (fieldDef.type === 'string[]' || fieldDef.type === 'object') {
                lines.push(`${name}:`);
                lines.push('  - 示例1');
                lines.push('  - 示例2');
            } else if (fieldDef.type === 'number') {
                lines.push(`${name}: 50 情绪词`);
            } else {
                lines.push(`${name}: 示例值`);
            }
        }
    }

    lines.push('</status>');
    return lines.join('\n');
}

function createFieldContract(modules: DateStatusModuleDefinition[]): string {
    return modules.map(module => {
        const fields = module.fields.map(fieldDef => {
            const name = getTemplateFieldName(module, fieldDef);
            return `- ${name}: 〔${getTypeHint(fieldDef)}|${fieldDef.level === 'display' ? '展示' : '内核'}〕${fieldDef.effect}`;
        }).join('\n');

        const tags = module.genreTags?.length ? `；适配标签：${module.genreTags.join('、')}` : '';
        return `【${module.name}】id=${module.id}; skin=.${module.skinClass}; visibility=${module.visibility}${tags}\n${module.description}\n${fields}`;
    }).join('\n\n');
}

function createSystemPrompt(title: string, description: string, modules: DateStatusModuleDefinition[]): string {
    return `${DATE_STATUS_COMPACT_SYSTEM_PROMPT_V2}

### 当前启用模块
本轮只生成以下线下状态栏「${title}」字段；不要生成未列出的模块或字段。
${description}

字段协议：
${createStatusProtocol(modules)}

字段含义：
${createFieldContract(modules)}`;
}

function fieldName(module: DateStatusModuleDefinition, key: string): string {
    const fieldDef = module.fields.find(item => item.key === key);
    return fieldDef ? getTemplateFieldName(module, fieldDef) : `${module.name}-${key}`;
}

function ph(module: DateStatusModuleDefinition, key: string, suffix = ''): string {
    return `{{${fieldName(module, key)}${suffix}}}`;
}

function listBlock(module: DateStatusModuleDefinition, key: string, inner: string): string {
    const name = fieldName(module, key);
    return `{{#${name}}}${inner}{{/${name}}}`;
}

function coreDetails(module: DateStatusModuleDefinition, rows: string, className = 'core'): string {
    return `<details class="${className}">
      <summary>(展开)</summary>
${rows}
    </details>`;
}

function renderPlotAnchor(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module flip-scene" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="flip" role="button" tabindex="0" aria-pressed="false" aria-label="命途 塔罗牌,轻触翻面查看背面天机">
      <div class="face front">
        <div class="frame">
          <div class="num">XVII</div>
          <h1>命途</h1>
          <div class="en">the thread of fate</div>
          <div class="medal"><span class="ln h"></span><span class="ln v"></span><i style="top:22%;left:30%"></i><i style="top:38%;left:64%"></i><i style="top:62%;left:42%"></i><i style="top:70%;left:70%"></i></div>
          <div class="arc"><b>牌意 ·</b> ${ph(module, 'currentArc')}</div>
          <div class="phases" data-phase="${ph(module, 'anchorPhase')}">
            <div class="ph full" data-phase-key="铺垫"><div class="moon"></div>铺垫</div>
            <div class="ph half" data-phase-key="逼近"><div class="moon"></div>逼近</div>
            <div class="ph" data-phase-key="触发"><div class="moon"></div>触发</div>
          </div>
          <div class="foot">✦ 正位 · UPRIGHT ✦</div>
        </div>
        <span class="hint">↻ 轻触翻面</span>
      </div>
      <div class="face back">
        <div class="frame">
          <div class="rev">Reversed · 逆位</div>
          <div class="ttl">天机</div>
          <div class="sigil">◈</div>
          <div class="fields">
            <div class="bf"><b>主线锚点</b>${ph(module, 'mainAnchor')}</div>
            <div class="bf"><b>触发条件</b>${listBlock(module, 'triggerConditions', '{{.}}<br>')}</div>
            <div class="bf"><b>暗线 · 勿泄</b>${listBlock(module, 'forbiddenReveals', '{{.}}<br>')}</div>
            <div class="bf"><b>下一推进</b>${ph(module, 'nextNudge')}</div>
          </div>
        </div>
        <span class="hint">↻ 翻回正位</span>
      </div>
    </div>
  </article>`;
}

function renderSceneProgress(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module play" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="orn">✦ · ✦ · ✦</div>
    <div class="prog">Programme · 第二幕</div>
    <h1>此幕</h1>
    <div class="drule"></div>
    <div class="venue">幕启于 · ${ph(module, 'currentScene')}</div>
    <div class="syn"><span class="lbl">本幕看点</span><p>${ph(module, 'sceneGoal')}</p></div>
    <div class="run">${listBlock(module, 'beatProgress', '<div class="ro"><span>{{.}}</span><span class="mk">•</span></div>')}</div>
${coreDetails(module, `<div class="fold">
        <p class="ci"><b>落幕条件:</b>${listBlock(module, 'exitConditions', '{{.}}<br>')}</p>
        <p class="ci"><b>下一幕候选:</b>${listBlock(module, 'nextSceneCandidates', '{{.}}<br>')}</p>
        <p class="ci"><b>本幕节奏:</b>${ph(module, 'sceneTempo')}</p>
      </div>`, 'bk')}
    <div class="stub"><div class="a">ADMIT ONE<small>线下场景 · 当前幕</small></div><div class="t">NOW</div></div>
  </article>`;
}

function renderClueForeshadow(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module clue" data-module-id="${module.id}" data-module-name="${module.name}">
    <span class="tab">EVIDENCE</span>
    <h1>草蛇灰线</h1>
    <div class="sub">Clues &amp; Threads</div>
    <div class="board">${listBlock(module, 'knownClues', '<div class="scrap">{{.}}</div>')}</div>
    <div>${listBlock(module, 'keyItems', '<span class="item"><span class="pre">物证</span><b>{{.}}</b></span>')}</div>
${coreDetails(module, `<p class="ci"><b>误导线索:</b>${listBlock(module, 'falseLeads', '{{.}}<br>')}</p>
      <p class="ci"><b>未浮现:</b>${listBlock(module, 'unknownClues', '{{.}}<br>')}</p>
      <p class="ci"><b>伏笔账本:</b>${listBlock(module, 'foreshadowLedger', '{{.}}<br>')}</p>
      <p class="ci"><b>信息边界:</b>${ph(module, 'informationLimits')}</p>`)}
  </article>`;
}

function renderCharacterStance(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module file" data-module-id="${module.id}" data-module-name="${module.name}">
    <span class="tab">CASE No.0427</span>
    <div class="stamp">监视中<small>SURVEILLANCE</small></div>
    <h1>人心向背</h1>
    <div class="sub">Subject Stance — Dossier</div>
    <div class="row"><span class="k">角色</span><span class="d"></span><span class="v">${ph(module, 'characterName')}</span></div>
    <div class="row"><span class="k">立场</span><span class="d"></span><span class="v">${ph(module, 'attitude')}</span></div>
    <div class="ms"><div class="h">— 态度指数 / INDICES —</div>
      <div class="mr"><span class="k">信任</span><span class="trk"><i style="width:${ph(module, 'trust', '__percent')}%"></i></span><span class="n">${ph(module, 'trust', '__rounded')}</span><span class="t">${ph(module, 'trust', '__label')}</span></div>
      <div class="mr"><span class="k">戒备</span><span class="trk"><i style="width:${ph(module, 'suspicion', '__percent')}%"></i></span><span class="n">${ph(module, 'suspicion', '__rounded')}</span><span class="t">${ph(module, 'suspicion', '__label')}</span></div>
    </div>
${coreDetails(module, `<p class="ci"><b>隐藏动机:</b>${ph(module, 'hiddenIntent')}</p>
      <p class="ci"><b>关系筹码:</b>${ph(module, 'relationshipLeverage')}</p>
      <p class="ci"><span class="lk"><b>可解锁:</b></span>${listBlock(module, 'unlockableInfo', '{{.}}<br>')}</p>`)}
  </article>`;
}

function renderRomanceAffection(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module plan" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="tape"><h1>怦然 ♡</h1></div>
    <div class="meta"><span class="sticker">对象 · <b>${ph(module, 'target')}</b></span><span class="hl">${ph(module, 'relationshipStage')}</span></div>
    <div class="pm"><span class="k">心动</span><span class="trk"><i style="width:${ph(module, 'affection', '__percent')}%;background:var(--rose)"></i></span><span class="w">${ph(module, 'affection', '__label')} ${ph(module, 'affection', '__rounded')}</span></div>
    <div class="pm"><span class="k">亲密</span><span class="trk"><i style="width:${ph(module, 'intimacy', '__percent')}%;background:var(--butter)"></i></span><span class="w">${ph(module, 'intimacy', '__label')} ${ph(module, 'intimacy', '__rounded')}</span></div>
    <div class="pm"><span class="k">安心</span><span class="trk"><i style="width:${ph(module, 'comfort', '__percent')}%;background:var(--mint)"></i></span><span class="w">${ph(module, 'comfort', '__label')} ${ph(module, 'comfort', '__rounded')}</span></div>
    <div class="sticky s1"><span class="lab">心动信号 ♡</span><p>${ph(module, 'heartSignal')}</p></div>
    <div class="sticky s2"><span class="lab">此刻边界</span><p>${ph(module, 'softBoundary')}</p></div>
${coreDetails(module, `<div class="todo"><span class="box"></span><span><b>下一颗糖</b> <span class="heart">♡</span><br><span class="cond">${listBlock(module, 'availableRomanceBeats', '{{.}}<br>')}</span></span></div>`, 'annex')}
  </article>`;
}

function renderRomanceTension(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module letter" data-module-id="${module.id}" data-module-name="${module.name}">
    <span class="unsent">未寄出</span>
    <div class="sal">致 ${ph(module, 'target')}</div>
    <div class="body">${ph(module, 'unsaidThought')}</div>
    <div class="note"><span class="lab">心绪</span>暧昧张力 <b>${ph(module, 'tension', '__label')}(${ph(module, 'tension', '__rounded')})</b> · 占有 <b>${ph(module, 'possessiveness', '__label')}(${ph(module, 'possessiveness', '__rounded')})</b> · 克制 <b>${ph(module, 'restraint', '__label')}(${ph(module, 'restraint', '__rounded')})</b></div>
    <div class="meter-row"><span>张力</span><i><b style="width:${ph(module, 'tension', '__percent')}%"></b></i></div>
    <div class="meter-row"><span>占有</span><i><b style="width:${ph(module, 'possessiveness', '__percent')}%"></b></i></div>
    <div class="meter-row"><span>克制</span><i><b style="width:${ph(module, 'restraint', '__percent')}%"></b></i></div>
    <div class="state">此刻 · <b>${ph(module, 'distance')}</b></div>
${coreDetails(module, `<p class="ci"><b>拉扯动作:</b>${ph(module, 'pushPullAction')}</p>
      <p class="ci"><b>红线:</b>${listBlock(module, 'forbiddenActions', '{{.}}<br>')}</p>`, 'annex')}
    <div class="sig">—— 没敢落款</div>
    <div class="seal">缄</div>
  </article>`;
}

function renderPlayerCondition(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module pass" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="inner">
      <div class="band"><span>通 行 证 · IDENTITY PASS</span><span>No.0427</span></div>
      <div class="top">
        <div class="photo">我</div>
        <div class="idf"><div class="nm">${ph(module, 'identity')}</div>当前身份登记<br>线下剧情状态</div>
        <div class="seal"><b>在册</b><small>0427</small></div>
      </div>
      <div class="sl">状 态 评 定 / STATUS</div>
      <div class="gr"><span class="k">身体</span><span class="seg"><i style="width:${ph(module, 'health', '__percent')}%"></i></span><span class="v">${ph(module, 'health', '__rounded')} ${ph(module, 'health', '__label')}</span></div>
      <div class="gr"><span class="k">心神</span><span class="seg"><i style="width:${ph(module, 'mentalState', '__percent')}%"></i></span><span class="v">${ph(module, 'mentalState', '__rounded')} ${ph(module, 'mentalState', '__label')}</span></div>
      <div class="gr"><span class="k">暴露</span><span class="seg"><i style="width:${ph(module, 'exposure', '__percent')}%"></i></span><span class="v">${ph(module, 'exposure', '__rounded')} ${ph(module, 'exposure', '__label')}</span></div>
      <div class="decl"><div class="sl">随 身 登 记 / DECLARED</div>${listBlock(module, 'inventory', '<div class="di"><span class="bx"></span>{{.}}</div>')}</div>
${coreDetails(module, `<p class="ci"><b>可打的牌:</b>${listBlock(module, 'abilities', '{{.}}<br>')}</p>
        <p class="ci"><b>可触发:</b>${listBlock(module, 'triggerableEvents', '{{.}}<br>')}</p>`, 'cl')}
      <div class="ft"><span>签发 · 当前场景</span><span>PMT-0427-7F</span></div>
    </div>
  </article>`;
}

function renderWorldFaction(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module news" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="top"><div class="date">${ph(module, 'currentMoment')}</div><div class="mast">风云录</div><div class="date">City Affairs — Late Edition</div></div>
    <span class="heads">今 日 时 局</span>
    <div class="threat"><span class="lv">${ph(module, 'worldThreatLevel', '__rounded')}</span><span>威胁等级<br><span class="w">${ph(module, 'worldThreatLevel', '__label')}</span></span></div>
    <div class="news-meter"><i style="width:${ph(module, 'worldThreatLevel', '__percent')}%"></i></div>
    <div class="sec"><h4>活 跃 势 力</h4><p class="forces">${listBlock(module, 'activeFactions', '<b>{{.}}</b> · ')}</p></div>
${coreDetails(module, `<p class="ci"><b>势力动态:</b>${listBlock(module, 'factionMoves', '{{.}}<br>')}</p>
      <p class="ci"><b>限时事件:</b>${listBlock(module, 'deadlineEvents', '{{.}}<br>')}</p>
      <p class="ci"><b>限制区域:</b>${listBlock(module, 'restrictedAreas', '{{.}}<br>')}</p>`)}
    <div class="by">本期坐标:当前线下场景</div>
  </article>`;
}

function renderEventTrigger(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module cable" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="hd"><span>电报 · TELEGRAM</span><span>No.0427</span></div>
    <div class="meta"><span>发自 · 暗桩</span><span class="urgent">急件 URGENT</span></div>
    <div class="deadline"><span>伏机已就位</span><span class="tm">${module.fields.length}</span></div>
    <div class="body">${listBlock(module, 'activeFlags', '<div class="strip">{{.}} 已记录 STOP</div>')}</div>
${coreDetails(module, `<p class="ci"><b>待命:</b>${listBlock(module, 'standbyEvents', '{{.}} STOP<br>')}</p>
      <p class="ci"><b>限时:</b>${listBlock(module, 'timedEvents', '{{.}} STOP<br>')}</p>
      <p class="ci"><b>冷却:</b>${listBlock(module, 'cooldowns', '{{.}} STOP<br>')}</p>`, 'annex')}
  </article>`;
}

function renderNarrativeControl(module: DateStatusModuleDefinition): string {
    return `<article class="date-registry__module editor" data-module-id="${module.id}" data-module-name="${module.name}">
    <div class="kick">From the Editor · 作者视角</div>
    <h1>执笔</h1>
    <div class="dl">本轮导演台 · 默认折叠</div>
${coreDetails(module, `<div class="en"><span class="l">基调 / Tone</span><p>${ph(module, 'tone')}</p></div>
      <div class="en"><span class="l">火候 / Heat</span><p>${ph(module, 'heat')}</p></div>
      <div class="en big"><span class="l">本轮要让读者</span><p>${ph(module, 'currentNarrativeGoal')}</p></div>
      <div class="en"><span class="l">下一步写法</span><p>${ph(module, 'nextWritingMove')}</p></div>
      <div class="no">切忌:<b>${listBlock(module, 'forbiddenStyles', '{{.}} · ')}</b></div>`, 'editor-core')}
    <div class="sig">—— 执笔人</div>
  </article>`;
}

function renderModuleHtml(module: DateStatusModuleDefinition): string {
    switch (module.id) {
        case 'plot_anchor':
            return renderPlotAnchor(module);
        case 'scene_progress':
            return renderSceneProgress(module);
        case 'clue_foreshadow':
            return renderClueForeshadow(module);
        case 'character_stance':
            return renderCharacterStance(module);
        case 'romance_affection':
            return renderRomanceAffection(module);
        case 'romance_tension':
            return renderRomanceTension(module);
        case 'player_condition':
            return renderPlayerCondition(module);
        case 'world_faction':
            return renderWorldFaction(module);
        case 'event_trigger':
            return renderEventTrigger(module);
        case 'narrative_control':
            return renderNarrativeControl(module);
        default:
            return '';
    }
}

function createHtmlBody(_title: string, _description: string, modules: DateStatusModuleDefinition[]): string {
    return `<section class="date-status-v2 date-registry" data-module-count="${modules.length}">
${modules.map(renderModuleHtml).join('\n')}
</section>`;
}

const DATE_STATUS_V2_CSS = `:root{--cn-sans:"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif;--cn-serif:"Noto Serif SC","Songti SC",serif;--brush:"Ma Shan Zheng",cursive}
.date-status-v2{width:330px;max-width:calc(100vw - 24px);display:grid;gap:18px;background:#ebe5da;color:#222;padding:0;font-family:var(--cn-sans);-webkit-font-smoothing:antialiased}
.date-registry__module{width:330px;max-width:calc(100vw - 24px);border-radius:4px;overflow:hidden}
details>summary{list-style:none;cursor:pointer;user-select:none}details>summary::-webkit-details-marker{display:none}
.annex,.core,.bk,.cl,.editor-core{overflow:hidden}

.plan{--rose:#e87f9d;--mint:#5fb795;--butter:#e7b948;--lav:#a594d8;--muted:#9a8d7e;--ink:#4a4038;background:#fffdf7;color:var(--ink);padding:30px 20px 24px;position:relative;background-image:radial-gradient(#e6dfcd 1.3px,transparent 1.3px);background-size:17px 17px;background-position:8px 8px}
.plan .tape{display:inline-block;transform:rotate(-2.4deg);box-shadow:0 1px 4px rgba(0,0,0,.08);background:repeating-linear-gradient(135deg,rgba(232,127,157,.85),rgba(232,127,157,.85) 7px,rgba(244,166,188,.85) 7px,rgba(244,166,188,.85) 14px);padding:7px 20px}
.plan .tape h1{font-family:var(--brush);font-weight:400;font-size:27px;color:#fff;letter-spacing:.06em;line-height:1}
.plan .meta{display:flex;align-items:center;gap:10px;margin:18px 0 4px;flex-wrap:wrap}.plan .sticker{background:#fff;border:1.5px solid var(--lav);border-radius:16px;font-size:12px;padding:3px 12px;color:#6a5da0;box-shadow:0 1px 3px rgba(0,0,0,.05)}.plan .sticker b{color:var(--ink)}.plan .hl{font-family:var(--brush);font-size:19px;color:var(--ink);background:linear-gradient(transparent 55%,rgba(231,185,72,.55) 55%);padding:0 3px}
.plan .pm{display:flex;align-items:center;gap:10px;margin:11px 0}.plan .pm .k{flex:none;width:30px;font-size:13px}.plan .pm .trk{flex:1;height:11px;border-radius:999px;background:#f1ead8;overflow:hidden}.plan .pm .trk i{display:block;height:100%;border-radius:999px}.plan .pm .w{flex:none;font-family:"Caveat",var(--brush);font-size:18px;color:var(--muted);min-width:72px;text-align:right}
.plan .sticky{position:relative;padding:13px 15px 14px;margin:15px 2px;border-radius:3px;box-shadow:2px 3px 7px rgba(0,0,0,.1)}.plan .sticky.s1{background:#fdf3c9;transform:rotate(-1deg)}.plan .sticky.s2{background:#dff3e9;transform:rotate(.8deg);border:1.5px dashed #97cdb5}.plan .sticky .lab{font-family:var(--brush);font-size:18px;line-height:1;display:block;margin-bottom:5px}.plan .sticky.s1 .lab{color:#b98e1e}.plan .sticky.s2 .lab{color:#3f8e6c}.plan .sticky p{font-size:13.5px;line-height:1.58}
.plan details.annex{margin-top:15px;border:1.5px dashed rgba(232,127,157,.62);border-radius:5px;padding:0 12px;background:rgba(255,255,255,.52)}.plan details.annex summary{font-family:var(--brush);font-size:17px;color:var(--rose);padding:9px 0}.plan details.annex summary::before{content:"▸ 内核 · "}.plan details.annex[open] summary::before{content:"▾ 内核 · "}.plan .todo{display:flex;align-items:flex-start;gap:9px;margin:8px 4px 12px;font-size:13px;line-height:1.5}.plan .todo .box{flex:none;width:16px;height:16px;border:2px dashed var(--rose);border-radius:4px;margin-top:1px}.plan .todo b{color:var(--ink)}.plan .todo .cond{color:var(--muted);font-size:11.5px}.plan .heart{color:var(--rose)}

.letter{--plum:#7c3a57;--wine:#9c3a4e;--muted:#9a8088;--ink:#3f3038;--paper:#fdf4f1;--rule:#ecd8da;background:var(--paper);color:var(--ink);padding:26px 22px 24px;position:relative;font-family:var(--cn-serif);background-image:repeating-linear-gradient(transparent,transparent 27px,rgba(124,58,87,.08) 27px,rgba(124,58,87,.08) 28px)}
.letter .unsent{position:absolute;right:16px;top:16px;border:1.5px solid var(--wine);color:var(--wine);font-size:9px;letter-spacing:.18em;padding:2px 7px;transform:rotate(8deg);opacity:.72;font-family:"Special Elite"}.letter .sal{font-family:var(--brush);font-size:24px;color:var(--plum);line-height:1;margin-bottom:12px}.letter .body{font-size:15px;line-height:28px;color:#3a2e34;font-style:italic}.letter .note{margin-top:18px;border-top:1px dashed var(--rule);padding-top:11px;font-size:12px;color:var(--muted)}.letter .note .lab{font-family:var(--brush);font-size:15px;color:var(--plum);margin-right:6px}.letter .note b{color:#5a4750;font-weight:400;font-style:italic}.letter .state{font-size:12px;color:var(--muted);margin-top:7px}.letter .state b{color:var(--wine);font-style:italic;font-weight:400}
.letter .meter-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-top:7px}.letter .meter-row span{width:34px}.letter .meter-row i{flex:1;height:7px;border-radius:999px;background:#f0dadd;overflow:hidden}.letter .meter-row b{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#c06a7b,var(--wine))}
.letter details.annex{margin-top:14px;background:#faecee;border:1px dashed #e3bcc4;border-radius:5px;padding:0 13px}.letter details.annex summary{font-family:var(--brush);font-size:16px;color:var(--plum);padding:9px 0}.letter details.annex summary::before{content:"✎ 不敢写进信里 · "}.letter details.annex[open] summary::before{content:"✎ "}.letter .ci{font-size:13px;line-height:1.55;color:#3a2e34;margin:4px 0 8px}.letter .ci b{font-weight:600;font-style:normal}.letter .sig{font-family:var(--brush);font-size:18px;color:var(--ink);margin-top:16px}.letter .seal{position:absolute;right:20px;bottom:18px;width:50px;height:50px;border-radius:50%;background:var(--wine);color:#f6e3df;display:flex;align-items:center;justify-content:center;font-family:var(--cn-serif);font-size:21px;opacity:.92;box-shadow:0 1px 3px rgba(0,0,0,.25);transform:rotate(-6deg)}

.play{--carmine:#9c2f3a;--gold:#a9802f;--ink:#2a2018;--muted:#8a7a66;--paper:#f7f1e6;background:var(--paper);color:var(--ink);padding:24px 20px 20px;position:relative;overflow:visible;font-family:var(--cn-serif);text-align:center}.play .orn{color:var(--gold);letter-spacing:.45em;font-size:13px}.play .prog{font-family:"Playfair Display",serif;text-transform:uppercase;letter-spacing:.3em;font-size:10px;color:var(--carmine);margin:9px 0 2px}.play h1{font-family:"Playfair Display",var(--cn-serif);font-weight:900;font-size:40px;line-height:1;margin:4px 0 2px}.play .drule{height:0;border-top:3px double var(--carmine);width:58%;margin:13px auto}.play .venue{font-size:12.5px;color:var(--muted);letter-spacing:.04em}.play .lbl{font-family:"Playfair Display",serif;text-transform:uppercase;letter-spacing:.2em;font-size:10px;color:var(--carmine);display:block;margin-bottom:5px}.play .syn{margin:16px 8px}.play .syn p{font-style:italic;font-size:15px;line-height:1.55;color:#3a2f24}.play .run{text-align:left;max-width:290px;margin:16px auto 2px}.play .run .ro{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dotted #c9b58f;padding:5px 0;font-size:13.5px;color:#6f6354}.play .run .ro:first-child{color:var(--ink);font-weight:600}.play .run .ro .mk{color:var(--carmine);font-family:"Playfair Display",serif}.play details.bk{margin-top:16px}.play details.bk summary{font-family:"Playfair Display",serif;text-transform:uppercase;letter-spacing:.2em;font-size:10px;color:var(--carmine);padding:9px 0;border-top:1px solid var(--gold);border-bottom:1px solid var(--gold)}.play details.bk summary::before{content:"❧ 后台 Backstage "}.play details.bk[open] summary::before{content:"❧ "}.play .fold{max-width:300px;margin:10px auto 0;text-align:left}.play .ci{font-size:12.5px;line-height:1.55;color:#3a2f24;margin:5px 0}.play .ci b{font-weight:600}.play .stub{position:relative;margin:18px -20px -20px;border-top:2px dashed var(--carmine);padding:13px 20px 15px;background:rgba(156,47,58,.06);display:flex;justify-content:space-between;align-items:center;text-align:left}.play .stub::before,.play .stub::after{content:"";position:absolute;top:-9px;width:16px;height:16px;border-radius:50%;background:#ebe5da}.play .stub::before{left:-8px}.play .stub::after{right:-8px}.play .stub .a{font-family:"Playfair Display",serif;letter-spacing:.22em;font-size:11px;color:var(--carmine)}.play .stub .a small{display:block;color:var(--muted);font-size:11px;letter-spacing:.03em;margin-top:4px;font-family:var(--cn-serif)}.play .stub .t{font-family:"Playfair Display",serif;font-size:22px;color:var(--ink)}

.pass{--ink:#2b2e2a;--teal:#3d6b5f;--seal:#9c3434;--muted:#7d847a;--paper:#edf0ea;--line:#c2cabf;background:var(--paper);color:var(--ink);border:1px solid var(--ink);font-family:var(--cn-sans)}.pass .inner{border:1px solid var(--teal);margin:5px;padding:18px 16px;position:relative}.pass .band{background:var(--teal);color:#eef2ee;margin:-18px -16px 15px;padding:7px 14px;display:flex;justify-content:space-between;align-items:center;font-family:"Special Elite";letter-spacing:.12em;font-size:11px}.pass .top{display:flex;gap:13px;position:relative}.pass .photo{flex:none;width:58px;height:70px;border:1px solid var(--ink);display:flex;align-items:center;justify-content:center;font-family:var(--cn-serif);font-size:24px;color:#9aa39a;background:repeating-linear-gradient(45deg,#e3e8e0,#e3e8e0 4px,#dce2d9 4px,#dce2d9 8px)}.pass .idf{font-size:12.5px;line-height:1.6;color:#454b45;min-width:0}.pass .idf .nm{font-family:var(--cn-serif);font-size:17px;font-weight:600;color:var(--ink);margin-bottom:5px;overflow-wrap:anywhere}.pass .seal{position:absolute;right:-2px;top:14px;width:62px;height:62px;border:2px solid var(--seal);border-radius:50%;color:var(--seal);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:var(--cn-serif);font-weight:600;letter-spacing:.06em;transform:rotate(-12deg);opacity:.62;line-height:1}.pass .seal::before{content:"";position:absolute;inset:4px;border:1px solid var(--seal);border-radius:50%}.pass .seal b{font-size:16px}.pass .seal small{font-size:7px;letter-spacing:.16em;margin-top:3px;font-family:"Special Elite"}.pass .sl{font-size:10px;letter-spacing:.18em;color:var(--muted);margin:16px 0 8px;font-family:"Special Elite"}.pass .gr{display:flex;align-items:center;gap:9px;font-size:12px;margin:8px 0}.pass .gr .k{flex:none;width:30px}.pass .gr .seg{flex:1;height:11px;border:1px solid var(--line);background:#dfe4dc;position:relative;overflow:hidden;background-image:repeating-linear-gradient(90deg,transparent,transparent 19%,rgba(43,46,42,.22) 19%,rgba(43,46,42,.22) 20%)}.pass .gr .seg i{display:block;height:100%;background:var(--teal)}.pass .gr .v{flex:none;font-size:11px;color:var(--muted);width:76px}.pass .decl{margin:15px 0 4px}.pass .di{display:flex;align-items:center;gap:9px;font-size:13px;margin:6px 0;color:#3a3f3a}.pass .di .bx{flex:none;width:11px;height:11px;border:1.5px solid var(--teal)}.pass details.cl{margin-top:14px;border:1px dashed var(--seal);padding:0 12px}.pass details.cl summary{font-family:"Special Elite";font-size:10px;letter-spacing:.14em;color:var(--seal);padding:9px 0}.pass details.cl summary::before{content:"▸ 密令 Classified "}.pass details.cl[open] summary::before{content:"▾ "}.pass .ci{font-size:12px;line-height:1.55;color:#2b2e2a;margin:4px 0 8px}.pass .ci b{font-weight:600}.pass .ft{display:flex;justify-content:space-between;align-items:flex-end;margin-top:13px;border-top:1px solid var(--line);padding-top:9px;font-size:10.5px;color:var(--muted);font-family:"Special Elite";letter-spacing:.05em}

.clue{--ink:#2a2620;--string:#a83232;--muted:#6c6149;background:#e0d0ab;color:var(--ink);padding:22px 20px 20px;position:relative;font-family:"Special Elite",var(--cn-serif);background-image:linear-gradient(rgba(42,38,32,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(42,38,32,.05) 1px,transparent 1px);background-size:21px 21px}.clue .tab{display:inline-block;background:var(--ink);color:#e7d9b6;font-size:10px;letter-spacing:.18em;padding:4px 13px;border-radius:4px}.clue h1{font-size:21px;letter-spacing:.05em;margin:13px 0 1px;color:var(--ink)}.clue .sub{font-size:10px;letter-spacing:.22em;color:var(--muted);text-transform:uppercase;margin-bottom:14px}.clue .board{position:relative;padding-left:23px}.clue .board::before{content:"";position:absolute;left:7px;top:8px;bottom:10px;width:2px;background:var(--string);opacity:.85}.clue .scrap{position:relative;background:#f3ead6;border:1px solid #cdb98f;box-shadow:1px 2px 5px rgba(0,0,0,.13);padding:8px 12px;margin:11px 0;font-size:13px;line-height:1.5;transform:rotate(-.7deg)}.clue .scrap:nth-child(even){transform:rotate(.8deg)}.clue .scrap::before{content:"";position:absolute;left:-20px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--string);box-shadow:0 0 0 2px #e0d0ab,1px 1px 2px rgba(0,0,0,.3)}.clue .item{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--ink);font-size:12px;padding:4px 11px;margin-top:8px;margin-right:6px}.clue .item .pre{font-size:9px;letter-spacing:.1em;color:var(--string);font-weight:bold}.clue details.core{margin-top:15px;border:1.5px dashed var(--ink);padding:0 11px}.clue details.core summary{font-size:10px;letter-spacing:.18em;color:var(--string);font-weight:bold;padding:9px 0}.clue details.core summary::before{content:"▸ 暗线·机密 "}.clue details.core[open] summary::before{content:"▾ 暗线·机密 "}.clue .ci{font-size:12px;line-height:1.55;color:#322d24;margin:4px 0 8px}.clue .ci b{color:var(--ink)}

.file{--ink:#2a2620;--stamp:#8f3242;--muted:#6c6149;background:#e0d0ab;color:var(--ink);padding:22px 20px 20px 36px;position:relative;font-family:"Special Elite",var(--cn-serif);background-image:repeating-linear-gradient(0deg,transparent,transparent 27px,rgba(42,38,32,.07) 27px,rgba(42,38,32,.07) 28px)}.file::before{content:"";position:absolute;left:13px;top:54px;width:9px;height:9px;border-radius:50%;background:#cdbb91;box-shadow:0 64px 0 #cdbb91,0 128px 0 #cdbb91;border:1px solid #b6a374}.file .tab{position:absolute;left:22px;top:-1px;background:var(--ink);color:#e7d9b6;font-size:10px;letter-spacing:.16em;padding:4px 13px;border-radius:0 0 5px 5px}.file .stamp{position:absolute;right:14px;top:100px;color:var(--stamp);border:2.5px solid var(--stamp);border-radius:5px;padding:4px 9px;font-size:13px;letter-spacing:.22em;font-weight:bold;transform:rotate(-9deg);opacity:.74;text-align:center;line-height:1.15}.file .stamp small{display:block;font-size:7.5px;letter-spacing:.3em;font-weight:normal}.file h1{font-size:21px;letter-spacing:.05em;margin:16px 0 2px;color:var(--ink)}.file .sub{font-size:10px;letter-spacing:.22em;color:var(--muted);text-transform:uppercase;margin-bottom:14px}.file .row{display:flex;align-items:flex-end;font-size:13px;margin:7px 0}.file .row .k{flex:none;color:var(--muted)}.file .row .d{flex:1;border-bottom:1px dotted #8a7a55;margin:0 6px 3px}.file .row .v{flex:none;font-weight:bold;max-width:166px;overflow-wrap:anywhere}.file .ms{margin:14px 0 4px}.file .ms .h{font-size:10px;letter-spacing:.22em;color:var(--muted);margin-bottom:7px}.file .mr{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:12px}.file .mr .k{flex:none;width:30px}.file .mr .trk{flex:1;height:13px;border:1.5px solid var(--ink);background:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(42,38,32,.13) 3px,rgba(42,38,32,.13) 4.5px)}.file .mr .trk i{display:block;height:100%;background:var(--stamp);opacity:.82}.file .mr .n{flex:none;width:24px;text-align:right;font-weight:bold}.file .mr .t{flex:none;color:var(--muted);font-size:11px;width:62px;overflow-wrap:anywhere}.file details.core{margin-top:15px;border:1.5px dashed var(--ink);padding:0 11px}.file details.core summary{font-size:10px;letter-spacing:.18em;color:var(--stamp);font-weight:bold;padding:9px 0}.file details.core summary::before{content:"▸ 机密附录 "}.file details.core[open] summary::before{content:"▾ 机密附录 "}.file .ci{font-size:12px;line-height:1.55;color:#322d24;margin:4px 0 8px}.file .ci b{color:var(--ink)}.file .ci .lk{color:var(--stamp)}

.news{--ink:#16110b;--red:#97291f;--rule:#b9ac96;--muted:#6f6453;background:#ece4d3;color:var(--ink);padding:20px 20px 18px;font-family:var(--cn-serif)}.news .top{border-top:3px double var(--ink);border-bottom:1px solid var(--ink);text-align:center;padding:6px 0 9px}.news .mast{font-weight:900;font-size:32px;letter-spacing:.16em;line-height:1;margin:5px 0 7px}.news .date{font-size:10.5px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}.news .heads{display:inline-block;background:var(--red);color:#f4ebd8;font-size:11px;font-weight:600;letter-spacing:.2em;padding:2px 9px;margin:14px 0 8px}.news .threat{display:flex;align-items:baseline;gap:9px;font-size:14px;border-bottom:1px solid var(--rule);padding-bottom:10px;margin-bottom:6px}.news .threat .lv{font-weight:900;font-size:26px;color:var(--red);line-height:1}.news .threat .w{color:var(--muted)}.news .news-meter{height:8px;background:#ded4bd;border:1px solid var(--rule);margin-bottom:10px}.news .news-meter i{display:block;height:100%;background:var(--red)}.news .sec h4{font-size:11px;font-weight:700;letter-spacing:.2em;color:var(--muted);margin:11px 0 5px}.news .sec p{font-size:13.5px;line-height:1.6;color:#2c261d}.news .forces{font-size:13.5px;line-height:1.7}.news .forces b{font-weight:700}.news details.core{margin-top:13px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink)}.news details.core summary{font-size:11px;font-weight:700;letter-spacing:.2em;color:var(--red);padding:9px 0;text-align:center}.news details.core summary::before{content:"▸ "}.news details.core[open] summary::before{content:"▾ "}.news .ci{font-size:13px;line-height:1.55;color:#2c261d;margin:6px 0}.news .ci b{color:var(--ink);font-weight:700}.news .by{margin-top:13px;font-size:11px;letter-spacing:.06em;color:var(--muted);text-align:right}

.cable{--ink:#23211c;--blue:#2f4a6b;--red:#9c2f2f;--muted:#6f6a5c;--paper:#f2efe4;--strip:#fbfaf3;background:var(--paper);color:var(--ink);font-family:"Special Elite",var(--cn-serif);border:1px solid #b9b29c}.cable .hd{background:var(--blue);color:#eef1f5;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;letter-spacing:.14em;font-size:11px}.cable .meta{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;letter-spacing:.08em;color:var(--muted);padding:10px 14px 0}.cable .urgent{color:var(--red);font-weight:bold;border:1.5px solid var(--red);padding:1px 6px;transform:rotate(-3deg);display:inline-block;letter-spacing:.1em}.cable .deadline{margin:11px 14px 4px;background:var(--ink);color:#e7c34a;letter-spacing:.1em;padding:7px 12px;display:flex;justify-content:space-between;align-items:center}.cable .deadline .tm{font-size:18px;font-weight:bold}.cable .body{padding:6px 14px 2px}.cable .strip{background:var(--strip);border:1px solid #ded7c2;box-shadow:0 1px 2px rgba(0,0,0,.08);padding:7px 11px;margin:8px 0;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:#2c2a24}.cable details.annex{margin:10px 14px 14px;border:1.5px dashed var(--ink);padding:0 11px}.cable details.annex summary{font-size:10px;letter-spacing:.16em;color:var(--blue);font-weight:bold;padding:9px 0}.cable details.annex summary::before{content:"▸ 密件附言 Annex "}.cable details.annex[open] summary::before{content:"▾ "}.cable .ci{font-size:12px;line-height:1.55;color:#2c2a24;margin:4px 0 8px;letter-spacing:.03em}.cable .ci b{font-weight:bold}

.editor{--ink:#221d1b;--rose:#a8324a;--muted:#897d75;--rule:#d6cab8;background:#f6f1e8;color:var(--ink);padding:26px 22px 22px;font-family:var(--cn-serif)}.editor .kick{font-family:"Playfair Display",var(--cn-serif);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--rose);display:flex;align-items:center;gap:10px}.editor .kick::after{content:"";flex:1;height:1px;background:var(--rule)}.editor h1{font-family:"Playfair Display",var(--cn-serif);font-weight:900;font-size:38px;line-height:1;margin:12px 0 3px}.editor .dl{font-size:11px;letter-spacing:.1em;color:var(--muted);border-bottom:2px solid var(--ink);padding-bottom:11px;margin-bottom:14px}.editor details.editor-core{border:1px solid var(--rule);padding:0 12px;background:rgba(255,255,255,.28)}.editor details.editor-core summary{font-size:11px;letter-spacing:.2em;color:var(--rose);padding:10px 0;text-transform:uppercase}.editor details.editor-core summary::before{content:"▸ 编辑内核 "}.editor details.editor-core[open] summary::before{content:"▾ 编辑内核 "}.editor .en{margin:12px 0}.editor .en .l{font-family:"Playfair Display",serif;text-transform:uppercase;letter-spacing:.2em;font-size:10px;color:var(--rose);display:block;margin-bottom:3px}.editor .en p{font-size:14px;line-height:1.62;color:#2c2522}.editor .en.big p{font-style:italic;font-size:17px;line-height:1.55}.editor .no{margin-top:13px;border-top:1px solid var(--rule);padding-top:10px;font-size:12px;color:var(--muted)}.editor .no b{color:#7a4250;font-style:italic;font-weight:400}.editor .sig{text-align:right;font-family:"Playfair Display",serif;font-style:italic;color:var(--rose);font-size:15px;margin-top:14px}

.flip-scene{perspective:1400px;max-width:336px;margin:0 auto;overflow:visible}.flip{position:relative;height:474px;transform-style:preserve-3d;transition:transform .85s cubic-bezier(.2,.8,.2,1);cursor:pointer}.flip.is-flipped{transform:rotateY(180deg)}.flip:focus-visible{outline:2px solid #9b8a52;outline-offset:6px;border-radius:10px}.face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:9px;overflow:hidden;padding:11px}.back{transform:rotateY(180deg)}.frame{height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 15px;text-align:center}.frame::before{content:"";position:absolute;inset:4px;pointer-events:none}.hint{position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:10px;letter-spacing:.24em;opacity:.6}
.front{background:#1b2440;border:1px solid #39466c;color:#e6ebf2;background-image:radial-gradient(rgba(220,228,242,.5) 1px,transparent 1.2px);background-size:26px 26px}.front .frame{border:1px solid #b9c4d8}.front .frame::before{border:1px solid rgba(185,196,216,.4)}.front .num{font-family:"Playfair Display",serif;letter-spacing:.32em;font-size:11px;color:#c2cdde}.front h1{font-family:"Playfair Display",var(--cn-serif);font-weight:900;font-size:33px;color:#eef2f8;margin:6px 0 2px;letter-spacing:.05em}.front .en{font-family:"Playfair Display",serif;font-style:italic;letter-spacing:.18em;font-size:10px;color:#93a0bc;text-transform:uppercase}.front .medal{width:86px;height:86px;border:1.5px solid #c2cdde;border-radius:50%;margin:16px auto;position:relative}.front .medal::before{content:"";position:absolute;inset:9px;border:1px solid rgba(185,196,216,.5);border-radius:50%}.front .medal .ln{position:absolute;background:rgba(185,196,216,.45)}.front .medal .ln.h{left:9px;right:9px;top:50%;height:1px}.front .medal .ln.v{top:9px;bottom:9px;left:50%;width:1px}.front .medal i{position:absolute;width:4px;height:4px;border-radius:50%;background:#e6ebf2;box-shadow:0 0 3px rgba(230,235,242,.9)}.front .arc{font-size:13px;color:#e6ebf2;line-height:1.6;margin:6px 6px 0}.front .arc b{color:#c2cdde;font-weight:600}.front .phases{display:flex;justify-content:center;gap:20px;margin:16px 0 6px}.front .ph{font-size:11px;color:#93a0bc}.front .ph .moon{width:18px;height:18px;border-radius:50%;border:1.5px solid #c2cdde;margin:0 auto 6px;position:relative;overflow:hidden}.front .ph.half .moon::after{content:"";position:absolute;right:0;top:0;bottom:0;width:50%;background:#c2cdde}.front .ph.full .moon{background:#c2cdde}.front .ph.on{color:#eef2f8;font-weight:600}.front .foot{color:#c2cdde;letter-spacing:.26em;font-size:11px;margin-top:4px}.front .hint{color:#8d9ab8}
.back{background:#1f0710;border:1px solid rgba(201,154,74,.55);color:#f3e8d4;background-image:radial-gradient(circle at 50% 14%,rgba(233,202,126,.16),transparent 30%),radial-gradient(rgba(213,160,74,.34) 1px,transparent 1.2px),linear-gradient(135deg,rgba(255,218,138,.05),transparent 34%,rgba(91,16,34,.22) 70%,rgba(255,218,138,.04));background-size:auto,26px 26px,auto;box-shadow:inset 0 0 30px rgba(255,202,106,.07)}.back .frame{justify-content:flex-start;padding:22px 17px 36px;border:1px solid rgba(218,176,88,.78);background:linear-gradient(180deg,rgba(82,17,32,.24),rgba(20,5,12,.10));box-shadow:inset 0 0 0 1px rgba(255,235,174,.16),inset 0 0 34px rgba(0,0,0,.18)}.back .frame::before{border:1px solid rgba(235,194,102,.28);inset:8px}.back .rev{font-family:"Playfair Display",serif;letter-spacing:.34em;font-size:9.5px;color:#d9ae55;text-transform:uppercase;text-shadow:0 1px 10px rgba(217,174,85,.24)}.back .ttl{font-family:"Playfair Display",var(--cn-serif);font-weight:900;font-size:28px;line-height:1.1;color:#f7ead0;margin:6px 0 0;letter-spacing:.14em;text-shadow:0 0 18px rgba(245,213,149,.18)}.back .sigil{font-size:22px;color:#d6a74d;margin:6px 0 9px;line-height:1;text-shadow:0 0 16px rgba(214,167,77,.36)}.back .fields{position:relative;text-align:left;width:100%;max-height:292px;overflow-y:auto;overflow-x:hidden;border:1px solid rgba(218,176,88,.25);border-radius:7px;padding:10px 10px 12px;background:linear-gradient(180deg,rgba(20,5,11,.38),rgba(78,15,31,.22));box-shadow:inset 0 0 0 1px rgba(255,235,180,.06);scrollbar-width:none}.back .fields::-webkit-scrollbar{display:none}.back .fields::before{content:"";position:absolute;left:12px;right:12px;top:6px;height:1px;background:linear-gradient(90deg,transparent,rgba(219,177,91,.54),transparent)}.back .bf{position:relative;font-size:11.6px;line-height:1.46;color:#f0debf;margin:8px 0 0;padding:8px 9px 8px 12px;border-left:1px solid rgba(218,176,88,.34);background:linear-gradient(90deg,rgba(245,205,116,.08),rgba(255,255,255,0));border-radius:0 6px 6px 0;overflow-wrap:anywhere}.back .bf:first-child{margin-top:6px}.back .bf b{display:inline-block;color:#e6bd61;background:rgba(230,189,97,.10);border:1px solid rgba(230,189,97,.22);border-radius:999px;padding:1px 8px;font-weight:700;letter-spacing:.08em;font-size:10px;margin:0 0 4px -2px;text-shadow:0 0 10px rgba(230,189,97,.18)}.back .hint{bottom:13px;color:#c99d50}

@media (max-width:360px){.date-status-v2,.date-registry__module{width:calc(100vw - 24px)}.plan,.letter,.play,.clue,.file,.news,.editor{padding-left:16px;padding-right:16px}.file{padding-left:30px}.front h1,.back .ttl{font-size:28px}.flip{height:442px}.play h1,.editor h1{font-size:34px}.news .mast{font-size:27px;letter-spacing:.12em}.plan .pm .w{min-width:58px;font-size:16px}.pass .gr .v{width:66px;font-size:10px}}`;

const DATE_STATUS_FLIP_JS = `(function(){
  var cards = document.querySelectorAll('.flip');
  cards.forEach(function(c){
    function flip(){ var on = c.classList.toggle('is-flipped'); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    c.addEventListener('click', flip);
    c.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); flip(); } });
  });
  document.querySelectorAll('.phases').forEach(function(group){
    var phase = (group.getAttribute('data-phase') || '').replace(/[（(].*$/,'').trim();
    var matched = false;
    group.querySelectorAll('.ph').forEach(function(item){
      var key = item.getAttribute('data-phase-key') || '';
      var on = phase.indexOf(key) >= 0;
      item.classList.toggle('on', on);
      if(on) matched = true;
    });
    if(!matched){
      var fallback = group.querySelector('[data-phase-key="铺垫"]');
      if(fallback) fallback.classList.add('on');
    }
  });
})();`;

function createStatusTemplate(
    id: string,
    name: string,
    description: string,
    modules: DateStatusModuleDefinition[],
): CustomStatusTemplate {
    const needsScripts = modules.some(module => module.id === 'plot_anchor');
    return {
        id,
        name,
        systemPrompt: createSystemPrompt(name, description, modules),
        extractRegex: '',
        htmlBody: createHtmlBody(name, description, modules),
        cssTemplate: DATE_STATUS_V2_CSS,
        jsTemplate: needsScripts ? DATE_STATUS_FLIP_JS : '',
        headTemplate: DATE_STATUS_FONT_LINKS,
        templateVersion: LAYERED_STATUS_TEMPLATE_VERSION,
        allowScripts: needsScripts,
        interactionMode: needsScripts ? 'flip' : 'none',
        interactionIdea: needsScripts ? '命途使用正逆位翻转卡，轻触或键盘 Enter/Space 翻面。' : '',
        reviewFlags: {},
        renderMode: 'html',
        fields: createTemplateFields(modules),
    };
}

export const DATE_STATUS_BUILTIN_MODULE_TEMPLATES: CustomStatusTemplate[] = DATE_STATUS_MODULE_REGISTRY
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .map(module => createStatusTemplate(
        `${DATE_STATUS_BUILTIN_PREFIX}${module.id}`,
        module.name,
        module.description,
        [module],
    ));

export const DATE_STATUS_BUILTIN_TEMPLATES: CustomStatusTemplate[] = [
    ...DATE_STATUS_BUILTIN_MODULE_TEMPLATES,
];

export function isBuiltinDateStatusTemplateId(templateId: string | undefined): boolean {
    return Boolean(templateId?.startsWith(DATE_STATUS_BUILTIN_PREFIX));
}

export function getDateStatusBuiltinTemplate(templateId: string | undefined): CustomStatusTemplate | undefined {
    return DATE_STATUS_BUILTIN_TEMPLATES.find(template => template.id === templateId);
}

function isLegacyDateStatusModeId(templateId: string | undefined): boolean {
    return Boolean(templateId?.startsWith(DATE_STATUS_MODE_PREFIX));
}

function getModuleIdFromBuiltinTemplateId(templateId: string | undefined): string | undefined {
    if (!templateId?.startsWith(DATE_STATUS_BUILTIN_PREFIX)) return undefined;
    if (isLegacyDateStatusModeId(templateId)) return undefined;

    const moduleId = templateId.slice(DATE_STATUS_BUILTIN_PREFIX.length);
    return moduleById.has(moduleId) ? moduleId : undefined;
}

export function getSelectedDateStatusModuleIds(
    char: Pick<CharacterProfile, 'dateStatusModuleIds' | 'dateStatusTemplateId'>,
): string[] {
    if (Array.isArray(char.dateStatusModuleIds)) {
        return char.dateStatusModuleIds.filter(moduleId => moduleById.has(moduleId));
    }

    const legacyModuleId = getModuleIdFromBuiltinTemplateId(char.dateStatusTemplateId);
    if (legacyModuleId) return [legacyModuleId];

    if (isLegacyDateStatusModeId(char.dateStatusTemplateId)) {
        return DEFAULT_DATE_STATUS_MODULE_IDS;
    }

    if (char.dateStatusTemplateId && !isBuiltinDateStatusTemplateId(char.dateStatusTemplateId)) {
        return [];
    }

    return DEFAULT_DATE_STATUS_MODULE_IDS;
}

export function createDateStatusTemplateFromModuleIds(moduleIds: string[]): CustomStatusTemplate | undefined {
    const normalizedIds = Array.from(new Set(moduleIds.filter(moduleId => moduleById.has(moduleId))));
    const modules = resolveModules(normalizedIds);
    if (modules.length === 0) return undefined;

    if (modules.length === 1) {
        return getDateStatusBuiltinTemplate(`${DATE_STATUS_BUILTIN_PREFIX}${modules[0].id}`);
    }

    return createStatusTemplate(
        `${DATE_STATUS_BUILTIN_PREFIX}modules_${modules.map(module => module.id).join('_')}`,
        modules.map(module => module.name).join(' + '),
        `用户自选的 ${modules.length} 个线下状态栏模块。`,
        modules,
    );
}

export function getDateStatusTemplateOptions(char: Pick<CharacterProfile, 'customStatusTemplates'>): DateStatusTemplateOption[] {
    const moduleOptions = DATE_STATUS_BUILTIN_MODULE_TEMPLATES.map(template => ({
        id: template.id,
        name: template.name,
        source: 'builtin_module' as const,
        template,
    }));
    const workshopOptions = (char.customStatusTemplates || []).map(template => ({
        id: template.id,
        name: template.name || '未命名工坊方案',
        source: 'workshop' as const,
        template,
    }));

    return [...moduleOptions, ...workshopOptions];
}

export function resolveDateStatusTemplate(
    char: Pick<CharacterProfile, 'dateStatusModuleIds' | 'dateStatusTemplateId' | 'customStatusTemplates'>,
): CustomStatusTemplate | undefined {
    const selectedId = char.dateStatusTemplateId;

    if (selectedId && !isBuiltinDateStatusTemplateId(selectedId)) {
        const custom = (char.customStatusTemplates || []).find(template => template.id === selectedId);
        if (custom) return custom;
    }

    return createDateStatusTemplateFromModuleIds(getSelectedDateStatusModuleIds(char))
        || createDateStatusTemplateFromModuleIds(DEFAULT_DATE_STATUS_MODULE_IDS);
}

function createInlineStatusProtocol(fields: TemplateField[]): string {
    if (!fields.length) {
        return '<status>\n状态: 用模板要求生成的状态内容\n</status>';
    }

    const lines = ['<status>'];
    for (const fieldDef of fields) {
        const sourceType = fieldTypeByName.get(fieldDef.name);
        if (fieldDef.type === 'list') {
            lines.push(`${fieldDef.name}:`);
            lines.push(sourceType === 'object' ? '  - 条件/对象 -> 结果' : '  - 简短状态1');
            lines.push(sourceType === 'object' ? '  - 条件/对象 -> 结果' : '  - 简短状态2');
        } else if (sourceType === 'number') {
            lines.push(`${fieldDef.name}: 50 情绪词`);
        } else {
            lines.push(`${fieldDef.name}: 简短状态`);
        }
    }
    lines.push('</status>');
    return lines.join('\n');
}

export function buildDateStatusInlineInstruction(template: CustomStatusTemplate | undefined): string {
    if (!template) return '';

    const fields = template.fields || [];
    const systemPrompt = template.systemPrompt || DATE_STATUS_COMPACT_SYSTEM_PROMPT_V2;
    const systemPromptHasFieldProtocol = /当前启用模块|字段协议/i.test(systemPrompt);
    const fieldNotes = fields.length
        ? fields.map(fieldDef => `- ${fieldDef.name}: ${fieldDef.description || '根据本轮线下剧情生成'}`).join('\n')
        : `模板说明：${template.systemPrompt || '根据本轮线下剧情生成状态栏。'}`;
    const fieldNotesBlock = systemPromptHasFieldProtocol
        ? ''
        : `\n\n当前实际启用字段：\n${fieldNotes}`;
    const outputExampleBlock = systemPromptHasFieldProtocol
        ? ''
        : `\n\n输出格式示例：\n正文内容……\n\n${createInlineStatusProtocol(fields)}`;
    const regexNote = template.extractRegex?.trim()
        ? `\n如果这是正则模板，状态片段必须能被这个正则匹配：${template.extractRegex.trim()}`
        : '';

    return `

### 线下状态栏随文生成
本角色已启用线下状态栏「${template.name}」。先照常输出线下剧情正文（严格遵守沉浸剧场格式），正文结束后另起一行追加唯一一个 <status>...</status> 块——它仅供前端渲染状态栏，不作为正文展示，块内不必每行加情绪标签。下面的【状态栏导演】指令只约束这个 <status> 块，不影响正文任务。状态全部取材于本轮新互动与剧情上下文，不要照搬上一轮快照的旧字段、旧数值。</status> 之后不再写任何正文或解释。
${regexNote}

【状态栏导演】系统指令：
${systemPrompt}${fieldNotesBlock}${outputExampleBlock}`;
}

function clipDateStatusSnapshot(text: string): string {
    const cleaned = text.trim();
    if (cleaned.length <= DATE_STATUS_SNAPSHOT_MAX_CHARS) return cleaned;
    return `${cleaned.slice(0, DATE_STATUS_SNAPSHOT_MAX_CHARS).trimEnd()}\n...（状态快照已截断）`;
}

function cleanDateStatusRawSnapshot(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<\/?status>/gi, '')
        .trim();
}

function formatDateStatusFieldsSnapshot(fields: unknown): string {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return '';

    const lines: string[] = [];
    let currentModule = '';
    for (const [fieldName, value] of Object.entries(fields as Record<string, unknown>)) {
        const moduleMatch = fieldName.match(/^(.+?)[-－—–](.+)$/);
        const moduleName = moduleMatch?.[1]?.trim() || '';
        if (moduleName && moduleName !== currentModule) {
            currentModule = moduleName;
            lines.push(`【${moduleName}】`);
        }

        if (Array.isArray(value)) {
            lines.push(`${fieldName}:`);
            value
                .map(item => String(item).trim())
                .filter(Boolean)
                .forEach(item => lines.push(`  - ${item}`));
        } else {
            const text = value === null || value === undefined ? '' : String(value).trim();
            lines.push(`${fieldName}: ${text}`);
        }
    }

    return lines.join('\n').trim();
}

function getDateStatusSnapshotText(cardData: StatusCardData | undefined): string {
    const meta = cardData?.meta as Record<string, unknown> | undefined;
    const raw = cleanDateStatusRawSnapshot(meta?.dateStatusRaw);
    if (raw) return clipDateStatusSnapshot(raw);

    const fields = formatDateStatusFieldsSnapshot(meta?.dateStatusFields);
    return fields ? clipDateStatusSnapshot(fields) : '';
}

export function buildLatestDateStatusSnapshotBlock(messages: Message[]): string {
    const latestStatusMessage = [...messages]
        .filter(message => (
            message.role === 'assistant'
            && message.metadata?.source === 'date'
            && message.metadata?.hasDateStatusCard === true
            && message.metadata?.statusCardData
        ))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || (b.id || 0) - (a.id || 0))[0];
    const snapshot = getDateStatusSnapshotText(latestStatusMessage?.metadata?.statusCardData as StatusCardData | undefined);
    if (!snapshot) return '';

    return `### 【当前线下状态快照】
以下是最近一次见面的状态栏，仅作为本轮剧情导演的内部状态：它不是用户输入、不是角色台词，不要复述给用户，不要在正文中解释"状态栏显示"。用它判断本轮怎么走——哪些边界还在、哪些钩子可以推进、哪些大事件还不能发生、哪些禁忌写法需要遵守。

${snapshot}`;
}

function stripMatchedStatusContent(content: string, matchResult: RegExpMatchArray | null): string {
    let cleaned = (content || '').replace(/<status>[\s\S]*?<\/status>/gi, '').trim();
    if (matchResult?.[0]) {
        cleaned = cleaned.replace(matchResult[0], '').trim();
    }
    return cleaned;
}

function clampStatusNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function formatPrecisePercent(value: number): string {
    const clamped = clampStatusNumber(value);
    return Number.isInteger(clamped)
        ? String(clamped)
        : clamped.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function fallbackNumberLabel(value: number): string {
    if (value >= 85) return '快满溢';
    if (value >= 70) return '压不住';
    if (value >= 50) return '正升温';
    if (value >= 30) return '还摇晃';
    return '很微弱';
}

function parseNumberWithLabel(value: string | string[] | undefined): {
    value: number;
    label: string;
} {
    const raw = Array.isArray(value) ? value[0] : value;
    const text = String(raw || '').trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return { value: 0, label: fallbackNumberLabel(0) };

    const numeric = clampStatusNumber(Number(match[0]));
    const label = text
        .slice(match.index! + match[0].length)
        .replace(/[，,。:：|/·]+/g, ' ')
        .trim();
    return {
        value: numeric,
        label: label || fallbackNumberLabel(numeric),
    };
}

function augmentDateStatusParsedData(
    parsedData: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> | undefined {
    if (!parsedData) return undefined;

    const next: Record<string, string | string[]> = { ...parsedData };
    for (const [name, type] of fieldTypeByName.entries()) {
        if (type !== 'number' || !(name in parsedData)) continue;

        const parsed = parseNumberWithLabel(parsedData[name]);
        next[`${name}__percent`] = formatPrecisePercent(parsed.value);
        next[`${name}__rounded`] = String(Math.round(parsed.value));
        next[`${name}__label`] = parsed.label;
    }
    return next;
}

function createStatusCardDataFromTemplate(
    template: CustomStatusTemplate,
    extracted: string,
    matchResult: RegExpMatchArray | null,
    parsedData?: Record<string, string | string[]>,
): StatusCardData | undefined {
    if (!extracted.trim()) return undefined;

    const enrichedParsedData = augmentDateStatusParsedData(parsedData);

    if (template.renderMode === 'html') {
        const finalHtml = composeCustomStatusTemplateHtml(template, {
            matchResult,
            extracted,
            parsedData: enrichedParsedData,
            includeScripts: template.allowScripts === true,
        });
        if (!finalHtml.trim()) return undefined;

        const plainText = finalHtml
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            cardType: 'freeform',
            body: plainText.slice(0, 40).trim() || template.name || '线下状态栏',
            meta: template.allowScripts === true
                ? { html: finalHtml, allowScripts: true, dateStatusRaw: extracted, dateStatusFields: enrichedParsedData }
                : { html: finalHtml, dateStatusRaw: extracted, dateStatusFields: enrichedParsedData },
            style: { mood: '' },
        };
    }

    return {
        cardType: 'custom_text',
        body: extracted.slice(0, 200),
        meta: {
            dateStatusRaw: extracted,
            dateStatusFields: enrichedParsedData,
        },
        style: { mood: '' },
    };
}

export function createDateStatusCardDataFromRaw(
    rawStatus: string,
    template: CustomStatusTemplate | undefined,
): StatusCardData | undefined {
    const raw = rawStatus.trim();
    if (!raw) return undefined;

    if (!template) {
        return {
            cardType: 'custom_text',
            title: '线下状态栏',
            body: raw.slice(0, 200),
            meta: { dateStatusRaw: raw },
            style: { mood: '' },
        };
    }

    const wrapped = /<status\b/i.test(raw) ? raw : `<status>\n${raw}\n</status>`;
    let extracted = raw.replace(/<\/?status>/gi, '').trim();
    let matchResult: RegExpMatchArray | null = null;
    let parsedData: Record<string, string | string[]> | undefined;
    const regexPattern = template.extractRegex?.trim();

    if (regexPattern) {
        try {
            const regex = new RegExp(regexPattern, 's');
            matchResult = wrapped.match(regex) || raw.match(regex);
            extracted = matchResult ? (matchResult[1] ?? matchResult[0] ?? extracted) : extracted;
        } catch (error) {
            console.warn('[DateStatus] Invalid edit regex:', template.extractRegex, error);
        }
    }

    const parsedStatus = parseStatusBlock(wrapped, template.fields);
    if (parsedStatus) {
        if (!matchResult) {
            extracted = parsedStatus.raw;
        }
        if (Object.keys(parsedStatus.fields).length > 0) {
            parsedData = parsedStatus.fields;
        }
    }

    return createStatusCardDataFromTemplate(template, extracted, matchResult, parsedData)
        || {
            cardType: 'custom_text',
            title: template.name || '线下状态栏',
            body: raw.slice(0, 200),
            meta: { dateStatusRaw: raw, dateStatusFields: parsedData },
            style: { mood: '' },
        };
}

export function extractDateStatusCardFromMainOutput(
    content: string,
    template: CustomStatusTemplate | undefined,
): DateStatusMainOutputResult {
    if (!template) return { content };

    let extracted = '';
    let matchResult: RegExpMatchArray | null = null;
    let parsedData: Record<string, string | string[]> | undefined;
    const regexPattern = template.extractRegex?.trim();

    if (regexPattern) {
        try {
            const regex = new RegExp(regexPattern, 's');
            matchResult = content.match(regex);
            extracted = matchResult ? (matchResult[1] ?? matchResult[0] ?? '') : '';
        } catch (error) {
            console.warn('[DateStatus] Invalid inline regex:', template.extractRegex, error);
        }
    }

    const parsedStatus = parseStatusBlock(content, template.fields);
    if (parsedStatus) {
        if (!extracted) {
            extracted = parsedStatus.raw;
        }
        if (Object.keys(parsedStatus.fields).length > 0) {
            parsedData = parsedStatus.fields;
        }
    }

    const cleanedContent = stripMatchedStatusContent(content, matchResult);
    if (!extracted.trim()) return { content: cleanedContent };

    const cardData = createStatusCardDataFromTemplate(template, extracted, matchResult, parsedData);
    return {
        content: cleanedContent,
        cardData,
        templateId: cardData ? template.id : undefined,
    };
}
