# 顶部栏和底部输入栏美化类名

整理日期：2026-06-15

这份是从总清单里单独拆出来的快捷文件，只放聊天页最常改的两个固定区域：顶部栏和底部输入栏。完整总表仍在 `docs/chat-beauty-classnames.md`。

## 顶部栏

来源：`components/chat/ChatHeader.tsx`

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-chat-header` | 顶部栏整块，控制背景、高度、安全区、边框、阴影、毛玻璃。 |
| `.sully-chat-header-button` | 顶部栏所有图标按钮的通用入口。 |
| `.sully-chat-header-back` | 返回按钮。 |
| `.sully-chat-header-call` | 通话按钮。 |
| `.sully-chat-header-trigger` | 手动触发 AI / 闪电按钮。 |
| `.sully-chat-header-avatar` | 角色头像。 |
| `.sully-chat-header-title` | 角色名。 |
| `.sully-chat-header-subtitle` | Online / 状态副标题。 |
| `.sully-chat-header-token` | 顶部栏 token 小标签。 |
| `.sully-chat-header-summary` | 记忆整理提示条。 |

当前顶部栏主要 className：

```tsx
className="sully-chat-header min-h-[6rem] pt-10 bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shrink-0 z-30 sticky top-0 shadow-sm relative transition-all duration-300"
className="sully-chat-header-button sully-chat-header-back p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full"
className="sully-chat-header-avatar w-10 h-10 rounded-xl object-cover shadow-sm"
className="sully-chat-header-title font-bold text-slate-800"
className="sully-chat-header-subtitle text-[10px] text-slate-400 uppercase"
className="sully-chat-header-token text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded-md font-mono border border-slate-200"
className="sully-chat-header-button sully-chat-header-call p-2 -mr-1 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
className={`sully-chat-header-button sully-chat-header-trigger p-2 rounded-full ${isTyping ? 'bg-slate-100' : 'bg-primary/10 text-primary'}`}
className="sully-chat-header-summary absolute top-full left-0 w-full bg-indigo-50 border-b border-indigo-100 p-2 flex items-center justify-center gap-2"
```

## 底部输入栏

来源：`apps/Chat.tsx`、`components/chat/ChatInputArea.tsx`、`components/chat/VoiceRecordButton.tsx`、`components/chat/plugins/WeChatInputBar.tsx`

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-chat-dock` | 底部输入/待发送动作区域外层。 |
| `.sully-chat-input` | 底部输入栏整块，控制背景、边框、安全区、毛玻璃。 |
| `.sully-chat-input-main` | 输入栏主行。 |
| `.sully-chat-input-icon-button` | 输入栏普通图标按钮通用入口。 |
| `.sully-chat-input-plus-button` | 加号 / 更多按钮。 |
| `.sully-chat-input-textbox` | 输入框外壳。 |
| `.sully-chat-input-textarea` | 真实文本输入区。 |
| `.sully-chat-input-placeholder` | placeholder 或按住说话提示文字。 |
| `.sully-chat-input-emoji-button` | 表情按钮。 |
| `.sully-chat-input-send-button` | 发送按钮，也会作用到语音发送位按钮。 |
| `.sully-voice-record-button` | 默认主题语音录制按钮。 |
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

当前默认输入栏主要 className：

```tsx
className="sully-chat-input bg-white/90 backdrop-blur-2xl border-t border-slate-200/50 pb-safe shrink-0 z-40 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] relative transition-all duration-300"
className="sully-chat-input-main p-3 px-4 flex gap-3 items-end"
className="sully-chat-input-icon-button sully-chat-input-plus-button w-11 h-11 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
className="sully-chat-input-textbox flex-1 min-w-0 bg-slate-100 rounded-[24px] flex items-center px-1 border border-transparent focus-within:bg-white focus-within:border-primary/30 transition-all overflow-hidden"
className={`sully-chat-input-textarea flex-1 min-w-0 bg-transparent px-4 py-3 ${useIOSStandaloneInputFix ? 'text-[16px]' : 'text-[15px]'} resize-none max-h-24 no-scrollbar`}
className="sully-chat-input-emoji-button p-2 shrink-0 text-slate-400 hover:text-primary"
className="sully-chat-input-send-button w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-all bg-primary text-white shadow-lg"
className="sully-chat-input-panel bg-slate-50 h-72 border-t border-slate-200/60 overflow-hidden relative z-0 flex flex-col"
```

