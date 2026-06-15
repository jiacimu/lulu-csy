# 气泡工坊全量自定义升级规划

整理日期：2026-06-15

## 目标

把现有「气泡工坊」从“主要编辑用户/角色气泡 + 高级 CSS”的工具，升级成「聊天皮肤工作台」：

- 聊天界面里的主要可见区域都能结构化自定义。
- 每个可自定义区域都有对应预览。
- 预览要覆盖正常、加载、失败、展开、选中、插件等状态。
- 编辑区和预览区都要分页，避免所有控件堆在一个长面板里。
- 保留旧主题兼容：已有 `ChatTheme.user`、`ChatTheme.ai`、`customCss` 不能失效。

## 当前事实

现有核心文件：

- `apps/ThemeMaker.tsx`：当前气泡工坊页面。
- `types/chat.ts`：`BubbleStyle` 和 `ChatTheme` 类型定义。
- `components/chat/ChatConstants.ts`：内置主题 `default`、`waterdrop`、`glassmorphism`。
- `components/chat/ThemeRegistry.ts`：主题插件注册，默认微信主题有自定义输入栏、转账卡、语音条、动作面板。
- `apps/Chat.tsx`：实际聊天页注入 `activeTheme.customCss`，并给根容器挂 `theme-${activeTheme.baseThemeId || activeTheme.id}`。
- `components/chat/MessageItem.tsx`：实际消息类型渲染入口。
- `components/chat/ChatHeader.tsx`、`ChatInputArea.tsx`、`ChatBubble.tsx`、`VoiceBubble.tsx`：顶部栏、底部输入栏、文字气泡、语音气泡。

现有结构：

- `ChatTheme` 只有 `user`、`ai` 两套 `BubbleStyle`，外加 `customCss`。
- `BubbleStyle` 支持文字颜色、背景色、底纹、底纹透明度、圆角、透明度、气泡尾巴、渐变、边框、阴影、字号、文字阴影、气泡贴纸、头像挂件。
- `ThemeMaker` 当前主分页只有 `用户气泡 / 角色气泡 / CSS`。
- `ThemeMaker` 当前子分页只有 `基础样式 / 气泡贴纸 / 头像挂件`。
- 当前预览包含：顶部栏简版、文字消息、图片消息、时间戳、语音消息、转账卡、底部输入栏简版。
- 顶部栏、底部输入栏、时间戳、系统提示、图片、表情、互动、卡片等主要依靠 `customCss`，还没有结构化可视化控件。

## 已开始实施

2026-06-15 第一轮地基：

- `types/chat.ts` 已扩展 V2 可选字段：`version`、`tokens`、`surfaces`、`previewSettings`、`generatedCss`。
- 新增 `components/theme-maker/themeSchema.ts`：
  - 提供 V2 默认 token / surfaces。
  - 提供 `createThemeMakerDraft`。
  - 提供 `migrateChatThemeToV2`。
  - 提供 `parseImportedChatTheme`，旧 JSON 导入时会自动补齐 V2 字段。
- 新增 `components/theme-maker/previewFixtures.ts`：
  - 统一维护编辑器一级分页。
  - 统一维护预览分页。
  - 统一维护预览文案和转账状态假数据。
- `apps/ThemeMaker.tsx` 已接入：
  - 新主题默认创建 V2 草稿。
  - 编辑旧主题时自动 hydrate 到 V2。
  - 导入主题时自动 normalize 到 V2。
  - 保存主题前同步迁移，确保 `surfaces.bubbles.user/ai` 跟当前气泡设置一致。
  - 预览区已有分页：总览、文字、媒体、提示、卡片、输入栏、覆盖层、极限。
  - 编辑区已有一级分页骨架：总览、页面、顶部栏、消息、媒体、提示、卡片、输入栏、高级。
  - 旧的用户/角色气泡控件保留在 `消息` 页，CSS 保留在 `高级` 页。

2026-06-15 第二轮 Phase 3 起步：

- 新增 `components/theme-maker/themeCss.ts`：
  - 将 V2 `surfaces` 生成 `generatedCss`。
  - 生成 CSS 先于用户 `customCss` 注入，保留高级 CSS 覆盖权。
  - 已覆盖 `.sully-chat-container`、`.sully-chat-messages`、`.sully-chat-header`、`.sully-chat-input`、时间戳、提示、卡片、图片、语音等第一批入口。
