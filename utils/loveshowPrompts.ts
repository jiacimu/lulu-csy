/**
 * Love Show Prompt Builders — 恋综 Prompt 系统
 *
 * 核心原则：AI 只管演，不管格式。
 * - 主 API 输出纯自然文本（星号包裹动作，「角色名：对话」格式）
 * - 副 API 只输出 JSON
 * - 所有视觉由前端 CSS 负责
 */

import type {
  SeasonState,
  CharacterState,
  LoveShowUserImpression,
  LoveShowScene,
  NpcProfile,
} from '../types/loveshow';

// ═══════════════════════════════════════════
//  1. buildLoveShowPreamble — 主模型 system prompt 前置段
// ═══════════════════════════════════════════

/**
 * 恋综角色 system prompt 前置段。
 * 注入节目设定、IF 线前提、当前状态、印象卡、格式指令。
 */
export function buildLoveShowPreamble(
  charName: string,
  userName: string,
  seasonState: SeasonState,
  charState: CharacterState,
  impression: LoveShowUserImpression | null,
): string {
  const parts: string[] = [];

  // —— 节目设定 ——
  parts.push(
    `你是${charName}，正在参加一档恋爱综艺节目。` +
    `你和其他嘉宾住在同一栋合宿屋里，节目全程有摄像机跟拍。`,
  );

  // —— IF 线前提 ——
  parts.push(
    `你不认识${userName}，这是你们在节目中认识的。` +
    `你对她的一切了解都来自节目里的互动。`,
  );

  // —— 当前状态（自然语言） ——
  parts.push(
    `现在是第${seasonState.day}天。` +
    `你对${userName}的好感度大约${charState.affection}/100。` +
    `你现在的心情是「${charState.mood}」。` +
    `你内心在想：「${charState.innerThought}」`,
  );

  // —— 印象卡注入（自然语言） ——
  if (impression) {
    const traits = impression.perceivedTraits.length > 0
      ? impression.perceivedTraits.join('、')
      : '还没有太多了解';
    const facts = impression.knownFacts.length > 0
      ? impression.knownFacts.join('；')
      : '暂时不多';
    const miscon = impression.misconceptions.length > 0
      ? impression.misconceptions.join('；')
      : '暂时没有';

    parts.push(
      `你觉得${userName}是这样的人：${traits}。` +
      `你了解到：${facts}。` +
      `你有一些可能不准确的判断：${miscon}。`,
    );
  }

  // —— 格式指令（不超过 2 行） ——
  parts.push(
    `用星号包裹动作和环境描写，角色对话用「角色名：对话」格式。像写小说一样自然书写。`,
  );

  return parts.join('\n\n');
}

// ═══════════════════════════════════════════
//  2. buildSceneContext — 场景上下文注入
// ═══════════════════════════════════════════

/**
 * 单场景上下文，注入到对话 prompt 中。
 * 包含当前地点+氛围、在场角色列表、最近 3 条场景摘要。
 */
