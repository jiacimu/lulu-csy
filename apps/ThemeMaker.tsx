



import React,{ useState,useRef,useEffect,useMemo } from 'react';
import { Eye,X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { ChatTheme,BubbleStyle,ChatThemeSurfaces,ChatThemeTokens } from '../types';
import { processImage } from '../utils/file';
import ChatBubble from '../components/chat/ChatBubble';
import VoiceBubble from '../components/chat/VoiceBubble';
import DefaultTransferCard from '../components/chat/plugins/DefaultTransferCard';
import { NewspaperCard,YesterdayNewspaperDeliveryNotice } from '../components/chat/newspaper/YesterdayNewspaper';
import {
    MOCK_NEWSPAPER_FAILED_RECORD,
    MOCK_NEWSPAPER_GENERATING_RECORD,
    MOCK_NEWSPAPER_READY_RECORD,
    MOCK_NEWSPAPER_REPORT,
    MOCK_TRANSFER_ACCEPTED,
    MOCK_TRANSFER_AI,
    MOCK_TRANSFER_RETURNED,
    MOCK_TRANSFER_USER,
    PREVIEW_CHAT_COPY,
    THEME_MAKER_EDITOR_PAGES,
    ThemeMakerEditorPage,
} from '../components/theme-maker/previewFixtures';
import { buildThemeSurfacesCss } from '../components/theme-maker/themeCss';
import { createThemeMakerDraft,migrateChatThemeToV2,parseImportedChatTheme } from '../components/theme-maker/themeSchema';
import { focusPreventScroll } from '../utils/viewportRepair';

// --- Aesthetic Palette Inspiration Cards ---

// --- CSS Examples ---
const CSS_EXAMPLES = [
    {
        name: '毛玻璃 (Glass)',
        code: `/* Glassmorphism for bubbles */
.sully-bubble-user, .sully-bubble-ai {
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}
.sully-bubble-user { background: rgba(99, 102, 241, 0.7) !important; }
.sully-bubble-ai { background: rgba(255, 255, 255, 0.7) !important; }`
    },
    {
        name: '霓虹 (Neon)',
        code: `/* Glowing Neon Borders */
.sully-bubble-user {
  border: 2px solid #a855f7;
  box-shadow: 0 0 10px #a855f7;
  background: #2e1065 !important;
  color: #fff !important;
}
.sully-bubble-ai {
  border: 2px solid #3b82f6;
  box-shadow: 0 0 10px #3b82f6;
  background: #172554 !important;
  color: #fff !important;
}`
    },
    {
        name: '像素 (Pixel)',
        code: `/* Pixel Art Style */
.sully-bubble-user, .sully-bubble-ai {
  border-radius: 0px !important;
  border: 2px solid #000;
  box-shadow: 4px 4px 0px #000;
  font-family: monospace;
}`
    }
];

type CssIssue = {
    message: string;
    line?: number;
};

type CssAnalysis = {
    errors: CssIssue[];
    warnings: CssIssue[];
    importantCount: number;
};

const ADVANCED_CSS_ALLOWED_SELECTORS = [
    ':root',
    '.sully-chat-container',
    '.sully-chat-messages',
    '.sully-chat-dock',
    '.sully-chat-header',
    '.sully-chat-header-avatar',
    '.sully-chat-header-title',
    '.sully-chat-header-subtitle',
    '.sully-chat-header-token',
    '.sully-chat-header-button',
    '.sully-chat-header-summary',
    '.sully-chat-header-back',
    '.sully-chat-header-call',
    '.sully-chat-header-trigger',
    '.sully-chat-input',
    '.sully-chat-input-main',
    '.sully-chat-input-icon-button',
    '.sully-chat-input-plus-button',
    '.sully-chat-input-textbox',
    '.sully-chat-input-textarea',
    '.sully-chat-input-placeholder',
    '.sully-chat-input-emoji-button',
    '.sully-chat-input-send-button',
    '.sully-chat-input-panel',
    '.sully-chat-input-suggestion-panel',
    '.sully-chat-input-suggestion-item',
    '.sully-chat-input-panel-tabs',
    '.sully-chat-input-panel-tab',
    '.sully-chat-input-panel-item',
    '.sully-chat-input-emoji-item',
    '.sully-chat-input-panel-action',
    '.sully-chat-input-panel-action-icon',
    '.sully-wechat-input-main',
    '.sully-wechat-input-mode-button',
    '.sully-wechat-input-textbox',
    '.sully-wechat-input-textarea',
    '.sully-wechat-input-emoji-button',
    '.sully-wechat-input-send-button',
    '.sully-wechat-input-plus-button',
    '.sully-wechat-voice-hold',
    '.sully-recording-overlay',
    '.sully-recording-bubble-wrap',
    '.sully-recording-bubble',
    '.sully-recording-cancel-label',
    '.sully-recording-convert-label',
    '.sully-recording-send-label',
    '.sully-recording-duration',
    '.sully-wechat-recording-overlay',
    '.sully-wechat-recording-bubble-wrap',
    '.sully-wechat-recording-bubble',
    '.sully-wechat-converting-overlay',
    '.sully-wechat-converting-modal',
    '.sully-chat-selection-bar',
    '.sully-chat-selection-button',
    '.sully-chat-selection-forward',
    '.sully-chat-selection-soul',
    '.sully-chat-selection-danger',
    '.sully-message-selection-checkbox-wrap',
    '.sully-message-selection-checkbox',
    '.sully-message-selection-check',
    '.sully-message-avatar',
    '.sully-message-avatar-user',
    '.sully-message-avatar-ai',
    '.sully-message-avatar-image',
    '.sully-message-avatar-decoration',
    '.sully-message-avatar-badge-wrap',
    '.sully-message-avatar-badge',
    '.sully-message-avatar-badge-story-phone',
    '.sully-message-avatar-badge-afterglow',
    '.sully-message-avatar-badge-inner-voice',
    '.sully-message-avatar-badge-surprise',
    '.sully-message-avatar-badge-retry',
    '.sully-message-avatar-loading',
    '.sully-bubble-user',
    '.sully-bubble-ai',
    '.sully-bubble-tail',
    '.sully-voice-bubble',
    '.sully-voice-bar',
    '.sully-voice-record-button',
    '.sully-typing-bubble',
    '.sully-typing-tail',
    '.sully-image-msg-shell',
    '.sully-image-msg',
    '.sully-emoji-msg',
    '.sully-image-preview-backdrop',
    '.sully-image-preview-action',
    '.sully-msg-timestamp',
    '.sully-system-pill',
    '.sully-interaction-pill',
    '.sully-card-container',
    '.sully-forward-card',
    '.sully-canva-card',
    '.sully-xhs-card',
    '.sully-social-card',
    '.sully-system-notice-card',
    '.sully-system-notice-card-dark',
    '.sully-chart-reading-card',
    '.sully-soul-reflection-card',
    '.sully-voice-call-card',
    '.sully-collection-forward-card',
    '.sully-collection-forward-heart-card',
    '.sully-song-share-card',
    '.sully-wechat-moments-card',
    '.sully-story-phone-card',
    '.sully-news-card',
    '.sully-news-card-bilibili',
    '.sully-news-card-weibo',
    '.sully-news-card-zhihu',
    '.sully-news-card-baidu',
    '.sully-news-card-douyin',
    '.sully-news-card-default',
    '.sully-news-card-header',
    '.sully-news-card-badge',
    '.sully-news-card-rank',
    '.sully-news-card-title',
    '.sully-news-card-desc',
    '.sully-news-card-footer',
    '.sully-news-card-action',
    '.sully-newspaper-card',
    '.sully-newspaper-delivery',
    '.sully-newspaper-delivery-stack',
    '.sully-newspaper-delivery-modal',
    '.sully-newspaper-delivery-mark',
    '.sully-newspaper-delivery-action',
    '.sully-newspaper-modal',
    '.sully-newspaper-modal-sheet',
    '.sully-newspaper-modal-button',
    '.sully-room-note-card',
    '.sully-room-note-body',
    '.sully-room-plan-card',
    '.sully-room-plan-body',
    '.sully-furniture-interaction-card',
    '.sully-furniture-interaction-body',
    '.sully-phone-card',
    '.sully-phone-wechat-card',
    '.sully-phone-call-card',
    '.sully-phone-taobao-card',
    '.sully-phone-meituan-card',
    '.sully-phone-social-card',
    '.sully-phone-default-card',
    '.sully-phone-netease-card',
    '.sully-phone-camera-card',
    '.sully-transfer-card',
    '.sully-transfer-top',
    '.sully-transfer-bottom',
    '.sully-transfer-watermark',
    '.sully-theme-overlay-backdrop',
    '.sully-theme-overlay-modal',
    '.sully-theme-overlay-primary-button',
    '.sully-theme-overlay-secondary-button',
    '.sully-message-action-modal',
    '.sully-message-action-button',
    '.sully-message-action-danger',
    '.sully-inner-voice-backdrop',
    '.sully-inner-voice-close',
    '.sully-inner-voice-shell',
    '.sully-inner-voice-card',
    '.sully-inner-voice-title',
    '.sully-inner-voice-text',
    '.sully-inner-voice-toggle',
    '.sully-inner-voice-close-hint',
    '.sully-status-card-overlay-shell',
    '.sully-status-card-collection-button',
    '.sully-afterglow-composer-backdrop',
    '.sully-afterglow-composer-dialog',
    '.sully-afterglow-composer-button',
    '.sully-bubble-text',
];

const CSS_SELECTOR_REFERENCE = [
    { selector: '.sully-chat-container', desc: '整页聊天区域：背景图、渐变底色、整体氛围。' },
    { selector: '.sully-chat-messages', desc: '消息滚动区：内边距、滚动区域背景。' },
    { selector: '.sully-chat-dock', desc: '底部输入和待发送动作的 dock 外层。' },
    { selector: '.sully-chat-header', desc: '顶部栏：角色头像、名字、返回按钮、通话按钮所在区域。' },
    { selector: '.sully-chat-header-avatar', desc: '顶部栏头像：尺寸、圆角、阴影。' },
    { selector: '.sully-chat-header-title', desc: '顶部栏主标题：角色名文字。' },
    { selector: '.sully-chat-header-subtitle', desc: '顶部栏副标题：Online、状态文字。' },
    { selector: '.sully-chat-header-token', desc: '顶部栏 token 小标签：调试用量、徽标背景、边框和文字。' },
    { selector: '.sully-chat-header-button', desc: '顶部栏按钮：返回、通话、触发 AI 等图标按钮。' },
    { selector: '.sully-chat-header-summary', desc: '顶部栏记忆整理提示条。' },
    { selector: '.sully-chat-input', desc: '底部输入栏：输入框、加号、表情、发送/语音按钮所在区域。' },
    { selector: '.sully-chat-input-main', desc: '底部输入栏主行：控制输入框和按钮之间的间距。' },
    { selector: '.sully-chat-input-textbox', desc: '输入框外壳：背景、圆角、边框。' },
    { selector: '.sully-chat-input-textarea', desc: '真实文本输入区域：文字颜色、字号、placeholder。' },
    { selector: '.sully-chat-input-placeholder', desc: '输入框 placeholder 或微信按住说话提示文字。' },
    { selector: '.sully-chat-input-icon-button', desc: '输入栏左侧功能按钮。' },
    { selector: '.sully-chat-input-emoji-button', desc: '输入栏表情按钮。' },
    { selector: '.sully-chat-input-send-button', desc: '输入栏发送按钮。' },
    { selector: '.sully-chat-input-panel', desc: '底部展开面板：表情/更多操作区域。' },
    { selector: '.sully-chat-input-suggestion-panel', desc: '输入栏上方表情联想浮层。' },
    { selector: '.sully-chat-input-suggestion-item', desc: '表情联想浮层单项。' },
    { selector: '.sully-chat-input-panel-tab', desc: '底部面板分类标签。' },
    { selector: '.sully-chat-input-panel-item', desc: '表情格子和更多动作图标格。' },
    { selector: '.sully-chat-input-panel-action', desc: '更多动作面板单个动作按钮。' },
    { selector: '.sully-chat-input-panel-action-icon', desc: '更多动作面板图标容器。' },
    { selector: '.sully-wechat-input-main', desc: '微信插件输入栏主行。' },
    { selector: '.sully-wechat-input-textbox', desc: '微信插件文本输入框外壳。' },
    { selector: '.sully-wechat-voice-hold', desc: '微信插件按住说话区域。' },
    { selector: '.sully-recording-overlay', desc: '录音覆盖层背景。' },
    { selector: '.sully-recording-bubble', desc: '录音中的提示气泡 / 波形卡片。' },
    { selector: '.sully-recording-duration', desc: '录音计时文字。' },
    { selector: '.sully-chat-selection-bar', desc: '多选消息时的底部操作栏。' },
    { selector: '.sully-chat-selection-button', desc: '多选底栏普通操作按钮。' },
    { selector: '.sully-chat-selection-danger', desc: '多选底栏危险操作按钮。' },
    { selector: '.sully-message-selection-checkbox', desc: '消息多选勾选框。' },
    { selector: '.sully-message-avatar', desc: '消息流头像通用入口。' },
    { selector: '.sully-message-avatar-image', desc: '消息流头像图片本体。' },
    { selector: '.sully-message-avatar-badge', desc: '消息头像右上角状态徽标通用入口。' },
    { selector: '.sully-bubble-user', desc: '用户气泡外壳：背景、边框、圆角、阴影、内边距。' },
    { selector: '.sully-bubble-ai', desc: '角色气泡外壳：背景、边框、圆角、阴影、内边距。' },
    { selector: '.sully-bubble-text', desc: '气泡文字层：建议只改颜色/阴影，不建议改 display、换行、writing-mode。' },
    { selector: '.sully-bubble-tail polygon', desc: '气泡小尖角颜色：尾巴是 SVG，改颜色用 fill。' },
    { selector: '.sully-voice-bubble', desc: '语音条气泡：语音消息的圆角、背景、边框、阴影。' },
    { selector: '.sully-voice-record-button', desc: '输入栏语音录制按钮。' },
    { selector: '.sully-image-msg-shell', desc: '图片消息外壳：加载、失败、图片容器。' },
    { selector: '.sully-image-msg', desc: '图片消息：图片圆角、边框、阴影、尺寸限制。' },
    { selector: '.sully-emoji-msg', desc: '表情消息：表情图尺寸、阴影和圆角。' },
    { selector: '.sully-image-preview-backdrop', desc: '图片大图预览遮罩。' },
    { selector: '.sully-image-preview-action', desc: '图片大图预览关闭/下载按钮。' },
    { selector: '.sully-msg-timestamp', desc: '时间戳：消息中间的“下午04:14”这类时间分隔。' },
    { selector: '.sully-system-pill', desc: '系统提示胶囊：转账提示、事件提示等系统小条。' },
    { selector: '.sully-interaction-pill', desc: '互动提示胶囊：轻触、长按、剧情互动等小提示。' },
    { selector: '.sully-card-container', desc: '聊天卡片容器：小红书、转发、其他结构化卡片的外框。' },
    { selector: '.sully-transfer-card', desc: '转账卡片整体容器。' },
    { selector: '.sully-transfer-top', desc: '转账卡片上半区域。' },
    { selector: '.sully-transfer-bottom', desc: '转账卡片底部说明区域。' },
    { selector: '.sully-forward-card', desc: '聊天记录转发卡片。' },
    { selector: '.sully-canva-card', desc: 'Canva 设计分享卡片。' },
    { selector: '.sully-xhs-card', desc: '小红书分享卡片。' },
    { selector: '.sully-social-card', desc: '社交动态分享卡片。' },
    { selector: '.sully-system-notice-card', desc: '系统通知卡片。' },
    { selector: '.sully-chart-reading-card', desc: '星象/星盘解读卡片。' },
    { selector: '.sully-soul-reflection-card', desc: '回神/自省独白卡片。' },
    { selector: '.sully-voice-call-card', desc: '语音通话摘要卡片。' },
    { selector: '.sully-collection-forward-card', desc: '典藏馆转递卡片。' },
    { selector: '.sully-song-share-card', desc: '音乐分享卡片。' },
    { selector: '.sully-wechat-moments-card', desc: '朋友圈样式分享卡片。' },
    { selector: '.sully-story-phone-card', desc: '剧情手机证据卡片外壳。' },
    { selector: '.sully-news-card', desc: '多平台新闻/热榜卡片通用入口。' },
    { selector: '.sully-news-card-bilibili', desc: 'B站视频热榜卡片。' },
    { selector: '.sully-news-card-weibo', desc: '微博热搜卡片。' },
    { selector: '.sully-news-card-zhihu', desc: '知乎热榜卡片。' },
    { selector: '.sully-news-card-baidu', desc: '百度热榜卡片。' },
    { selector: '.sully-news-card-douyin', desc: '抖音热榜卡片。' },
    { selector: '.sully-news-card-title', desc: '新闻卡标题。' },
    { selector: '.sully-news-card-desc', desc: '新闻卡描述。' },
    { selector: '.sully-news-card-action', desc: '新闻卡打开原文/平台动作。' },
    { selector: '.sully-newspaper-card', desc: '昨日来信/回望小报卡片本体。' },
    { selector: '.sully-newspaper-delivery', desc: '昨日来信投递条：成功、失败、生成中状态。' },
    { selector: '.sully-newspaper-delivery-action', desc: '昨日来信投递条操作按钮。' },
    { selector: '.sully-newspaper-modal', desc: '昨日来信存档弹窗遮罩。' },
    { selector: '.sully-newspaper-modal-sheet', desc: '昨日来信存档弹窗主体。' },
    { selector: '.sully-room-note-body', desc: '房间便签卡片主体。' },
    { selector: '.sully-room-plan-body', desc: '房间计划卡片主体。' },
    { selector: '.sully-furniture-interaction-body', desc: '家具互动反馈卡片主体。' },
    { selector: '.sully-phone-card', desc: '手机证据卡片通用入口。' },
    { selector: '.sully-phone-wechat-card', desc: '手机证据：微信聊天卡。' },
    { selector: '.sully-phone-call-card', desc: '手机证据：通话记录卡。' },
    { selector: '.sully-phone-taobao-card', desc: '手机证据：淘宝订单卡。' },
    { selector: '.sully-phone-meituan-card', desc: '手机证据：美团外卖卡。' },
    { selector: '.sully-phone-netease-card', desc: '手机证据：网易云音乐卡。' },
    { selector: '.sully-theme-overlay-backdrop', desc: '主题覆盖层遮罩：弹窗、预览层背景。' },
    { selector: '.sully-theme-overlay-modal', desc: '主题覆盖层弹窗主体。' },
    { selector: '.sully-theme-overlay-primary-button', desc: '覆盖层主按钮。' },
    { selector: '.sully-theme-overlay-secondary-button', desc: '覆盖层次按钮。' },
    { selector: '.sully-message-action-modal', desc: '消息长按操作菜单内容区。' },
    { selector: '.sully-message-action-button', desc: '消息长按操作菜单普通按钮。' },
    { selector: '.sully-message-action-danger', desc: '消息长按操作菜单危险按钮。' },
    { selector: '.sully-inner-voice-backdrop', desc: '经典心声全屏遮罩背景。' },
    { selector: '.sully-inner-voice-card', desc: '经典心声卡片主体。' },
    { selector: '.sully-inner-voice-title', desc: '经典心声卡片标题。' },
    { selector: '.sully-inner-voice-text', desc: '经典心声卡片正文。' },
    { selector: '.sully-status-card-collection-button', desc: '状态卡片收藏按钮。' },
    { selector: '.sully-afterglow-composer-dialog', desc: '番外篇命题弹窗主体。' },
    { selector: '.sully-afterglow-composer-button', desc: '番外篇命题弹窗按钮。' },
];

const CSS_SELECTOR_GROUPS = [
    {
        title: '整页与顶部栏',
        desc: '背景、消息区、顶部头像、标题和顶部按钮。',
        selectors: [
            '.sully-chat-container',
            '.sully-chat-messages',
            '.sully-chat-dock',
            '.sully-chat-header',
            '.sully-chat-header-avatar',
            '.sully-chat-header-title',
            '.sully-chat-header-subtitle',
            '.sully-chat-header-token',
            '.sully-chat-header-button',
            '.sully-chat-header-summary',
        ],
    },
    {
        title: '气泡与消息',
        desc: '用户/角色气泡、语音、图片、表情、时间戳和头像状态。',
        selectors: [
            '.sully-bubble-user',
            '.sully-bubble-ai',
            '.sully-bubble-text',
            '.sully-bubble-tail polygon',
            '.sully-voice-bubble',
            '.sully-voice-record-button',
            '.sully-image-msg-shell',
            '.sully-image-msg',
            '.sully-emoji-msg',
            '.sully-msg-timestamp',
            '.sully-system-pill',
            '.sully-interaction-pill',
            '.sully-message-selection-checkbox',
            '.sully-message-avatar',
            '.sully-message-avatar-image',
            '.sully-message-avatar-badge',
        ],
    },
    {
        title: '底部输入栏',
        desc: '输入框、加号、表情、发送按钮、展开面板和录音状态。',
        selectors: [
            '.sully-chat-input',
            '.sully-chat-input-main',
            '.sully-chat-input-icon-button',
            '.sully-chat-input-textbox',
            '.sully-chat-input-textarea',
            '.sully-chat-input-placeholder',
            '.sully-chat-input-emoji-button',
            '.sully-chat-input-send-button',
            '.sully-chat-input-panel',
            '.sully-chat-input-suggestion-panel',
            '.sully-chat-input-suggestion-item',
            '.sully-chat-input-panel-tab',
            '.sully-chat-input-panel-item',
            '.sully-chat-input-panel-action',
            '.sully-chat-input-panel-action-icon',
            '.sully-recording-overlay',
            '.sully-recording-bubble',
            '.sully-recording-duration',
            '.sully-chat-selection-bar',
            '.sully-chat-selection-button',
            '.sully-chat-selection-danger',
        ],
    },
    {
        title: '聊天卡片',
        desc: '转账、转发、社交分享、新闻、小报、房间和手机证据卡片。',
        selectors: [
            '.sully-card-container',
            '.sully-transfer-card',
            '.sully-transfer-top',
            '.sully-transfer-bottom',
            '.sully-forward-card',
            '.sully-canva-card',
            '.sully-xhs-card',
            '.sully-social-card',
            '.sully-song-share-card',
            '.sully-wechat-moments-card',
            '.sully-story-phone-card',
            '.sully-news-card',
            '.sully-news-card-title',
            '.sully-news-card-desc',
            '.sully-news-card-action',
            '.sully-newspaper-card',
            '.sully-newspaper-delivery',
            '.sully-newspaper-modal',
            '.sully-room-note-body',
            '.sully-room-plan-body',
            '.sully-furniture-interaction-body',
            '.sully-phone-card',
        ],
    },
    {
        title: '弹窗与覆盖层',
        desc: '图片预览、主题弹窗、消息操作、心声卡和番外命题。',
        selectors: [
            '.sully-theme-overlay-backdrop',
            '.sully-theme-overlay-modal',
            '.sully-theme-overlay-primary-button',
            '.sully-theme-overlay-secondary-button',
            '.sully-image-preview-backdrop',
            '.sully-image-preview-action',
            '.sully-message-action-modal',
            '.sully-message-action-button',
            '.sully-message-action-danger',
            '.sully-inner-voice-backdrop',
            '.sully-inner-voice-card',
            '.sully-inner-voice-title',
            '.sully-inner-voice-text',
            '.sully-status-card-collection-button',
            '.sully-afterglow-composer-dialog',
            '.sully-afterglow-composer-button',
        ],
    },
] as const;

const CARD_GALLERY_PAGES = [
    { id: 'core', label: '基础' },
    { id: 'social', label: '社交' },
    { id: 'phone', label: '手机' },
    { id: 'room', label: '房间' },
    { id: 'hotnews', label: '新闻' },
    { id: 'newspaper', label: '小报' },
] as const;

const findLineNumberByIndex = (input: string,index: number) => input.slice(0,index).split('\n').length;

const selectorIsAllowed = (selector: string) => (
    ADVANCED_CSS_ALLOWED_SELECTORS.some((allowed) => selector === allowed || selector.startsWith(`${allowed} `) || selector.startsWith(`${allowed}.`) || selector.startsWith(`${allowed}:`) || selector.startsWith(`${allowed}[`) || selector.startsWith(`${allowed}>`))
);

const customCssTargetsBubbleShell = (css: string | undefined) => /\.sully-bubble-(?:user|ai)\b/.test(css || '');

const analyzeCustomCss = (css: string): CssAnalysis => {
    const source = css || '';
    const errors: CssIssue[] = [];
    const warnings: CssIssue[] = [];
    const importantCount = (source.match(/!important/g) || []).length;

    const pushError = (message: string,line?: number) => errors.push({ message,line });
    const pushWarning = (message: string,line?: number) => warnings.push({ message,line });

    if (!source.trim()) {
        return { errors,warnings,importantCount };
    }

    try {
        if (typeof CSSStyleSheet !== 'undefined') {
            const sheet = new CSSStyleSheet();
            if (typeof sheet.replaceSync === 'function') {
                sheet.replaceSync(source);
            }
        }
    } catch (error: any) {
        pushError(`CSS 语法错误：${error?.message || '请检查语法。'}`);
    }

    const braceStack: number[] = [];
    [...source].forEach((char,index) => {
        if (char === '{') braceStack.push(index);
        if (char === '}') {
            if (braceStack.length === 0) {
                pushError('发现多余的 `}`，请检查大括号闭合。',findLineNumberByIndex(source,index));
            } else {
                braceStack.pop();
            }
        }
    });
    braceStack.forEach((index) => pushError('存在未闭合的 `{`，请补全规则块。',findLineNumberByIndex(source,index)));

    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g,'');
    const selectorRegex = /([^{}]+)\{/g;
    let selectorMatch: RegExpExecArray | null;
    while ((selectorMatch = selectorRegex.exec(sourceWithoutComments)) !== null) {
        const selectorGroup = selectorMatch[1].trim();
        if (!selectorGroup || selectorGroup.startsWith('@')) continue;
        const selectorList = selectorGroup.split(',').map(item => item.trim()).filter(Boolean);
        selectorList.forEach((selector) => {
            if (selector === 'from' || selector === 'to' || selector.includes('%')) return;
            const line = findLineNumberByIndex(sourceWithoutComments,selectorMatch?.index ?? 0);
            if (/^(?:html|body|#root|\*)\b/.test(selector)) {
                pushWarning(`选择器 \`${selector}\` 会影响聊天页外部，建议改用 .sully-chat-container 作用域。`,line);
                return;
            }
            if (!selectorIsAllowed(selector)) {
                pushWarning(`选择器 \`${selector}\` 不在推荐白名单内，可能导致预览和实际页面不一致。`,line);
            }
        });
    }

    if (/\.sully-bubble-(?:ai|user)[^{]*{[^}]*?(?:^|[;{\s])height\s*:/is.test(sourceWithoutComments)) {
        pushWarning('检测到气泡固定 height，短句/长句可能被挤成异常分行。建议使用 min-height。');
    }
    if (/\bword-break\s*:\s*break-all\b/i.test(sourceWithoutComments)) {
        pushWarning('检测到 word-break: break-all，中文气泡可能出现单字断行。建议使用 overflow-wrap: break-word。');
    }
    if (/\bwriting-mode\s*:/i.test(sourceWithoutComments)) {
        pushWarning('检测到 writing-mode，可能让聊天文字竖排。');
    }
    if (/\.sully-bubble-text[^{]*{[^}]*\b(?:display|white-space|word-break|writing-mode)\s*:/is.test(sourceWithoutComments)) {
        pushWarning('检测到直接覆盖 .sully-bubble-text 排版核心，请确认不会造成文字竖排或异常断行。');
    }

    return { errors,warnings,importantCount };
};

// --- Helpers for Color & CSS ---

// Parse Hex/RGBA to { hex: "#RRGGBB", alpha: 0-1 }
const parseColorValue = (color: string) => {
    // Default
    let hex = '#ffffff';
    let alpha = 1;

    if (!color) return { hex, alpha };

    if (color.startsWith('#')) {
        hex = color.substring(0, 7);
        return { hex, alpha: 1 };
    }

    if (color.startsWith('rgba')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            const a = match[4] ? parseFloat(match[4]) : 1;
            const toHex = (n: number) => n.toString(16).padStart(2, '0');
            hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            alpha = a;
        }
    }
    return { hex, alpha };
};

const toRgbaString = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Padding CSS Injection Helper
const PADDING_MARKER_START = '/* PADDING_AUTO_START */';
const PADDING_MARKER_END = '/* PADDING_AUTO_END */';

const injectPaddingCss = (css: string, verticalPadding: number) => {
    const horizontalPadding = Math.round(verticalPadding * 1.6); // Aspect ratio for bubble
    const rule = `
${PADDING_MARKER_START}
.sully-bubble-user, .sully-bubble-ai {
  padding: ${verticalPadding}px ${horizontalPadding}px !important;
}
${PADDING_MARKER_END}`;

    const regex = new RegExp(`${PADDING_MARKER_START.replace(/\*/g, '\\*')}[\\s\\S]*?${PADDING_MARKER_END.replace(/\*/g, '\\*')}`);

    if (css && css.match(regex)) {
        return css.replace(regex, rule);
    }
    return (css || '') + rule;
};

const extractPaddingFromCss = (css: string) => {
    const match = css?.match(/padding:\s*(\d+)px/);
    return match ? parseInt(match[1]) : 12; // Default 12px (py-3)
};

const safeThemeFileName = (name: string) => {
    const base = (name.trim() || 'bubble-theme').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    return `${base}.json`;
};

const syncRuntimeThemeFlags = (theme: ChatTheme): ChatTheme => ({
    ...theme,
    showTimestamp: theme.surfaces?.timestamp?.visible ?? theme.showTimestamp,
    timestampIntervalMs: theme.surfaces?.timestamp?.intervalMs ?? theme.timestampIntervalMs,
});

const COLOR_SWATCHES = [
    '#ffffff',
    '#f8fafc',
    '#111827',
    '#64748b',
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f43f5e',
    '#f97316',
    '#f59e0b',
    '#10b981',
    '#06b6d4',
];

const COLOR_CONTROL_LABEL_PATTERN = /(颜色|色$|色彩|背景|边框色|文字|强调|页面背景|表面颜色|主文字|次文字|占位)/;
const COLOR_VALUE_UNSUPPORTED_PATTERN = /(gradient|url\(|var\(|shadow|calc\()/i;

const shouldShowColorPicker = (label: string,value?: string) => (
    COLOR_CONTROL_LABEL_PATTERN.test(label) && !COLOR_VALUE_UNSUPPORTED_PATTERN.test(value || '')
);

// --- Collapsible Section chevron SVG ---
const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
);

// --- Collapsible Section (must be top-level to avoid remount on parent re-render) ---
const CollapsibleSection: React.FC<{ icon: string; title: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }> = ({ icon, title, isOpen, onToggle, children }) => (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
        <button
            onClick={onToggle}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 hover:bg-slate-100/80 transition-colors"
        >
            <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">{icon} {title}</span>
            <ChevronIcon open={isOpen} />
        </button>
        {isOpen && (
            <div className="px-4 pb-4 pt-3 space-y-5">
                {children}
            </div>
        )}
    </div>
);

const ControlCard: React.FC<{ eyebrow?: string; title: string; children: React.ReactNode }> = ({ eyebrow,title,children }) => (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        {eyebrow && <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>}
        <div className="mt-1 text-sm font-bold text-slate-700">{title}</div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {children}
        </div>
    </div>
);

const TextControl: React.FC<{ label: string; value?: string; onChange: (value: string) => void; placeholder?: string }> = ({ label,value,onChange,placeholder }) => {
    const showColorPicker = shouldShowColorPicker(label,value);
    const parsedColor = parseColorValue(value || '#ffffff');
    const handleColorChange = (hex: string) => {
        onChange(parsedColor.alpha < 1 ? toRgbaString(hex,parsedColor.alpha) : hex);
    };

    return (
        <label className="block rounded-xl border border-slate-100 bg-white p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
            {showColorPicker && (
                <div className="mt-2 flex items-center gap-2">
                    <input
                        type="color"
                        value={parsedColor.hex}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="h-9 w-10 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-transparent p-0.5"
                        aria-label={`${label} 色板`}
                    />
                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar">
                        {COLOR_SWATCHES.map((swatch) => (
                            <button
                                key={swatch}
                                type="button"
                                onClick={(event) => {
                                    event.preventDefault();
                                    handleColorChange(swatch);
                                }}
                                className={`h-7 w-7 shrink-0 rounded-full border transition-transform active:scale-90 ${parsedColor.hex.toLowerCase() === swatch ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-white shadow-sm ring-1 ring-slate-200'}`}
                                style={{ backgroundColor: swatch }}
                                aria-label={`${label} 使用 ${swatch}`}
                            />
                        ))}
                    </div>
                </div>
            )}
            <input
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="mt-2 w-full rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-600 outline-none transition-colors focus:border-primary/40 focus:bg-white"
            />
        </label>
    );
};

const RangeControl: React.FC<{ label: string; value?: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }> = ({ label,value,min,max,step = 1,suffix = 'px',onChange }) => {
    const safeValue = typeof value === 'number' ? value : min;
    return (
        <label className="block rounded-xl border border-slate-100 bg-white p-3">
            <span className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span>{label}</span>
                <span className="font-mono text-slate-500">{safeValue}{suffix}</span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={safeValue}
                onChange={(e) => onChange(Number(e.target.value))}
                className="mt-3 w-full accent-primary"
            />
        </label>
    );
};

const ToggleControl: React.FC<{ label: string; checked?: boolean; onChange: (checked: boolean) => void }> = ({ label,checked,onChange }) => (
    <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 text-left"
    >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </span>
    </button>
);

const SelectControl: React.FC<{ label: string; value?: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }> = ({ label,value,options,onChange }) => (
    <label className="block rounded-xl border border-slate-100 bg-white p-3">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <select
            value={value || options[0]?.value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-600 outline-none transition-colors focus:border-primary/40 focus:bg-white"
        >
            {options.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
            ))}
        </select>
    </label>
);

const ThemeMaker: React.FC = () => {
    const { closeApp, addCustomTheme, addToast, characters, activeCharacterId, customThemes, updateCharacter } = useOS();
    const [editingTheme, setEditingTheme] = useState<ChatTheme>(() => createThemeMakerDraft());
    const [editorPage, setEditorPage] = useState<ThemeMakerEditorPage>('messages');
    const [activeTab, setActiveTab] = useState<'user' | 'ai' | 'css'>('user');
    const [toolSection, setToolSection] = useState<'base' | 'sticker' | 'avatar'>('base');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [sharePanel, setSharePanel] = useState<'none' | 'export' | 'import'>('none');
    const [importText, setImportText] = useState('');
    const [lastUsableCss, setLastUsableCss] = useState('');

    // Local state for sliders
    const [paddingVal, setPaddingVal] = useState(12);

    // Collapsible panel state — 'colors' open by default
    const [openPanels, setOpenPanels] = useState<Set<string>>(new Set(['colors']));

    const fileInputRef = useRef<HTMLInputElement>(null);
    const decorationInputRef = useRef<HTMLInputElement>(null);
    const avatarDecoInputRef = useRef<HTMLInputElement>(null);
    const exportTextareaRef = useRef<HTMLTextAreaElement>(null);
    const importFileInputRef = useRef<HTMLInputElement>(null);

    const hydratedEditingTheme = useMemo(() => migrateChatThemeToV2(editingTheme), [editingTheme]);
    const generatedSurfaceCss = useMemo(() => buildThemeSurfacesCss(hydratedEditingTheme), [hydratedEditingTheme]);
    const exportTheme = useMemo<ChatTheme>(() => syncRuntimeThemeFlags({
        ...hydratedEditingTheme,
        generatedCss: generatedSurfaceCss,
    }), [generatedSurfaceCss,hydratedEditingTheme]);
    const activeStyle = hydratedEditingTheme[activeTab === 'css' ? 'user' : activeTab];
    const surfaces = hydratedEditingTheme.surfaces || {};
    const themeJson = useMemo(() => JSON.stringify(exportTheme, null, 2), [exportTheme]);
    const cssAnalysis = useMemo(() => analyzeCustomCss(editingTheme.customCss || ''), [editingTheme.customCss]);
    const cssLineCount = (editingTheme.customCss || '').split('\n').length;
    const cssControlsBubbleShell = useMemo(() => customCssTargetsBubbleShell(editingTheme.customCss), [editingTheme.customCss]);
    const canRestoreLastUsableCss = cssAnalysis.errors.length > 0 && (editingTheme.customCss || '') !== lastUsableCss;

    // Edit mode: load existing theme from sessionStorage if set by Chat.tsx
    useEffect(() => {
        const editId = window.sessionStorage.getItem('themeMakerEditId');
        if (editId) {
            window.sessionStorage.removeItem('themeMakerEditId');
            const existingTheme = customThemes.find(t => t.id === editId);
            if (existingTheme) {
                const hydratedTheme = migrateChatThemeToV2(existingTheme);
                setEditingTheme(hydratedTheme);
                if (existingTheme.customCss) {
                    setPaddingVal(extractPaddingFromCss(existingTheme.customCss));
                }
                addToast('正在编辑: ' + existingTheme.name, 'success');
                return; // Skip default padding init
            }
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Initialize padding state from CSS on load
    useEffect(() => {
        if (editingTheme.customCss) {
            setPaddingVal(extractPaddingFromCss(editingTheme.customCss));
        }
    }, []);

    useEffect(() => {
        if (cssAnalysis.errors.length === 0) {
            setLastUsableCss(editingTheme.customCss || '');
        }
    }, [cssAnalysis.errors.length, editingTheme.customCss]);

    const togglePanel = (id: string) => {
        setOpenPanels(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const updateStyle = (key: keyof BubbleStyle, value: any) => {
        if (activeTab === 'css') return;
        setEditingTheme(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab as 'user' | 'ai'],
                [key]: value
            }
        }));
    };

    const updateContainerSurface = (updates: Partial<NonNullable<ChatThemeSurfaces['container']>>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    container: {
                        ...(hydrated.surfaces?.container || {}),
                        ...updates,
                    },
                },
            };
        });
    };

    const updateMessageListSurface = (updates: Partial<NonNullable<ChatThemeSurfaces['messageList']>>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    messageList: {
                        ...(hydrated.surfaces?.messageList || {}),
                        ...updates,
                    },
                },
            };
        });
    };

    const updateHeaderSurface = <K extends keyof NonNullable<ChatThemeSurfaces['header']>>(section: K, updates: Partial<NonNullable<NonNullable<ChatThemeSurfaces['header']>[K]>>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            const header = hydrated.surfaces?.header || {};
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    header: {
                        ...header,
                        [section]: {
                            ...((header[section] as Record<string, unknown> | undefined) || {}),
                            ...updates,
                        },
                    },
                },
            };
        });
    };

    const updateInputSurface = <K extends keyof NonNullable<ChatThemeSurfaces['input']>>(section: K, updates: Partial<NonNullable<NonNullable<ChatThemeSurfaces['input']>[K]>>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            const inputSurface = hydrated.surfaces?.input || {};
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    input: {
                        ...inputSurface,
                        [section]: {
                            ...((inputSurface[section] as Record<string, unknown> | undefined) || {}),
                            ...updates,
                        },
                    },
                },
            };
        });
    };

    const updateOverlaySurface = <K extends keyof NonNullable<ChatThemeSurfaces['overlays']>>(section: K, updates: Partial<NonNullable<NonNullable<ChatThemeSurfaces['overlays']>[K]>>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            const overlays = hydrated.surfaces?.overlays || {};
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    overlays: {
                        ...overlays,
                        [section]: {
                            ...((overlays[section] as Record<string, unknown> | undefined) || {}),
                            ...updates,
                        },
                    },
                },
            };
        });
    };

    const updateSurface = (section: keyof ChatThemeSurfaces, updates: Record<string, unknown>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    [section]: {
                        ...((hydrated.surfaces?.[section] as Record<string, unknown> | undefined) || {}),
                        ...updates,
                    },
                },
            };
        });
    };

    const updateRoleSurface = (section: 'voice', role: 'user' | 'ai', updates: Record<string, unknown>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            const roleSurface = hydrated.surfaces?.[section] || {};
            return {
                ...hydrated,
                surfaces: {
                    ...hydrated.surfaces,
                    [section]: {
                        ...roleSurface,
                        [role]: {
                            ...((roleSurface[role] as Record<string, unknown> | undefined) || {}),
                            ...updates,
                        },
                    },
                },
            };
        });
    };

    const updateTokens = (updates: Partial<ChatThemeTokens>) => {
        setEditingTheme(prev => {
            const hydrated = migrateChatThemeToV2(prev);
            const nextSurfaces = { ...(hydrated.surfaces || {}) };
            let nextUser = hydrated.user;

            if (updates.pageBackground) {
                nextSurfaces.container = {
                    ...(nextSurfaces.container || {}),
                    background: updates.pageBackground,
                };
            }
            if (updates.accent) {
                nextUser = {
                    ...nextUser,
                    backgroundColor: updates.accent,
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    sendButton: {
                        ...(nextSurfaces.input?.sendButton || {}),
                        background: updates.accent,
                    },
                };
                nextSurfaces.transferCard = {
                    ...(nextSurfaces.transferCard || {}),
                    background: updates.accent,
                };
            }
            if (updates.accentText) {
                nextUser = {
                    ...nextUser,
                    textColor: updates.accentText,
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    sendButton: {
                        ...(nextSurfaces.input?.sendButton || {}),
                        color: updates.accentText,
                    },
                };
            }
            if (updates.surface) {
                nextSurfaces.header = {
                    ...(nextSurfaces.header || {}),
                    shell: {
                        ...(nextSurfaces.header?.shell || {}),
                        background: updates.surface,
                    },
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    shell: {
                        ...(nextSurfaces.input?.shell || {}),
                        background: updates.surface,
                    },
                };
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    background: updates.surface,
                };
            }
            if (updates.text) {
                nextSurfaces.header = {
                    ...(nextSurfaces.header || {}),
                    title: {
                        ...(nextSurfaces.header?.title || {}),
                        color: updates.text,
                    },
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    textBox: {
                        ...(nextSurfaces.input?.textBox || {}),
                        color: updates.text,
                    },
                };
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    color: updates.text,
                };
            }
            if (updates.mutedText) {
                nextSurfaces.header = {
                    ...(nextSurfaces.header || {}),
                    subtitle: {
                        ...(nextSurfaces.header?.subtitle || {}),
                        color: updates.mutedText,
                    },
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    textBox: {
                        ...(nextSurfaces.input?.textBox || {}),
                        mutedColor: updates.mutedText,
                    },
                };
                nextSurfaces.timestamp = {
                    ...(nextSurfaces.timestamp || {}),
                    color: updates.mutedText,
                };
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    mutedColor: updates.mutedText,
                };
            }
            if (updates.border) {
                nextSurfaces.header = {
                    ...(nextSurfaces.header || {}),
                    shell: {
                        ...(nextSurfaces.header?.shell || {}),
                        borderColor: updates.border,
                    },
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    shell: {
                        ...(nextSurfaces.input?.shell || {}),
                        borderColor: updates.border,
                    },
                    panels: {
                        ...(nextSurfaces.input?.panels || {}),
                        borderColor: updates.border,
                    },
                };
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    borderColor: updates.border,
                };
            }
            if (typeof updates.radius === 'number') {
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    radius: updates.radius,
                };
                nextSurfaces.transferCard = {
                    ...(nextSurfaces.transferCard || {}),
                    radius: updates.radius,
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    textBox: {
                        ...(nextSurfaces.input?.textBox || {}),
                        radius: updates.radius,
                    },
                };
            }
            if (updates.shadow) {
                nextSurfaces.header = {
                    ...(nextSurfaces.header || {}),
                    shell: {
                        ...(nextSurfaces.header?.shell || {}),
                        shadow: updates.shadow,
                    },
                };
                nextSurfaces.input = {
                    ...(nextSurfaces.input || {}),
                    shell: {
                        ...(nextSurfaces.input?.shell || {}),
                        shadow: updates.shadow,
                    },
                };
                nextSurfaces.card = {
                    ...(nextSurfaces.card || {}),
                    shadow: updates.shadow,
                };
            }

            return {
                ...hydrated,
                user: nextUser,
                tokens: {
                    ...(hydrated.tokens || {}),
                    ...updates,
                },
                surfaces: nextSurfaces,
            };
        });
    };

    const updateColorWithAlpha = (newHex: string, newAlpha: number) => {
        const val = newAlpha === 1 ? newHex : toRgbaString(newHex, newAlpha);
        updateStyle('backgroundColor', val);
    };

    const updatePadding = (val: number) => {
        setPaddingVal(val);
        const newCss = injectPaddingCss(editingTheme.customCss || '', val);
        setEditingTheme(prev => ({ ...prev, customCss: newCss }));
    };

    const handleImageUpload = async (file: File, type: 'bg' | 'deco' | 'avatarDeco') => {
        try {
            const result = await processImage(file);
            if (type === 'bg') updateStyle('backgroundImage', result);
            else if (type === 'deco') updateStyle('decoration', result);
            else if (type === 'avatarDeco') updateStyle('avatarDecoration', result);
            addToast('图片上传成功', 'success');
        } catch (e: any) {
            addToast(e.message, 'error');
        }
    };

    const saveTheme = async () => {
        if (!editingTheme.name.trim()) return;
        if (cssAnalysis.errors.length > 0) {
            addToast('CSS 语法未通过，先修一下再保存', 'error');
            return;
        }
        const char = characters.find(c => c.id === activeCharacterId);
        const currentCustomTheme = customThemes.find(t => t.id === char?.bubbleStyle);
        const inheritedBaseId = currentCustomTheme?.baseThemeId || char?.bubbleStyle || 'default';
        const baseThemeId = inheritedBaseId === editingTheme.id ? (editingTheme.baseThemeId || 'default') : inheritedBaseId;
        const migratedTheme = migrateChatThemeToV2({
            ...editingTheme,
            name: editingTheme.name.trim(),
            type: 'custom',
            baseThemeId,
        });
        const themeToSave: ChatTheme = syncRuntimeThemeFlags({
            ...migratedTheme,
            generatedCss: buildThemeSurfacesCss(migratedTheme),
        });
        await addCustomTheme(themeToSave);
        if (char) {
            updateCharacter(char.id, { bubbleStyle: themeToSave.id });
            addToast('已保存并应用到当前角色', 'success');
        } else {
            addToast('已保存到主题库', 'success');
        }
        closeApp();
    };

    const restoreLastUsableCss = () => {
        if ((editingTheme.customCss || '') === lastUsableCss) {
            addToast('当前已是上次可用 CSS', 'success');
            return;
        }
        setEditingTheme(prev => ({ ...prev, customCss: lastUsableCss }));
        addToast('已恢复到上次语法通过的 CSS', 'success');
    };

    const copyCssText = async (text: string,successMessage: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly','true');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            addToast(successMessage, 'success');
        } catch {
            addToast('复制失败，请手动长按复制', 'error');
        }
    };

    const copyCssSelector = async (selector: string) => {
        await copyCssText(selector,`已复制 ${selector}`);
    };

    const copyCssSelectorList = async (selectors: readonly string[],label: string) => {
        await copyCssText(selectors.join('\n'),`已复制${label}`);
    };

    const copyAllCssSelectors = async () => {
        await copyCssSelectorList(CSS_SELECTOR_REFERENCE.map(item => item.selector),'全部类名');
    };

    const resetTheme = () => {
        setEditingTheme(prev => ({
            ...createThemeMakerDraft(prev.id),
            name: prev.name, // preserve user-given name
        }));
        setPaddingVal(12);
        addToast('已重置为默认样式', 'success');
    };

    const copyThemeJson = async () => {
        const selectTextarea = (textarea: HTMLTextAreaElement) => {
            focusPreventScroll(textarea);
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
        };

        const copyWithSelection = () => {
            const textarea = exportTextareaRef.current ?? document.createElement('textarea');
            const shouldRemove = !exportTextareaRef.current;
            if (shouldRemove) {
                textarea.value = themeJson;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.top = '0';
                textarea.style.left = '0';
                textarea.style.width = '1px';
                textarea.style.height = '1px';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
            }

            selectTextarea(textarea);
            const copied = document.execCommand('copy');
            if (shouldRemove) textarea.remove();
            return copied;
        };

        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(themeJson);
            addToast('主题 JSON 已复制到剪贴板', 'success');
        } catch {
            if (copyWithSelection()) {
                addToast('主题 JSON 已复制到剪贴板', 'success');
            } else if (exportTextareaRef.current) {
                selectTextarea(exportTextareaRef.current);
                addToast('已选中 JSON，请按 Ctrl+C 复制', 'success');
            } else {
                addToast('复制失败，请手动复制面板中的 JSON', 'error');
            }
        }
    };

    const downloadThemeJson = () => {
        const blob = new Blob([themeJson], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = safeThemeFileName(editingTheme.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        addToast('主题 JSON 已下载', 'success');
    };

    const applyImportedTheme = (text: string) => {
        try {
            const parsed = parseImportedChatTheme(text, editingTheme.id);
            setEditingTheme(parsed);
            setPaddingVal(parsed.customCss ? extractPaddingFromCss(parsed.customCss) : 12);
            setImportText(text);
            setSharePanel('none');
            addToast(`已导入: ${parsed.name}`, 'success');
        } catch {
            addToast('主题 JSON 无法解析', 'error');
        }
    };

    const importThemeFile = async (file: File) => {
        try {
            const text = await file.text();
            applyImportedTheme(text);
        } catch {
            addToast('主题文件读取失败', 'error');
        } finally {
            if (importFileInputRef.current) importFileInputRef.current.value = '';
        }
    };

    const selectEditorPage = (page: ThemeMakerEditorPage) => {
        setEditorPage(page);
        if (page === 'advanced') {
            setActiveTab('css');
        } else if (page === 'messages' && activeTab === 'css') {
            setActiveTab('user');
        }
    };

    // Active character info for real avatars in preview
    const activeChar = characters.find(c => c.id === activeCharacterId);

    // --- Preview Helpers ---

    /** Wraps preview content in a row with avatar (same layout as Chat.tsx) */
    const renderPreviewRow = (role: 'user' | 'ai', content: React.ReactNode) => {
        const style = role === 'user' ? editingTheme.user : editingTheme.ai;
        const isUser = role === 'user';
        const isActive = activeTab === role || activeTab === 'css';

        return (
            <div
                className={`relative w-full flex items-end transition-all duration-300 cursor-pointer ${isActive ? 'opacity-100 scale-100' : 'opacity-60 scale-95 grayscale-[0.5] hover:opacity-80'
                    } ${isUser ? 'justify-end' : 'justify-start'}`}
                onClick={() => setActiveTab(role)}
                title={`点击编辑${isUser ? '用户' : '角色'}气泡`}
            >
                {/* Avatar */}
                <div className={`absolute bottom-0 ${isUser ? 'right-0' : 'left-0'} w-10 h-10 pb-1 z-10`}>
                    <div className="w-full h-full rounded-full bg-slate-300 overflow-hidden relative z-0 shadow-sm border border-white/50">
                        {isUser ? (
                            <div className="absolute inset-0 flex items-center justify-center text-white/50 font-bold text-[10px]">ME</div>
                        ) : activeChar?.avatar ? (
                            <img src={activeChar.avatar} className="w-full h-full object-cover" alt="" />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-white/50 font-bold text-[10px]">AI</div>
                        )}
                    </div>
                    {style.avatarDecoration && (
                        <img
                            src={style.avatarDecoration}
                            className="absolute pointer-events-none z-10 max-w-none"
                            style={{
                                left: `${style.avatarDecorationX ?? 50}%`,
                                top: `${style.avatarDecorationY ?? 50}%`,
                                width: `${40 * (style.avatarDecorationScale ?? 1)}px`,
                                height: 'auto',
                                transform: `translate(-50%, -50%) rotate(${style.avatarDecorationRotate ?? 0}deg)`,
                            }}
                        />
                    )}
                </div>

                {/* Content */}
                <div className={`relative group max-w-[75%] ${isUser ? 'mr-14' : 'ml-14'}`}>
                    {content}
                </div>
            </div>
        );
    };

    /** Text bubble preview (with decoration sticker, bg image, gradient support) */
    const renderTextPreview = (role: 'user' | 'ai', text: string) => {
        const style = role === 'user' ? editingTheme.user : editingTheme.ai;
        return renderPreviewRow(role, (
            <ChatBubble
                isUser={role === 'user'}
                styleConfig={style}
                displayContent={text}
                allowCssOverride={cssControlsBubbleShell}
            />
        ));
    };

    const renderImagePreview = (role: 'user' | 'ai') => renderPreviewRow(role, (
        <img
            src={PREVIEW_CHAT_COPY.imageSrc}
            className="sully-image-msg max-w-[180px] max-h-[220px] rounded-2xl shadow-sm border border-black/5 object-cover"
            alt={PREVIEW_CHAT_COPY.imageAlt}
        />
    ));

    /** Voice bubble preview */
    const renderVoicePreview = (role: 'user' | 'ai', duration: number) => {
        const style = role === 'user' ? editingTheme.user : editingTheme.ai;
        return renderPreviewRow(role, (
            <VoiceBubble
                duration={duration}
                isPlaying={false}
                isLoading={false}
                isUser={role === 'user'}
                onPlay={() => {}}
                onStop={() => {}}
                styleConfig={style}
            />
        ));
    };

    /** Transfer card preview */
    const renderTransferPreview = (role: 'user' | 'ai', message = role === 'user' ? MOCK_TRANSFER_USER : MOCK_TRANSFER_AI) => {
        const isUser = role === 'user';
        return renderPreviewRow(role, (
            <DefaultTransferCard
                message={message}
                isUser={isUser}
                charName="角色"
                selectionMode={false}
            />
        ));
    };

    const renderTimestampPreview = () => (
        <div className="sully-msg-timestamp flex justify-center w-full py-1">
            <span className="text-[11px] text-gray-400">{PREVIEW_CHAT_COPY.timestamp}</span>
        </div>
    );

    const renderSystemPillPreview = () => (
        <div className="flex justify-center w-full">
            <div className="sully-system-pill flex items-center gap-1.5 bg-slate-200/40 backdrop-blur-md text-slate-500 px-3 py-1 rounded-full shadow-sm border border-white/20 select-none">
                <span className="text-[10px] font-medium tracking-wide">系统提示预览：记忆已归档</span>
            </div>
        </div>
    );

    const renderInteractionPreview = () => (
        <div className="flex justify-center w-full">
            <div className="sully-interaction-pill text-[11px] text-slate-500 bg-slate-200/50 backdrop-blur-sm px-4 py-1.5 rounded-full flex items-center gap-1.5 border border-white/40 shadow-sm select-none">
                <span>👉</span>
                <span className="font-medium opacity-80">你</span>
                <span className="opacity-60">戳了戳</span>
                <span className="font-medium opacity-80">{activeChar?.name || '角色'}</span>
            </div>
        </div>
    );

    const renderTypingPreview = () => renderPreviewRow('ai', (
        <div className="sully-typing-bubble bg-white px-3 py-2 rounded-lg shadow-sm relative">
            {!editingTheme.ai.hideTail && (
                <svg className="sully-typing-tail absolute top-[12px] -left-[5.5px] w-[6px] h-[10px] pointer-events-none" style={{ fill: '#ffffff' }}><polygon points="6,0 0,5 6,10" /></svg>
            )}
            <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75" />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150" />
            </div>
        </div>
    ));

    const renderCardContainerPreview = (title: string, subtitle: string, accent = 'text-indigo-500') => (
        <div className="sully-card-container w-64 rounded-2xl overflow-hidden shadow-sm border border-slate-100 bg-white">
            <div className="px-4 pt-3 pb-2 border-b border-slate-100">
                <div className={`text-xs font-bold ${accent}`}>{title}</div>
            </div>
            <div className="px-4 py-3 space-y-1">
                <div className="h-2 rounded-full bg-slate-100" />
                <div className="h-2 w-4/5 rounded-full bg-slate-100" />
                <div className="pt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</div>
            </div>
        </div>
    );

    const renderSpecialCardGalleryPreview = () => (
        <div className="w-full space-y-4">
            {CARD_GALLERY_PAGES.map((page) => (
                <div key={page.id} className="grid w-full gap-3">
                    <div className="w-64 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-black tracking-[0.18em] text-slate-400 shadow-sm backdrop-blur-md">
                        {page.label}
                    </div>
                    {page.id === 'core' && (
                        <>
                            <div className="sully-card-container sully-forward-card w-64 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                                <div className="text-[11px] font-black text-indigo-500">聊天记录转发</div>
                                <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                                    <div>你：今晚的风很轻。</div>
                                    <div>角色：所以适合把没说完的话说完。</div>
                                </div>
                            </div>
                            <div className="sully-card-container sully-canva-card w-64 overflow-hidden rounded-2xl border border-cyan-100 bg-white shadow-sm">
                                <div className="h-20 bg-gradient-to-br from-cyan-300 via-sky-300 to-fuchsia-300" />
                                <div className="px-4 py-3">
                                    <div className="text-[11px] font-black text-cyan-600">Canva 设计</div>
                                    <div className="mt-1 text-[12px] font-semibold text-slate-700">午后海报草稿</div>
                                </div>
                            </div>
                            <div className="sully-card-container sully-song-share-card w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                                <div className="flex gap-3 px-3 py-3">
                                    <div className="h-11 w-11 rounded-lg bg-slate-200" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] font-bold text-slate-800">Theme Song</div>
                                        <div className="mt-1 truncate text-[10px] text-slate-400">Emo Cloud</div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {page.id === 'social' && (
                        <>
                            <div className="sully-card-container sully-xhs-card w-64 overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm">
                                <div className="flex h-20 items-center justify-center bg-gradient-to-r from-red-400 to-pink-500 text-xs font-bold text-white/80">小红书笔记</div>
                                <div className="px-4 py-3 text-[12px] font-semibold text-slate-700">操场边的风和迟到的月亮</div>
                            </div>
                            <div className="sully-card-container sully-social-card w-64 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                                <div className="h-20 bg-pink-100 px-3 py-2 text-3xl">Spark</div>
                                <div className="px-4 py-3 text-[12px] leading-relaxed text-slate-600">一条来自角色的社交动态分享。</div>
                            </div>
                            <div className="sully-card-container sully-wechat-moments-card w-64 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                                <div className="text-[13px] font-bold text-[#576b95]">朋友圈</div>
                                <div className="mt-2 text-[12px] leading-relaxed text-neutral-900">刚刚路过那家便利店，灯还是旧的。</div>
                                <div className="mt-2 text-[10px] text-slate-400">刚刚 · 学校门口</div>
                            </div>
                            <div className="sully-card-container sully-collection-forward-card w-64 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 shadow-sm">
                                <div className="text-[10px] font-black tracking-[0.18em] text-rose-500">AFTERGLOW</div>
                                <div className="mt-3 text-[16px] font-black text-rose-900">典藏馆转递</div>
                            </div>
                        </>
                    )}

                    {page.id === 'phone' && (
                        <>
                            <div className="sully-card-container sully-phone-card sully-phone-wechat-card w-64 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
                                <div className="bg-emerald-600 px-3 py-2 text-[11px] font-black text-white">手机证据 · 微信</div>
                                <div className="px-3 py-3 text-[12px] text-slate-600">“晚点回你。”</div>
                            </div>
                            <div className="sully-card-container sully-phone-card sully-phone-meituan-card w-64 overflow-hidden rounded-2xl border border-yellow-100 bg-white shadow-sm">
                                <div className="bg-yellow-300 px-3 py-2 text-[11px] font-black text-neutral-900">手机证据 · 外卖订单</div>
                                <div className="px-3 py-3 text-[12px] font-semibold text-slate-600">奶茶、薯条、深夜小票都能被统一染色。</div>
                            </div>
                            <div className="sully-card-container sully-phone-card sully-phone-taobao-card w-64 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
                                <div className="px-3 py-2 text-[11px] font-black text-orange-500">淘宝订单</div>
                                <div className="px-3 pb-3 text-[12px] text-slate-600">给你买的小东西还在路上。</div>
                            </div>
                            <div className="sully-card-container sully-phone-card sully-phone-netease-card w-64 overflow-hidden rounded-2xl border border-red-950/10 bg-neutral-950 px-4 py-3 text-white shadow-sm">
                                <div className="text-[10px] font-black text-red-300">网易云音乐</div>
                                <div className="mt-2 text-[13px] font-bold">最近常听</div>
                            </div>
                        </>
                    )}

                    {page.id === 'room' && (
                        <>
                            <div className="sully-card-container sully-room-note-body w-64 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 shadow-sm">
                                <div className="text-[10px] font-black text-violet-400">房间便签</div>
                                <div className="mt-1 text-[13px] leading-relaxed text-violet-900/75">私密记事本、今日计划、家具互动会跟随卡片页预览。</div>
                            </div>
                            <div className="sully-card-container sully-room-plan-body w-64 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 shadow-sm">
                                <div className="text-[10px] font-black text-amber-600">今日计划</div>
                                <div className="mt-2 text-[12px] leading-relaxed text-amber-900">买牛奶 / 整理书桌 / 留一张便利贴</div>
                            </div>
                            <div className="sully-card-container sully-furniture-interaction-body w-64 rounded-2xl border border-pink-100 bg-pink-50 px-4 py-3 shadow-sm">
                                <div className="text-[10px] font-black text-pink-500">家具互动</div>
                                <div className="mt-2 text-[12px] leading-relaxed text-pink-900/80">书桌上多了一枚没送出去的徽章。</div>
                            </div>
                            <div className="sully-card-container sully-story-phone-card w-64 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white shadow-sm">
                                <div className="text-[10px] font-black text-slate-400">剧情手机</div>
                                <div className="mt-2 text-[12px] leading-relaxed text-slate-100">锁屏里藏着一条未读线索。</div>
                            </div>
                        </>
                    )}

                    {page.id === 'hotnews' && (
                        <>
                            <div className="sully-card-container sully-news-card sully-news-card-bilibili w-64 overflow-hidden rounded-2xl border border-pink-200 bg-white shadow-sm">
                                <div className="sully-news-card-header flex items-center justify-between bg-pink-50 px-3 py-2">
                                    <span className="sully-news-card-badge text-[10px] font-black text-pink-600">BILIBILI 视频热榜</span>
                                    <span className="sully-news-card-rank rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-pink-500">#3</span>
                                </div>
                                <div className="px-3 py-2">
                                    <div className="sully-news-card-title text-[14px] font-black text-slate-950">晚风里的旧录像忽然上榜</div>
                                    <div className="sully-news-card-desc mt-1 text-[11px] leading-snug text-slate-500">视频热榜卡片会跟随通用卡片外壳，也保留平台子类。</div>
                                </div>
                                <div className="sully-news-card-footer flex justify-between border-t border-pink-100 px-3 py-2 text-[10px] font-bold text-slate-400">
                                    <span>角色转给你看</span>
                                    <span className="sully-news-card-action text-pink-500">打开视频</span>
                                </div>
                            </div>
                            <div className="sully-card-container sully-news-card sully-news-card-weibo w-64 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
                                <div className="sully-news-card-header flex items-center justify-between bg-orange-500 px-3 py-2 text-white">
                                    <span className="sully-news-card-badge text-[10px] font-black">微博热搜</span>
                                    <span className="sully-news-card-rank rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-orange-500">#12</span>
                                </div>
                                <div className="px-3 py-2">
                                    <div className="sully-news-card-title text-[14px] font-black text-stone-950">操场灯泡坏了一半</div>
                                    <div className="sully-news-card-desc mt-1 text-[11px] leading-snug text-stone-500">微博、知乎、百度、抖音都有独立平台类名。</div>
                                </div>
                            </div>
                            <div className="sully-card-container sully-news-card sully-news-card-zhihu w-64 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
                                <div className="sully-news-card-header bg-blue-600 px-3 py-2 text-[10px] font-black tracking-[0.2em] text-white">知乎热榜</div>
                                <div className="px-3 py-2">
                                    <div className="sully-news-card-title text-[14px] font-black text-slate-950">为什么有些对话会被记很久？</div>
                                    <div className="sully-news-card-desc mt-1 text-[11px] leading-snug text-slate-500">标题、描述、底部、动作按钮都能单独写 CSS。</div>
                                </div>
                            </div>
                            <div className="grid w-64 grid-cols-2 gap-2">
                                {[
                                    ['sully-news-card-baidu', '百度热榜', '百', 'bg-blue-700 text-white'],
                                    ['sully-news-card-douyin', '抖音热榜', '抖', 'bg-neutral-950 text-white'],
                                    ['sully-news-card-default', '默认热点', '热', 'bg-slate-900 text-white'],
                                ].map(([className, label, mark, tone]) => (
                                    <div key={className} className={`sully-card-container sully-news-card ${className} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}>
                                        <div className={`sully-news-card-header px-2 py-1.5 text-[10px] font-black ${tone}`}>{mark}</div>
                                        <div className="px-2 py-2">
                                            <div className="sully-news-card-badge text-[9px] font-black text-slate-400">{label}</div>
                                            <div className="sully-news-card-title mt-1 text-[11px] font-black leading-snug text-slate-900">平台卡缩略预览</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {page.id === 'newspaper' && (
                        <>
                            <div className="sully-newspaper-preview-shell w-64 overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-100/70 p-2 shadow-sm">
                                <div className="h-[430px] w-[246px] overflow-hidden">
                                    <div className="origin-top-left scale-[0.68]">
                                        <NewspaperCard
                                            report={MOCK_NEWSPAPER_REPORT}
                                            charName={activeChar?.name || '角色'}
                                            userName="你"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="w-64 space-y-2">
                                <YesterdayNewspaperDeliveryNotice
                                    record={MOCK_NEWSPAPER_READY_RECORD}
                                    onOpen={() => {}}
                                    onRetry={() => {}}
                                />
                                <YesterdayNewspaperDeliveryNotice
                                    record={MOCK_NEWSPAPER_FAILED_RECORD}
                                    onOpen={() => {}}
                                    onRetry={() => {}}
                                />
                            </div>
                            <div className="sully-theme-overlay-backdrop sully-newspaper-delivery-modal relative grid h-40 w-64 place-items-center overflow-hidden rounded-2xl bg-black/35 p-4 shadow-inner backdrop-blur-md">
                                <div className="sully-card-container sully-newspaper-delivery yn-delivery yn-delivery--generating pointer-events-none scale-[0.74]" data-status={MOCK_NEWSPAPER_GENERATING_RECORD.status} role="status">
                                    <div className="sully-newspaper-delivery-mark yn-delivery__mark" aria-hidden="true">
                                        <span className="yn-delivery__dot" />
                                    </div>
                                    <div className="yn-delivery__text">
                                        <p className="yn-delivery__title">投递员正在送来信</p>
                                        <p className="yn-delivery__body">小报生成中的遮罩状态也在这里预览。</p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            ))}
        </div>
    );

    const renderImageStatePreview = (state: 'loading' | 'failed') => renderPreviewRow('ai', (
        <div className="sully-image-msg-shell flex h-[180px] w-[150px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-black/5 bg-black/5 px-4 text-center shadow-sm">
            {state === 'loading' ? (
                <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
            ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-500">!</div>
            )}
            <div className="text-xs font-medium text-slate-500">{state === 'loading' ? '发送图片中...' : '图片发送失败'}</div>
        </div>
    ));

    const renderInputPanelPreview = () => (
        <div className="space-y-3">
            <div className="sully-chat-input-suggestion-panel rounded-2xl border border-white/50 bg-white/85 px-3 py-2.5 shadow-2xl backdrop-blur-xl">
                <div className="flex gap-2.5 overflow-hidden">
                    {['表情 A', '表情 B', '表情 C'].map((label) => (
                        <div key={label} className="sully-chat-input-suggestion-item flex shrink-0 flex-col items-center gap-1 text-[10px] font-bold text-slate-500">
                            <div className="sully-chat-input-panel-item h-12 w-12 rounded-xl border border-slate-100 bg-white shadow-sm" />
                            {label}
                        </div>
                    ))}
                </div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-md">
                <div className="sully-chat-input-main flex items-center gap-2">
                    <div className="sully-chat-input-icon-button h-10 w-10 rounded-full bg-slate-100" />
                    <div className="sully-chat-input-textbox h-10 flex-1 rounded-[24px] bg-slate-100 px-4 py-2.5 text-[15px] text-slate-400">
                        <span className="sully-chat-input-placeholder">Message...</span>
                    </div>
                    <div className="sully-chat-input-send-button h-10 w-10 rounded-full bg-primary" />
                </div>
            </div>
            <div className="sully-chat-input-panel rounded-2xl border border-slate-200/60 bg-slate-50 p-3">
                <div className="mb-3 flex gap-2 overflow-hidden">
                    {['默认', '表情', '更多', '录音'].map((label) => (
                        <span key={label} className="sully-chat-input-panel-tab rounded-full bg-white px-3 py-1 text-[10px] font-bold text-slate-500 shadow-sm">{label}</span>
                    ))}
                </div>
                <div className="grid grid-cols-4 gap-3">
                    {['转账', '戳一戳', '相册', '主题曲'].map((label) => (
                        <div key={label} className="sully-chat-input-panel-action flex flex-col items-center gap-1 text-[10px] font-bold text-slate-500">
                            <div className="sully-chat-input-panel-item sully-chat-input-panel-action-icon h-11 w-11 rounded-2xl border border-slate-100 bg-white shadow-sm" />
                            {label}
                        </div>
                    ))}
                </div>
            </div>
            <div className="sully-recording-overlay relative h-36 overflow-hidden rounded-2xl bg-black/60 p-4 shadow-inner">
                <div className="sully-recording-bubble mx-auto mt-5 max-w-[220px] rounded-3xl border border-white/10 bg-black/70 px-6 py-4 text-center text-white shadow-2xl backdrop-blur-xl">
                    <div className="sully-recording-cancel-label mb-2 text-[11px] font-bold text-white/60">↑ 上滑取消</div>
                    <div className="mx-auto h-8 w-32 rounded-full bg-white/15" />
                    <div className="sully-recording-duration mt-2 font-mono text-sm font-bold">0:06</div>
                </div>
            </div>
            <div className="sully-chat-selection-bar rounded-2xl bg-white/50 p-3 shadow-sm backdrop-blur-md">
                <div className="flex gap-2">
                    <button className="sully-chat-selection-button sully-chat-selection-forward flex-1 rounded-xl bg-indigo-500 py-3 text-xs font-bold text-white shadow-lg">转发 (2)</button>
                    <button className="sully-chat-selection-button sully-chat-selection-soul flex-1 rounded-xl bg-neutral-900 py-3 text-xs font-bold text-neutral-300">回神</button>
                    <button className="sully-chat-selection-button sully-chat-selection-danger flex-1 rounded-xl bg-red-500 py-3 text-xs font-bold text-white shadow-lg">删除 (2)</button>
                </div>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm backdrop-blur-md">
                <div className="relative flex items-center gap-3 rounded-xl bg-slate-100/70 px-3 py-2">
                    <div className="sully-message-selection-checkbox-wrap relative left-auto top-auto z-0 translate-y-0">
                        <div className="sully-message-selection-checkbox is-selected flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary bg-primary">
                            <svg className="sully-message-selection-check h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </div>
                    </div>
                    <div className="sully-message-avatar sully-message-avatar-ai relative h-9 w-9 shrink-0">
                        {activeChar?.avatar ? <img src={activeChar.avatar} className="sully-message-avatar-image h-full w-full rounded object-cover" alt="" /> : <div className="sully-message-avatar-image h-full w-full rounded bg-slate-200" />}
                        <div className="sully-message-avatar-badge-wrap absolute -right-1.5 -top-1.5 flex gap-0.5">
                            <button className="sully-message-avatar-badge sully-message-avatar-badge-inner-voice flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] text-white shadow-sm">♥</button>
                            <button className="sully-message-avatar-badge sully-message-avatar-badge-surprise flex h-4 w-4 items-center justify-center rounded-full bg-teal-500 text-[10px] font-black text-white shadow-sm">?</button>
                        </div>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-600">消息选择和头像徽标</div>
                        <div className="text-[10px] text-slate-400">选择框、心声、状态、惊喜、手机等入口</div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderOverlayPreview = () => (
        <div className="space-y-3">
            <div className="relative h-72 overflow-hidden rounded-[24px] bg-slate-900/80 p-5 text-white shadow-inner">
                <div className="sully-theme-overlay-backdrop absolute inset-0 bg-black/35 backdrop-blur-sm" />
                <div className="sully-theme-overlay-modal relative z-10 mx-auto mt-6 w-52 rounded-3xl border border-white/20 bg-white/95 p-4 text-center text-slate-700 shadow-2xl">
                    <div className="mx-auto mb-3 h-20 w-20 rounded-2xl bg-slate-200" />
                    <div className="text-sm font-bold">覆盖层预览</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-400">图片预览、音乐确认、导入导出都从这里统一调视觉。</div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <button className="sully-theme-overlay-secondary-button rounded-2xl bg-slate-100 py-2 text-[11px] font-bold text-slate-500">取消</button>
                        <button className="sully-theme-overlay-primary-button rounded-2xl bg-primary py-2 text-[11px] font-bold text-white">确认</button>
                    </div>
                </div>
            </div>
            <div className="sully-image-preview-backdrop relative h-72 overflow-hidden rounded-[24px] bg-black/75 p-4 shadow-inner backdrop-blur-md">
                <img
                    src={PREVIEW_CHAT_COPY.imageSrc}
                    alt={PREVIEW_CHAT_COPY.imageAlt}
                    className="mx-auto h-full max-w-full rounded-2xl object-cover shadow-2xl"
                />
                <div className="absolute right-3 top-3 flex gap-2">
                    <button className="sully-image-preview-action h-9 rounded-full bg-white/15 px-3 text-[11px] font-bold text-white backdrop-blur-md">关闭</button>
                    <button className="sully-image-preview-action h-9 rounded-full bg-white/15 px-3 text-[11px] font-bold text-white backdrop-blur-md">下载</button>
                </div>
                <div className="absolute bottom-3 left-3 right-3 text-center text-[10px] font-bold text-white/70">图片大图预览</div>
            </div>
            <div className="relative h-72 overflow-hidden rounded-[24px] bg-slate-900/75 p-4 shadow-inner">
                <div className="sully-theme-overlay-backdrop sully-inner-voice-backdrop absolute inset-0 bg-black/35 backdrop-blur-sm" />
                <button className="sully-image-preview-action sully-inner-voice-close absolute right-3 top-3 z-20 h-9 w-9 rounded-full bg-white/15 text-white backdrop-blur-md">×</button>
                <div className="sully-inner-voice-shell relative z-10 mx-auto flex h-full max-w-[230px] items-center justify-center">
                    <div className="sully-inner-voice-card w-full rotate-[-1deg] rounded-sm border border-white/70 bg-[#F9F8F4] p-4 text-center shadow-2xl">
                        <div className="mb-3 h-24 rounded bg-[#E8E6DF]" />
                        <div className="sully-inner-voice-title text-[10px] uppercase tracking-[0.35em] text-[#8C8273]">Inner Voice</div>
                        <div className="sully-inner-voice-text mt-3 text-[13px] leading-6 text-[#2A2520]">这里预览经典心声卡片的纸张、文字、关闭按钮。</div>
                        <button className="sully-inner-voice-toggle mt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8C8273]">展开全文</button>
                    </div>
                </div>
            </div>
            <div className="sully-theme-overlay-modal sully-message-action-modal rounded-3xl border border-white/20 bg-white/95 p-4 text-center text-slate-700 shadow-2xl">
                <div className="mb-3 text-sm font-bold">消息操作</div>
                <div className="space-y-2">
                    <button className="sully-message-action-button w-full rounded-2xl bg-slate-50 py-3 text-xs font-bold text-slate-700">引用 / 回复</button>
                    <button className="sully-message-action-button w-full rounded-2xl bg-slate-50 py-3 text-xs font-bold text-slate-700">复制文字</button>
                    <button className="sully-message-action-danger w-full rounded-2xl bg-red-50 py-3 text-xs font-bold text-red-500">删除消息</button>
                </div>
            </div>
            <div className="sully-theme-overlay-modal sully-afterglow-composer-dialog rounded-2xl border border-white/70 bg-[#fffaf2] p-4 shadow-2xl">
                <div className="mb-3 text-[12px] font-bold tracking-[0.18em] text-[#7a4b22]">番外篇命题</div>
                <div className="grid grid-cols-2 gap-2">
                    <button className="sully-afterglow-composer-button sully-theme-overlay-primary-button rounded-xl bg-[#2d2118] py-2 text-[11px] font-bold text-[#ffe4bb]">写番外</button>
                    <button className="sully-afterglow-composer-button sully-theme-overlay-secondary-button rounded-xl border border-[#dbc4a9] bg-white py-2 text-[11px] font-bold text-[#81552f]">谈心</button>
                </div>
                <button className="sully-status-card-collection-button sully-theme-overlay-primary-button mt-3 w-full rounded-xl bg-primary py-2 text-[11px] font-bold text-white">收藏视觉碎片</button>
            </div>
        </div>
    );

    const renderFullPreviewContent = () => (
        <>
            {renderSystemPillPreview()}
            {renderInteractionPreview()}
            {renderTextPreview('user', PREVIEW_CHAT_COPY.userFirst)}
            {renderTextPreview('user', PREVIEW_CHAT_COPY.userSecond)}
            {renderImagePreview('user')}
            {renderTimestampPreview()}
            {renderTextPreview('ai', PREVIEW_CHAT_COPY.aiFirst)}
            {renderTextPreview('ai', PREVIEW_CHAT_COPY.aiSecond)}
            {renderVoicePreview('ai', PREVIEW_CHAT_COPY.aiVoiceSeconds)}
            {renderVoicePreview('user', PREVIEW_CHAT_COPY.userVoiceSeconds)}
            {renderTextPreview('user', PREVIEW_CHAT_COPY.longUser)}
            {renderTextPreview('ai', PREVIEW_CHAT_COPY.longAi)}
            {renderImageStatePreview('loading')}
            {renderImageStatePreview('failed')}
            {renderPreviewRow('user', <img src={PREVIEW_CHAT_COPY.imageSrc} className="sully-emoji-msg max-w-[96px] max-h-[96px] rounded-2xl object-cover drop-shadow-md" alt="" />)}
            {renderTypingPreview()}
            {renderTransferPreview('ai', MOCK_TRANSFER_AI)}
            {renderTransferPreview('user', MOCK_TRANSFER_USER)}
            {renderTransferPreview('ai', MOCK_TRANSFER_ACCEPTED)}
            {renderTransferPreview('user', MOCK_TRANSFER_RETURNED)}
            {renderPreviewRow('ai', renderCardContainerPreview('小红书 / Canva / 转发', '通用卡片会在这里统一预览外壳、文字和边框。'))}
            {renderPreviewRow('ai', renderSpecialCardGalleryPreview())}
            {renderInputPanelPreview()}
            {renderOverlayPreview()}
            {renderTextPreview('user', `${PREVIEW_CHAT_COPY.longUser}\n\n第二行也要安全换行，不允许挤出气泡。`)}
            {renderTextPreview('ai', `${PREVIEW_CHAT_COPY.aiSecond}\n\n如果字号、圆角、边框、底纹都开到极限，仍然要能读。`)}
            {renderImagePreview('ai')}
        </>
    );

    const parsedBgColor = parseColorValue(activeStyle.backgroundColor);

    const previewPhone = (
        <div className="sully-chat-container flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 shadow-2xl">
            {/* Live CSS Injection for Preview — same placement as Chat.tsx */}
            {generatedSurfaceCss && <style>{generatedSurfaceCss}</style>}
            {editingTheme.customCss && <style>{editingTheme.customCss}</style>}

            <div className="sully-chat-header min-h-[4.25rem] bg-white/80 backdrop-blur-xl px-5 flex items-end pb-3 border-b border-slate-200/60 shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-3 w-full">
                    <button className="sully-chat-header-button sully-chat-header-back p-2 -ml-2 text-slate-500 rounded-full" aria-label="返回预览">‹</button>
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                        <div className="sully-chat-header-avatar w-9 h-9 rounded-xl bg-slate-200 overflow-hidden shadow-sm shrink-0">
                            {activeChar?.avatar ? <img src={activeChar.avatar} className="w-full h-full object-cover" alt="" /> : null}
                        </div>
                        <div className="min-w-0">
                            <div className="sully-chat-header-title font-bold text-slate-800 truncate">{activeChar?.name || '角色'}</div>
                            <div className="flex items-center gap-1.5">
                                <div className="sully-chat-header-subtitle text-[10px] text-slate-400 uppercase">Online</div>
                                <div className="sully-chat-header-token rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">128</div>
                            </div>
                        </div>
                    </div>
                    <button className="sully-chat-header-button sully-chat-header-trigger p-2 text-slate-500 rounded-full" aria-label="更多预览">•••</button>
                </div>
            </div>

            <div className="sully-chat-messages flex-1 overflow-y-auto no-scrollbar relative pt-4 pb-4 px-5">
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

                {/* Rich Preview Conversation */}
                <div className="sully-chat-preview-list relative z-10 w-full max-w-sm mx-auto space-y-3">
                    {renderFullPreviewContent()}
                </div>
            </div>

            <div className="sully-chat-input bg-white/90 backdrop-blur-2xl border-t border-slate-200/50 shrink-0 z-20 shadow-[0_-5px_15px_rgba(0,0,0,0.02)]">
                <div className="sully-chat-input-main p-3 px-4 flex gap-3 items-center">
                    <button className="sully-chat-input-icon-button sully-chat-input-plus-button w-10 h-10 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500" aria-label="加号预览">+</button>
                    <div className="sully-chat-input-textbox flex-1 min-w-0 bg-slate-100 rounded-[24px] flex items-center px-4 py-2.5 text-[15px] text-slate-400 border border-transparent">
                        <span className="sully-chat-input-placeholder">Message...</span>
                    </div>
                    <button className="sully-chat-input-send-button w-10 h-10 shrink-0 rounded-full bg-primary text-white flex items-center justify-center" aria-label="发送预览">➤</button>
                </div>
            </div>
        </div>
    );


    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            {/* Header */}
            <div className="bg-white/70 backdrop-blur-md shrink-0 z-20 border-b border-white/40 shadow-sm flex flex-col">
                <div className="sully-safe-topbar h-20 flex items-end pb-3 px-4 justify-between gap-3">
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                            </svg>
                        </button>
                        <h1 className="text-xl font-medium text-slate-700">气泡工坊</h1>
                    </div>
                    {/* Theme Name — always visible regardless of active tab */}
                    <input
                        value={editingTheme.name}
                        onChange={(e) => setEditingTheme(prev => ({ ...prev, name: e.target.value }))}
                        className="flex-1 min-w-0 bg-slate-100/80 border border-slate-200/60 rounded-lg px-2.5 py-1 text-sm text-center focus:border-primary/50 transition-all outline-none placeholder:text-slate-300"
                        placeholder="主题名称"
                    />
                    <button onClick={() => void saveTheme()} className="shrink-0 px-4 py-1.5 bg-primary text-white rounded-full text-xs font-bold shadow-lg shadow-primary/30 active:scale-95 transition-all">
                        保存
                    </button>
                </div>
                {/* Utility row: Reset + Import/Export */}
                <div className="px-4 pb-3 flex gap-2 items-center">
                    <button onClick={resetTheme} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all">↺ 重置</button>
                    <button onClick={() => setSharePanel('export')} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all">↑ 导出</button>
                    <button onClick={() => { setImportText(''); setSharePanel('import'); }} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all">↓ 导入</button>
                </div>
            </div>

            {isPreviewOpen && (
                <div
                    className="fixed inset-0 z-[80] flex items-stretch justify-center bg-slate-950/35 p-3 backdrop-blur-md sm:items-center sm:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label="聊天页面预览"
                >
                    <button
                        type="button"
                        className="absolute inset-0"
                        aria-label="关闭预览遮罩"
                        onClick={() => setIsPreviewOpen(false)}
                    />
                    <div className="relative z-10 flex h-full w-full max-w-[430px] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.35)] sm:h-[82vh]">
                        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/70 bg-white/80 px-4 backdrop-blur-xl">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Live Preview</div>
                                <div className="text-xs font-bold text-slate-700">聊天页面预览</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsPreviewOpen(false)}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 active:scale-95"
                                aria-label="关闭聊天预览"
                                title="关闭预览"
                            >
                                <X className="h-4 w-4" weight="bold" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1">
                            {previewPhone}
                        </div>
                    </div>
                </div>
            )}

            {!isPreviewOpen && (
                <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[-0.75rem] z-[70] flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-slate-950/95 text-white opacity-80 shadow-[0_18px_45px_rgba(15,23,42,0.28)] backdrop-blur transition-all hover:-translate-x-3 hover:scale-105 hover:opacity-100 focus-visible:-translate-x-3 focus-visible:opacity-100 active:scale-95"
                    aria-label="打开聊天预览"
                    title="打开聊天预览"
                >
                    <Eye className="h-5 w-5" weight="bold" />
                </button>
            )}

            {/* Editor Controls */}
            <div className="bg-white shadow-[0_-5px_30px_rgba(0,0,0,0.08)] z-30 flex min-h-0 flex-1 flex-col ring-1 ring-slate-100">
                {/* V2 Editor Pages */}
                <div className="px-6 pt-5 pb-2 border-b border-slate-50">
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {THEME_MAKER_EDITOR_PAGES.map((page) => (
                            <button
                                key={page.id}
                                type="button"
                                onClick={() => selectEditorPage(page.id)}
                                title={page.description}
                                className={`shrink-0 rounded-full px-3.5 py-2 text-[11px] font-bold transition-all ${
                                    editorPage === page.id
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'bg-slate-50 text-slate-400 border border-slate-100'
                                }`}
                            >
                                {page.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Message role tabs & mirror copy */}
                {editorPage === 'messages' && (
                <div className="flex items-center justify-between px-8 pt-4 pb-2 border-b border-slate-50">
                    <div className="flex gap-6 overflow-x-auto no-scrollbar">
                        <button onClick={() => setActiveTab('user')} className={`text-sm font-bold transition-colors whitespace-nowrap ${activeTab === 'user' ? 'text-slate-800' : 'text-slate-300'}`}>用户气泡</button>
                        <button onClick={() => setActiveTab('ai')} className={`text-sm font-bold transition-colors whitespace-nowrap ${activeTab === 'ai' ? 'text-slate-800' : 'text-slate-300'}`}>角色气泡</button>
                    </div>
                    {/* Mirror Copy Button */}
                    <button
                        onClick={() => {
                            const sourceTab = activeTab === 'css' ? 'user' : activeTab;
                            const targetTab = sourceTab === 'user' ? 'ai' : 'user';
                            const sourceStyle = editingTheme[sourceTab];
                            setEditingTheme(prev => ({
                                ...prev,
                                [targetTab]: {
                                    ...prev[targetTab],
                                    backgroundColor: sourceStyle.backgroundColor,
                                    gradient: sourceStyle.gradient ? { ...sourceStyle.gradient } : undefined,
                                    textColor: sourceStyle.textColor,
                                    borderRadius: sourceStyle.borderRadius,
                                    opacity: sourceStyle.opacity,
                                    borderWidth: sourceStyle.borderWidth,
                                    borderColor: sourceStyle.borderColor,
                                    hideTail: sourceStyle.hideTail,
                                    boxShadow: sourceStyle.boxShadow,
                                    fontSize: sourceStyle.fontSize,
                                    textShadow: sourceStyle.textShadow,
                                    backgroundImage: sourceStyle.backgroundImage,
                                    backgroundImageOpacity: sourceStyle.backgroundImageOpacity
                                }
                            }));
                            addToast(`已将基础样式复制给${targetTab === 'user' ? '用户' : '角色'}`, 'success');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
                        title={`将当前样式复制到${activeTab === 'user' ? '角色气泡' : '用户气泡'}（不含贴纸）`}
                    >
                        ⇄ 同步给对方
                    </button>
                </div>
                )}

                {/* Conditional Sub-Tool Tabs */}
                {editorPage === 'messages' && activeTab !== 'css' && (
                    <div className="flex px-6 border-b border-slate-100 mb-2 overflow-x-auto no-scrollbar">
                        <button onClick={() => setToolSection('base')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'base' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>基础样式</button>
                        <button onClick={() => setToolSection('sticker')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'sticker' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>气泡贴纸</button>
                        <button onClick={() => setToolSection('avatar')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'avatar' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>头像挂件</button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar pb-20">

                    {editorPage === 'overview' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow="TOKENS" title="全局色彩">
                                <TextControl label="强调色" value={hydratedEditingTheme.tokens?.accent} onChange={(accent) => updateTokens({ accent })} />
                                <TextControl label="强调文字" value={hydratedEditingTheme.tokens?.accentText} onChange={(accentText) => updateTokens({ accentText })} />
                                <TextControl label="页面背景" value={hydratedEditingTheme.tokens?.pageBackground} onChange={(pageBackground) => updateTokens({ pageBackground })} />
                                <TextControl label="表面颜色" value={hydratedEditingTheme.tokens?.surface} onChange={(surface) => updateTokens({ surface })} />
                                <TextControl label="主文字" value={hydratedEditingTheme.tokens?.text} onChange={(text) => updateTokens({ text })} />
                                <TextControl label="次文字" value={hydratedEditingTheme.tokens?.mutedText} onChange={(mutedText) => updateTokens({ mutedText })} />
                                <TextControl label="边框色" value={hydratedEditingTheme.tokens?.border} onChange={(border) => updateTokens({ border })} />
                            </ControlCard>

                            <ControlCard eyebrow="SYSTEM" title="全局形态">
                                <RangeControl label="默认圆角" value={hydratedEditingTheme.tokens?.radius} min={0} max={36} onChange={(radius) => updateTokens({ radius })} />
                                <TextControl label="默认阴影" value={hydratedEditingTheme.tokens?.shadow} onChange={(shadow) => updateTokens({ shadow })} />
                                <SelectControl
                                    label="动效强度"
                                    value={hydratedEditingTheme.tokens?.motionScale}
                                    options={[
                                        { value: 'off', label: '关闭' },
                                        { value: 'lite', label: '轻微' },
                                        { value: 'normal', label: '标准' },
                                    ]}
                                    onChange={(motionScale) => updateTokens({ motionScale: motionScale as ChatThemeTokens['motionScale'] })}
                                />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'page' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-chat-container" title="整页画布">
                                <TextControl label="背景" value={surfaces.container?.background} onChange={(background) => updateContainerSurface({ background })} placeholder="#f1f5f9 / rgba(...) / gradient" />
                                <TextControl label="阴影" value={surfaces.container?.shadow} onChange={(shadow) => updateContainerSurface({ shadow })} placeholder="0 20px 60px rgba(...)" />
                                <RangeControl label="圆角" value={surfaces.container?.radius} min={0} max={36} onChange={(radius) => updateContainerSurface({ radius })} />
                                <RangeControl label="透明度" value={surfaces.container?.opacity ?? 1} min={0.2} max={1} step={0.05} suffix="" onChange={(opacity) => updateContainerSurface({ opacity })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-messages" title="消息列表">
                                <RangeControl label="左右留白" value={surfaces.messageList?.paddingX} min={8} max={40} onChange={(paddingX) => updateMessageListSurface({ paddingX })} />
                                <RangeControl label="上下留白" value={surfaces.messageList?.paddingY} min={8} max={56} onChange={(paddingY) => updateMessageListSurface({ paddingY })} />
                                <RangeControl label="消息间距" value={surfaces.messageList?.gap} min={4} max={28} onChange={(gap) => updateMessageListSurface({ gap })} />
                                <SelectControl
                                    label="密度"
                                    value={surfaces.messageList?.density}
                                    options={[
                                        { value: 'compact', label: '紧凑' },
                                        { value: 'normal', label: '标准' },
                                        { value: 'spacious', label: '舒展' },
                                    ]}
                                    onChange={(density) => updateMessageListSurface({ density: density as NonNullable<ChatThemeSurfaces['messageList']>['density'] })}
                                />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'header' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-chat-header" title="顶部栏外壳">
                                <TextControl label="背景" value={surfaces.header?.shell?.background} onChange={(background) => updateHeaderSurface('shell', { background })} placeholder="rgba(255,255,255,.8)" />
                                <TextControl label="边框色" value={surfaces.header?.shell?.borderColor} onChange={(borderColor) => updateHeaderSurface('shell', { borderColor })} placeholder="rgba(...)" />
                                <RangeControl label="边框宽度" value={surfaces.header?.shell?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateHeaderSurface('shell', { borderWidth })} />
                                <RangeControl label="毛玻璃" value={surfaces.header?.shell?.blur} min={0} max={36} onChange={(blur) => updateHeaderSurface('shell', { blur })} />
                                <RangeControl label="高度" value={surfaces.header?.shell?.height} min={64} max={132} onChange={(height) => updateHeaderSurface('shell', { height })} />
                                <RangeControl label="左右留白" value={surfaces.header?.shell?.paddingX} min={12} max={36} onChange={(paddingX) => updateHeaderSurface('shell', { paddingX })} />
                                <RangeControl label="上下留白" value={surfaces.header?.shell?.paddingY} min={8} max={28} onChange={(paddingY) => updateHeaderSurface('shell', { paddingY })} />
                                <TextControl label="阴影" value={surfaces.header?.shell?.shadow} onChange={(shadow) => updateHeaderSurface('shell', { shadow })} placeholder="0 1px 2px rgba(...)" />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-header-avatar" title="头像">
                                <RangeControl label="尺寸" value={surfaces.header?.avatar?.width} min={28} max={64} onChange={(size) => updateHeaderSurface('avatar', { width: size, height: size })} />
                                <RangeControl label="圆角" value={surfaces.header?.avatar?.radius} min={0} max={28} onChange={(radius) => updateHeaderSurface('avatar', { radius })} />
                                <TextControl label="阴影" value={surfaces.header?.avatar?.shadow} onChange={(shadow) => updateHeaderSurface('avatar', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-header-title" title="标题文字">
                                <TextControl label="标题颜色" value={surfaces.header?.title?.color} onChange={(color) => updateHeaderSurface('title', { color })} />
                                <RangeControl label="标题字号" value={surfaces.header?.title?.fontSize} min={12} max={22} onChange={(fontSize) => updateHeaderSurface('title', { fontSize })} />
                                <RangeControl label="标题字重" value={surfaces.header?.title?.fontWeight} min={400} max={900} step={100} suffix="" onChange={(fontWeight) => updateHeaderSurface('title', { fontWeight })} />
                                <ToggleControl label="显示副标题" checked={surfaces.header?.subtitle?.visible ?? true} onChange={(visible) => updateHeaderSurface('subtitle', { visible })} />
                                <TextControl label="副标题颜色" value={surfaces.header?.subtitle?.color} onChange={(color) => updateHeaderSurface('subtitle', { color })} />
                                <RangeControl label="副标题字号" value={surfaces.header?.subtitle?.fontSize} min={8} max={14} onChange={(fontSize) => updateHeaderSurface('subtitle', { fontSize })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-header-button" title="顶部按钮">
                                <TextControl label="背景" value={surfaces.header?.buttons?.background} onChange={(background) => updateHeaderSurface('buttons', { background })} />
                                <TextControl label="图标颜色" value={surfaces.header?.buttons?.color} onChange={(color) => updateHeaderSurface('buttons', { color })} />
                                <RangeControl label="尺寸" value={surfaces.header?.buttons?.width} min={28} max={52} onChange={(size) => updateHeaderSurface('buttons', { width: size, height: size })} />
                                <RangeControl label="圆角" value={surfaces.header?.buttons?.radius} min={0} max={999} onChange={(radius) => updateHeaderSurface('buttons', { radius })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'input' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-chat-input" title="底部输入栏外壳">
                                <TextControl label="背景" value={surfaces.input?.shell?.background} onChange={(background) => updateInputSurface('shell', { background })} />
                                <TextControl label="边框色" value={surfaces.input?.shell?.borderColor} onChange={(borderColor) => updateInputSurface('shell', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.input?.shell?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateInputSurface('shell', { borderWidth })} />
                                <RangeControl label="毛玻璃" value={surfaces.input?.shell?.blur} min={0} max={36} onChange={(blur) => updateInputSurface('shell', { blur })} />
                                <RangeControl label="左右留白" value={surfaces.input?.shell?.paddingX} min={8} max={32} onChange={(paddingX) => updateInputSurface('shell', { paddingX })} />
                                <RangeControl label="上下留白" value={surfaces.input?.shell?.paddingY} min={6} max={24} onChange={(paddingY) => updateInputSurface('shell', { paddingY })} />
                                <RangeControl label="控件间距" value={surfaces.input?.shell?.gap} min={4} max={24} onChange={(gap) => updateInputSurface('shell', { gap })} />
                                <TextControl label="阴影" value={surfaces.input?.shell?.shadow} onChange={(shadow) => updateInputSurface('shell', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-textbox" title="输入框">
                                <TextControl label="背景" value={surfaces.input?.textBox?.background} onChange={(background) => updateInputSurface('textBox', { background })} />
                                <TextControl label="文字颜色" value={surfaces.input?.textBox?.color} onChange={(color) => updateInputSurface('textBox', { color })} />
                                <TextControl label="占位颜色" value={surfaces.input?.textBox?.mutedColor} onChange={(mutedColor) => updateInputSurface('textBox', { mutedColor })} />
                                <RangeControl label="圆角" value={surfaces.input?.textBox?.radius} min={0} max={36} onChange={(radius) => updateInputSurface('textBox', { radius })} />
                                <RangeControl label="字号" value={surfaces.input?.textBox?.fontSize} min={12} max={20} onChange={(fontSize) => updateInputSurface('textBox', { fontSize })} />
                                <RangeControl label="左右内边距" value={surfaces.input?.textBox?.paddingX} min={8} max={28} onChange={(paddingX) => updateInputSurface('textBox', { paddingX })} />
                                <RangeControl label="上下内边距" value={surfaces.input?.textBox?.paddingY} min={6} max={20} onChange={(paddingY) => updateInputSurface('textBox', { paddingY })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-icon-button / .sully-chat-input-send-button" title="输入栏按钮">
                                <TextControl label="左按钮背景" value={surfaces.input?.iconButton?.background} onChange={(background) => updateInputSurface('iconButton', { background })} />
                                <TextControl label="左按钮颜色" value={surfaces.input?.iconButton?.color} onChange={(color) => updateInputSurface('iconButton', { color })} />
                                <RangeControl label="左按钮尺寸" value={surfaces.input?.iconButton?.width} min={32} max={56} onChange={(size) => updateInputSurface('iconButton', { width: size, height: size })} />
                                <RangeControl label="左按钮圆角" value={surfaces.input?.iconButton?.radius} min={0} max={999} onChange={(radius) => updateInputSurface('iconButton', { radius })} />
                                <TextControl label="发送背景" value={surfaces.input?.sendButton?.background} onChange={(background) => updateInputSurface('sendButton', { background })} />
                                <TextControl label="发送颜色" value={surfaces.input?.sendButton?.color} onChange={(color) => updateInputSurface('sendButton', { color })} />
                                <RangeControl label="发送尺寸" value={surfaces.input?.sendButton?.width} min={32} max={56} onChange={(size) => updateInputSurface('sendButton', { width: size, height: size })} />
                                <RangeControl label="发送圆角" value={surfaces.input?.sendButton?.radius} min={0} max={999} onChange={(radius) => updateInputSurface('sendButton', { radius })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-panel" title="展开面板">
                                <TextControl label="背景" value={surfaces.input?.panels?.background} onChange={(background) => updateInputSurface('panels', { background })} />
                                <TextControl label="边框色" value={surfaces.input?.panels?.borderColor} onChange={(borderColor) => updateInputSurface('panels', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.input?.panels?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateInputSurface('panels', { borderWidth })} />
                                <RangeControl label="面板高度" value={surfaces.input?.panels?.height} min={160} max={420} onChange={(height) => updateInputSurface('panels', { height })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-suggestion-panel" title="表情联想浮层">
                                <TextControl label="背景" value={surfaces.input?.suggestionPanel?.background} onChange={(background) => updateInputSurface('suggestionPanel', { background })} />
                                <TextControl label="文字颜色" value={surfaces.input?.suggestionPanel?.color} onChange={(color) => updateInputSurface('suggestionPanel', { color })} />
                                <TextControl label="边框色" value={surfaces.input?.suggestionPanel?.borderColor} onChange={(borderColor) => updateInputSurface('suggestionPanel', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.input?.suggestionPanel?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateInputSurface('suggestionPanel', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.input?.suggestionPanel?.radius} min={0} max={28} onChange={(radius) => updateInputSurface('suggestionPanel', { radius })} />
                                <RangeControl label="毛玻璃" value={surfaces.input?.suggestionPanel?.blur} min={0} max={32} onChange={(blur) => updateInputSurface('suggestionPanel', { blur })} />
                                <TextControl label="阴影" value={surfaces.input?.suggestionPanel?.shadow} onChange={(shadow) => updateInputSurface('suggestionPanel', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-panel-tab" title="面板分类标签">
                                <TextControl label="背景" value={surfaces.input?.panelTabs?.background} onChange={(background) => updateInputSurface('panelTabs', { background })} />
                                <TextControl label="文字颜色" value={surfaces.input?.panelTabs?.color} onChange={(color) => updateInputSurface('panelTabs', { color })} />
                                <RangeControl label="圆角" value={surfaces.input?.panelTabs?.radius} min={0} max={999} onChange={(radius) => updateInputSurface('panelTabs', { radius })} />
                                <RangeControl label="字号" value={surfaces.input?.panelTabs?.fontSize} min={8} max={15} onChange={(fontSize) => updateInputSurface('panelTabs', { fontSize })} />
                                <RangeControl label="左右内边距" value={surfaces.input?.panelTabs?.paddingX} min={4} max={20} onChange={(paddingX) => updateInputSurface('panelTabs', { paddingX })} />
                                <RangeControl label="上下内边距" value={surfaces.input?.panelTabs?.paddingY} min={2} max={12} onChange={(paddingY) => updateInputSurface('panelTabs', { paddingY })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-input-panel-item" title="表情/动作格子">
                                <TextControl label="背景" value={surfaces.input?.panelItem?.background} onChange={(background) => updateInputSurface('panelItem', { background })} />
                                <TextControl label="文字颜色" value={surfaces.input?.panelItem?.color} onChange={(color) => updateInputSurface('panelItem', { color })} />
                                <TextControl label="边框色" value={surfaces.input?.panelItem?.borderColor} onChange={(borderColor) => updateInputSurface('panelItem', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.input?.panelItem?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateInputSurface('panelItem', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.input?.panelItem?.radius} min={0} max={28} onChange={(radius) => updateInputSurface('panelItem', { radius })} />
                                <RangeControl label="字号" value={surfaces.input?.panelItem?.fontSize} min={8} max={16} onChange={(fontSize) => updateInputSurface('panelItem', { fontSize })} />
                                <TextControl label="阴影" value={surfaces.input?.panelItem?.shadow} onChange={(shadow) => updateInputSurface('panelItem', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-recording-overlay / .sully-recording-bubble" title="录音覆盖层">
                                <TextControl label="遮罩背景" value={surfaces.input?.recordingOverlay?.background} onChange={(background) => updateInputSurface('recordingOverlay', { background })} />
                                <TextControl label="文字颜色" value={surfaces.input?.recordingOverlay?.color} onChange={(color) => updateInputSurface('recordingOverlay', { color })} />
                                <TextControl label="边框色" value={surfaces.input?.recordingOverlay?.borderColor} onChange={(borderColor) => updateInputSurface('recordingOverlay', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.input?.recordingOverlay?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateInputSurface('recordingOverlay', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.input?.recordingOverlay?.radius} min={0} max={36} onChange={(radius) => updateInputSurface('recordingOverlay', { radius })} />
                                <RangeControl label="毛玻璃" value={surfaces.input?.recordingOverlay?.blur} min={0} max={32} onChange={(blur) => updateInputSurface('recordingOverlay', { blur })} />
                                <RangeControl label="字号" value={surfaces.input?.recordingOverlay?.fontSize} min={10} max={18} onChange={(fontSize) => updateInputSurface('recordingOverlay', { fontSize })} />
                                <RangeControl label="最大宽度" value={surfaces.input?.recordingOverlay?.maxWidth} min={180} max={360} onChange={(maxWidth) => updateInputSurface('recordingOverlay', { maxWidth })} />
                                <TextControl label="阴影" value={surfaces.input?.recordingOverlay?.shadow} onChange={(shadow) => updateInputSurface('recordingOverlay', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-selection-bar" title="多选模式底栏">
                                <TextControl label="背景" value={surfaces.input?.selectionBar?.background} onChange={(background) => updateInputSurface('selectionBar', { background })} />
                                <RangeControl label="毛玻璃" value={surfaces.input?.selectionBar?.blur} min={0} max={32} onChange={(blur) => updateInputSurface('selectionBar', { blur })} />
                                <RangeControl label="左右留白" value={surfaces.input?.selectionBar?.paddingX} min={6} max={28} onChange={(paddingX) => updateInputSurface('selectionBar', { paddingX })} />
                                <RangeControl label="上下留白" value={surfaces.input?.selectionBar?.paddingY} min={6} max={24} onChange={(paddingY) => updateInputSurface('selectionBar', { paddingY })} />
                                <RangeControl label="按钮间距" value={surfaces.input?.selectionBar?.gap} min={4} max={20} onChange={(gap) => updateInputSurface('selectionBar', { gap })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-chat-selection-button" title="多选操作按钮">
                                <TextControl label="普通背景" value={surfaces.input?.selectionButton?.background} onChange={(background) => updateInputSurface('selectionButton', { background })} />
                                <TextControl label="普通文字" value={surfaces.input?.selectionButton?.color} onChange={(color) => updateInputSurface('selectionButton', { color })} />
                                <RangeControl label="普通圆角" value={surfaces.input?.selectionButton?.radius} min={0} max={28} onChange={(radius) => updateInputSurface('selectionButton', { radius })} />
                                <RangeControl label="普通字号" value={surfaces.input?.selectionButton?.fontSize} min={10} max={18} onChange={(fontSize) => updateInputSurface('selectionButton', { fontSize })} />
                                <TextControl label="普通阴影" value={surfaces.input?.selectionButton?.shadow} onChange={(shadow) => updateInputSurface('selectionButton', { shadow })} />
                                <TextControl label="危险背景" value={surfaces.input?.dangerButton?.background} onChange={(background) => updateInputSurface('dangerButton', { background })} />
                                <TextControl label="危险文字" value={surfaces.input?.dangerButton?.color} onChange={(color) => updateInputSurface('dangerButton', { color })} />
                                <RangeControl label="危险圆角" value={surfaces.input?.dangerButton?.radius} min={0} max={28} onChange={(radius) => updateInputSurface('dangerButton', { radius })} />
                                <TextControl label="危险阴影" value={surfaces.input?.dangerButton?.shadow} onChange={(shadow) => updateInputSurface('dangerButton', { shadow })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'media' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-voice-bubble.sully-bubble-user" title="用户语音条">
                                <TextControl label="背景" value={surfaces.voice?.user?.background} onChange={(background) => updateRoleSurface('voice', 'user', { background })} />
                                <TextControl label="文字颜色" value={surfaces.voice?.user?.color} onChange={(color) => updateRoleSurface('voice', 'user', { color })} />
                                <RangeControl label="圆角" value={surfaces.voice?.user?.radius} min={0} max={36} onChange={(radius) => updateRoleSurface('voice', 'user', { radius })} />
                                <RangeControl label="高度" value={surfaces.voice?.user?.height} min={28} max={58} onChange={(height) => updateRoleSurface('voice', 'user', { height })} />
                                <RangeControl label="字号" value={surfaces.voice?.user?.fontSize} min={10} max={18} onChange={(fontSize) => updateRoleSurface('voice', 'user', { fontSize })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-voice-bubble" title="角色语音条">
                                <TextControl label="背景" value={surfaces.voice?.ai?.background} onChange={(background) => updateRoleSurface('voice', 'ai', { background })} />
                                <TextControl label="文字颜色" value={surfaces.voice?.ai?.color} onChange={(color) => updateRoleSurface('voice', 'ai', { color })} />
                                <RangeControl label="圆角" value={surfaces.voice?.ai?.radius} min={0} max={36} onChange={(radius) => updateRoleSurface('voice', 'ai', { radius })} />
                                <RangeControl label="高度" value={surfaces.voice?.ai?.height} min={28} max={58} onChange={(height) => updateRoleSurface('voice', 'ai', { height })} />
                                <RangeControl label="字号" value={surfaces.voice?.ai?.fontSize} min={10} max={18} onChange={(fontSize) => updateRoleSurface('voice', 'ai', { fontSize })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-image-msg / .sully-image-msg-shell" title="图片消息">
                                <RangeControl label="圆角" value={surfaces.image?.radius} min={0} max={32} onChange={(radius) => updateSurface('image', { radius })} />
                                <TextControl label="边框色" value={surfaces.image?.borderColor} onChange={(borderColor) => updateSurface('image', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.image?.borderWidth} min={0} max={6} onChange={(borderWidth) => updateSurface('image', { borderWidth })} />
                                <RangeControl label="最大宽度" value={surfaces.image?.maxWidth} min={120} max={280} onChange={(maxWidth) => updateSurface('image', { maxWidth })} />
                                <TextControl label="阴影" value={surfaces.image?.shadow} onChange={(shadow) => updateSurface('image', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-emoji-msg" title="表情消息">
                                <RangeControl label="最大宽度" value={surfaces.emoji?.maxWidth} min={72} max={220} onChange={(maxWidth) => updateSurface('emoji', { maxWidth })} />
                                <RangeControl label="圆角" value={surfaces.emoji?.radius} min={0} max={32} onChange={(radius) => updateSurface('emoji', { radius })} />
                                <TextControl label="阴影" value={surfaces.emoji?.shadow} onChange={(shadow) => updateSurface('emoji', { shadow })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'notices' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-msg-timestamp" title="时间戳">
                                <ToggleControl label="显示时间戳" checked={surfaces.timestamp?.visible ?? false} onChange={(visible) => updateSurface('timestamp', { visible })} />
                                <TextControl label="文字颜色" value={surfaces.timestamp?.color} onChange={(color) => updateSurface('timestamp', { color })} />
                                <RangeControl label="字号" value={surfaces.timestamp?.fontSize} min={9} max={16} onChange={(fontSize) => updateSurface('timestamp', { fontSize })} />
                                <RangeControl label="上下留白" value={surfaces.timestamp?.paddingY} min={0} max={18} onChange={(paddingY) => updateSurface('timestamp', { paddingY })} />
                                <RangeControl label="间隔阈值" value={surfaces.timestamp?.intervalMs} min={0} max={600000} step={30000} suffix="ms" onChange={(intervalMs) => updateSurface('timestamp', { intervalMs })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-system-pill" title="系统提示胶囊">
                                <TextControl label="背景" value={surfaces.systemPill?.background} onChange={(background) => updateSurface('systemPill', { background })} />
                                <TextControl label="文字颜色" value={surfaces.systemPill?.color} onChange={(color) => updateSurface('systemPill', { color })} />
                                <TextControl label="边框色" value={surfaces.systemPill?.borderColor} onChange={(borderColor) => updateSurface('systemPill', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.systemPill?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateSurface('systemPill', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.systemPill?.radius} min={0} max={999} onChange={(radius) => updateSurface('systemPill', { radius })} />
                                <RangeControl label="字号" value={surfaces.systemPill?.fontSize} min={8} max={15} onChange={(fontSize) => updateSurface('systemPill', { fontSize })} />
                                <RangeControl label="左右内边距" value={surfaces.systemPill?.paddingX} min={4} max={24} onChange={(paddingX) => updateSurface('systemPill', { paddingX })} />
                                <RangeControl label="上下内边距" value={surfaces.systemPill?.paddingY} min={2} max={14} onChange={(paddingY) => updateSurface('systemPill', { paddingY })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-interaction-pill" title="互动提示胶囊">
                                <TextControl label="背景" value={surfaces.interactionPill?.background} onChange={(background) => updateSurface('interactionPill', { background })} />
                                <TextControl label="文字颜色" value={surfaces.interactionPill?.color} onChange={(color) => updateSurface('interactionPill', { color })} />
                                <TextControl label="边框色" value={surfaces.interactionPill?.borderColor} onChange={(borderColor) => updateSurface('interactionPill', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.interactionPill?.borderWidth} min={0} max={4} onChange={(borderWidth) => updateSurface('interactionPill', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.interactionPill?.radius} min={0} max={999} onChange={(radius) => updateSurface('interactionPill', { radius })} />
                                <RangeControl label="字号" value={surfaces.interactionPill?.fontSize} min={8} max={16} onChange={(fontSize) => updateSurface('interactionPill', { fontSize })} />
                                <RangeControl label="左右内边距" value={surfaces.interactionPill?.paddingX} min={6} max={28} onChange={(paddingX) => updateSurface('interactionPill', { paddingX })} />
                                <RangeControl label="上下内边距" value={surfaces.interactionPill?.paddingY} min={2} max={16} onChange={(paddingY) => updateSurface('interactionPill', { paddingY })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'cards' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-transfer-card" title="转账卡片">
                                <TextControl label="背景" value={surfaces.transferCard?.background} onChange={(background) => updateSurface('transferCard', { background })} />
                                <RangeControl label="圆角" value={surfaces.transferCard?.radius} min={0} max={28} onChange={(radius) => updateSurface('transferCard', { radius })} />
                                <RangeControl label="最大宽度" value={surfaces.transferCard?.maxWidth} min={180} max={300} onChange={(maxWidth) => updateSurface('transferCard', { maxWidth })} />
                                <TextControl label="阴影" value={surfaces.transferCard?.shadow} onChange={(shadow) => updateSurface('transferCard', { shadow })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-card-container" title="通用卡片">
                                <ToggleControl label="跟随卡片品牌色" checked={surfaces.card?.followBrandColor ?? true} onChange={(followBrandColor) => updateSurface('card', { followBrandColor })} />
                                <TextControl label="背景" value={surfaces.card?.background} onChange={(background) => updateSurface('card', { background })} />
                                <TextControl label="主文字" value={surfaces.card?.color} onChange={(color) => updateSurface('card', { color })} />
                                <TextControl label="次文字" value={surfaces.card?.mutedColor} onChange={(mutedColor) => updateSurface('card', { mutedColor })} />
                                <TextControl label="边框色" value={surfaces.card?.borderColor} onChange={(borderColor) => updateSurface('card', { borderColor })} />
                                <RangeControl label="边框宽度" value={surfaces.card?.borderWidth} min={0} max={5} onChange={(borderWidth) => updateSurface('card', { borderWidth })} />
                                <RangeControl label="圆角" value={surfaces.card?.radius} min={0} max={30} onChange={(radius) => updateSurface('card', { radius })} />
                                <RangeControl label="最大宽度" value={surfaces.card?.maxWidth} min={180} max={320} onChange={(maxWidth) => updateSurface('card', { maxWidth })} />
                                <RangeControl label="字号" value={surfaces.card?.fontSize} min={10} max={18} onChange={(fontSize) => updateSurface('card', { fontSize })} />
                                <TextControl label="阴影" value={surfaces.card?.shadow} onChange={(shadow) => updateSurface('card', { shadow })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage === 'overlays' && (
                        <div className="space-y-4 animate-fade-in">
                            <ControlCard eyebrow=".sully-theme-overlay-backdrop / .sully-image-preview-backdrop" title="遮罩">
                                <TextControl label="背景" value={surfaces.overlays?.backdrop?.background} onChange={(background) => updateOverlaySurface('backdrop', { background })} />
                                <RangeControl label="毛玻璃" value={surfaces.overlays?.backdrop?.blur} min={0} max={32} onChange={(blur) => updateOverlaySurface('backdrop', { blur })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-theme-overlay-modal" title="弹窗主体">
                                <TextControl label="背景" value={surfaces.overlays?.modal?.background} onChange={(background) => updateOverlaySurface('modal', { background })} />
                                <RangeControl label="圆角" value={surfaces.overlays?.modal?.radius} min={0} max={36} onChange={(radius) => updateOverlaySurface('modal', { radius })} />
                                <RangeControl label="最大宽度" value={surfaces.overlays?.modal?.maxWidth} min={180} max={360} onChange={(maxWidth) => updateOverlaySurface('modal', { maxWidth })} />
                                <TextControl label="阴影" value={surfaces.overlays?.modal?.shadow} onChange={(shadow) => updateOverlaySurface('modal', { shadow })} />
                                <RangeControl label="左右留白" value={surfaces.overlays?.modal?.paddingX} min={8} max={32} onChange={(paddingX) => updateOverlaySurface('modal', { paddingX })} />
                                <RangeControl label="上下留白" value={surfaces.overlays?.modal?.paddingY} min={8} max={32} onChange={(paddingY) => updateOverlaySurface('modal', { paddingY })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-theme-overlay-primary-button" title="主按钮">
                                <TextControl label="背景" value={surfaces.overlays?.primaryButton?.background} onChange={(background) => updateOverlaySurface('primaryButton', { background })} />
                                <TextControl label="文字颜色" value={surfaces.overlays?.primaryButton?.color} onChange={(color) => updateOverlaySurface('primaryButton', { color })} />
                                <RangeControl label="圆角" value={surfaces.overlays?.primaryButton?.radius} min={0} max={28} onChange={(radius) => updateOverlaySurface('primaryButton', { radius })} />
                                <RangeControl label="字号" value={surfaces.overlays?.primaryButton?.fontSize} min={10} max={18} onChange={(fontSize) => updateOverlaySurface('primaryButton', { fontSize })} />
                            </ControlCard>

                            <ControlCard eyebrow=".sully-theme-overlay-secondary-button" title="次按钮">
                                <TextControl label="背景" value={surfaces.overlays?.secondaryButton?.background} onChange={(background) => updateOverlaySurface('secondaryButton', { background })} />
                                <TextControl label="文字颜色" value={surfaces.overlays?.secondaryButton?.color} onChange={(color) => updateOverlaySurface('secondaryButton', { color })} />
                                <RangeControl label="圆角" value={surfaces.overlays?.secondaryButton?.radius} min={0} max={28} onChange={(radius) => updateOverlaySurface('secondaryButton', { radius })} />
                                <RangeControl label="字号" value={surfaces.overlays?.secondaryButton?.fontSize} min={10} max={18} onChange={(fontSize) => updateOverlaySurface('secondaryButton', { fontSize })} />
                            </ControlCard>
                        </div>
                    )}

                    {editorPage !== 'overview' && editorPage !== 'messages' && editorPage !== 'advanced' && editorPage !== 'page' && editorPage !== 'header' && editorPage !== 'input' && editorPage !== 'media' && editorPage !== 'notices' && editorPage !== 'cards' && editorPage !== 'overlays' && (
                        <div className="animate-fade-in rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">V2 PAGE SLOT</div>
                            <h2 className="mt-2 text-lg font-bold text-slate-700">
                                {THEME_MAKER_EDITOR_PAGES.find(page => page.id === editorPage)?.label}
                            </h2>
                            <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                {THEME_MAKER_EDITOR_PAGES.find(page => page.id === editorPage)?.description}
                            </p>
                            <div className="mt-4 rounded-2xl bg-white p-4 text-[11px] leading-relaxed text-slate-500 shadow-sm">
                                这一页的分页入口已经接好，下一阶段会把规划中的结构化控件挂到这里。你可以先用上方预览分页查看对应区域的预览状态。
                            </div>
                        </div>
                    )}

                    {/* --- CSS EDITOR --- */}
                    {editorPage === 'advanced' && (
                        <div className="animate-fade-in flex h-full min-h-0 flex-col gap-4">
                            <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">CSS Studio</div>
                                        <h2 className="mt-1 text-lg font-black text-slate-800">高级 CSS 美化</h2>
                                        <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                                            普通面板负责气泡，这里集中处理顶部栏、底部输入栏、展开面板、弹窗和各种消息卡片。
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void copyAllCssSelectors()}
                                            className="rounded-full bg-slate-900 px-3 py-2 text-[11px] font-black text-white shadow-sm active:scale-95 transition-transform"
                                        >
                                            复制全部类名
                                        </button>
                                        {canRestoreLastUsableCss && (
                                            <button
                                                type="button"
                                                onClick={restoreLastUsableCss}
                                                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black text-slate-600 active:scale-95 transition-transform"
                                            >
                                                恢复上次通过
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="text-[10px] font-bold text-slate-400">语法</div>
                                        <div className={`mt-0.5 text-sm font-black ${cssAnalysis.errors.length === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {cssAnalysis.errors.length === 0 ? '通过' : `${cssAnalysis.errors.length} 错误`}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="text-[10px] font-bold text-slate-400">提示</div>
                                        <div className="mt-0.5 text-sm font-black text-amber-600">{cssAnalysis.warnings.length} 条</div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="text-[10px] font-bold text-slate-400">覆盖</div>
                                        <div className="mt-0.5 text-sm font-black text-slate-700">{cssAnalysis.importantCount} 处</div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="text-[10px] font-bold text-slate-400">行数</div>
                                        <div className="mt-0.5 text-sm font-black text-slate-700">{cssLineCount}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                                <section className="flex min-h-[360px] flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-inner">
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Custom CSS</div>
                                            <div className="mt-0.5 text-xs font-bold text-slate-200">直接写入聊天皮肤</div>
                                        </div>
                                        <div className="flex max-w-full gap-2 overflow-x-auto no-scrollbar">
                                            {CSS_EXAMPLES.map((ex, i) => (
                                                <button
                                                    type="button"
                                                    key={i}
                                                    onClick={() => setEditingTheme(prev => ({ ...prev, customCss: ex.code }))}
                                                    className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-slate-200 active:scale-95 transition-transform"
                                                >
                                                    {ex.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <textarea
                                        value={editingTheme.customCss || ''}
                                        onChange={(e) => setEditingTheme(prev => ({ ...prev, customCss: e.target.value }))}
                                        placeholder={'/* 例：\n.sully-chat-header {\n  background: rgba(255,255,255,.86) !important;\n}\n\n.sully-chat-input {\n  min-height: 72px !important;\n}\n*/'}
                                        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-4 font-mono text-[12px] leading-6 text-slate-100 outline-none placeholder:text-slate-500"
                                        spellCheck={false}
                                    />
                                </section>

                                <aside className="min-h-0 overflow-y-auto no-scrollbar rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                                    <div className="sticky top-0 z-10 -mx-3 -mt-3 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-3 py-3 backdrop-blur">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Selectors</div>
                                            <div className="text-xs font-black text-slate-700">类名分组复制</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void copyAllCssSelectors()}
                                            className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-600 active:scale-95 transition-transform"
                                        >
                                            全部复制
                                        </button>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        {CSS_SELECTOR_GROUPS.map((group, groupIndex) => (
                                            <details
                                                key={group.title}
                                                open={groupIndex < 3}
                                                className="group rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-500"
                                            >
                                                <summary className="flex cursor-pointer list-none items-center gap-2 outline-none">
                                                    <span className="min-w-0 flex-1 font-black text-slate-700">{group.title}</span>
                                                    <span className="rounded-full bg-white px-2 py-0.5 font-bold text-slate-400">{group.selectors.length} 个</span>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            void copyCssSelectorList(group.selectors, `「${group.title}」类名`);
                                                        }}
                                                        className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-500 active:scale-95 transition-transform"
                                                        aria-label={`复制${group.title}类名`}
                                                    >
                                                        复制本组
                                                    </button>
                                                </summary>
                                                <div className="mt-3 grid gap-2">
                                                    {group.selectors.map((selector) => {
                                                        const selectorInfo = CSS_SELECTOR_REFERENCE.find((item) => item.selector === selector);
                                                        return (
                                                            <div key={selector} className="rounded-xl border border-white bg-white px-2.5 py-2 shadow-sm">
                                                                <div className="flex items-start gap-2">
                                                                    <code className="min-w-0 flex-1 break-all font-mono text-[10px] font-bold text-indigo-600">{selector}</code>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                            void copyCssSelector(selector);
                                                                        }}
                                                                        className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500 active:scale-95 transition-transform"
                                                                        aria-label={`复制 ${selector}`}
                                                                    >
                                                                        复制
                                                                    </button>
                                                                </div>
                                                                {selectorInfo?.desc && (
                                                                    <span className="mt-1 block leading-relaxed text-slate-500">{selectorInfo.desc}</span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                </aside>
                            </div>

                            {(cssAnalysis.errors.length > 0 || cssAnalysis.warnings.length > 0) && (
                                <div className={`max-h-28 overflow-y-auto no-scrollbar rounded-2xl border px-3 py-2 text-[11px] ${cssAnalysis.errors.length > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                    <div className="mb-1 font-semibold">{cssAnalysis.errors.length > 0 ? 'CSS 错误提示' : '皮肤风险提示'}</div>
                                    <ul className="space-y-1 list-disc pl-4">
                                        {[...cssAnalysis.errors,...cssAnalysis.warnings].map((issue,idx) => (
                                            <li key={`${issue.message}-${idx}`}>{issue.line ? `第 ${issue.line} 行：` : ''}{issue.message}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- BASE STYLE TOOLS (Collapsible Accordion) --- */}
                    {editorPage === 'messages' && activeTab !== 'css' && toolSection === 'base' && (
                        <div className="space-y-3 animate-fade-in">

                            {/* === Section 1: Colors & Background === */}
                            <CollapsibleSection icon="🎨" title="色彩与背板" isOpen={openPanels.has('colors')} onToggle={() => togglePanel('colors')}>
                                {/* Colors */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">文字颜色</label>
                                        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100"><input type="color" value={activeStyle.textColor} onChange={(e) => updateStyle('textColor', e.target.value)} className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent" /></div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">背景色</label>
                                        {/* Gradient Toggle */}
                                        <div className="flex items-center gap-2 mb-2">
                                            <button
                                                onClick={() => {
                                                    if (activeStyle.gradient) {
                                                        updateStyle('gradient', undefined);
                                                    } else {
                                                        updateStyle('gradient', { from: parsedBgColor.hex, to: '#ffffff', direction: 135 });
                                                    }
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${activeStyle.gradient ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}
                                            >
                                                {activeStyle.gradient ? '渐变开' : '渐变关'}
                                            </button>
                                        </div>

                                        {!activeStyle.gradient ? (
                                            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                                                <input
                                                    type="color"
                                                    value={parsedBgColor.hex}
                                                    onChange={(e) => updateColorWithAlpha(e.target.value, parsedBgColor.alpha)}
                                                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent"
                                                />
                                            </div>
                                        ) : (
                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-3">
                                                <div className="flex gap-2">
                                                    <input type="color" value={activeStyle.gradient?.from || '#000000'} onChange={(e) => updateStyle('gradient', { from: e.target.value, to: activeStyle.gradient?.to || '#ffffff', direction: activeStyle.gradient?.direction ?? 135 })} className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent" title="起点颜色" />
                                                    <span className="text-slate-300 self-center">→</span>
                                                    <input type="color" value={activeStyle.gradient?.to || '#ffffff'} onChange={(e) => updateStyle('gradient', { from: activeStyle.gradient?.from || '#000000', to: e.target.value, direction: activeStyle.gradient?.direction ?? 135 })} className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent" title="终点颜色" />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between mb-1"><span className="text-[10px] text-slate-400">方向 (°)</span><span className="text-[10px] text-slate-500 font-mono">{activeStyle.gradient?.direction ?? 135}°</span></div>
                                                    <input type="range" min="0" max="360" step="5" value={activeStyle.gradient?.direction ?? 135} onChange={(e) => updateStyle('gradient', { from: activeStyle.gradient?.from || '#000000', to: activeStyle.gradient?.to || '#ffffff', direction: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-500" />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Background Alpha (Transparency) */}
                                <div>
                                    <div className="flex justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">背景透明度</label>
                                        <span className="text-[10px] text-slate-500 font-mono">{Math.round(parsedBgColor.alpha * 100)}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="1" step="0.05"
                                        value={parsedBgColor.alpha}
                                        onChange={(e) => updateColorWithAlpha(parsedBgColor.hex, parseFloat(e.target.value))}
                                        className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary"
                                    />
                                </div>

                                {/* Background Image */}
                                <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 overflow-hidden hover:border-primary/50 hover:text-primary transition-all">
                                    {activeStyle.backgroundImage ? (
                                        <>
                                            <img src={activeStyle.backgroundImage} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                                            <span className="relative z-10 text-[10px] bg-white/80 px-2 py-1 rounded shadow-sm font-bold">更换底纹</span>
                                        </>
                                    ) : <span className="text-xs font-bold">+ 上传底纹图片</span>}
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'bg')} />
                                    {activeStyle.backgroundImage && <button onClick={(e) => { e.stopPropagation(); updateStyle('backgroundImage', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full z-20">移除</button>}
                                </div>

                                {/* Background Image Opacity */}
                                {activeStyle.backgroundImage && (
                                    <div>
                                        <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase">底纹透明度</label><span className="text-[10px] text-slate-500 font-mono">{Math.round((activeStyle.backgroundImageOpacity ?? 0.5) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={activeStyle.backgroundImageOpacity ?? 0.5} onChange={(e) => updateStyle('backgroundImageOpacity', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                                    </div>
                                )}
                            </CollapsibleSection>

                            {/* === Section 2: Border & Shadow === */}
                            <CollapsibleSection icon="✨" title="边框与光影" isOpen={openPanels.has('border')} onToggle={() => togglePanel('border')}>
                                {/* Border Radius */}
                                <div>
                                    <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase">圆角大小</label><span className="text-[10px] text-slate-500 font-mono">{activeStyle.borderRadius}px</span></div>
                                    <input type="range" min="0" max="30" value={activeStyle.borderRadius} onChange={(e) => updateStyle('borderRadius', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                                </div>

                                {/* Bubble Tail */}
                                <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase block">气泡尾巴</label>
                                        <span className="text-[10px] text-slate-400">{activeStyle.hideTail ? '隐藏' : '显示'}</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={!activeStyle.hideTail}
                                        onClick={() => updateStyle('hideTail', !activeStyle.hideTail)}
                                        className={`relative w-12 h-6 rounded-full transition-colors active:scale-95 ${activeStyle.hideTail ? 'bg-slate-300' : 'bg-primary'}`}
                                    >
                                        <span
                                            className={`absolute left-0 top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${activeStyle.hideTail ? 'translate-x-1' : 'translate-x-7'}`}
                                        />
                                    </button>
                                </div>

                                {/* Border Width & Color */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">边框</label>
                                        <span className="text-[10px] text-slate-500 font-mono">{activeStyle.borderWidth || 0}px</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input type="range" min="0" max="10" step="1" value={activeStyle.borderWidth || 0} onChange={(e) => updateStyle('borderWidth', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                                        {(activeStyle.borderWidth || 0) > 0 && (
                                            <div className="shrink-0 bg-slate-50 p-1 rounded-lg border border-slate-100">
                                                <input type="color" value={activeStyle.borderColor || '#000000'} onChange={(e) => updateStyle('borderColor', e.target.value)} className="w-6 h-6 rounded border-none cursor-pointer bg-transparent" />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Box Shadow */}
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">投影阴影</label>
                                    <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar pb-1">
                                        <button onClick={() => updateStyle('boxShadow', undefined)} className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] border whitespace-nowrap ${!activeStyle.boxShadow ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>无</button>
                                        <button onClick={() => updateStyle('boxShadow', '0 2px 6px rgba(0,0,0,0.05)')} className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] border whitespace-nowrap ${activeStyle.boxShadow === '0 2px 6px rgba(0,0,0,0.05)' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>柔和</button>
                                        <button onClick={() => updateStyle('boxShadow', '0 4px 12px rgba(0,0,0,0.1)')} className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] border whitespace-nowrap ${activeStyle.boxShadow === '0 4px 12px rgba(0,0,0,0.1)' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>明显</button>
                                        <button onClick={() => updateStyle('boxShadow', '4px 4px 0px rgba(0,0,0,1)')} className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] border whitespace-nowrap ${activeStyle.boxShadow === '4px 4px 0px rgba(0,0,0,1)' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>像素</button>
                                        <button onClick={() => updateStyle('boxShadow', '0 0 10px rgba(99,102,241,0.5)')} className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] border whitespace-nowrap ${activeStyle.boxShadow === '0 0 10px rgba(99,102,241,0.5)' ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>霓虹</button>
                                    </div>
                                    <input
                                        type="text"
                                        value={activeStyle.boxShadow || ''}
                                        onChange={(e) => updateStyle('boxShadow', e.target.value || undefined)}
                                        placeholder="自定义 CSS box-shadow"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-mono focus:border-primary/50 outline-none"
                                    />
                                </div>
                            </CollapsibleSection>

                            {/* === Section 3: Size & Typography === */}
                            <CollapsibleSection icon="📏" title="尺寸与排版" isOpen={openPanels.has('typo')} onToggle={() => togglePanel('typo')}>
                                {/* Padding (Compactness) */}
                                <div>
                                    <div className="flex justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">气泡紧凑度</label>
                                        <span className="text-[10px] text-slate-500 font-mono">{paddingVal <= 6 ? '紧凑' : (paddingVal >= 16 ? '宽松' : '适中')}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400">紧凑</span>
                                        <input
                                            type="range" min="4" max="24" step="1"
                                            value={paddingVal}
                                            onChange={(e) => updatePadding(parseInt(e.target.value))}
                                            className="flex-1 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary"
                                        />
                                        <span className="text-[10px] text-slate-400">宽敞</span>
                                    </div>
                                </div>

                                {/* Font Size */}
                                <div>
                                    <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase">文字大小</label><span className="text-[10px] text-slate-500 font-mono">{activeStyle.fontSize || 15}px</span></div>
                                    <input type="range" min="12" max="22" step="1" value={activeStyle.fontSize || 15} onChange={(e) => updateStyle('fontSize', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                                </div>

                                {/* Text Shadow */}
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">文字阴影</label>
                                        <button
                                            onClick={() => updateStyle('textShadow', activeStyle.textShadow ? undefined : '0 1px 2px rgba(0,0,0,0.3)')}
                                            className={`px-2 py-0.5 rounded text-[8px] font-bold transition-colors ${activeStyle.textShadow ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}
                                        >
                                            {activeStyle.textShadow ? '开' : '关'}
                                        </button>
                                    </div>
                                    {activeStyle.textShadow && (
                                        <input
                                            type="text"
                                            value={activeStyle.textShadow}
                                            onChange={(e) => updateStyle('textShadow', e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-mono focus:border-primary/50 outline-none"
                                        />
                                    )}
                                </div>
                            </CollapsibleSection>

                        </div>
                    )}

                    {/* --- STICKER TOOLS --- */}
                    {editorPage === 'messages' && activeTab !== 'css' && toolSection === 'sticker' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => decorationInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-primary/50 hover:text-primary transition-all">
                                {activeStyle.decoration ? <img src={activeStyle.decoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold">+ 上传气泡角标/贴纸</span>}
                                <input type="file" ref={decorationInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'deco')} />
                                {activeStyle.decoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('decoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full">移除</button>}
                            </div>

                            {activeStyle.decoration && (
                                <div className="grid grid-cols-2 gap-x-6 gap-y-6 p-2">
                                    <div className="col-span-2"><label className="text-[10px] text-slate-400 uppercase block mb-2">位置坐标 (X / Y)</label>
                                        <div className="flex gap-3">
                                            <input type="range" min="-50" max="150" value={activeStyle.decorationX ?? 90} onChange={(e) => updateStyle('decorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            <input type="range" min="-50" max="150" value={activeStyle.decorationY ?? -10} onChange={(e) => updateStyle('decorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                        </div>
                                    </div>
                                    <div><label className="text-[10px] text-slate-400 uppercase block mb-2">缩放 ({activeStyle.decorationScale ?? 1}x)</label>
                                        <input type="range" min="0.2" max="3" step="0.1" value={activeStyle.decorationScale ?? 1} onChange={(e) => updateStyle('decorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                    </div>
                                    <div><label className="text-[10px] text-slate-400 uppercase block mb-2">旋转 ({activeStyle.decorationRotate ?? 0}°)</label>
                                        <input type="range" min="-180" max="180" value={activeStyle.decorationRotate ?? 0} onChange={(e) => updateStyle('decorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- AVATAR TOOLS --- */}
                    {editorPage === 'messages' && activeTab !== 'css' && toolSection === 'avatar' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => avatarDecoInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-primary/50 hover:text-primary transition-all">
                                {activeStyle.avatarDecoration ? <img src={activeStyle.avatarDecoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold">+ 上传头像框/挂件</span>}
                                <input type="file" ref={avatarDecoInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'avatarDeco')} />
                                {activeStyle.avatarDecoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('avatarDecoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full">移除</button>}
                            </div>

                            {activeStyle.avatarDecoration && (
                                <div className="grid grid-cols-2 gap-x-6 gap-y-6 p-2">
                                    <div className="col-span-2"><label className="text-[10px] text-slate-400 uppercase block mb-2">中心偏移 (Offset X / Y)</label>
                                        <div className="flex gap-3">
                                            <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationX ?? 50} onChange={(e) => updateStyle('avatarDecorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationY ?? 50} onChange={(e) => updateStyle('avatarDecorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                        </div>
                                    </div>
                                    <div><label className="text-[10px] text-slate-400 uppercase block mb-2">缩放 ({activeStyle.avatarDecorationScale ?? 1}x)</label>
                                        <input type="range" min="0.5" max="3" step="0.1" value={activeStyle.avatarDecorationScale ?? 1} onChange={(e) => updateStyle('avatarDecorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                    </div>
                                    <div><label className="text-[10px] text-slate-400 uppercase block mb-2">旋转 ({activeStyle.avatarDecorationRotate ?? 0}°)</label>
                                        <input type="range" min="-180" max="180" value={activeStyle.avatarDecorationRotate ?? 0} onChange={(e) => updateStyle('avatarDecorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>

            {sharePanel !== 'none' && (
                <div
                    className="absolute inset-0 z-50 flex items-end bg-slate-900/35 backdrop-blur-sm animate-fade-in"
                    onClick={() => setSharePanel('none')}
                >
                    <div
                        className="w-full bg-white rounded-t-[2rem] shadow-2xl border border-white/60 px-5 pt-5 pb-7 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-base font-bold text-slate-800">{sharePanel === 'export' ? '导出主题' : '导入主题'}</h2>
                                <p className="text-[11px] text-slate-400 mt-0.5">{editingTheme.name || '未命名主题'}</p>
                            </div>
                            <button
                                onClick={() => setSharePanel('none')}
                                className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-95 transition-transform"
                                aria-label="关闭"
                            >
                                ×
                            </button>
                        </div>

                        {sharePanel === 'export' ? (
                            <>
                                <textarea
                                    ref={exportTextareaRef}
                                    value={themeJson}
                                    readOnly
                                    data-allow-text-selection="true"
                                    className="w-full h-56 bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed rounded-2xl p-4 resize-none outline-none"
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => void copyThemeJson()}
                                        className="py-3 rounded-2xl bg-slate-100 text-slate-600 text-xs font-bold active:scale-[0.98] transition-transform"
                                    >
                                        复制 JSON
                                    </button>
                                    <button
                                        onClick={downloadThemeJson}
                                        className="py-3 rounded-2xl bg-primary text-white text-xs font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
                                    >
                                        下载 JSON
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <textarea
                                    value={importText}
                                    onChange={(e) => setImportText(e.target.value)}
                                    data-allow-text-selection="true"
                                    placeholder="粘贴主题 JSON"
                                    className="w-full h-48 bg-slate-50 border border-slate-200 text-slate-700 font-mono text-[11px] leading-relaxed rounded-2xl p-4 resize-none outline-none focus:border-primary/40"
                                />
                                <input
                                    type="file"
                                    ref={importFileInputRef}
                                    accept="application/json,.json"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void importThemeFile(file);
                                    }}
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => importFileInputRef.current?.click()}
                                        className="py-3 rounded-2xl bg-slate-100 text-slate-600 text-xs font-bold active:scale-[0.98] transition-transform"
                                    >
                                        选择文件
                                    </button>
                                    <button
                                        onClick={() => applyImportedTheme(importText)}
                                        disabled={!importText.trim()}
                                        className="py-3 rounded-2xl bg-primary text-white text-xs font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:shadow-none"
                                    >
                                        应用导入
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ThemeMaker;