- `components/chat/ChatHeader.tsx` 已补语义类名：
  - `.sully-chat-header-avatar`
  - `.sully-chat-header-title`
  - `.sully-chat-header-subtitle`
  - `.sully-chat-header-token`
  - `.sully-chat-header-button`
  - `.sully-chat-header-summary`
- `components/chat/ChatInputArea.tsx` 已补语义类名：
  - `.sully-chat-input-main`
  - `.sully-chat-input-textbox`
  - `.sully-chat-input-textarea`
  - `.sully-chat-input-icon-button`
  - `.sully-chat-input-emoji-button`
  - `.sully-chat-input-send-button`
  - `.sully-chat-input-panel`
- `页面`、`顶部栏`、`输入栏` 三页已从占位升级为第一批真实结构化控件。
- `总览`、`媒体`、`提示`、`卡片`、`覆盖层` 已从占位升级为第一批真实结构化控件：
  - 总览：全局 token、强调色、页面背景、表面色、主/次文字、边框、圆角、阴影、动效强度。
  - 媒体：用户/角色语音条、图片消息、表情消息。
  - 提示：时间戳、系统提示、互动提示。
  - 卡片：转账卡片、通用卡片、品牌色跟随开关；关闭品牌跟随时会强制覆盖重点卡片内部文字/边框。
  - 覆盖层：遮罩、弹窗主体、主按钮、次按钮、图片大图预览动作按钮。
- 真实表情消息新增 `.sully-emoji-msg` 语义类名。
- 微信插件输入栏已补 `.sully-wechat-*` 语义类名，并复用 `.sully-chat-input-*` 生成样式。
- 默认录音按钮和微信录音覆盖层已补 `.sully-recording-*` 语义类名，并接入 `input.recordingOverlay` 控件。
- 底部表情联想浮层、分类标签、表情格子、更多动作图标已补 `.sully-chat-input-panel-*` / `.sully-chat-input-suggestion-*` 类名，并接入 `input.panelTabs`、`input.panelItem`、`input.suggestionPanel` 控件。
- 选择模式底栏已补 `.sully-chat-selection-*` 类名，并接入 `input.selectionBar`、`input.selectionButton`、`input.dangerButton` 控件。
- 真实专项卡片已统一补 `.sully-card-container` 和专属入口，包括转发、Canva、小红书、社交卡、系统通知、星盘、回神、语音通话、典藏馆、音乐分享、朋友圈、剧情手机、房间便签/计划、家具互动、手机证据子卡、多平台新闻/热榜卡、昨日来信/回望小报。
- 卡片预览页已加入内部分页画廊，按“基础 / 社交 / 手机 / 房间 / 新闻 / 小报”查看重点卡片，每页控制在 3 到 4 张，避免挤爆手机宽度；新闻页会同时展示 B站、微博、知乎、百度、抖音和默认热榜卡。
- 高级 CSS 白名单和选择器速查已扩展到输入栏细分、录音、多选底栏、消息选择框、头像徽标、消息操作菜单、图片预览动作按钮、心声/状态/番外篇覆盖层、专项卡片、多平台新闻卡和昨日小报投递/存档状态。
- 通用弹窗、语音转文字 overlay、图片预览遮罩/动作按钮已接入覆盖层或图片预览选择器，覆盖层预览页已有真实图片大图状态。
- 消息长按菜单、消息多选勾选框、消息流头像、头像右上角状态徽标、经典心声、状态卡片收藏、番外篇/谈心命题弹窗已补 `.sully-message-*`、`.sully-inner-voice-*`、`.sully-status-card-*`、`.sully-afterglow-composer-*` 入口；气泡工坊输入栏/覆盖层预览页已有缩略态。
- 多平台 `news_card` 已补 `.sully-news-card`、`.sully-news-card-{platform}`、标题、描述、标签、排名、底部和打开动作入口；关闭“跟随卡片品牌色”时，生成 CSS 会同步覆盖标题/描述/action。
- 昨日小报本体、投递条、生成中遮罩缩略态、存档弹窗已补 `.sully-newspaper-*` 入口；关闭“跟随卡片品牌色”时，生成 CSS 会同步覆盖小报纸张、墨色、弱文字、线条和强调色变量。
- 气泡工坊预览和真实聊天页都会注入 `generatedCss`，保存后主题可应用到真实聊天页。

下一步优先继续做专项卡片更细的内部 token 化，以及真实聊天页的移动端/桌面视觉 QA。

