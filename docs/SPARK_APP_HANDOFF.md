# Spark App 功能与提示词交接

更新时间：2026-06-08

这份文档用于给策划理解和优化 Spark。Spark 是仓库里的社交动态 App，代码入口是 `apps/SocialApp.tsx`，应用 ID 是 `AppID.Social`，桌面名称是 `Spark`。

## 一句话定位

Spark 是一个“模拟社交信息流”的前端 App：用户可以刷到由角色马甲和路人混合生成的社交帖子，也可以自己发布笔记、查看评论区、在评论里互动，并把帖子分享进 Message 聊天里让角色继续评价。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `types/core.ts` | 定义 `AppID.Social = 'social'`。 |
| `constants.tsx` | 把 `AppID.Social` 注册成桌面 App，名称为 `Spark`，并放进 Dock。 |
| `components/PhoneShell.tsx` | 懒加载 `../apps/SocialApp`，打开 `AppID.Social` 时渲染 Spark。 |
| `apps/SocialApp.tsx` | Spark 主体：信息流、主页、发布、身份管理、AI 生成帖子/评论/回复。 |
| `types/social.ts` | Spark 的帖子、评论、角色马甲、用户 Spark 主页资料类型。 |
| `utils/db/appDataStore.ts` | Spark 推荐流帖子落库：`social_posts`。 |
| `utils/db/contentStore.ts` | Spark 用户主页背景和资料作为 asset 保存。 |
| `components/chat/cards/SocialCard.tsx` | Spark 帖子分享进 Message 后的卡片 UI。 |
| `utils/messageContext.ts` | Spark 卡片进入聊天上下文时，转成角色能读懂的文本。 |
| `utils/systemBackup.ts` | 备份/恢复 Spark 的马甲、用户 Spark ID、主页资料、背景图。 |

## 现有功能

1. 首页推荐流

- 用户点击“刷新”后，主模型生成 6-8 条新帖子。
- 帖子来源混合：约 30% 是角色用马甲发帖，约 70% 是路人/网友发帖。
- 帖子显示为类似小红书瀑布流卡片，图面当前使用 emoji + 渐变背景，不是真实图片。
- 用户可以点赞、收藏、删除帖子。

2. 角色马甲管理

- 每个角色可以配置多个 Spark 身份，也就是代码里的 `SubAccount`。
- 每个马甲有 `handle` 和 `note`。
- AI 发帖、评论时会根据语境选择马甲，例如“大号”“吐槽小号”“认真模式”。
- 默认会给每个角色补一个马甲：优先用 `char.socialProfile?.handle`，否则用角色名。

3. 评论区

- 打开一个没有评论的帖子时，会调用主模型生成 4-6 条评论。
- 评论混合使用选定角色马甲和随机路人。
- 禁止模型生成用户本人署名的评论。

4. 用户评论与角色回复

- 用户在帖子下发评论后，前端先把用户评论本地追加进去。
- 然后调用主模型生成 1-3 条对用户评论的回复。
- 生成的回复会追加在评论区里，内容前缀会被前端处理成 `回复 @用户昵称: ...`。

5. 用户发布笔记

- 用户可以手动发布标题、正文和一个心情贴纸 emoji。
- 这条笔记不调用模型。
- 发布者使用 Spark 内的本地用户主页资料，不直接等同全局用户档案。

6. Spark 主页资料

- 用户可设置 Spark 专属昵称、头像、bio、Spark ID、主页背景图。
- 保存后只在 Spark 生效，不改全局用户档案。

7. 分享到 Message

- 帖子详情页可以分享给某个角色。
- 分享后保存一条 `type: 'social_card'` 的聊天消息，`metadata.post` 存完整帖子。
- Message 里显示 `SocialCard` 卡片。
- 聊天上下文会把它转换成：
  - 标题
  - 内容
  - 热评样本
  - 一句提示：“请根据你的性格对这个帖子发表看法，比如吐槽、感兴趣或者不屑”