## 微信插件输入栏

默认微信主题会走 `components/chat/plugins/WeChatInputBar.tsx`。它复用 `.sully-chat-input-*`，同时有更细的微信专属入口。

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-wechat-input-main` | 微信插件输入栏主行。 |
| `.sully-wechat-input-mode-button` | 语音/键盘切换按钮。 |
| `.sully-wechat-input-textbox` | 文本输入框外壳。 |
| `.sully-wechat-input-textarea` | 文本输入区。 |
| `.sully-wechat-input-emoji-button` | 表情按钮。 |
| `.sully-wechat-input-send-button` | 发送按钮。 |
| `.sully-wechat-input-plus-button` | 更多按钮。 |
| `.sully-wechat-voice-hold` | “按住说话”区域。 |
| `.sully-wechat-recording-overlay` | 微信录音覆盖层。 |
| `.sully-wechat-recording-bubble-wrap` | 微信录音气泡定位外壳。 |
| `.sully-wechat-recording-bubble` | 微信录音气泡。 |
| `.sully-wechat-converting-overlay` | 语音转文字遮罩。 |
| `.sully-wechat-converting-modal` | 语音转文字弹窗。 |

当前微信输入栏主要 className：

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
```

## 录音覆盖层

默认录音按钮和微信录音都会复用这些入口。

| 类名 / 选择器 | 作用 |
| --- | --- |
| `.sully-recording-overlay` | 录音覆盖层。 |
| `.sully-recording-bubble-wrap` | 录音提示气泡定位外壳，微信插件使用。 |
| `.sully-recording-bubble` | 录音提示气泡。 |
| `.sully-recording-cancel-label` | 上滑取消提示。 |
| `.sully-recording-convert-label` | 微信录音转文字提示。 |
| `.sully-recording-send-label` | 微信录音松开发送提示。 |
| `.sully-recording-duration` | 录音计时。 |

当前录音相关主要 className：

```tsx
className={`sully-chat-input-send-button sully-voice-record-button w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-all select-none ...`}
className="sully-recording-overlay fixed inset-0 z-[999] flex flex-col items-center justify-end pb-32 pointer-events-none"
className={`sully-recording-bubble relative pointer-events-none px-8 py-5 rounded-3xl backdrop-blur-2xl shadow-2xl border transition-all duration-200 ...`}
className={`sully-recording-cancel-label text-center text-xs font-bold mb-3 transition-colors ...`}
className="sully-recording-duration text-center text-white text-lg font-mono font-bold tracking-wider"
className="sully-recording-overlay sully-wechat-recording-overlay"
className="sully-recording-bubble-wrap sully-wechat-recording-bubble-wrap"
className="sully-recording-bubble sully-wechat-recording-bubble"
className="sully-recording-convert-label"
className="sully-recording-send-label"
```

## 气泡工坊支持情况

这些顶部栏和底部输入栏类名已经进入气泡工坊高级 CSS 白名单。结构化控件目前覆盖：

- 顶部栏外壳、头像、标题、副标题、按钮、记忆整理条。
- 输入栏外壳、输入框、按钮、展开面板、表情联想浮层、面板标签、表情/动作格子。
- 录音覆盖层和多选底部操作栏。

`.sully-chat-header-token` 是顶部栏 token 小标签，已加入高级 CSS 白名单；它主要适合用高级 CSS 单独改徽标颜色、边框和字号。