## 全量自定义范围

### 1. 整页聊天容器

目标选择器：

- `.sully-chat-container`
- `.sully-chat-messages`
- `.sully-chat-dock`

可配置项：

- 背景色、渐变、背景图、背景图透明度。
- 背景纹理/点阵开关。
- 消息区上下内边距、左右内边距。
- 消息间距、消息最大宽度、用户/角色横向偏移。
- 全局字体、全局文字颜色、弱文字颜色。
- 运动强度：普通、轻量、关闭。

预览状态：

- 普通聊天流。
- 长聊天流滚动。
- 自定义背景图。
- 性能轻量模式。

### 2. 顶部栏

目标选择器：

- `.sully-chat-header`
- `.sully-chat-header-avatar`
- `.sully-chat-header-title`
- `.sully-chat-header-subtitle`
- `.sully-chat-header-token`
- `.sully-chat-header-button`
- `.sully-chat-header-summary`

可配置项：

- 顶部栏背景、模糊、边框、阴影、高度、安全区额外高度。
- 返回按钮样式：大小、颜色、背景、圆角、图标显示。
- 角色头像：尺寸、圆角、边框、阴影。
- 角色名：字号、字重、颜色。
- 副标题/Online/Token：是否显示、颜色、背景、圆角。
- 通话按钮、闪电按钮：颜色、背景、选中/禁用态。
- 多选模式顶部栏。
- 记忆整理提示条。

预览状态：

- 普通顶部栏。
- 正在输入。
- 记忆整理中。
- 多选模式。
- 默认微信主题标题居中布局。

### 3. 消息列表与头像

目标区域：

- `MessageItem` 的通用布局。
- 用户/角色头像区域。
- 分组、选中、长按态。

可配置项：

- 头像尺寸、头像圆角、头像边框、头像阴影。
- 头像挂件沿用 `BubbleStyle.avatarDecoration`，后续可升级为共享 `avatar.user/ai`。
- 消息最大宽度。
- 头像和气泡间距。
- 组内消息间距、组间消息间距。
- 选中态圆圈颜色、尺寸、位置。
- 长按/点击缩放强度。

预览状态：

- 用户消息。
- 角色消息。
- 连续消息。
- 多选模式。
- 带头像挂件。

### 4. 文字气泡

目标选择器：

- `.sully-chat-bubble-wrapper`
- `.sully-bubble-user`
- `.sully-bubble-ai`
- `.sully-bubble-text`
- `.sully-bubble-tail`
- `.sully-bubble-tail polygon`

已有配置保留并增强：

- 背景、渐变、底纹、透明度。
- 文字颜色、字号、文字阴影。
- 圆角、边框、阴影。
- 内边距、紧凑度。
- 气泡尾巴显示/隐藏。
- 气泡贴纸。

新增配置：

- 用户/角色分别设置最大宽度。
- 链接颜色。
- 引用块样式。
- 翻译按钮样式。
- 来源标签样式。
- 思考链入口样式。

预览状态：

- 短文本。
- 长文本。
- 多行文本。
- 带引用。
- 带翻译按钮。
- 带来源标签。
- 带思考链折叠/展开。

### 5. 语音消息

目标选择器：

- `.sully-voice-bubble`
- `.sully-voice-bar`

可配置项：

- 语音条背景、文字、圆角、边框、阴影。
- 语音条宽度规则：短、中、长。
- 播放图标颜色。
- 波形条颜色、宽度、间距、动效强度。
- 转文字按钮样式。
- 转文字展开框样式。
- 加载/失败态样式。

预览状态：

- 未播放。
- 播放中。
- 加载中。
- 失败可重试。
- 转文字展开。
- 兼容 `<语音>` 文本导入。

### 6. 图片与表情

目标选择器：

- `.sully-image-msg-shell`
- `.sully-image-msg`
- `.sully-emoji-msg`
- `.sully-image-preview-backdrop`
- `.sully-image-preview-action`
- `chat-emoji-image` 测试标记对应同一张表情图片。

可配置项：

- 图片圆角、边框、阴影、最大宽高。
- 图片加载占位尺寸、背景、图标。
- 图片失败态颜色。
- 大图预览背景、关闭按钮、下载按钮。
- 表情最大尺寸、阴影、点击缩放。

预览状态：

- 普通图片。
- 图片生成中。
- 图片发送失败。
- 大图预览。
- 普通表情。