## 现有链路

### 1. 打开 App

`Launcher` 或 Dock 点击 Spark -> `useApp().openApp(AppID.Social)` -> `AppContext` 设置 `activeApp` -> `PhoneShell.renderActiveApp` 命中 `case AppID.Social` -> 渲染 `<SocialApp />`。

### 2. 初始化数据

Spark 进入后执行初始化：

- 从 IndexedDB 的 `social_posts` 读取推荐流帖子，按 `timestamp` 倒序显示。
- 从 `localStorage.spark_user_id` 读取 Spark ID。
- 从 IndexedDB assets 读取：
  - `spark_user_bg`：用户 Spark 主页背景图。
  - `spark_social_profile`：用户 Spark 主页资料。
- 如果旧版本数据还在 localStorage，会迁移到 IndexedDB assets：
  - `localStorage.spark_user_bg`
  - `localStorage.spark_social_profile`
- 从 `localStorage.spark_char_handles` 读取角色马甲。
- 如果角色没有马甲，则自动补默认马甲。

### 3. 生成首页推荐流

触发函数：`handleRefresh`

链路：

1. 检查 `apiConfig.apiKey`。
2. 随机选最多 3 个角色。
3. 为每个角色构建：
   - `ContextBuilder.buildCoreContext(char, userProfile, false)`：角色核心上下文。
   - 最近一条私聊消息：`DB.getMessagesByCharId(char.id)`。
   - 角色可用马甲列表。
4. 组装“推荐流 Prompt”。
5. 请求主模型：
   - URL：`${apiConfig.baseUrl}/chat/completions`
   - model：`apiConfig.model`
   - messages：只有一条 `{ role: "user", content: prompt }`
   - temperature：`0.95`
   - max_tokens：`8000`
6. `safeResponseJson` 读取响应。
7. `safeParseJSON` 解析 JSON 数组。
8. 前端把每条模型输出映射成 `SocialPost`：
   - 角色帖：尽量匹配 `charId` 或 authorName 对应的马甲，头像用角色头像。
   - 路人帖：头像用 Dicebear 随机生成。
   - 图片位目前用 `emojis` 第一个 emoji。
   - 背景用随机渐变。
9. 新帖插到 feed 前面，并逐条 `DB.saveSocialPost` 持久化。

### 4. 生成评论区

触发函数：`generateComments`

触发条件：

- 用户打开某条帖子。
- 该帖子当前评论数为 0。
- 已配置 API Key。

链路：

1. 随机选最多 2 个角色。
2. 收集这两个角色的马甲。
3. 注入这两个角色的核心上下文。
4. 判断楼主身份：
   - 用户本人
   - 某个角色
   - 路人
5. 组装“评论区 Prompt”。
6. 请求主模型：
   - messages：只有一条 `{ role: "user", content: prompt }`
   - temperature：`0.8`
7. 解析 JSON 数组。
8. 评论作者如果匹配某角色马甲，头像用角色头像；否则用 Dicebear。
9. 更新帖子评论并保存到 IndexedDB。

### 5. 用户发评论后生成回复

触发函数：`handleSendComment` -> `generateRepliesToUser`

链路：

1. 前端先把用户评论追加到当前帖。
2. 保存更新后的帖子。
3. 汇总所有角色及其马甲。
4. 组装“回复用户评论 Prompt”。
5. 请求主模型：
   - messages：只有一条 `{ role: "user", content: prompt }`
   - temperature：`0.9`
6. 解析 JSON 数组。
7. 匹配马甲头像。
8. 把模型回复前端处理成 `回复 @${socialProfile.name}: ${content}`。
9. 追加进当前帖子评论区并保存。

### 6. 手动发帖

触发函数：`handleCreatePost`

- 不调用模型。
- 使用 Spark 本地用户资料作为作者。
- 保存到 `social_posts`。

### 7. 分享到 Message

触发函数：`handleShare`

