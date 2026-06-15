# 当前聊天界面美化类名清单

整理日期：2026-06-15

范围：`apps/Chat.tsx`、`components/chat/**`、`styles/themes/**`、`index.css`、`apps/ThemeMaker.tsx`。

顶部栏和底部输入栏的独立速查文件：`docs/chat-top-bottom-classnames.md`。

## 顶部栏和底部输入栏快捷索引

这两块是聊天界面固定区域，改整体观感时优先看这里。

### 顶部栏

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-chat-header` | 顶部栏整块：背景、高度、安全区、边框、阴影、毛玻璃。 |
| `.sully-chat-header-button` | 顶部栏所有图标按钮的通用入口。 |
| `.sully-chat-header-back` | 返回按钮。 |
| `.sully-chat-header-call` | 通话按钮。 |
| `.sully-chat-header-trigger` | 手动触发 AI / 闪电按钮。 |
| `.sully-chat-header-avatar` | 角色头像。 |
| `.sully-chat-header-title` | 角色名。 |
| `.sully-chat-header-subtitle` | Online / 状态副标题。 |
| `.sully-chat-header-token` | 调试 token 小标签。 |
| `.sully-chat-header-summary` | 记忆整理提示条。 |

### 底部输入栏

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-chat-dock` | 底部输入/待发送动作区域外层。 |
| `.sully-chat-input` | 底部输入栏整块：背景、边框、安全区、毛玻璃。 |
| `.sully-chat-input-main` | 输入栏主行。 |
| `.sully-chat-input-icon-button` | 输入栏普通图标按钮通用入口。 |
| `.sully-chat-input-plus-button` | 加号 / 更多按钮。 |
| `.sully-chat-input-textbox` | 输入框外壳。 |
| `.sully-chat-input-textarea` | 真实文本输入区。 |
| `.sully-chat-input-placeholder` | placeholder 或按住说话提示文字。 |
| `.sully-chat-input-emoji-button` | 表情按钮。 |
| `.sully-chat-input-send-button` | 发送按钮，也会作用到语音发送位按钮。 |
| `.sully-voice-record-button` | 语音录制按钮。 |
| `.sully-chat-input-suggestion-panel` | 输入栏上方表情联想浮层。 |
| `.sully-chat-input-suggestion-item` | 表情联想单项。 |
| `.sully-chat-input-panel` | 底部展开面板。 |
| `.sully-chat-input-panel-tabs` | 面板分类标签栏。 |
| `.sully-chat-input-panel-tab` | 单个面板分类标签。 |
| `.sully-chat-input-panel-item` | 表情格子 / 动作图标格。 |
| `.sully-chat-input-emoji-item` | 单个表情格。 |
| `.sully-chat-input-panel-action` | 更多动作按钮。 |
| `.sully-chat-input-panel-action-icon` | 更多动作图标容器。 |
| `.sully-chat-selection-bar` | 多选消息时的底部操作栏。 |
| `.sully-chat-selection-button` | 多选底栏普通按钮。 |
| `.sully-chat-selection-forward` | 多选转发按钮。 |
| `.sully-chat-selection-soul` | 多选回神按钮。 |
| `.sully-chat-selection-danger` | 多选删除等危险按钮。 |
| `.sully-recording-overlay` | 录音覆盖层。 |
| `.sully-recording-bubble-wrap` | 录音提示气泡定位外壳。 |
| `.sully-recording-bubble` | 录音提示气泡。 |
| `.sully-recording-cancel-label` | 上滑取消提示。 |
| `.sully-recording-convert-label` | 转文字提示。 |
| `.sully-recording-send-label` | 松开发送提示。 |
| `.sully-recording-duration` | 录音计时。 |
| `.sully-wechat-input-main` | 微信插件输入栏主行。 |
| `.sully-wechat-input-mode-button` | 微信插件语音/键盘切换按钮。 |
| `.sully-wechat-input-textbox` | 微信插件文本输入框外壳。 |
| `.sully-wechat-input-textarea` | 微信插件文本输入区。 |
| `.sully-wechat-input-emoji-button` | 微信插件表情按钮。 |
| `.sully-wechat-input-send-button` | 微信插件发送按钮。 |
| `.sully-wechat-input-plus-button` | 微信插件更多按钮。 |
| `.sully-wechat-voice-hold` | 微信插件“按住说话”区域。 |
| `.sully-wechat-recording-overlay` | 微信插件录音覆盖层。 |
| `.sully-wechat-recording-bubble-wrap` | 微信插件录音气泡定位外壳。 |
| `.sully-wechat-recording-bubble` | 微信插件录音气泡。 |
| `.sully-wechat-converting-overlay` | 微信插件语音转文字遮罩。 |
| `.sully-wechat-converting-modal` | 微信插件语音转文字弹窗。 |

## 最推荐改的稳定类名

这些是主题工坊高级 CSS 白名单里的选择器，适合拿来写聊天页皮肤。

