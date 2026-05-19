/**
 * Love Show Engine — 恋综导演引擎 + 赛季状态机
 *
 * 导演的核心工作是「制造选择」——不排固定时间表，
 * 而是根据当前状态生成下一个选择点（ChoicePoint）。
 */

import {
  buildCharacterStateEvalPrompt,
  buildDirectorMissionPrompt,
  buildImpressionUpdatePrompt,
  buildNpcExpandPrompt,
  buildNpcGeneratorPrompt,
  buildSceneSummaryPrompt,
  buildSocialPostsPrompt,
} from './loveshowPrompts';
import type {
  SeasonState,
  SeasonPhase,
  ChoicePoint,
  ChoiceOption,
  CharacterState,
  LoveShowScene,
  LoveShowUserImpression,
  NpcProfile,
  LoveShowSocialPost,
  DirectorMission,
} from '../types/loveshow';

// ═══════════════════════════════════════════════
//  常量：合宿屋地点 & 外出约会地点
// ═══════════════════════════════════════════════

/** 合宿屋地点常量 */
export const HOUSE_LOCATIONS: { id: string; name: string; atmosphere: string }[] = [
  { id: 'kitchen', name: '厨房', atmosphere: '日常温暖，偶遇感' },
  { id: 'living_room', name: '客厅', atmosphere: '公开热闹，群聊破冰' },
  { id: 'rooftop', name: '天台', atmosphere: '私密浪漫，夜聊告白' },
  { id: 'hallway', name: '走廊', atmosphere: '偶然暧昧，擦肩而过' },
  { id: 'garden', name: '院子', atmosphere: '轻松开放，集体活动' },
  { id: 'interview_room', name: '采访间', atmosphere: '独处真实，对镜头说心里话' },
];

/** 外出约会地点池 */
export const DATE_LOCATION_POOL: { id: string; name: string; atmosphere: string }[] = [
  { id: 'amusement_park', name: '游乐园', atmosphere: '刺激兴奋，容易拉近距离' },
  { id: 'seaside', name: '海边', atmosphere: '开阔浪漫，适合深聊' },
  { id: 'cafe', name: '咖啡馆', atmosphere: '安静私密，面对面' },
  { id: 'escape_room', name: '密室逃脱', atmosphere: '紧张合作，肢体接触' },
  { id: 'night_market', name: '夜市', atmosphere: '热闹随意，自然亲近' },
  { id: 'aquarium', name: '水族馆', atmosphere: '安静梦幻，适合并肩' },
  { id: 'bookstore', name: '独立书店', atmosphere: '文艺安静，偷看对方' },
  { id: 'hiking', name: '徒步', atmosphere: '运动出汗，互相照顾' },
];

// ═══════════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════════

/** 生成简短唯一 ID */
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把 day 映射到大致时段标签 */
type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * 根据赛季 day + phase 推导当前时段。
 * 纯启发式：phase 不同 → 时段不同。
 */
function inferPeriod(phase: SeasonPhase): DayPeriod {
  switch (phase) {
    case 'casting':
    case 'day_active':
      return 'afternoon';
    case 'phone_time':
      return 'night';
    case 'observatory':
      return 'night';
    case 'day_end':
      return 'night';
    default:
      return 'afternoon';
  }
}

// ═══════════════════════════════════════════════
//  1. 赛季生命周期
// ═══════════════════════════════════════════════