### 7. 时间戳、系统提示、互动提示

目标选择器：

- `.sully-msg-timestamp`
- `.sully-system-pill`
- `.sully-interaction-pill`

可配置项：

- 时间戳显示开关、间隔、字体、颜色、背景、圆角、间距。
- 系统提示背景、文字、边框、阴影、图标。
- 互动提示背景、文字、图标、动效。

预览状态：

- 普通时间戳。
- 系统灰色胶囊。
- 带来源的系统卡片。
- 戳一戳。

### 8. 转账与通用卡片

目标选择器：

- `.sully-card-container`
- `.sully-transfer-card`
- `.sully-transfer-top`
- `.sully-transfer-bottom`
- `.sully-transfer-watermark`

可配置项：

- 通用卡片背景、边框、圆角、阴影、宽度。
- 卡片标题/正文/弱文字颜色。
- 转账卡主色、底部色、金额字号、图标颜色。
- pending、accepted、returned 三种状态。

预览状态：

- 转账待收。
- 已收款。
- 已退还。
- 转发卡片。
- 收藏转发卡片。
- Canva 卡片。
- 小红书卡片。
- 朋友圈卡片。
- 社交帖子卡片。

### 9. 新闻、音乐、电话与专项卡片

目标组件：

- `SongShareCardBubble`
- `news_card` 各平台变体。
- `VoiceCallSummaryCard`
- `PhoneEvidenceCard`
- `StoryPhoneEvidenceCard`
- `RoomNoteCard`
- `RoomPlanCard`
- `FurnitureInteractionCard`
- `YesterdayNewspaper`

可配置策略：

- 第一阶段不为每个专项卡片做完整细项面板，先提供 `cardTheme` 级别结构化配置：背景、文字、边框、圆角、阴影、宽度、品牌色。
- 对品牌强绑定卡片，例如微博、B 站、知乎、抖音，可以提供“跟随品牌 / 跟随主题”切换。
- 对复杂专项卡片保留高级 CSS 选择器与预览。

预览状态：

- 音乐卡片 + 打开确认弹窗。
- 新闻卡片：B 站、微博、知乎、百度、抖音、默认。
- 通话总结。
- 手机证据。
- 房间便签。
- 房间计划。
- 家具互动。
- 昨日小报缩略。

### 10. 底部输入栏

目标选择器：

- `.sully-chat-input`
- `.sully-chat-input-main`
- `.sully-chat-input-textbox`
- `.sully-chat-input-textarea`
- `.sully-chat-input-icon-button`
- `.sully-chat-input-emoji-button`
- `.sully-chat-input-send-button`
- `.sully-chat-input-panel`

可配置项：

- 输入栏背景、模糊、边框、阴影、安全区。
- 默认输入行高度、间距、圆角。
- 加号按钮、表情按钮、发送按钮、语音按钮。
- 文本框背景、文字、placeholder、聚焦态。
- 选择模式底栏。
- 表情建议浮层。
- 表情分类栏。
- 表情网格。
- 表情管理栏。
- 更多动作面板。
- 主题切换面板。
- 语音录制覆盖层。

预览状态：

- 空输入，显示语音按钮。
- 有输入，显示发送按钮。
- 表情建议浮层。
- 表情面板。
- 更多动作面板。
- 选择模式。
- 语音录制中。
- 微信插件输入栏。

### 11. 弹窗与覆盖层

目标范围：

- 图片预览。
- 音乐打开确认弹窗。
- 快速写歌弹窗。
- 消息操作弹窗。
- 导入/导出面板。

可配置项：

- 背景遮罩色、模糊。
- 弹窗背景、边框、圆角、阴影。
- 主按钮、次按钮。
- 顶部拖拽条。

预览状态：

- 图片预览。
- 音乐确认。
- 主题导入/导出。

## 分页设计

### 编辑器一级分页

建议把当前 `用户气泡 / 角色气泡 / CSS` 改成完整分页：

1. `总览`
   - 主题名称、基底主题、保存、导入、导出、重置。
   - 全局 token：主色、背景、文字、弱文字、圆角、阴影、动效强度。

2. `页面`
   - 聊天容器。
   - 消息滚动区。
   - 背景图/纹理。
   - 消息密度。

3. `顶部栏`
   - 顶部栏外壳。
   - 返回/更多/通话/闪电按钮。
   - 头像、标题、副标题、状态提示。