| 类名 / 选择器 | 作用 |
| --- | --- |
| `:root` | 全局 CSS 变量入口。 |
| `.sully-chat-container` | 整个聊天页容器：背景图、渐变底色、整体氛围。 |
| `.sully-chat-header` | 顶部栏：返回按钮、角色头像、名字、通话按钮、触发按钮。 |
| `.sully-chat-header-avatar` | 顶部栏头像。 |
| `.sully-chat-header-title` | 顶部栏角色名。 |
| `.sully-chat-header-subtitle` | 顶部栏状态副标题。 |
| `.sully-chat-header-button` | 顶部栏图标按钮。 |
| `.sully-chat-input` | 底部输入栏：加号、文本框、表情、发送/语音按钮。 |
| `.sully-chat-input-main` | 底部输入栏主行。 |
| `.sully-chat-input-textbox` | 输入框外壳。 |
| `.sully-chat-input-textarea` | 真实文本输入区域。 |
| `.sully-chat-input-icon-button` | 输入栏左侧功能按钮。 |
| `.sully-chat-input-emoji-button` | 输入栏表情按钮。 |
| `.sully-chat-input-send-button` | 输入栏发送按钮。 |
| `.sully-chat-input-panel` | 底部展开面板。 |
| `.sully-chat-input-suggestion-panel` | 表情联想浮层。 |
| `.sully-chat-input-suggestion-item` | 表情联想浮层单项。 |
| `.sully-chat-input-panel-tab` | 底部面板分类标签。 |
| `.sully-chat-input-panel-item` | 表情格子 / 动作图标格。 |
| `.sully-chat-input-panel-action` | 更多动作按钮。 |
| `.sully-chat-input-panel-action-icon` | 更多动作图标容器。 |
| `.sully-wechat-input-main` | 微信插件输入栏主行。 |
| `.sully-wechat-input-mode-button` | 微信插件语音/键盘切换按钮。 |
| `.sully-wechat-input-textbox` | 微信插件文本输入框外壳。 |
| `.sully-wechat-input-textarea` | 微信插件文本输入区域。 |
| `.sully-wechat-input-emoji-button` | 微信插件表情按钮。 |
| `.sully-wechat-input-send-button` | 微信插件发送按钮。 |
| `.sully-wechat-input-plus-button` | 微信插件更多按钮。 |
| `.sully-wechat-voice-hold` | 微信插件“按住说话”区域。 |
| `.sully-recording-overlay` | 录音覆盖层背景。 |
| `.sully-recording-bubble` | 录音覆盖层提示气泡。 |
| `.sully-recording-cancel-label` | 录音取消提示文字。 |
| `.sully-recording-convert-label` | 微信录音转文字提示。 |
| `.sully-recording-send-label` | 微信录音发送提示。 |
| `.sully-recording-duration` | 录音计时文字。 |
| `.sully-chat-selection-bar` | 多选消息时的底部操作栏。 |
| `.sully-chat-selection-button` | 多选底栏普通按钮。 |
| `.sully-chat-selection-danger` | 多选底栏删除等危险按钮。 |
| `.sully-message-selection-checkbox` | 消息多选勾选框。 |
| `.sully-message-avatar` | 消息流头像通用入口。 |
| `.sully-message-avatar-image` | 消息流头像图片本体。 |
| `.sully-message-avatar-badge` | 头像右上角状态徽标通用入口。 |
| `.sully-message-action-button` | 消息长按操作菜单普通按钮。 |
| `.sully-message-action-danger` | 消息长按操作菜单删除等危险按钮。 |
| `.sully-inner-voice-card` | 经典心声卡片主体。 |
| `.sully-afterglow-composer-dialog` | 番外篇/谈心命题弹窗主体。 |
| `.sully-bubble-user` | 用户消息气泡外壳。 |
| `.sully-bubble-ai` | 角色消息气泡外壳。 |
| `.sully-bubble-text` | 消息文字层：建议改颜色、字体、阴影，不建议破坏换行和书写方向。 |
| `.sully-bubble-tail` | 气泡小尖角 SVG。 |
| `.sully-bubble-tail polygon` | 气泡小尖角填充色。 |
| `.sully-voice-bubble` | 语音消息气泡外壳。 |
| `.sully-voice-bar` | 语音播放时的波形条。 |
| `.sully-typing-bubble` | 角色“正在输入/处理中”气泡。 |
| `.sully-typing-tail` | 正在输入气泡的小尖角。 |
| `.sully-image-msg` | 图片消息本体。 |
| `.sully-emoji-msg` | 表情消息图片。 |
| `.sully-msg-timestamp` | 消息时间分隔。 |
| `.sully-system-pill` | 系统提示胶囊。 |
| `.sully-interaction-pill` | 戳一戳/互动提示胶囊。 |
| `.sully-card-container` | 聊天卡片通用容器，如转发、Canva、小红书等结构化卡片。 |
| `.sully-forward-card` | 聊天记录转发卡片。 |
| `.sully-canva-card` | Canva 设计分享卡片。 |
| `.sully-xhs-card` | 小红书分享卡片。 |
| `.sully-social-card` | 社交动态分享卡片。 |
| `.sully-system-notice-card` | 系统通知卡片。 |
| `.sully-chart-reading-card` | 星象/星盘解读卡片。 |
| `.sully-soul-reflection-card` | 回神/自省独白卡片。 |
| `.sully-voice-call-card` | 语音通话摘要卡片。 |
| `.sully-collection-forward-card` | 典藏馆转递卡片。 |
| `.sully-song-share-card` | 音乐分享卡片。 |
| `.sully-wechat-moments-card` | 朋友圈样式卡片。 |
| `.sully-story-phone-card` | 剧情手机证据卡片外壳。 |
| `.sully-news-card` | 多平台新闻/热榜卡片通用入口。 |
| `.sully-news-card-bilibili` | B站视频热榜卡片。 |
| `.sully-news-card-weibo` | 微博热搜卡片。 |
| `.sully-news-card-zhihu` | 知乎热榜卡片。 |
| `.sully-news-card-baidu` | 百度热榜卡片。 |
| `.sully-news-card-douyin` | 抖音热榜卡片。 |
| `.sully-news-card-title` | 新闻卡标题。 |
| `.sully-news-card-desc` | 新闻卡描述。 |
| `.sully-news-card-action` | 新闻卡打开平台/原文动作。 |
| `.sully-newspaper-card` | 昨日来信 / 回望小报卡片本体。 |
| `.sully-newspaper-delivery` | 昨日来信投递条，覆盖送达、失败、生成中。 |
| `.sully-newspaper-delivery-action` | 昨日来信投递条按钮。 |
| `.sully-newspaper-modal` | 昨日来信存档弹窗遮罩。 |
| `.sully-newspaper-modal-sheet` | 昨日来信存档弹窗主体。 |
| `.sully-newspaper-modal-button` | 昨日来信存档弹窗按钮。 |
| `.sully-room-note-body` | 房间便签卡片主体。 |
| `.sully-room-plan-body` | 房间计划卡片主体。 |
| `.sully-furniture-interaction-body` | 家具互动反馈卡片主体。 |
| `.sully-phone-card` | 手机证据卡片通用入口。 |
| `.sully-transfer-card` | 转账卡片容器。 |
| `.sully-theme-overlay-backdrop` | 主题覆盖层遮罩。 |
| `.sully-theme-overlay-modal` | 主题覆盖层弹窗主体。 |
| `.sully-theme-overlay-primary-button` | 覆盖层主按钮。 |
| `.sully-theme-overlay-secondary-button` | 覆盖层次按钮。 |
| `.sully-image-preview-action` | 图片大图预览关闭/下载按钮。 |

## 当前页面骨架类名

这些类名直接挂在聊天页主要区域上，适合做整页布局和主题级覆盖。