- 保存一条聊天消息：
  - `role: 'user'`
  - `type: 'social_card'`
  - `content: '[分享帖子]'`
  - `metadata: { post: selectedPost }`
- Message 里 `components/chat/MessageItem.tsx` 判断 `m.type === 'social_card'` 后渲染 `SocialCard`。
- 聊天 Prompt 构建上下文时，`utils/messageContext.ts` 会把卡片转为角色可读文本。

## 数据结构与存储

### IndexedDB

- `social_posts`
  - 保存推荐流、用户发布帖、评论、点赞收藏状态等。
- `assets`
  - `spark_user_bg`
  - `spark_social_profile`

### localStorage

- `spark_user_id`
- `spark_char_handles`
- 旧版迁移兼容：
  - `spark_user_bg`
  - `spark_social_profile`

### 核心类型

```ts
export interface SocialComment {
    id: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    likes: number;
    isCharacter?: boolean;
}

export interface SocialPost {
    id: string;
    authorName: string;
    authorAvatar: string;
    title: string;
    content: string;
    images: string[];
    likes: number;
    isCollected: boolean;
    isLiked: boolean;
    comments: SocialComment[];
    timestamp: number;
    tags: string[];
    bgStyle?: string;
}

export interface SubAccount {
    id: string;
    handle: string;
    note: string;
}

export interface SocialAppProfile {
    name: string;
    avatar: string;
    bio: string;
}
```

## 关于 Prompt 的重要说明

Spark 当前没有单独的 `system` role 消息。三处模型调用都只发送一条 `user` role 消息：

```ts
messages: [{ role: "user", content: prompt }]
```

因此策划现在能直接优化的 Spark 固定 Prompt 一共有 3 段：

1. 推荐流生成 Prompt
2. 评论区生成 Prompt
3. 回复用户评论 Prompt

这些 Prompt 里会插入动态变量，例如：

- `${identityMap}`：角色和马甲列表。
- `${charContexts}` / `${contextPrompt}`：角色核心上下文。
- `${socialProfile.name}`：Spark 本地用户昵称。
- `${post.title}` / `${post.authorName}` / `${userContent}`：当前帖子和用户评论。

其中 `${charContexts}` 和 `${contextPrompt}` 里会包含 `ContextBuilder.buildCoreContext(...)` 的输出。它不是 Spark 独有 Prompt，而是全仓库共用的角色上下文，包含角色身份、用户画像、世界观、记忆、私密印象、内部状态等。

## 当前 Prompt 原文 1：推荐流生成

来源：`apps/SocialApp.tsx` 的 `handleRefresh`

```text
### 任务: 模拟社交APP "Spark" 的推荐流
你需要生成 6-8 条新的社交媒体帖子。

### 🎭 内容构成 (混合模式)
1. **角色发帖 (30%)**: 
   - 选中的角色: ${selectedChars.map(c => c.name).join(', ')}
   - **关键规则**: 每个角色有多个马甲(账号)。请根据内容需要，选择最合适的账号身份发帖。
   - 例如：如果是吐槽，可能用小号；如果是发美照，用大号。请务必使用 **Configured Handle (网名)**。
   - **内容方向**: 公开发言，生活日常、吐槽、或者暗戳戳的记录。

2. **路人/网友发帖 (70%)**: 
   - 模拟真实的互联网生态：吃瓜群众、技术宅、美妆博主、情感树洞。

### 身份配置
${identityMap}

### 🚫 绝对禁令
1. **禁止扮演用户**: 绝对禁止生成作者名为 "${socialProfile.name}" (用户) 的帖子。
2. **禁止上帝视角**。

### 输入上下文
${charContexts}

### 输出格式 (JSON Array)
[
  {
    "isCharacter": true/false,
    "charId": "如果是角色填ID, 否则null", 
    "authorName": "必须填身份表中定义的【网名】",
    "title": "简短吸睛的标题",
    "content": "正文内容...",
    "emojis": ["🎈", "✨"],
    "likes": 随机数 (0 - 10000)
  },
  ...
]
```