4. `消息`
   - 用户气泡。
   - 角色气泡。
   - 头像与分组。
   - 引用、翻译、思考链。

5. `媒体`
   - 语音消息。
   - 图片消息。
   - 表情。
   - 图片预览。

6. `提示`
   - 时间戳。
   - 系统提示。
   - 互动提示。
   - 加载/失败态。

7. `卡片`
   - 转账。
   - 通用卡片。
   - 社交/小红书/朋友圈/Canva。
   - 音乐/新闻/电话/房间专项卡片。

8. `输入栏`
   - 默认输入栏。
   - 表情面板。
   - 更多动作。
   - 选择模式。
   - 语音录制覆盖层。
   - 微信插件输入栏。

9. `高级`
   - CSS 编辑器。
   - 选择器速查。
   - 风险提示。
   - 快速模板。

### 二级分页

每个一级分页内部用小型 segmented tabs，不再用很长的折叠面板。

示例：

- `顶部栏`：外壳 / 标题区 / 按钮 / 状态条。
- `消息`：用户 / 角色 / 头像 / 扩展状态。
- `媒体`：语音 / 图片 / 表情 / 预览层。
- `卡片`：基础 / 转账 / 社交 / 新闻 / 专项。
- `输入栏`：外壳 / 输入行 / 表情 / 动作 / 录音。

### 预览分页

预览区独立分页，不跟编辑区完全绑定，避免用户改一个字段时只能看到一个局部。

建议预览页：

1. `聊天总览`
   - 顶部栏、消息流、底部输入栏同屏。

2. `文字气泡`
   - 短句、长句、多行、引用、翻译、思考链、来源标签。

3. `媒体消息`
   - 语音、语音加载、语音失败、图片、图片加载、图片失败、表情。

4. `提示状态`
   - 时间戳、系统胶囊、来源系统卡片、互动提示、正在输入。

5. `卡片画廊`
   - 转账、转发、收藏转发、Canva、小红书、朋友圈、社交、音乐、新闻。
   - 卡片画廊内部再分页，每页 4 到 6 张卡，避免挤爆手机宽度。

6. `输入栏`
   - 默认输入、表情建议、表情面板、更多动作、选择模式、录音覆盖层。

7. `覆盖层`
   - 图片预览、音乐确认、导入导出、消息操作。

8. `移动端极限`
   - 小屏、长标题、长文本、超大字号、背景图。

## 数据模型建议

不要把所有字段继续塞进 `BubbleStyle`。建议保留旧字段，并给 `ChatTheme` 增加可选 V2 配置：

```ts
export interface ChatTheme {
    id: string;
    name: string;
    type: 'preset' | 'custom';
    baseThemeId?: string;
    user: BubbleStyle;
    ai: BubbleStyle;
    customCss?: string;
    showTimestamp?: boolean;
    timestampIntervalMs?: number;

    version?: 2;
    tokens?: ChatThemeTokens;
    surfaces?: ChatThemeSurfaces;
    previewSettings?: ChatThemePreviewSettings;
}
```

建议新增结构：