/** 创建新赛季 */
export function createSeason(charIds: string[]): SeasonState {
  return {
    seasonId: uid('season'),
    charIds: [...charIds],
    day: 1,
    phase: 'casting' as SeasonPhase,
    eliminations: [],
    finalChoice: null,
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

/** 推进到下一天 */
export function advanceDay(season: SeasonState): SeasonState {
  const nextDay = season.day + 1;
  const isFinalDay = nextDay > 5;
  return {
    ...season,
    day: isFinalDay ? season.day : nextDay,
    phase: isFinalDay ? 'finale' : 'day_active',
    lastActiveAt: Date.now(),
  };
}

/** 更新赛季阶段 */
export function updatePhase(season: SeasonState, phase: SeasonPhase): SeasonState {
  return {
    ...season,
    phase,
    lastActiveAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════
//  2. 导演选择点生成（核心）
// ═══════════════════════════════════════════════

/**
 * 根据当前赛季状态生成下一个选择点。
 * 导演不排时间表，而是每次只给出下一个选择。
 *
 * 选择的生成逻辑：
 * - Day 1 早晨 → group_event（破冰，必须）
 * - Day 1 之后 → location_visit（去厨房？去天台？可选）
 * - 每天一次 → date_card（约会券给谁，必须）
 * - 每天深夜 → sms_target + sms_content（匿名短信，可选）
 * - 每天一次 → daily_mission（可选）
 * - 每天结束 → observatory（观察室，可选）
 *
 * 选择的触发条件基于：
 * - 当前 day + 时段
 * - 角色戏份平衡（getScreenTimeMap）
 * - 已完成的选择历史
 */
export function generateNextChoicePoint(
  season: SeasonState,
  charStates: CharacterState[],
  completedChoiceIds: string[],
): ChoicePoint {
  const { day, phase } = season;
  const period = inferPeriod(phase);


  // ── 辅助：检查某个 prefix 类型是否今天已完成 ──
  const dayPrefix = `d${day}_`;
  const hasDone = (type: string) =>
    completedChoiceIds.some((id) => id.startsWith(dayPrefix) && id.includes(type));

  // ── Day 1 破冰（最高优先级） ──
  if (day === 1 && !hasDone('group_event')) {
    return {
      id: `${dayPrefix}group_event`,
      type: 'group_event',
      prompt: '📢 节目组通知：全体嘉宾请到客厅集合，今晚是破冰之夜！',
      mandatory: true,
      consequence: '所有角色初次见面，建立第一印象',
    };
  }

  // ── 每天必须：date_card（约会券） ──
  if (!hasDone('date_card')) {
    const availableChars = season.charIds.filter(
      (id) => !season.eliminations.includes(id),
    );
    const screenTime = getScreenTimeMap(season);
    // 按戏份从少到多排序，让低戏份角色出现在前面
    const sorted = [...availableChars].sort(
      (a, b) => (screenTime.get(a) || 0) - (screenTime.get(b) || 0),
    );
    const options: ChoiceOption[] = sorted.map((id) => {
      const state = charStates.find((c) => c.characterId === id);
      return {
        id,
        label: id,
        hint: state ? `好感度 ${state.affection}` : undefined,
      };
    });

    return {
      id: `${dayPrefix}date_card`,
      type: 'date_card',
      prompt: '💌 你收到了一张约会券！今天你想邀请谁一起外出？',
      options,
      mandatory: true,
      consequence: '获选角色获得独处约会场景',
    };
  }

  // ── observatory：观察室（每天结束前） ──
  if (
    (phase === 'observatory' || phase === 'day_end') &&
    !hasDone('observatory')
  ) {
    const availableChars = season.charIds.filter(
      (id) => !season.eliminations.includes(id),
    );
    const options: ChoiceOption[] = availableChars.map((id) => ({
      id,
      label: id,
      hint: '查看 TA 的独白',
    }));

    return {
      id: `${dayPrefix}observatory`,
      type: 'observatory',
      prompt: '🔭 观察室开放了。你想偷看谁的独白？',
      options,
      mandatory: false,
      consequence: '可以看到该角色当天的 innerThought',
    };
  }

  // ── 深夜时段：匿名短信 ──
  if (period === 'night' && !hasDone('sms_target')) {
    const availableChars = season.charIds.filter(
      (id) => !season.eliminations.includes(id),
    );
    const options: ChoiceOption[] = availableChars.map((id) => ({
      id,
      label: id,
      hint: '匿名发送',
    }));

    return {
      id: `${dayPrefix}sms_target`,
      type: 'sms_target',
      prompt: '📱 深夜了……你可以匿名发一条短信给某个人。要发给谁？',
      options,
      mandatory: false,
      consequence: '收到短信的角色会产生对应情绪变化',
    };
  }

  // ── 已选短信目标 → 写短信内容 ──
  if (hasDone('sms_target') && !hasDone('sms_content')) {
    return {
      id: `${dayPrefix}sms_content`,
      type: 'sms_content',
      prompt: '✏️ 写点什么吧……（匿名短信，对方不会知道是谁发的）',
      freeInput: true,
      mandatory: false,
      consequence: '短信内容会影响对方的 innerThought 和 mood',
    };
  }

  // ── 每天一次：密令任务 ──
  if (!hasDone('daily_mission')) {
    return {
      id: `${dayPrefix}daily_mission`,
      type: 'daily_mission',
      prompt: '🎯 导演密令已送达。你要现在打开看看吗？',
      options: [
        { id: 'accept', label: '接受密令' },
        { id: 'reject', label: '稍后再看' },
      ],
      mandatory: false,
      consequence: '完成密令会解锁特殊角色反应',
    };
  }

  // ── location_visit：去合宿屋某个地方 ──
  if (!hasDone('location_visit')) {
    const options: ChoiceOption[] = HOUSE_LOCATIONS.map((loc) => ({
      id: loc.id,
      label: loc.name,
      hint: loc.atmosphere,
    }));

    return {
      id: `${dayPrefix}location_visit`,
      type: 'location_visit',
      prompt: '🏠 你想去哪儿逛逛？',
      options,
      mandatory: false,
      consequence: '前往该地点可能触发偶遇场景',
    };
  }

  // ── 兜底：采访间 ──
  return {
    id: `${dayPrefix}interview_${Date.now()}`,
    type: 'interview',
    prompt: '📹 导演喊你去采访间坐坐，聊聊今天的感受。',
    freeInput: true,
    mandatory: false,
    consequence: '采访内容会被记录，影响后续剧情走向',
  };
}

/**
 * 处理用户对选择点的回应，返回更新后的赛季状态。
 */
export function resolveChoice(
  season: SeasonState,
  choiceId: string,
  selectedOptionId?: string,
  _freeInputText?: string,
): SeasonState {
  // 基本的状态更新逻辑（具体副作用由调用方处理）
  let updated = { ...season, lastActiveAt: Date.now() };

  // 根据选择类型做特定处理
  if (choiceId.includes('date_card') && selectedOptionId) {
    // 约会券：没有直接的 season 变化，由场景系统处理
  }

  if (choiceId.includes('observatory')) {
    // 观察室结束 → 推进 phase
    updated = updatePhase(updated, 'day_end');
  }

  // 如果当天所有阶段已结束，标记
  if (updated.phase === 'day_end') {
    // 日结束，等 advanceDay() 调用
  }

  return updated;
}

// ═══════════════════════════════════════════════
//  3. 场景管理
// ═══════════════════════════════════════════════

/** 根据选择结果创建场景 */
export function createSceneFromChoice(
  season: SeasonState,
  choice: ChoicePoint,
  selectedOption?: string,
): LoveShowScene {
  // 确定地点
  let locationId = 'living_room';
  let locationName = '客厅';
  let atmosphere = '公开热闹，群聊破冰';

  switch (choice.type) {
    case 'group_event':
      locationId = 'living_room';
      locationName = '客厅';
      atmosphere = '全员集合，氛围热烈';
      break;

    case 'location_visit':
      if (selectedOption) {
        const loc = HOUSE_LOCATIONS.find((l) => l.id === selectedOption);
        if (loc) {
          locationId = loc.id;
          locationName = loc.name;
          atmosphere = loc.atmosphere;
        }
      }
      break;

    case 'date_card':
      if (selectedOption) {
        // 随机选择约会地点
        const dateLoc =
          DATE_LOCATION_POOL[
            Math.floor(Math.random() * DATE_LOCATION_POOL.length)
          ];
        locationId = dateLoc.id;
        locationName = dateLoc.name;
        atmosphere = dateLoc.atmosphere;
      }
      break;

    case 'interview':
      locationId = 'interview_room';
      locationName = '采访间';
      atmosphere = '独处真实，对镜头说心里话';
      break;

    case 'observatory':
      locationId = 'observatory';
      locationName = '观察室';
      atmosphere = '暗处窥探，内心翻涌';
      break;

    default:
      break;
  }

  // 确定出场角色
  let characterIds = selectSceneCharacters(
    season,
    choice.type === 'group_event' ? season.charIds.length : 3,
    undefined,
  );

  if (choice.type === 'date_card' && selectedOption) {
    characterIds = [selectedOption];
  } else if (choice.type === 'sms_target' && selectedOption && !characterIds.includes(selectedOption)) {
    characterIds = [selectedOption, ...characterIds].slice(0, 3);
  }

  return {
    id: uid('scene'),
    dayNumber: season.day,
    locationId,
    locationName,
    characterIds,
    atmosphere,
    status: 'pending',
  };
}

// ═══════════════════════════════════════════════
//  4. 角色调度
// ═══════════════════════════════════════════════

/** 计算每个角色的戏份（简易版：基于 charIds 出现频次） */
export function getScreenTimeMap(season: SeasonState): Map<string, number> {
  const map = new Map<string, number>();
  for (const id of season.charIds) {
    // 基础戏份 = 1（注册即算 1）
    map.set(id, 1);
  }
  // 被淘汰的角色戏份归零
  for (const id of season.eliminations) {
    map.set(id, 0);
  }
  return map;
}

/** 选择场景出场角色（基于戏份平衡） */
export function selectSceneCharacters(
  season: SeasonState,
  maxCharacters: number,
  excludeIds?: string[],
): string[] {
  const excludeSet = new Set(excludeIds || []);
  const available = season.charIds.filter(
    (id) => !season.eliminations.includes(id) && !excludeSet.has(id),
  );

  if (available.length <= maxCharacters) {
    return [...available];
  }

  // 按戏份从少到多排序，优先选低戏份角色
  const screenTime = getScreenTimeMap(season);
  const sorted = [...available].sort(
    (a, b) => (screenTime.get(a) || 0) - (screenTime.get(b) || 0),
  );

  return sorted.slice(0, maxCharacters);
}

// ═══════════════════════════════════════════════
//  5. 副模型调用封装
// ═══════════════════════════════════════════════

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const SUB_MODEL_SYSTEM_PROMPT = '你是恋综副模型。严格遵守用户提示中的输出格式，不要添加解释。';

/**
 * 通用的 OpenAI 兼容 API 调用器。
 * 使用标准 fetch，不引入新 HTTP 库。
 */
async function callSubModel(
  config: ApiConfig,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.7,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Sub-model API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * 安全地解析 JSON 响应。
 * 容忍模型在 JSON 前后加 markdown 代码块标记。
 */
function safeParseJson<T>(raw: string): T {
  // 尝试直接解析
  try {
    return JSON.parse(raw);
  } catch {
    // 尝试提取 ```json ... ``` 包裹的内容
    const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new Error(`Failed to parse JSON from sub-model response: ${raw.slice(0, 200)}`);
  }
}

/** 评估角色状态变化 */
export async function evaluateCharacterState(
  apiConfig: ApiConfig,
  charName: string,
  userName: string,
  sceneSummary: string,
  currentState: CharacterState,
): Promise<CharacterState> {
  const userPrompt = buildCharacterStateEvalPrompt(charName, userName, sceneSummary, currentState);

  const raw = await callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.5);
  const parsed = safeParseJson<Partial<CharacterState>>(raw);

  return {
    ...currentState,
    ...parsed,
    characterId: currentState.characterId, // 不可覆盖
    lastUpdatedScene: sceneSummary.slice(0, 50),
  };
}

/** 更新印象卡 */
export async function updateImpression(
  apiConfig: ApiConfig,
  charName: string,
  userName: string,
  sceneSummary: string,
  currentImpression: LoveShowUserImpression,
): Promise<LoveShowUserImpression> {
  const userPrompt = buildImpressionUpdatePrompt(charName, userName, sceneSummary, currentImpression);

  const raw = await callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.5);
  const parsed = safeParseJson<Record<string, unknown>>(raw);

  // 合并但保护 characterId 不被覆盖
  const { characterId: _, ...updates } = parsed as Record<string, unknown> & { characterId?: string };
  return {
    ...currentImpression,
    ...updates,
  } as LoveShowUserImpression;
}

/** 生成场景摘要 */
export async function generateSceneSummary(
  apiConfig: ApiConfig,
  charName: string,
  userName: string,
  rawDialogue: string,
): Promise<string> {
  const userPrompt = buildSceneSummaryPrompt(charName, userName, rawDialogue);

  return callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.4);
}

/** 批量生成社交媒体帖子 */
export async function generateSocialPosts(
  apiConfig: ApiConfig,
  day: number,
  seasonSummary: string,
  charNames: string[],
): Promise<LoveShowSocialPost[]> {
  const userPrompt = buildSocialPostsPrompt(day, seasonSummary, charNames);

  const raw = await callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.8);
  const parsed = safeParseJson<Record<string, unknown>[]>(raw);

  // 确保每条帖子有必填字段
  return parsed.map((post, i): LoveShowSocialPost => ({
    id: (post.id as string) || uid('post'),
    dayNumber: day,
    platform: (post.platform as LoveShowSocialPost['platform']) || 'weibo',
    username: (post.username as string) || charNames[i % charNames.length],
    content: (post.content as string) || '',
    likes: typeof post.likes === 'number' ? post.likes : undefined,
  }));
}

/** 生成 NPC 骨架 */
export async function generateNpcSkeleton(
  apiConfig: ApiConfig,
  existingCharacterSummaries: string[],
): Promise<NpcProfile> {
  const userPrompt = buildNpcGeneratorPrompt(existingCharacterSummaries);

  const raw = await callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.9);
  const parsed = safeParseJson<Omit<NpcProfile, 'id' | 'generatedPrompt'>>(raw);

  return {
    ...parsed,
    id: `npc_${crypto.randomUUID()}`,
    name: parsed.name || 'NPC',
    age: parsed.age || 22,
    job: parsed.job || '自由职业',
    memorableDetail: parsed.memorableDetail || '',
    sampleLine: parsed.sampleLine || '',
    motivation: parsed.motivation || '',
    generatedPrompt: '', // 由 expandNpcPrompt 填充
  };
}

/** 将 NPC 骨架展开为完整 prompt */
export async function expandNpcPrompt(
  apiConfig: ApiConfig,
  skeleton: NpcProfile,
): Promise<string> {
  const userPrompt = buildNpcExpandPrompt(skeleton);

  return callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.7);
}

/** 生成导演密令 */
export async function generateDirectorMission(
  apiConfig: ApiConfig,
  day: number,
  charNames: string[],
  seasonContext: string,
): Promise<DirectorMission> {
  const userPrompt = buildDirectorMissionPrompt(day, charNames, seasonContext);

  const raw = await callSubModel(apiConfig, SUB_MODEL_SYSTEM_PROMPT, userPrompt, 0.7);
  const parsed = safeParseJson<Partial<DirectorMission>>(raw);

  return {
    id: parsed.id || uid('mission'),
    dayNumber: typeof parsed.dayNumber === 'number' ? parsed.dayNumber : day,
    description: parsed.description || '',
    reward: parsed.reward || '',
    completed: parsed.completed === true,
  };
}