模型请求参数：

```ts
{
    model: apiConfig.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.95,
    max_tokens: 8000
}
```

## 当前 Prompt 原文 2：评论区生成

来源：`apps/SocialApp.tsx` 的 `generateComments`

```text
### 任务: 模拟社交APP评论区
**帖子来源**: "Spark" 社区
**楼主**: "${post.authorName}" (${authorType})
**帖子**: "${post.title}"

请生成 4-6 条评论。混合使用 **选定角色** 和 **随机路人**。
角色评论时，请选择一个符合语境的马甲身份。

### 角色身份库
${identityMap}

### 禁令
- **绝对禁止** 生成署名为 "${socialProfile.name}" 的评论。

### 输入上下文
${contextPrompt}

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle) 或 路人昵称", "content": "评论内容..." }
]
```

模型请求参数：

```ts
{
    model: apiConfig.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8
}
```

## 当前 Prompt 原文 3：回复用户评论

来源：`apps/SocialApp.tsx` 的 `generateRepliesToUser`

```text
### 任务: 回复用户的评论
**场景**: 用户 "${socialProfile.name}" 在帖子下发了一条评论: "${userContent}"。
**帖子**: "${post.title}"
请生成 1-3 条对用户评论的回复。
${identityMap}

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle)", "content": "回复内容..." }
]
```

模型请求参数：

```ts
{
    model: apiConfig.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.9
}
```

## 动态注入内容怎么理解

### `${identityMap}`

推荐流里长这样：

```text
### 角色身份表 (Identities)

角色 [角色名] 可用账号:
- 网名: "xxx" (备注: 主账号)
- 网名: "yyy" (备注: 吐槽小号)
```

评论区里长这样：

```text
- 角色 角色名 可用身份: "xxx" (主账号), "yyy" (吐槽小号)
```

回复用户评论里长这样：

```text
- 角色名: "xxx", "yyy"
```

### `${charContexts}` / `${contextPrompt}`

这部分来自 `ContextBuilder.buildCoreContext`，会把角色档案塞进 Prompt。推荐流里每个角色外面还包了一层：

```text
<<< 角色档案: 角色名 >>>
角色核心上下文
(最近私聊状态: 刚和用户聊过 "最近一条私聊前20字...")
<<< 档案结束 >>>
```

评论区里每个角色外面包的是：

```text
<<< 评论者角色: 角色名 >>>
角色核心上下文
```

角色核心上下文通常包含：

- `### 你的身份 (Character)`
- `### 世界观与设定 (World Settings)`
- `### 互动对象 (User)`
- `### [私密档案: 我眼中的用户] (Private Impression)`
- `### 你的过去`
- 内部状态/身体信号
- 挂载世界书

所以策划优化 Spark Prompt 时要注意：模型不是只看到 Spark 的三段模板，还会看到角色档案和用户档案。Spark 模板负责规定“这是社交平台、要用马甲、要输出 JSON、不要扮演用户”；角色上下文负责决定角色口吻和关系感。

## 当前可优化点

1. 推荐流的“角色 30% / 路人 70%”现在只是提示词要求，前端不强校验比例。
2. 现在 `emojis` 实际被前端当作图片位使用，模型如果输出多个 emoji，界面主要展示第一个。
3. 评论区只在评论为空时自动生成一次；已有评论的帖子再次打开不会重新生成。
4. 回复用户评论 Prompt 没有注入完整角色核心上下文，只给了角色和马甲列表，因此回复更依赖模型泛化，角色味可能比首页/评论区弱。
5. 三段 Prompt 都没有单独 system role，约束力全在 user prompt 内。
6. 首页和评论区会禁止扮演用户，但“回复用户评论”这段没有写明禁止用用户署名回复。
7. 输出 JSON 解析靠 `safeParseJSON` 容错；如果策划修改 Prompt，仍要保留明确 JSON Array 输出格式。