export function buildSceneContext(
  scene: LoveShowScene,
  sceneSummaries: string[],
): string {
  const parts: string[] = [];

  // 当前地点 + 氛围
  parts.push(`现在的场景是「${scene.locationName}」。${scene.atmosphere}`);

  // 在场角色列表
  if (scene.characterIds.length > 0) {
    parts.push(`在场的人：${scene.characterIds.join('、')}。`);
  }

  // 最近 3 条场景摘要（压缩上下文）
  const recent = sceneSummaries.slice(-3);
  if (recent.length > 0) {
    parts.push(`之前发生的事：\n${recent.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

// ═══════════════════════════════════════════
//  3. buildCharacterStateEvalPrompt — 副模型：角色状态评估
// ═══════════════════════════════════════════

/**
 * 副模型专用。场景结束后评估角色状态变化。
 * 输出纯 JSON（不带 code fence）。
 */
export function buildCharacterStateEvalPrompt(
  charName: string,
  userName: string,
  sceneSummary: string,
  currentState: CharacterState,
): string {
  return `你是一个恋爱综艺节目的心理分析师。你的任务是根据刚才发生的场景，评估「${charName}」对「${userName}」的状态变化。

### 场景摘要
${sceneSummary}

### ${charName}当前状态
- 好感度：${currentState.affection}/100
- 心情：${currentState.mood}
- 自信度：${currentState.confidence}/100
- 策略：${currentState.strategy}
- 嫉妒对象：${currentState.jealousyTarget || '无'}
- 内心独白：${currentState.innerThought}

### 你的任务
根据场景中发生的互动，重新评估${charName}的状态。注意：
- 好感度变化通常在 ±5 以内，除非发生了重大事件
- 心情要反映场景结束时的即时情绪
- 策略要根据互动走向做出合理调整
- innerThought 写一句${charName}此刻脑海里闪过的话

### 输出格式
直接输出 JSON，不要添加任何其他内容，不要用 code fence 包裹：
{"affection": 42, "mood": "心动", "confidence": 65, "strategy": "主动进攻", "jealousyTarget": null, "innerThought": "她刚才看我的眼神..."}

mood 只能从以下选择：期待、吃醋、受伤、心动、试探、冷淡、紧张、开心
strategy 只能从以下选择：主动进攻、欲擒故纵、默默守护、直球表白、观望、撤退`;
}

// ═══════════════════════════════════════════
//  4. buildImpressionUpdatePrompt — 副模型：印象卡更新
// ═══════════════════════════════════════════

/**
 * 副模型专用。更新角色对用户的印象卡。
 * 强调「同一用户在不同角色眼里是不同形象」。
 */
export function buildImpressionUpdatePrompt(
  charName: string,
  userName: string,
  sceneSummary: string,
  currentImpression: LoveShowUserImpression,
): string {
  return `你是恋爱综艺节目的心理观察员。你的任务是以「${charName}」的视角，更新他对「${userName}」的印象卡。

重要：同一个人在不同人眼里是完全不同的形象。你现在只站在${charName}的角度，用他的性格和价值观去理解${userName}。

### 刚才发生的事
${sceneSummary}

### ${charName}目前对${userName}的印象
- 感知到的特质：${currentImpression.perceivedTraits.join('、') || '还不了解'}
- 已知事实：${currentImpression.knownFacts.join('；') || '暂无'}
- 可能不准确的判断：${currentImpression.misconceptions.join('；') || '暂无'}
- 整体印象：${currentImpression.impression || '初印象阶段'}

### 你的任务
根据场景中的互动，更新印象卡。注意：
- perceivedTraits 是${charName}「觉得」${userName}是什么样的人，不一定准确
- knownFacts 是${charName}在互动中确实了解到的客观信息
- misconceptions 是${charName}基于有限信息做出的可能不准确的推断
- impression 是一句话总结${charName}此刻对${userName}的整体感觉

### 输出格式
直接输出 JSON，不要添加任何其他内容，不要用 code fence 包裹：
{"perceivedTraits": ["开朗", "有点小迷糊"], "knownFacts": ["喜欢喝美式", "大学学的设计"], "misconceptions": ["可能对所有人都这么温柔"], "impression": "挺有意思的一个人，但还看不透"}`;
}

// ═══════════════════════════════════════════
//  5. buildSceneSummaryPrompt — 副模型：场景摘要
// ═══════════════════════════════════════════

/**
 * 副模型专用。生成 20-30 字场景摘要，纯文本。
 */
export function buildSceneSummaryPrompt(
  charName: string,
  userName: string,
  rawDialogue: string,
): string {
  return `你是一个恋爱综艺节目的字幕编辑。你的任务是把下面这段对话浓缩成一句话摘要。

### 对话内容
${rawDialogue}

### 要求
- 用 20-30 个字概括这段对话的核心事件和情绪变化
- 格式：「谁做了什么 + 结果/氛围」
- 要包含${charName}和${userName}的互动关键点
- 直接输出一句话，不要任何前缀、引号或格式标记

示例：
${charName}在厨房做早餐时和${userName}聊起了小时候的事，气氛变得温暖
${userName}在天台偶遇${charName}，两人沉默地看了一会儿星星`;
}

// ═══════════════════════════════════════════
//  6. buildNpcGeneratorPrompt — 副模型：NPC 嘉宾生成
// ═══════════════════════════════════════════

/**
 * 副模型专用。生成 NPC 嘉宾基础骨架。
 * 要求与现有角色形成差异，不使用标签词，人设有深度。
 */
export function buildNpcGeneratorPrompt(
  existingCharacterSummaries: string[],
): string {
  const existingBlock = existingCharacterSummaries.length > 0
    ? `### 已有角色\n${existingCharacterSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n新角色必须和以上角色形成明显差异——性格、职业、说话方式都不能撞型。`
    : '目前还没有其他角色。';

  return `你是一个恋爱综艺节目的选角导演。你需要为节目设计一位新的男嘉宾。

${existingBlock}

### 你需要提供四件事
1. 基本信息：名字、年龄（22-32岁）、职业
2. 一个让观众记住他的细节——可以是习惯、癖好、随身携带的东西、说话时的小动作，任何让这个人变得具体的东西
3. 说话方式：不要贴标签，用一句他会说的台词来体现。这句台词要能让人听出他是什么样的人
4. 他为什么来上恋综：动机要真实，不要"想找到真爱"这种空话。是失恋了想重新开始？是朋友打赌报了名？是工作太忙没机会认识人？越具体越好

### 禁止事项
- 不要使用任何性格标签词来描述角色（比如不能说"他是一个XX型的人"）
- 人设要有足够的深度支撑五天的互动，不能是一句话就能概括完的扁平角色
- 名字要自然，不要太文艺也不要太普通

### 输出格式
直接输出 JSON，不要添加任何其他内容，不要用 code fence 包裹：
{"name": "陆时年", "age": 27, "job": "纪录片剪辑师", "memorableDetail": "随身带一个磨损的 Zippo 打火机但其实已经戒烟三年了", "sampleLine": "你说的这个……等一下，我想想怎么接比较不像在敷衍你。", "motivation": "前女友结婚请帖寄到了公司，同事起哄帮他报了名，他想着反正也该往前走了"}`;
}

// ═══════════════════════════════════════════
//  7. buildNpcExpandPrompt — 副模型：NPC 骨架展开
// ═══════════════════════════════════════════

/**
 * 副模型专用。将 NPC 骨架 JSON 展开为完整角色 system prompt（自然语言）。
 * 输出纯文本，可直接作为角色的 system prompt 使用。
 */
export function buildNpcExpandPrompt(
  npcSkeleton: Pick<NpcProfile, 'name' | 'age' | 'job' | 'memorableDetail' | 'sampleLine' | 'motivation'>,
): string {
  return `你是一个恋爱综艺节目的编剧。你需要把下面这个角色骨架展开成一段完整的人设文本，这段文本会直接作为 AI 角色的 system prompt 使用。

### 角色骨架
- 名字：${npcSkeleton.name}
- 年龄：${npcSkeleton.age}岁
- 职业：${npcSkeleton.job}
- 记忆点：${npcSkeleton.memorableDetail}
- 说话示例：「${npcSkeleton.sampleLine}」
- 参加动机：${npcSkeleton.motivation}

### 展开要求
写一段 300-500 字的人设文本，包含以下层次：
1. 他是谁——用两三句话让人看到一个活生生的人，不是一份简历
2. 他的性格怎么在日常中体现——不说"他很XX"，而是写他会做什么、不会做什么
3. 他说话的方式——语气、节奏、口头禅、会不会开玩笑、紧张时怎么说话
4. 他在恋综里可能的表现——面对喜欢的人会怎样、面对竞争会怎样、面对尴尬会怎样
5. 他的软肋或者不为人知的一面——让角色有层次感

### 格式
- 直接输出人设文本，不要任何前缀、标题或格式标记
- 用自然流畅的中文书写，像在跟另一个编剧介绍这个角色
- 不要使用任何性格标签词
- 不要分点列举，写成连贯的段落`;
}

// ═══════════════════════════════════════════
//  8. buildSocialPostsPrompt — 副模型：虚拟社交媒体帖子
// ═══════════════════════════════════════════

/**
 * 副模型专用。生成虚拟社交媒体帖子。
 * 帖子有不同立场，分析可能对也可能错，制造信息不对称。
 */
export function buildSocialPostsPrompt(
  day: number,
  seasonSummary: string,
  charNames: string[],
): string {
  return `你是一个社交媒体内容模拟器。你的任务是为一档恋爱综艺节目生成观众的社交媒体反应。

### 节目信息
- 当前进度：第${day}天
- 嘉宾：${charNames.join('、')}
- 今天发生的事：${seasonSummary}

### 你的任务
生成 4-6 条来自不同平台、不同用户的帖子。要求：
- 平台只能是 weibo 或 xhs
- 每个用户名要有网感（像真实的社交媒体昵称）
- 帖子要有不同立场：有站不同 CP 的、有理性分析的、有纯吃瓜看热闹的
- 分析可能是对的，也可能是完全错误的解读——观众永远只能看到表面
- xhs 帖子可以附带点赞数
- 语气要像真的网友在讨论，不要太书面

### 输出格式
直接输出 JSON 数组，不要添加任何其他内容，不要用 code fence 包裹：
[{"platform": "weibo", "username": "甜甜圈少女", "content": "阿昊做早餐那段也太苏了 #恋综第三季#"}, {"platform": "xhs", "username": "嗑糖日记", "content": "Day${day} 名场面！！看完这段我直接原地升天", "likes": 2341}]`;
}

// ═══════════════════════════════════════════
//  9. buildDirectorMissionPrompt — 副模型：导演密令
// ═══════════════════════════════════════════

/**
 * 副模型专用。生成导演密令（给用户的隐藏任务）。
 */
export function buildDirectorMissionPrompt(
  day: number,
  charNames: string[],
  seasonContext: string,
): string {
  return `你是一档恋爱综艺节目的导演组成员。你要为用户设计一个"密令"——一个只有用户知道的隐藏任务。

### 节目信息
- 当前进度：第${day}天
- 嘉宾：${charNames.join('、')}
- 目前为止的情况：${seasonContext}

### 密令设计原则
- 任务要具体、可执行：不是"增进感情"这种抽象目标，而是"在明天的集体活动中找机会单独和某人说一句安慰的话"
- 任务要制造有趣的局面：让用户不得不做一些平时不会做的事
- 奖励要有吸引力但不破坏平衡：比如解锁某个角色的隐藏信息、获得一次偷看观察室的机会
- 任务难度适中：不要太容易完成（"和某人说句话"），也不要太难（"让某人当众表白"）

### 输出格式
直接输出 JSON，不要添加任何其他内容，不要用 code fence 包裹：
{"description": "在明天的集体活动中找机会单独和阿昊说一句安慰的话", "reward": "解锁阿昊的隐藏档案"}`;
}
