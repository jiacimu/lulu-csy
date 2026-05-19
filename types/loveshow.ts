/**
 * Love Show Types — 恋综 AI 恋爱综艺
 * 赛季状态、导演选择点、角色状态卡、印象卡、NPC、场景、密令、社交媒体、回忆卡
 */

// ═══════════════════════════════════
//  赛季状态（硬变量，代码控制）
// ═══════════════════════════════════

export type SeasonPhase =
  | 'casting' | 'day_active' | 'phone_time'
  | 'observatory' | 'day_end' | 'finale' | 'completed';

export interface SeasonState {
  seasonId: string;
  charIds: string[];           // 参赛角色 ID（用户角色 + NPC）
  day: number;                 // 1-5
  phase: SeasonPhase;
  eliminations: string[];
  finalChoice: string | null;
  startedAt: number;
  lastActiveAt: number;
}

// ═══════════════════════════════════
//  导演选择点
// ═══════════════════════════════════

export type ChoiceType =
  | 'date_card'       // 约会券给谁
  | 'sms_target'      // 短信发给谁
  | 'sms_content'     // 短信写什么
  | 'location_visit'  // 去不去某个地方
  | 'group_event'     // 集体活动（必须）
  | 'interview'       // 采访间
  | 'observatory'     // 观察室（偷看谁）
  | 'daily_mission';  // 接不接密令

export interface ChoiceOption {
  id: string;
  label: string;
  hint?: string;       // 给用户的小提示
}

export interface ChoicePoint {
  id: string;
  type: ChoiceType;
  prompt: string;            // 节目组风格通知文本
  options?: ChoiceOption[];
  freeInput?: boolean;       // 允许自由输入
  mandatory: boolean;        // 必须响应 vs 可忽略
  consequence?: string;      // 内部备注（不展示）
}

// ═══════════════════════════════════
//  角色状态卡（副 API 评估）
// ═══════════════════════════════════

export type LoveShowMood =
  | '期待' | '吃醋' | '受伤' | '心动'
  | '试探' | '冷淡' | '紧张' | '开心';

export type LoveShowStrategy =
  | '主动进攻' | '欲擒故纵' | '默默守护'
  | '直球表白' | '观望' | '撤退';

export interface CharacterState {
  characterId: string;
  affection: number;            // 0-100
  mood: LoveShowMood;
  confidence: number;           // 0-100
  strategy: LoveShowStrategy;
  jealousyTarget: string | null;
  innerThought: string;
  lastUpdatedScene: string;
}

// ═══════════════════════════════════
//  用户印象卡（副 API 评估）
// ═══════════════════════════════════

export interface ImpressionSnapshot {
  day: number;
  sceneId: string;
  impression: string;
  timestamp: number;
}

export interface LoveShowUserImpression {
  characterId: string;
  perceivedTraits: string[];
  knownFacts: string[];
  misconceptions: string[];
  impression: string;
  history: ImpressionSnapshot[];
}

// ═══════════════════════════════════
//  NPC 人设卡
// ═══════════════════════════════════

export interface NpcProfile {
  id: string;                    // 'npc_' + uuid
  name: string;
  age: number;
  job: string;
  memorableDetail: string;       // 一个让人记住他的细节
  sampleLine: string;            // 一句示例台词体现说话方式
  motivation: string;            // 为什么来上恋综
  generatedPrompt: string;       // 完整角色 prompt（副模型展开）
  avatar?: string;
}

// ═══════════════════════════════════
//  场景
// ═══════════════════════════════════

export interface LoveShowScene {
  id: string;
  dayNumber: number;
  locationId: string;
  locationName: string;
  characterIds: string[];
  atmosphere: string;
  summary?: string;              // 场景摘要（结束后填）
  status: 'pending' | 'active' | 'completed';
}

// ═══════════════════════════════════
//  导演密令
// ═══════════════════════════════════

export interface DirectorMission {
  id: string;
  dayNumber: number;
  description: string;
  reward: string;                // 奖励描述
  completed: boolean;
}

// ═══════════════════════════════════
//  虚拟社交媒体帖子
// ═══════════════════════════════════

export interface LoveShowSocialPost {
  id: string;
  platform: 'weibo' | 'xhs';
  username: string;
  content: string;
  likes?: number;
  dayNumber: number;
}

// ═══════════════════════════════════
//  回忆卡片
// ═══════════════════════════════════

export interface MemoryCard {
  sceneId: string;
  dayNumber: number;
  description: string;           // 一句话剧照描述
  characters: string[];
  timestamp: number;
}
