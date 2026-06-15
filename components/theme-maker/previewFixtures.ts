import type { Message,YesterdayNewspaperContent,YesterdayNewspaperRecord } from '../../types';

export type ThemeMakerEditorPage =
    | 'overview'
    | 'page'
    | 'header'
    | 'messages'
    | 'media'
    | 'notices'
    | 'cards'
    | 'input'
    | 'overlays'
    | 'advanced';

export const THEME_MAKER_EDITOR_PAGES: Array<{ id: ThemeMakerEditorPage; label: string; description: string }> = [
    { id: 'overview', label: '总览', description: '主题名称、基底主题、全局 token。' },
    { id: 'page', label: '页面', description: '聊天容器、消息区、背景和密度。' },
    { id: 'header', label: '顶部栏', description: '返回、头像、标题、状态和按钮。' },
    { id: 'messages', label: '消息', description: '用户/角色气泡、头像、引用和思考链。' },
    { id: 'media', label: '媒体', description: '语音、图片、表情和图片预览。' },
    { id: 'notices', label: '提示', description: '时间戳、系统提示、互动和加载态。' },
    { id: 'cards', label: '卡片', description: '转账、转发、社交、新闻和专项卡。' },
    { id: 'input', label: '输入栏', description: '输入框、表情、动作、录音和选择模式。' },
    { id: 'overlays', label: '覆盖层', description: '弹窗、遮罩、图片预览和确认按钮。' },
    { id: 'advanced', label: '高级', description: 'CSS、选择器速查和风险提示。' },
];

export const PREVIEW_CHAT_COPY = {
    userFirst: '今天放学有点晚',
    userSecond: '操场的灯又坏了一半',
    timestamp: '下午06:12',
    aiFirst: '嗯，夏天快过去了',
    aiSecond: '有些话那时候没说出口，后来就只剩下风替我们翻旧试卷。你看，连教室后门那块掉漆的地方，都比我们更擅长留在原地。',
    longUser: '我想把每一个聊天细节都捏成自己的样子，包括顶部栏、输入框、图片、卡片、系统提示和那些很小的状态。',
    longAi: '可以。我们把所有能看见的区域放进同一个完整预览里。这样你调一个按钮，点开悬浮球就能立刻看到它在真实聊天里的样子。',
    imageSrc: '/assets/theater/library.png',
    imageAlt: '黄昏旧教室预览图',
    aiVoiceSeconds: 6,
    userVoiceSeconds: 3,
};

export const MOCK_TRANSFER_USER: Message = {
    id: 0,
    charId: '',
    role: 'user',
    type: 'transfer',
    content: '',
    timestamp: Date.now(),
    metadata: { amount: '52.00', status: 'pending' },
};

export const MOCK_TRANSFER_AI: Message = {
    id: 1,
    charId: '',
    role: 'assistant',
    type: 'transfer',
    content: '',
    timestamp: Date.now(),
    metadata: { amount: '13.14', status: 'pending' },
};

export const MOCK_TRANSFER_ACCEPTED: Message = {
    ...MOCK_TRANSFER_AI,
    id: 2,
    metadata: { amount: '13.14', status: 'accepted' },
};

export const MOCK_TRANSFER_RETURNED: Message = {
    ...MOCK_TRANSFER_USER,
    id: 3,
    metadata: { amount: '52.00', status: 'returned' },
};

export const MOCK_NEWSPAPER_REPORT: YesterdayNewspaperContent = {
    date: '2026-06-15',
    periodType: 'daily',
    periodLabel: '06.15',
    publicationName: '昨日来信',
    publicationSubtitle: '气泡工坊预览版',
    issueLabel: 'NO. 20260615',
    layoutType: 'morning',
    masthead: '昨日来信',
    headline: '操场灯下有一页没有寄出的信',
    subheadline: '所有小报、投递条和存档弹窗，都应该能被同一套主题样式接住。',
    relationshipWeather: '关系天气：微风',
    leadStory: '傍晚的聊天被整理成一张私人小报。标题、版心、边栏、脚注和邮戳都在预览里露面，方便检查卡片主题是否真的覆盖到细节。',
    sideCards: [
        { title: '门口状态', content: '角色把今天的心情折进角落，像一枚还没干透的印章。' },
        { title: '随信小广告', content: '关闭品牌色后，小报会跟随通用卡片的背景、文字和边框变量。' },
    ],
    extraNotes: [
        '输入栏和顶部栏已经有独立分页。',
        '卡片页现在继续扩展到小报类结构化消息。',
        '投递成功、失败、生成中都需要能被看到。',
    ],
    memoryHighlights: ['这是一条用于兜底的记忆短讯。'],
    heartGraphNote: '心意地图暂时安静，但线条颜色会响应主题变量。',
    cornerNote: '角落留白，等下一阵风。',
    tomorrowHint: '下一封信还没落款。',
    closingLine: '明天继续把剩余模块补进分页预览。',
    footer: '角色 / 你 · 气泡工坊',
    voiceSnippet: '有些话被压成一行铅字。',
    statusSnapshot: '状态：正在美化所有可见区域。',
    cardEcho: '卡片回声：预览分页继续增加。',
    moodTags: ['预览', '小报', '卡片'],
};

export const MOCK_NEWSPAPER_READY_RECORD: YesterdayNewspaperRecord = {
    id: 'theme-preview-newspaper-ready',
    ownerUserId: 'preview',
    charId: 'preview-char',
    date: MOCK_NEWSPAPER_REPORT.date,
    periodType: 'daily',
    status: 'ready',
    content: MOCK_NEWSPAPER_REPORT,
    createdAt: 1760000000000,
    updatedAt: 1760000000000,
    generatedAt: 1760000000000,
};

export const MOCK_NEWSPAPER_GENERATING_RECORD: YesterdayNewspaperRecord = {
    ...MOCK_NEWSPAPER_READY_RECORD,
    id: 'theme-preview-newspaper-generating',
    status: 'generating',
    content: undefined,
};

export const MOCK_NEWSPAPER_FAILED_RECORD: YesterdayNewspaperRecord = {
    ...MOCK_NEWSPAPER_READY_RECORD,
    id: 'theme-preview-newspaper-failed',
    status: 'failed',
    content: undefined,
    error: '投递条失败状态预览：可以重新投递一次。',
};