| 类名 / 选择器 | 来源 | 作用 |
| --- | --- | --- |
| `.sully-chat-container` | `apps/Chat.tsx` | 聊天页根容器。 |
| `.theme-${activeTheme.baseThemeId || activeTheme.id}` | `apps/Chat.tsx` | 当前主题动态作用域。实际会变成 `.theme-default`、`.theme-glassmorphism`、`.theme-waterdrop` 等。 |
| `.sully-chat-messages` | `apps/Chat.tsx` | 中间消息滚动区。 |
| `.sully-chat-dock` | `apps/Chat.tsx` | 底部输入/待发送动作区域外层。 |
| `.sully-chat-header` | `components/chat/ChatHeader.tsx` | 顶部聊天栏。 |
| `.sully-chat-header-avatar` | `components/chat/ChatHeader.tsx` | 顶部栏头像。 |
| `.sully-chat-header-title` | `components/chat/ChatHeader.tsx` | 顶部栏角色名。 |
| `.sully-chat-header-subtitle` | `components/chat/ChatHeader.tsx` | 顶部栏状态副标题。 |
| `.sully-chat-header-token` | `components/chat/ChatHeader.tsx` | 顶部栏 token 小标签。 |
| `.sully-chat-header-button` | `components/chat/ChatHeader.tsx` | 顶部栏按钮。 |
| `.sully-chat-input` | `components/chat/ChatInputArea.tsx` | 底部输入栏。 |
| `.sully-chat-input-main` | `components/chat/ChatInputArea.tsx` | 默认输入栏主行。 |
| `.sully-chat-input-textbox` | `components/chat/ChatInputArea.tsx` | 输入框外壳。 |
| `.sully-chat-input-textarea` | `components/chat/ChatInputArea.tsx` | 文本输入区域。 |
| `.sully-chat-input-icon-button` | `components/chat/ChatInputArea.tsx` | 输入栏左侧功能按钮。 |
| `.sully-chat-input-emoji-button` | `components/chat/ChatInputArea.tsx` | 输入栏表情按钮。 |
| `.sully-chat-input-send-button` | `components/chat/ChatInputArea.tsx` | 输入栏发送按钮。 |
| `.sully-chat-input-panel` | `components/chat/ChatInputArea.tsx` | 表情/更多操作展开面板。 |
| `.sully-chat-input-suggestion-panel` | `components/chat/ChatInputArea.tsx` | 表情联想浮层。 |
| `.sully-chat-input-suggestion-item` | `components/chat/ChatInputArea.tsx` | 表情联想浮层单项。 |
| `.sully-chat-input-panel-tab` | `components/chat/ChatInputArea.tsx` | 面板分类标签、管理按钮。 |
| `.sully-chat-input-panel-item` | `components/chat/ChatInputArea.tsx` | 表情格子、动作图标格。 |
| `.sully-chat-input-panel-action` | `components/chat/ChatInputArea.tsx` | 更多动作面板单个动作。 |
| `.sully-chat-input-panel-action-icon` | `components/chat/ChatInputArea.tsx` | 更多动作图标容器。 |
| `.sully-wechat-input-main` | `components/chat/plugins/WeChatInputBar.tsx` | 微信插件输入栏主行。 |
| `.sully-wechat-input-mode-button` | `components/chat/plugins/WeChatInputBar.tsx` | 微信插件语音/键盘切换按钮。 |
| `.sully-wechat-input-textbox` | `components/chat/plugins/WeChatInputBar.tsx` | 微信插件文本输入框。 |
| `.sully-wechat-voice-hold` | `components/chat/plugins/WeChatInputBar.tsx` | 微信插件按住说话区域。 |
| `.sully-wechat-input-send-button` | `components/chat/plugins/WeChatInputBar.tsx` | 微信插件发送按钮。 |
| `.sully-recording-overlay` | `components/chat/VoiceRecordButton.tsx`、`WeChatInputBar.tsx` | 录音覆盖层背景。 |
| `.sully-recording-bubble` | `components/chat/VoiceRecordButton.tsx`、`WeChatInputBar.tsx` | 录音提示气泡。 |
| `.sully-chat-selection-bar` | `components/chat/ChatInputArea.tsx` | 多选消息时底部操作栏。 |
| `.sully-chat-selection-button` | `components/chat/ChatInputArea.tsx` | 多选底栏普通按钮。 |
| `.sully-chat-selection-danger` | `components/chat/ChatInputArea.tsx` | 多选底栏删除按钮。 |

当前主要 className 原文：