```ts
type ThemeRole = 'user' | 'ai';

interface ThemePaint {
    background?: string;
    gradient?: { from: string; to: string; direction: number };
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    color?: string;
    mutedColor?: string;
    borderColor?: string;
    borderWidth?: number;
    radius?: number;
    shadow?: string;
    blur?: number;
    opacity?: number;
}

interface ThemeTypography {
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
    textShadow?: string;
}

interface ThemeBox {
    paddingX?: number;
    paddingY?: number;
    gap?: number;
    width?: number;
    height?: number;
    maxWidth?: number;
}

interface ChatThemeTokens {
    accent?: string;
    accentText?: string;
    pageBackground?: string;
    surface?: string;
    text?: string;
    mutedText?: string;
    border?: string;
    radius?: number;
    shadow?: string;
    motionScale?: 'off' | 'lite' | 'normal';
}

interface ChatThemeSurfaces {
    container?: ThemePaint & ThemeBox;
    messageList?: ThemeBox & { density?: 'compact' | 'normal' | 'spacious' };
    header?: {
        shell?: ThemePaint & ThemeBox;
        avatar?: ThemePaint & ThemeBox;
        title?: ThemeTypography & ThemePaint;
        subtitle?: ThemeTypography & ThemePaint & { visible?: boolean };
        buttons?: ThemePaint & ThemeBox;
        summarizingBar?: ThemePaint & ThemeTypography;
    };
    bubbles?: Record<ThemeRole, BubbleStyle>;
    voice?: Record<ThemeRole, ThemePaint & ThemeBox & ThemeTypography>;
    image?: ThemePaint & ThemeBox;
    emoji?: ThemePaint & ThemeBox;
    timestamp?: ThemePaint & ThemeBox & ThemeTypography & { visible?: boolean; intervalMs?: number };
    systemPill?: ThemePaint & ThemeBox & ThemeTypography;
    interactionPill?: ThemePaint & ThemeBox & ThemeTypography;
    transferCard?: ThemePaint & ThemeBox;
    card?: ThemePaint & ThemeBox & ThemeTypography & { followBrandColor?: boolean };
    input?: {
        shell?: ThemePaint & ThemeBox;
        textBox?: ThemePaint & ThemeTypography;
        iconButton?: ThemePaint & ThemeBox;
        sendButton?: ThemePaint & ThemeBox & ThemeTypography;
        panels?: ThemePaint & ThemeBox;
        recordingOverlay?: ThemePaint & ThemeBox & ThemeTypography;
    };
    overlays?: {
        backdrop?: ThemePaint;
        modal?: ThemePaint & ThemeBox;
        primaryButton?: ThemePaint & ThemeTypography;
        secondaryButton?: ThemePaint & ThemeTypography;
    };
}
```

兼容策略：

- 旧主题没有 `version` 时，按 V1 读取。
- 保存时写入 `version: 2`，但继续同步 `user` 和 `ai`，让旧聊天页仍能渲染。
- 导入旧 JSON 时走 `parseImportedTheme`，自动补 `version`、`tokens`、`surfaces` 默认值。
- `customCss` 保持高级逃生口，结构化控件生成的样式尽量通过 CSS 变量或专门的 `generatedCss` 生成，不直接覆盖用户手写 CSS。

## 实现架构建议

### 文件拆分

当前 `apps/ThemeMaker.tsx` 已经很大，升级时建议拆分：

```text
apps/ThemeMaker.tsx
components/theme-maker/ThemeMakerShell.tsx
components/theme-maker/ThemePreviewPhone.tsx
components/theme-maker/PreviewPager.tsx
components/theme-maker/EditorPager.tsx
components/theme-maker/pages/OverviewPage.tsx
components/theme-maker/pages/PageSurfacePage.tsx
components/theme-maker/pages/HeaderPage.tsx
components/theme-maker/pages/MessagePage.tsx
components/theme-maker/pages/MediaPage.tsx
components/theme-maker/pages/NoticePage.tsx
components/theme-maker/pages/CardPage.tsx
components/theme-maker/pages/InputPage.tsx
components/theme-maker/pages/AdvancedCssPage.tsx
components/theme-maker/controls/ColorAlphaControl.tsx
components/theme-maker/controls/GradientControl.tsx
components/theme-maker/controls/RangeRow.tsx
components/theme-maker/controls/StylePresetRow.tsx
components/theme-maker/previewFixtures.ts
components/theme-maker/themeSchema.ts
components/theme-maker/themeCss.ts
```

### 核心模块

- `themeSchema.ts`
  - 默认 V2 主题。
  - V1 到 V2 迁移。
  - 导入 JSON normalize。
  - 字段路径更新 helper。

- `themeCss.ts`
  - 把 `tokens/surfaces` 转成 CSS 变量或 scoped CSS。
  - 生成 `.theme-{id}` 作用域样式。
  - 保证用户手写 `customCss` 最后注入，仍可覆盖。

- `previewFixtures.ts`
  - 固定预览消息。
  - 固定卡片数据。
  - 固定角色头像、用户头像、长标题、长文本。

- `ThemePreviewPhone.tsx`
  - 负责预览手机框和 `style` 注入。
  - 复用真实组件：`ChatBubble`、`VoiceBubble`、`DefaultTransferCard`、各类卡片组件。
  - 对无法低成本复用的完整 Chat 输入链路，用 preview-only 轻量组件，但 className 与真实页面保持一致。

## 分阶段实施

### Phase 1：审计与 schema 地基

交付：

- 新增 `themeSchema.ts`。
- 新增 `ChatThemeV2` 相关类型。
- `parseImportedTheme` 支持 V1/V2。
- 增加 V2 默认主题。
- 不改变现有 UI。

验收：

- 旧主题导入后仍保留用户/角色气泡。
- 保存新主题后 `user/ai/customCss` 仍存在。
- 轻量测试覆盖 normalize/migrate。

### Phase 2：分页壳与预览分页

交付：

- 拆出 `ThemeMakerShell`。
- 新增一级编辑分页。
- 新增预览分页。
- 先把现有控件原样搬进 `消息 > 用户/角色`。
- 预览页至少覆盖：总览、文字气泡、媒体消息、提示状态、输入栏。

验收：

- 分页切换不丢正在编辑的数据。
- 保存、导入、导出、重置仍可用。
- 现有用户/角色气泡功能不回退。

### Phase 3：顶部栏、页面、输入栏结构化配置

交付：

- 页面容器配置。
- 顶部栏配置。
- 输入栏配置。
- CSS 生成器把结构化字段作用到真实类名。

验收：

- `.sully-chat-container`、`.sully-chat-header`、`.sully-chat-input` 都可不用手写 CSS 修改主要视觉。
- 对应预览页实时生效。
- 实际聊天页和气泡工坊预览一致。

### Phase 4：媒体、提示、卡片配置

交付：

- 语音、图片、表情配置。
- 时间戳、系统提示、互动提示配置。
- 通用卡片、转账卡配置。
- 卡片画廊分页。

验收：

- 预览覆盖加载/失败/展开状态。
- 卡片画廊可分页查看所有重点卡片。
- 复杂品牌卡片可选择“跟随品牌 / 跟随主题”。

### Phase 5：高级 CSS 与安全护栏升级

交付：

- CSS 白名单扩展到新增选择器。
- 选择器速查按区域分组。
- 自动生成 CSS 与用户 CSS 分层显示。
- 风险提示覆盖输入栏、顶部栏、图片、卡片。

验收：

- 手写 CSS 不会悄悄破坏结构化字段。
- 预览和实际页面使用同一套作用域。
- 不允许误伤 `body`、`#root` 等全局区域时至少有明确警告。

### Phase 6：视觉 QA 与真实聊天页冒烟

交付：

- 浏览器打开气泡工坊。
- 保存一个 V2 测试主题。
- 应用到当前角色。
- 打开真实聊天页验证顶部栏、消息流、输入栏、卡片预览。

验收：

- 桌面/手机宽度都不重叠。
- 长文本、长角色名、超大字号不撑爆。
- 图片预览、录音覆盖层、表情面板没有明显遮挡。
- 按仓库低负载策略，只跑必要轻量测试，不默认全量 build/test。

## 优先级建议

第一批必须做：

- 分页壳。
- 预览分页。
- 页面容器、顶部栏、输入栏。
- 文字/语音/图片/时间戳/系统提示。
- V1/V2 兼容。

第二批做：

- 通用卡片和转账。
- 表情面板、动作面板、录音覆盖层。
- 卡片画廊。

第三批做：

- 新闻多平台卡片。
- 音乐确认弹窗。
- 手机/房间/小报等专项卡片。
- 更细的品牌模式切换。

## 关键风险

- 默认微信主题的 `WeChatInputBar` 已补语义类名，但仍保留较多 inline style；结构化配置可覆盖外层和关键按钮，后续可继续改成 CSS 变量或 theme props。
- 部分卡片组件内部样式仍写死；当前已能通过 `.sully-card-container` 和专属 `.sully-*-card` 入口改外壳，长期要逐步加内部 token。
- `MessageItem.tsx` 消息类型很多，预览 fixture 要覆盖重点路径，不适合一次性把所有边缘类型都塞进第一版。
- 主题 JSON 可能包含 data URL 图片，导入/导出和外观预设要继续兼容。

## 完成标准

当以下条件都满足，才算“气泡工坊全量自定义升级”完成：

- 每个一级区域都有独立分页。
- 每个一级区域至少有一个实时预览页。
- 顶部栏、底部输入栏、消息区、文字气泡、语音、图片、表情、时间戳、系统提示、转账、通用卡片和重点专项卡片都能通过结构化控件或白名单 CSS 修改主要视觉。
- 高级 CSS 仍可用，并有区域化选择器速查。
- 旧主题可以导入、编辑、保存、应用，不丢原有气泡样式。
- 新主题可以保存后应用到真实聊天页。
- 预览和真实聊天页关键样式一致。
- 分页在移动端不拥挤，文本不溢出，控件不互相遮挡。