```tsx
className={`sully-chat-container flex flex-col h-full bg-[#f1f5f9] overflow-hidden relative font-sans transition-[background-image] duration-500 theme-${activeTheme.baseThemeId || activeTheme.id}`}
className="sully-chat-messages flex-1 overflow-y-auto pt-6 pb-6 no-scrollbar"
className="sully-chat-dock relative z-40"
className="sully-chat-header min-h-[6rem] pt-10 bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shrink-0 z-30 sticky top-0 shadow-sm relative transition-all duration-300"
className="sully-chat-input bg-white/90 backdrop-blur-2xl border-t border-slate-200/50 pb-safe shrink-0 z-40 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] relative transition-all duration-300"
```

## 顶部栏详细类名

顶部栏最稳定的美化入口是 `.sully-chat-header`。内部关键节点已经补了语义类名，优先使用这些类名，不需要再依赖 Tailwind 嵌套选择器。

### 顶部栏稳定入口

| 类名 / 选择器 | 来源 | 作用 |
| --- | --- | --- |
| `.sully-chat-header` | `components/chat/ChatHeader.tsx` | 顶部栏整块背景、高度、安全区、边框、阴影。 |
| `.sully-chat-header-avatar` | `components/chat/ChatHeader.tsx` | 顶部栏头像尺寸、圆角、阴影。 |
| `.sully-chat-header-title` | `components/chat/ChatHeader.tsx` | 角色名颜色、字号、字重。 |
| `.sully-chat-header-subtitle` | `components/chat/ChatHeader.tsx` | Online / 状态副标题。 |
| `.sully-chat-header-token` | `components/chat/ChatHeader.tsx` | Token 小标签颜色、背景、边框、圆角。 |
| `.sully-chat-header-button` | `components/chat/ChatHeader.tsx` | 返回、通话、触发 AI 等图标按钮。 |
| `.sully-chat-header-summary` | `components/chat/ChatHeader.tsx` | 记忆整理提示条。 |
| `.theme-default .sully-chat-header` | `styles/themes/wechat.css` | 默认微信主题顶部栏覆盖。 |
| `.theme-glassmorphism .sully-chat-header` | `styles/themes/glassmorphism.css` | 毛玻璃主题顶部栏覆盖。 |
| `.theme-waterdrop .sully-chat-header` | `styles/themes/waterdrop.css` | 水滴主题顶部栏覆盖。 |

### 顶部栏内部 className 原文

```tsx
// 顶部栏外壳
className="sully-chat-header min-h-[6rem] pt-10 bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shrink-0 z-30 sticky top-0 shadow-sm relative transition-all duration-300"

// 多选模式
className="flex items-center justify-between w-full"
className="text-sm font-bold text-slate-500 px-2 py-1"
className="text-sm font-bold text-slate-800"
className="w-10"

// 普通模式主行
className="flex items-center gap-3 w-full"

// 返回按钮
className="sully-chat-header-button sully-chat-header-back p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full"
className="w-5 h-5"

// 角色信息区域
className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
className="sully-chat-header-avatar w-10 h-10 rounded-xl object-cover shadow-sm"
className="sully-chat-header-title font-bold text-slate-800"
className="flex items-center gap-2"
className="sully-chat-header-subtitle text-[10px] text-slate-400 uppercase"
className="sully-chat-header-token text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded-md font-mono border border-slate-200"

// 通话按钮
className="sully-chat-header-button sully-chat-header-call p-2 -mr-1 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
className="w-5 h-5"

// 闪电 / 手动触发 AI 按钮
className={`sully-chat-header-button sully-chat-header-trigger p-2 rounded-full ${isTyping ? 'bg-slate-100' : 'bg-primary/10 text-primary'}`}
className="w-5 h-5"

// 记忆整理提示条
className="sully-chat-header-summary absolute top-full left-0 w-full bg-indigo-50 border-b border-indigo-100 p-2 flex items-center justify-center gap-2"
className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"
className="text-xs text-indigo-600 font-medium"
```

### 顶部栏可直接覆盖的嵌套选择器

默认微信主题已经在用这些选择器，可以照这个思路写自定义主题。

```css
.sully-chat-header
.sully-chat-header-avatar
.sully-chat-header-title
.sully-chat-header-subtitle
.sully-chat-header-button
.sully-chat-header-summary

.theme-default .sully-chat-header
.theme-default .sully-chat-header > .gap-3
.theme-default .sully-chat-header > .gap-3 > button:first-of-type
.theme-default .sully-chat-header > .gap-3 > button:first-of-type svg
.theme-default .sully-chat-header > .gap-3 > button:nth-of-type(2)
.theme-default .sully-chat-header > .gap-3 > button:last-of-type
.theme-default .sully-chat-header > .gap-3 > button:last-of-type svg
.theme-default .sully-chat-header > .gap-3 > .flex-1
.theme-default .sully-chat-header > .gap-3 > .flex-1 > div
.theme-default .sully-chat-header > .gap-3 > .flex-1 img
.theme-default .sully-chat-header > .gap-3 > .flex-1 > div > div:nth-child(2)
.theme-default .sully-chat-header > .gap-3 > .flex-1 .font-bold
.theme-default .sully-chat-header button
.theme-default .sully-chat-header img.rounded-xl
.theme-default .sully-chat-header .bg-slate-100
```

## 底部输入栏详细类名

底部输入栏最稳定的美化入口是 `.sully-chat-input`。默认输入栏、表情建议面板、表情面板、动作面板和语音录制按钮都在它下面。

### 底部输入栏稳定入口

| 类名 / 选择器 | 来源 | 作用 |
| --- | --- | --- |
| `.sully-chat-input` | `components/chat/ChatInputArea.tsx` | 底部输入栏整块背景、边框、毛玻璃、安全区。 |
| `.sully-chat-input-main` | `components/chat/ChatInputArea.tsx` | 默认输入栏主行，控制按钮和输入框间距。 |
| `.sully-chat-input-textbox` | `components/chat/ChatInputArea.tsx` | 输入框外壳，控制背景、圆角、边框。 |
| `.sully-chat-input-textarea` | `components/chat/ChatInputArea.tsx` | 真实 textarea，控制文字、字号、placeholder。 |
| `.sully-chat-input-icon-button` | `components/chat/ChatInputArea.tsx` | 加号/功能按钮。 |
| `.sully-chat-input-emoji-button` | `components/chat/ChatInputArea.tsx` | 表情按钮。 |
| `.sully-chat-input-send-button` | `components/chat/ChatInputArea.tsx` | 发送按钮。 |
| `.sully-chat-input-panel` | `components/chat/ChatInputArea.tsx` | 表情/更多操作展开面板。 |
| `.sully-chat-input-suggestion-panel` | `components/chat/ChatInputArea.tsx` | 输入栏上方表情联想浮层。 |
| `.sully-chat-input-suggestion-item` | `components/chat/ChatInputArea.tsx` | 表情联想单项。 |
| `.sully-chat-input-panel-tab` | `components/chat/ChatInputArea.tsx` | 表情/更多面板标签。 |
| `.sully-chat-input-panel-item` | `components/chat/ChatInputArea.tsx` | 表情格子和动作图标格。 |
| `.sully-chat-input-panel-action` | `components/chat/ChatInputArea.tsx` | 更多动作按钮。 |
| `.sully-chat-input-panel-action-icon` | `components/chat/ChatInputArea.tsx` | 更多动作图标容器。 |
| `.sully-chat-selection-bar` | `components/chat/ChatInputArea.tsx` | 多选消息时底部操作栏。 |
| `.sully-chat-selection-button` | `components/chat/ChatInputArea.tsx` | 多选底栏普通操作按钮。 |
| `.sully-chat-selection-danger` | `components/chat/ChatInputArea.tsx` | 多选底栏删除按钮。 |
| `.sully-chat-dock` | `apps/Chat.tsx` | 输入栏/待发送动作区域的外层 dock。 |
| `.theme-default .sully-chat-input` | `styles/themes/wechat.css` | 默认微信主题输入栏覆盖。 |
| `.theme-glassmorphism .sully-chat-input` | `styles/themes/glassmorphism.css` | 毛玻璃主题输入栏覆盖。 |
| `.theme-waterdrop .sully-chat-input` | `styles/themes/waterdrop.css` | 水滴主题输入栏覆盖。 |

### 底部输入栏内部 className 原文

```tsx
// 输入栏外壳
className="sully-chat-input bg-white/90 backdrop-blur-2xl border-t border-slate-200/50 pb-safe shrink-0 z-40 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] relative transition-all duration-300"

// 表情联想浮层
className="absolute bottom-full left-0 right-0 z-50 px-3 pb-2 pointer-events-none"
className="sully-chat-input-suggestion-panel pointer-events-auto bg-white/85 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl px-3 py-2.5"
className="flex gap-2.5 overflow-x-auto no-scrollbar"
className="sully-chat-input-suggestion-item flex flex-col items-center gap-1 shrink-0 active:scale-90 transition-transform"
className="sully-chat-input-panel-item w-14 h-14 bg-white rounded-xl p-1.5 shadow-sm border border-slate-100"
className="w-full h-full object-contain"
className="text-[10px] text-slate-500 max-w-14 truncate"
className="text-[8px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full max-w-14 truncate"

// 多选模式底栏
className="sully-chat-selection-bar p-3 flex gap-2 bg-white/50 backdrop-blur-md"
className={`sully-chat-selection-button sully-chat-selection-forward flex-1 py-3 font-bold rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${selectedCount === 0 ? 'bg-slate-200 text-slate-400 shadow-none' : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-blue-200'}`}
className={`sully-chat-selection-button sully-chat-selection-soul flex-1 py-3 font-bold rounded-xl active:scale-95 transition-all flex items-center justify-center gap-2 ${selectedCount === 0 ? 'bg-slate-200 text-slate-400' : 'bg-neutral-900 text-neutral-400 border border-neutral-700 shadow-sm'}`}
className={`sully-chat-selection-button sully-chat-selection-danger ${onForwardSelected || onSoulReflection ? 'flex-1' : 'w-full'} py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2`}

// 默认输入行
className="sully-chat-input-main p-3 px-4 flex gap-3 items-end"
className="sully-chat-input-icon-button sully-chat-input-plus-button w-11 h-11 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
className="w-6 h-6"
className="sully-chat-input-textbox flex-1 min-w-0 bg-slate-100 rounded-[24px] flex items-center px-1 border border-transparent focus-within:bg-white focus-within:border-primary/30 transition-all overflow-hidden"
className={`sully-chat-input-textarea flex-1 min-w-0 bg-transparent px-4 py-3 ${useIOSStandaloneInputFix ? 'text-[16px]' : 'text-[15px]'} resize-none max-h-24 no-scrollbar`}
className="sully-chat-input-emoji-button p-2 shrink-0 text-slate-400 hover:text-primary"
className="w-6 h-6"
className="sully-chat-input-send-button w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-all bg-primary text-white shadow-lg"
className="sully-chat-input-send-button w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-all bg-slate-200 text-slate-400"
className="w-5 h-5"

// 展开面板外壳
className="sully-chat-input-panel bg-slate-50 h-72 border-t border-slate-200/60 overflow-hidden relative z-0 flex flex-col"

// 表情分类栏
className="sully-chat-input-panel-tabs h-10 bg-white border-b border-slate-100 flex items-center px-2 gap-2 overflow-x-auto no-scrollbar shrink-0"
className={`sully-chat-input-panel-tab h-7 px-3 rounded-full text-[11px] font-bold shrink-0 transition-colors ${emojiManageMode ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
className={`sully-chat-input-panel-tab px-3 py-1 text-xs rounded-full whitespace-nowrap transition-all select-none flex items-center gap-1 ${activeCategory === cat.id ? 'bg-primary text-white font-bold shadow-sm' : 'bg-slate-100 text-slate-500'}`}
className="sully-chat-input-panel-tab w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 hover:bg-slate-200"

// 表情管理栏
className="h-11 bg-white/80 border-b border-slate-100 flex items-center gap-2 px-3 shrink-0"
className="text-xs font-bold text-slate-600 mr-auto"
className="px-3 py-1.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 disabled:opacity-40"
className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"
className={`h-8 px-3 rounded-full text-[11px] font-bold flex items-center gap-1.5 transition-colors ${selectedEmojis.length === 0 ? 'bg-slate-100 text-slate-300' : 'bg-red-500 text-white'}`}

// 表情网格
className="flex-1 overflow-y-auto no-scrollbar p-4"
className="grid grid-cols-4 gap-3"
className="sully-chat-input-panel-item sully-chat-input-emoji-item aspect-square bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400"
className={`sully-chat-input-panel-item sully-chat-input-emoji-item bg-white rounded-2xl p-2 shadow-sm relative active:scale-95 transition-transform select-none flex flex-col items-center ${emojiManageMode ? 'border border-slate-100' : ''} ${isSelected ? 'ring-2 ring-red-400 ring-offset-2' : ''}`}
className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow-sm ${isSelected ? 'bg-red-500 text-white' : 'bg-white/90 text-slate-300'}`}
className="aspect-square w-full"
className="w-full h-full object-contain pointer-events-none"
className="text-[9px] text-slate-400 truncate w-full text-center mt-0.5 leading-tight"

// 更多动作面板
className="p-6 grid grid-cols-4 gap-8 overflow-y-auto"
className="sully-chat-input-panel-action flex flex-col items-center gap-2 text-slate-600 active:scale-95 transition-transform"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center shadow-sm text-orange-400 border border-orange-100"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center shadow-sm text-2xl border border-sky-100"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center shadow-sm text-indigo-400 border border-indigo-100"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center shadow-sm text-slate-500 border border-slate-100"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm text-pink-400 border border-pink-100"
className="sully-chat-input-panel-item sully-chat-input-panel-action-icon w-14 h-14 bg-fuchsia-50 rounded-2xl flex items-center justify-center shadow-sm text-fuchsia-400 border border-fuchsia-100"
className="text-xs font-bold"
className="hidden"
```

### 语音录制按钮 className

语音按钮在 `components/chat/VoiceRecordButton.tsx`。

```tsx
className={`sully-chat-input-send-button sully-voice-record-button w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-all select-none
  ${isRecording
    ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-200'
    : isProcessing
      ? 'bg-slate-200 text-slate-400'
      : 'bg-slate-100 text-slate-500 hover:bg-slate-200 active:bg-slate-300'
  }`}
className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"
className="w-5 h-5"
className="sully-recording-overlay fixed inset-0 z-[999] flex flex-col items-center justify-end pb-32 pointer-events-none"
className="absolute inset-0 pointer-events-auto"
className={`sully-recording-bubble relative pointer-events-none px-8 py-5 rounded-3xl backdrop-blur-2xl shadow-2xl border transition-all duration-200 ${isOverCancel ? 'bg-red-500/90 border-red-400/50 scale-105' : 'bg-black/70 border-white/10'}`}
className={`sully-recording-cancel-label text-center text-xs font-bold mb-3 transition-colors ${isOverCancel ? 'text-white' : 'text-white/50'}`}
className="flex items-center justify-center mb-3"
className="sully-recording-duration text-center text-white text-lg font-mono font-bold tracking-wider"
```

### 微信插件输入栏

默认微信主题会走 `components/chat/plugins/WeChatInputBar.tsx`。现在它也有和默认输入栏一致的 `sully-chat-input-*` 类名，并额外带 `sully-wechat-*` 细分入口：

```tsx
className="sully-chat-input-main sully-wechat-input-main"
className="sully-chat-input-icon-button sully-wechat-input-mode-button"
className="sully-chat-input-textbox sully-wechat-voice-hold"
className="sully-chat-input-placeholder"
className="sully-chat-input-textbox sully-wechat-input-textbox"
className="sully-chat-input-textarea sully-wechat-input-textarea no-scrollbar"
className="sully-chat-input-emoji-button sully-wechat-input-emoji-button"
className="sully-chat-input-send-button sully-wechat-input-send-button"
className="sully-chat-input-icon-button sully-wechat-input-plus-button"
className="sully-recording-overlay sully-wechat-recording-overlay"
className="sully-recording-bubble-wrap sully-wechat-recording-bubble-wrap"
className="sully-recording-bubble sully-wechat-recording-bubble"
className="sully-theme-overlay-backdrop sully-wechat-converting-overlay"
className="sully-theme-overlay-modal sully-wechat-converting-modal"
```

要改微信输入栏，优先覆盖外层和嵌套选择器：

```css
.sully-chat-input
.sully-chat-input-main
.sully-chat-input-textbox
.sully-chat-input-textarea
.sully-chat-input-textarea::placeholder
.sully-chat-input-icon-button
.sully-chat-input-emoji-button
.sully-chat-input-send-button
.sully-chat-input-panel
.sully-chat-input-suggestion-panel
.sully-chat-input-suggestion-item
.sully-chat-input-panel-tab
.sully-chat-input-panel-item
.sully-chat-input-panel-action
.sully-chat-input-panel-action-icon
.sully-recording-overlay
.sully-recording-bubble
.sully-recording-duration
.sully-wechat-input-main
.sully-wechat-input-mode-button
.sully-wechat-input-textbox
.sully-wechat-input-textarea
.sully-wechat-input-emoji-button
.sully-wechat-input-send-button
.sully-wechat-input-plus-button
.sully-wechat-voice-hold
.sully-wechat-recording-overlay
.sully-wechat-recording-bubble

.theme-default .sully-chat-input
.theme-default .sully-chat-input > div
.theme-default .sully-chat-input input
.theme-default .sully-chat-input textarea
.theme-default .sully-chat-input .flex-1
.theme-default .sully-chat-input button.rounded-full
.theme-default .sully-chat-input .text-slate-400
.theme-default .sully-chat-input > div.bg-slate-50
.theme-default .sully-chat-input > div.border-t
.theme-default .sully-chat-input div[class*="rounded-2xl"][class*="w-14"]
.theme-default .sully-chat-input button.aspect-square
.theme-default .sully-chat-input button.border-dashed
.theme-default .sully-chat-input div.bg-white.border-b
.theme-default .sully-chat-input button.rounded-full.bg-slate-100
.theme-default .sully-chat-input div[class*="rounded-[20px]"]
.theme-default .sully-chat-input button.rounded-2xl.border
.theme-default .sully-chat-input .bg-white\/50
.theme-default .sully-chat-input div.bg-slate-100.rounded-[24px]
```

## 消息气泡类名

| 类名 / 选择器 | 来源 | 作用 |
| --- | --- | --- |
| `.sully-chat-bubble-wrapper` | `components/chat/ChatBubble.tsx` | 每条文字气泡外层，负责点击缩放和动画。 |
| `.sully-bubble-nested-scroll-active` | `components/chat/ChatBubble.tsx` | 气泡内部有嵌套滚动时的状态类，避免外层缩放干扰滚动。 |
| `.sully-bubble-tail` | `components/chat/ChatBubble.tsx` | 文字气泡小尖角。 |
| `.sully-bubble-user` | `components/chat/ChatBubble.tsx`、`VoiceBubble.tsx` | 用户文字/语音气泡。 |
| `.sully-bubble-ai` | `components/chat/ChatBubble.tsx`、`VoiceBubble.tsx` | 角色文字/语音气泡。 |
| `.sully-bubble-text` | `components/chat/ChatBubble.tsx` | 文字内容层。 |

当前主要 className 原文：

```tsx
className={`sully-chat-bubble-wrapper relative animate-fade-in transition-transform ${nestedScrollActive ? 'sully-bubble-nested-scroll-active' : ''}`}
className={`sully-bubble-tail absolute top-[12px] w-[6px] h-[10px] pointer-events-none ${isUser ? '-right-[5.5px]' : '-left-[5.5px]'}`}
className={`relative overflow-hidden px-3 py-2 ${isUser ? 'sully-bubble-user mt-0' : 'sully-bubble-ai mt-0'}`}
className="sully-bubble-text relative z-10 block leading-relaxed whitespace-pre-wrap"
```

## 消息操作、头像和心声类名

这些入口负责长按消息后的操作菜单、多选勾选框、消息流头像、头像右上角状态徽标，以及心声 / 状态卡片 / 番外篇命题弹窗。

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-message-selection-checkbox-wrap` | 多选勾选框定位外壳。 |
| `.sully-message-selection-checkbox` | 多选勾选框本体。 |
| `.sully-message-selection-checkbox.is-selected` | 已选中的勾选框状态。 |
| `.sully-message-selection-check` | 勾选图标。 |
| `.sully-message-avatar` | 消息流头像通用入口。 |
| `.sully-message-avatar-user` | 用户消息头像外壳。 |
| `.sully-message-avatar-ai` | 角色消息头像外壳。 |
| `.sully-message-avatar-image` | 头像图片本体。 |
| `.sully-message-avatar-decoration` | 头像装饰贴图。 |
| `.sully-message-avatar-badge-wrap` | 头像右上角徽标组。 |
| `.sully-message-avatar-badge` | 头像徽标通用入口。 |
| `.sully-message-avatar-badge-story-phone` | 剧情手机徽标。 |
| `.sully-message-avatar-badge-afterglow` | 番外篇徽标。 |
| `.sully-message-avatar-badge-inner-voice` | 心声/状态卡片徽标。 |
| `.sully-message-avatar-badge-surprise` | 惊喜模式揭晓徽标。 |
| `.sully-message-avatar-badge-retry` | 重试生成心声徽标。 |
| `.sully-message-avatar-loading` | 用户头像动作加载圈。 |
| `.sully-message-action-modal` | 消息长按操作菜单内容区。 |
| `.sully-message-action-button` | 消息操作菜单普通按钮。 |
| `.sully-message-action-danger` | 消息操作菜单危险按钮。 |
| `.sully-inner-voice-backdrop` | 心声覆盖层遮罩。 |
| `.sully-inner-voice-close` | 心声覆盖层关闭按钮。 |
| `.sully-inner-voice-shell` | 心声 / 状态卡片覆盖层内容外壳。 |
| `.sully-inner-voice-card` | 经典心声卡片主体。 |
| `.sully-inner-voice-title` | 经典心声卡片标题。 |
| `.sully-inner-voice-text` | 经典心声正文。 |
| `.sully-inner-voice-toggle` | 展开/收起全文按钮。 |
| `.sully-inner-voice-close-hint` | 点击空白关闭提示。 |
| `.sully-status-card-overlay-shell` | 创意状态卡片覆盖层外壳。 |
| `.sully-status-card-collection-button` | 状态卡片收藏按钮。 |
| `.sully-afterglow-composer-backdrop` | 番外篇命题弹窗遮罩。 |
| `.sully-afterglow-composer-dialog` | 番外篇命题弹窗主体。 |
| `.sully-afterglow-composer-button` | 番外篇命题弹窗按钮。 |

气泡工坊的 `输入栏` 预览页已经展示多选勾选框和头像徽标缩略态；`覆盖层` 预览页已经展示消息操作菜单、经典心声卡片、番外篇命题弹窗和状态卡片收藏按钮。

## 语音、图片、状态类名

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-voice-bubble` | 语音条整体。 |
| `.sully-voice-bar` | 语音播放动效条。 |
| `.sully-image-msg-shell` | 图片消息外壳/加载占位外壳。 |
| `.sully-image-msg` | 图片消息图片本体。 |
| `.sully-emoji-msg` | 表情消息图片本体。 |
| `.sully-image-preview-backdrop` | 图片预览大图背景层。 |
| `.sully-image-preview-action` | 图片预览关闭/下载按钮。 |
| `.sully-msg-timestamp` | 时间分隔条。 |
| `.sully-system-pill` | 系统提示胶囊。 |
| `.sully-interaction-pill` | 互动提示胶囊。 |
| `.sully-thinking-scroll` | 思考链面板内部滚动区。 |
| `.sully-theme-overlay-backdrop` | 主题覆盖层遮罩。 |
| `.sully-theme-overlay-modal` | 主题覆盖层弹窗主体。 |
| `.sully-theme-overlay-primary-button` | 覆盖层主按钮。 |
| `.sully-theme-overlay-secondary-button` | 覆盖层次按钮。 |

当前主要 className 原文：

```tsx
className={`sully-voice-bubble relative flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none active:scale-[0.97] transition-transform animate-fade-in ${isUser ? 'sully-bubble-user' : 'sully-bubble-ai'}`}
className="sully-voice-bar w-[3px] rounded-full animate-voice-bar-1"
className="sully-image-msg-shell flex h-[240px] w-[180px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-black/5 bg-black/5 px-4 text-center shadow-sm"
className="sully-image-msg-shell relative group block overflow-hidden rounded-2xl border border-black/5 bg-black/5 shadow-sm transition-transform active:scale-[0.98]"
className="sully-image-msg max-h-[300px] max-w-[200px] object-cover"
className="sully-emoji-msg max-w-[160px] max-h-[160px] hover:scale-105 transition-transform drop-shadow-md active:scale-95"
className="sully-msg-timestamp flex justify-center w-full py-2"
className="sully-system-pill flex items-center gap-1.5 bg-slate-200/40 backdrop-blur-md text-slate-500 px-3 py-1 rounded-full shadow-sm border border-white/20 select-none cursor-pointer active:scale-95 transition-transform"
className="sully-interaction-pill text-[11px] text-slate-500 bg-slate-200/50 backdrop-blur-sm px-4 py-1.5 rounded-full flex items-center gap-1.5 border border-white/40 shadow-sm select-none"
className="sully-thinking-scroll overflow-y-auto no-scrollbar"
```

气泡工坊的 `覆盖层` 预览页现在会同时展示通用弹窗和图片大图预览；调 `.sully-image-preview-backdrop`、`.sully-image-preview-action` 可以直接看到关闭/下载按钮状态。

## 卡片和专项模块类名

这些不是所有主题都一定出现，但属于聊天消息流里的可见卡片/弹窗。

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-card-container` | 通用卡片容器。 |
| `.sully-forward-card` | 聊天记录转发卡片。 |
| `.sully-canva-card` | Canva 设计分享卡片。 |
| `.sully-xhs-card` | 小红书分享卡片。 |
| `.sully-social-card` | 社交动态分享卡片。 |
| `.sully-system-notice-card` | 系统通知卡片。 |
| `.sully-system-notice-card-dark` | 深色系统通知卡片。 |
| `.sully-chart-reading-card` | 星象/星盘解读卡片。 |
| `.sully-soul-reflection-card` | 回神/自省独白卡片。 |
| `.sully-voice-call-card` | 语音通话摘要卡片。 |
| `.sully-collection-forward-card` | 典藏馆转递卡片。 |
| `.sully-collection-forward-heart-card` | 谈心典藏馆转递卡片。 |
| `.sully-song-share-card` | 音乐分享卡片。 |
| `.sully-wechat-moments-card` | 朋友圈样式卡片。 |
| `.sully-story-phone-card` | 剧情手机证据卡片外壳。 |
| `.sully-news-card` | 多平台新闻/热榜卡片通用入口。 |
| `.sully-news-card-bilibili` | B站视频热榜卡片。 |
| `.sully-news-card-weibo` | 微博热搜卡片。 |
| `.sully-news-card-zhihu` | 知乎热榜卡片。 |
| `.sully-news-card-baidu` | 百度热榜卡片。 |
| `.sully-news-card-douyin` | 抖音热榜卡片。 |
| `.sully-news-card-default` | 未识别平台的默认新闻卡片。 |
| `.sully-news-card-header` | 新闻卡头部。 |
| `.sully-news-card-badge` | 新闻卡平台标签。 |
| `.sully-news-card-rank` | 新闻卡热榜排名。 |
| `.sully-news-card-title` | 新闻卡标题。 |
| `.sully-news-card-desc` | 新闻卡描述。 |
| `.sully-news-card-footer` | 新闻卡底部来源/动作栏。 |
| `.sully-news-card-action` | 新闻卡打开平台/原文动作。 |
| `.sully-newspaper-card` | 昨日来信 / 回望小报卡片本体。 |
| `.sully-newspaper-delivery` | 昨日来信投递条。 |
| `.sully-newspaper-delivery-stack` | 多个昨日来信投递条堆叠外壳。 |
| `.sully-newspaper-delivery-modal` | 昨日来信生成中投递遮罩。 |
| `.sully-newspaper-delivery-mark` | 昨日来信信封/状态标记。 |
| `.sully-newspaper-delivery-action` | 昨日来信投递条按钮。 |
| `.sully-newspaper-modal` | 昨日来信存档弹窗遮罩。 |
| `.sully-newspaper-modal-sheet` | 昨日来信存档弹窗主体。 |
| `.sully-newspaper-modal-button` | 昨日来信存档弹窗按钮。 |
| `.sully-transfer-card` | 转账卡片。 |
| `.sully-transfer-top` | 转账卡片上半部分。 |
| `.sully-transfer-bottom` | 转账卡片底部说明。 |
| `.sully-transfer-watermark` | 转账卡片水印。 |
| `.sully-room-note-card` | 房间便签卡片外层。 |
| `.sully-room-note-body` | 房间便签卡片主体。 |
| `.sully-room-plan-card` | 房间计划卡片外层。 |
| `.sully-room-plan-body` | 房间计划卡片主体。 |
| `.sully-furniture-interaction-card` | 家具互动卡片外层。 |
| `.sully-furniture-interaction-body` | 家具互动卡片主体。 |
| `.sully-phone-card` | 手机证据卡片通用入口。 |
| `.sully-phone-wechat-card` | 手机证据：微信聊天。 |
| `.sully-phone-call-card` | 手机证据：通话记录。 |
| `.sully-phone-taobao-card` | 手机证据：淘宝订单。 |
| `.sully-phone-meituan-card` | 手机证据：美团外卖。 |
| `.sully-phone-social-card` | 手机证据：社交动态。 |
| `.sully-phone-default-card` | 手机证据：未知应用默认卡。 |
| `.sully-phone-netease-card` | 手机证据：网易云音乐。 |
| `.sully-phone-camera-card` | 手机证据：时光相机。 |
| `.afterglow-reader-backdrop` | 余晖读者模式背景。 |
| `.afterglow-reader-frame` | 余晖读者模式框架。 |
| `.afterglow-reader-shell` | 余晖读者模式主壳。 |
| `.afterglow-reader-close` | 余晖读者关闭按钮。 |
| `.afterglow-reader-stage` | 余晖读者内容舞台。 |
| `.afterglow-reader-page` | 余晖读者页面。 |
| `.afterglow-reader-action-dock` | 余晖读者操作栏。 |
| `.afterglow-reader-action` | 余晖读者操作按钮。 |
| `.ag-head` | 余晖页面头部。 |
| `.ag-brand` | 余晖品牌/标题。 |
| `.ag-foot` | 余晖页面底部。 |
| `.ag-chev` | 余晖翻页箭头。 |
| `.ag-ind` | 余晖页码指示器。 |
| `.ag-dot` | 余晖页码点。 |
| `.ag-count` | 余晖页码文本。 |

气泡工坊的 `卡片` 预览页已内部分页：`基础` 覆盖转发 / Canva / 音乐，`社交` 覆盖小红书 / 社交动态 / 朋友圈 / 典藏馆，`手机` 覆盖微信 / 外卖 / 淘宝 / 网易云，`房间` 覆盖便签 / 今日计划 / 家具互动 / 剧情手机，`新闻` 覆盖 B站 / 微博 / 知乎 / 百度 / 抖音 / 默认热榜卡，`小报` 覆盖昨日来信卡片、送达/失败投递条、生成中遮罩缩略态。关闭“跟随卡片品牌色”后，生成 CSS 会额外压住重点卡片内部文字、弱边框、新闻卡标题/描述/action 和昨日小报纸张变量。

## 主题作用域类名

当前主题 CSS 里已经出现的作用域：

```css
.theme-default.sully-chat-container
.theme-default .sully-chat-header
.theme-default .sully-chat-input
.theme-default .sully-transfer-card
.theme-default .sully-transfer-watermark
.theme-default .sully-transfer-bottom
.theme-default .sully-card-container
.theme-default .sully-msg-timestamp

.theme-glassmorphism .sully-bubble-tail
.theme-glassmorphism .sully-bubble-ai
.theme-glassmorphism .sully-bubble-user
.theme-glassmorphism .sully-chat-header
.theme-glassmorphism .sully-chat-input

.theme-waterdrop .sully-bubble-tail
.theme-waterdrop .sully-bubble-ai
.theme-waterdrop .sully-bubble-user
.theme-waterdrop .sully-chat-header
.theme-waterdrop .sully-chat-input
```

写自定义主题时，推荐这样套作用域：

```css
.theme-your-theme .sully-chat-container {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
}

.theme-your-theme .sully-bubble-ai {
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
}

.theme-your-theme .sully-bubble-user {
  background: #111827;
  color: #fff;
}
```

## 运行时/辅助类名

这些会影响安全区、性能或状态，不建议当作主要美化入口，除非你明确知道影响范围。

| 类名 / 变量 | 作用 |
| --- | --- |
| `.sully-active-app-container` | 活跃 App 外层容器。 |
| `.sully-app-root` | App 根节点相关。 |
| `.sully-safe-topbar` | 安全区顶部栏。 |
| `.sully-safe-topbar-compact` | 紧凑安全区顶部栏。 |
| `.sully-safe-topbar-spacious` | 宽松安全区顶部栏。 |
| `.sully-safe-overlay-top` | 顶部安全区覆盖层。 |
| `.sully-safe-floating-top` | 顶部浮层安全区。 |
| `.sully-perf-lite` | 性能轻量模式作用域。 |
| `.sully-gallery-grid-image` | 图库网格图片。 |
| `--sully-chat-status-space` | 聊天状态浮层顶部空间变量。 |
| `--sully-chat-header-height` | 聊天顶部栏高度变量。 |
| `--sully-chat-header-padding-top` | 聊天顶部栏安全区内边距变量。 |
| `--sully-resolved-app-top-inset` | 已解析的顶部安全区变量。 |

## 搜索到的 `sully-*` 完整列表

```text
sully-active-app-container
sully-app-root
sully-bubble-ai
sully-bubble-nested-scroll-active
sully-bubble-tail
sully-bubble-text
sully-bubble-user
sully-canva-card
sully-card-container
sully-chart-reading-card
sully-chat-bubble-wrapper
sully-chat-container
sully-chat-dock
sully-chat-header
sully-chat-header-avatar
sully-chat-header-back
sully-chat-header-button
sully-chat-header-call
sully-chat-header-subtitle
sully-chat-header-summary
sully-chat-header-title
sully-chat-header-token
sully-chat-header-trigger
sully-chat-input
sully-chat-input-emoji-button
sully-chat-input-emoji-item
sully-chat-input-icon-button
sully-chat-input-main
sully-chat-input-panel
sully-chat-input-panel-action
sully-chat-input-panel-action-icon
sully-chat-input-panel-item
sully-chat-input-panel-tab
sully-chat-input-panel-tabs
sully-chat-input-placeholder
sully-chat-input-plus-button
sully-chat-input-send-button
sully-chat-input-suggestion-item
sully-chat-input-suggestion-panel
sully-chat-input-textarea
sully-chat-input-textbox
sully-chat-messages
sully-chat-preview-list
sully-chat-selection-bar
sully-chat-selection-button
sully-chat-selection-danger
sully-chat-selection-forward
sully-chat-selection-soul
sully-collection-forward-card
sully-collection-forward-heart-card
sully-emoji-msg
sully-forward-card
sully-furniture-interaction-body
sully-furniture-interaction-card
sully-gallery-grid-image
sully-image-msg
sully-image-msg-shell
sully-image-preview-action
sully-image-preview-backdrop
sully-interaction-pill
sully-inner-voice-backdrop
sully-inner-voice-card
sully-inner-voice-close
sully-inner-voice-close-hint
sully-inner-voice-shell
sully-inner-voice-text
sully-inner-voice-title
sully-inner-voice-toggle
sully-message-action-button
sully-message-action-danger
sully-message-action-modal
sully-message-avatar
sully-message-avatar-ai
sully-message-avatar-badge
sully-message-avatar-badge-afterglow
sully-message-avatar-badge-inner-voice
sully-message-avatar-badge-retry
sully-message-avatar-badge-story-phone
sully-message-avatar-badge-surprise
sully-message-avatar-badge-wrap
sully-message-avatar-decoration
sully-message-avatar-image
sully-message-avatar-loading
sully-message-avatar-user
sully-message-selection-check
sully-message-selection-checkbox
sully-message-selection-checkbox-wrap
sully-msg-timestamp
sully-news-card
sully-news-card-action
sully-news-card-badge
sully-news-card-baidu
sully-news-card-bilibili
sully-news-card-default
sully-news-card-desc
sully-news-card-douyin
sully-news-card-footer
sully-news-card-header
sully-news-card-rank
sully-news-card-title
sully-news-card-weibo
sully-news-card-zhihu
sully-newspaper-card
sully-newspaper-delivery
sully-newspaper-delivery-action
sully-newspaper-delivery-mark
sully-newspaper-delivery-modal
sully-newspaper-delivery-stack
sully-newspaper-modal
sully-newspaper-modal-button
sully-newspaper-modal-sheet
sully-perf-lite
sully-phone-call-card
sully-phone-camera-card
sully-phone-card
sully-phone-default-card
sully-phone-meituan-card
sully-phone-netease-card
sully-phone-social-card
sully-phone-taobao-card
sully-phone-wechat-card
sully-recording-bubble
sully-recording-bubble-wrap
sully-recording-cancel-label
sully-recording-convert-label
sully-recording-duration
sully-recording-overlay
sully-recording-send-label
sully-room-note-body
sully-room-note-card
sully-room-plan-body
sully-room-plan-card
sully-safe-floating-top
sully-safe-overlay-top
sully-safe-topbar
sully-safe-topbar-compact
sully-safe-topbar-spacious
sully-social-card
sully-song-share-card
sully-soul-reflection-card
sully-status-card-collection-button
sully-status-card-overlay-shell
sully-story-phone-card
sully-system-notice-card
sully-system-notice-card-dark
sully-system-pill
sully-system-text-scope
sully-theme-overlay-backdrop
sully-theme-overlay-modal
sully-theme-overlay-primary-button
sully-theme-overlay-secondary-button
sully-thinking-scroll
sully-afterglow-composer-backdrop
sully-afterglow-composer-button
sully-afterglow-composer-dialog
sully-transfer-bottom
sully-transfer-card
sully-transfer-top
sully-transfer-watermark
sully-typing-bubble
sully-typing-tail
sully-voice-bar
sully-voice-bubble
sully-voice-call-card
sully-voice-record-button
sully-wechat-converting-modal
sully-wechat-converting-overlay
sully-wechat-input-emoji-button
sully-wechat-input-main
sully-wechat-input-mode-button
sully-wechat-input-plus-button
sully-wechat-input-send-button
sully-wechat-input-textarea
sully-wechat-input-textbox
sully-wechat-moments-card
sully-wechat-recording-bubble
sully-wechat-recording-bubble-wrap
sully-wechat-recording-overlay
sully-wechat-voice-hold
sully-xhs-card
```

注意：`sully-bubble-`、`sully-image-` 这种搜索结果是模板字符串前缀，不是完整可直接使用的类名。
