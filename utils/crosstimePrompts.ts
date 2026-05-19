/**
 * Crosstime Prompts — 跨时空对话 Prompt 引擎
 *
 * 为每个时空切片构建独立的人格上下文，
 * 然后组装导演 prompt 驱动多角色对话。
 */

import type { CharacterProfile, UserProfile } from '../types';
import type { TrajectoryNode } from '../types/trajectory';
import type { CrosstimeParticipant, CrosstimeMessage } from '../types/crosstime';

/**
 * 按角色分组构建参与者上下文
 * 同一角色的共享基底（人设+世界观）只写一次，每个切片只写差异
 * 大幅减少同角色多切片场景下的 input tokens
 */
export function buildGroupedParticipantContexts(
    participants: CrosstimeParticipant[],
    characters: CharacterProfile[],
    userProfile: UserProfile,
    getNode: (p: CrosstimeParticipant) => TrajectoryNode | undefined,
    summaryMap: Record<string, string>,
): string {
    // 按 charId 分组
    const groups = new Map<string, CrosstimeParticipant[]>();
    for (const p of participants) {
        const list = groups.get(p.charId) || [];
        list.push(p);
        groups.set(p.charId, list);
    }

    let output = '';

    for (const [charId, slices] of groups) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        // ── 共享基底（只写一次）──
        output += `========== ${char.name} · 共享人格基底 ==========
### 核心性格
${char.systemPrompt || '（未设定）'}
`;
        if (char.worldview?.trim()) {
            output += `\n### 世界观\n${char.worldview}\n`;
        }
        output += `==========\n\n`;

        // ── 每个切片的差异部分 ──
        for (const p of slices) {
            const displayName = `${char.name}·${p.label}`;
            const memoryBlock = summaryMap[p.id]
                ? `\n### 对话回忆\n${summaryMap[p.id]}\n`
                : '';

            if (p.timeSlice === 'current') {
                // 当前版本：精简版（不再调 buildCoreContext）
                output += `--- ${displayName} (PID: ${p.id}) ---
[时空]: 当前时间线，拥有完整经历
[与用户]: 认识${userProfile.name}`;
                // 注入印象的核心评价（如果有）
                if (char.impression) {
                    output += `\n[内心印象]: ${char.impression.personality_core.summary}`;
                }
                output += memoryBlock;
                output += `\n---\n\n`;
            } else {
                // 轨迹节点切片
                const node = getNode(p);
                output += `--- ${displayName} (PID: ${p.id}) ---
[年龄]: ${p.age ?? '?'}岁
`;
                if (node) {
                    output += `[人生阶段]: ${node.title}
[情绪底色]: ${node.mood}
[关键词]: ${node.keywords.join('、')}
`;
                    if (node.monologue) {
                        output += `[内心片段]: ${node.monologue.slice(0, 200)}${node.monologue.length > 200 ? '…' : ''}\n`;
                    }
                }
                output += `[⚠️ 时空隔离]: ${p.age ?? '?'}岁，不知道此后的事\n`;
                if (p.era === 'before_meeting') {
                    output += `[与用户]: 不认识${userProfile.name}\n`;
                } else {
                    output += `[与用户]: 认识${userProfile.name}\n`;
                }
                output += memoryBlock;
                output += `---\n\n`;
            }
        }
    }

    return output;
}

// 保留旧函数签名的兼容 wrapper（单参与者场景）
export function buildParticipantContext(
    participant: CrosstimeParticipant,
    char: CharacterProfile,
    userProfile: UserProfile,
    node?: TrajectoryNode,
    conversationMemory?: string,
): string {
    return buildGroupedParticipantContexts(
        [participant], [char], userProfile,
        () => node,
        conversationMemory ? { [participant.id]: conversationMemory } : {},
    );
}

/**
 * 检查是否存在同一角色的不同时空版本
 */
function findSameCharCollisions(participants: CrosstimeParticipant[]): Map<string, CrosstimeParticipant[]> {
    const groups = new Map<string, CrosstimeParticipant[]>();
    for (const p of participants) {
        const list = groups.get(p.charId) || [];
        list.push(p);
        groups.set(p.charId, list);
    }
    // 只保留有多个版本的
    const collisions = new Map<string, CrosstimeParticipant[]>();
    for (const [charId, list] of groups) {
        if (list.length > 1) collisions.set(charId, list);
    }
    return collisions;
}

/**
 * 组装导演 prompt
 */
export function buildCrosstimeDirectorPrompt(
    participantContexts: string,
    participantList: { pid: string; displayName: string; charId: string }[],
    recentMessages: string,
    userProfile: UserProfile,
    userMode: 'online' | 'invisible',
    sameCharCollisions: Map<string, CrosstimeParticipant[]>,
    characters: CharacterProfile[],
): string {
    const userSection = userMode === 'online'
        ? `用户「${userProfile.name}」正在场。角色们知道他的存在，可以与他互动。
   注意：如果某个角色是「相遇前」的切片，他不认识用户，会对这个陌生人感到好奇。`
        : `用户处于隐身状态。角色们**完全不知道**有人在旁观。
   禁止任何角色提到用户、对用户说话、或暗示有外人在场。`;

    // 同角色碰撞规则
    let collisionRules = '';
    if (sameCharCollisions.size > 0) {
        collisionRules = '\n### 同一角色碰撞规则\n';
        for (const [charId, versions] of sameCharCollisions) {
            const charName = characters.find(c => c.id === charId)?.name || '角色';
            const labels = versions.map(v => v.label).join('、');
            collisionRules += `- 房间里有 ${versions.length} 个不同时间的${charName}（${labels}）。
  年轻版本会觉得对方"莫名眼熟"但不理解为什么。年长版本可能会感慨、沉默、或欲言又止。
  他们不应该直接说"你是未来的我"，但可以隐约感知到某种联系。\n`;
        }
    }

    const participantIdList = participantList
        .map(p => `  - PID: "${p.pid}" → ${p.displayName}`)
        .join('\n');

    return `【系统：跨时空对话 · 导演模式】

${participantContexts}

### 场景设定
这是一个跨越时空的特殊空间。不同时间的他们被聚集在这里。
${userSection}

### 参与者 ID 映射
${participantIdList}
${collisionRules}
### 最近对话记录
${recentMessages || '（暂无对话记录，这是第一轮）'}

### 导演任务
请作为导演，接管所有角色，让对话**自然地流动起来**。

### 核心规则
1. **去中心化**: 角色之间要有互动和回应，不要每个人说完就消失。
2. **多轮输出**: 一次生成 **2 到 6 条** 消息。
3. **气泡分段**: 长话分多条，每行是一个独立气泡。
4. **时空隔离**: 每个角色只知道自己时间线内的事。年轻版本不知道未来。
5. **性格一致**: 严格按照每个切片的人格档案行事。17岁叛逆期的他和现在温柔的他，说话方式完全不同。

### 输出格式 (JSON Array)
严格输出 JSON，不要有任何多余文字。
[
  {
    "participantId": "参与者的PID",
    "content": "发言内容"
  },
  ...
]
`;
}

/** 跨时空总结的消息标识 */
export const CROSSTIME_SUMMARY_PARTICIPANT_ID = '__summary__';

/**
 * 将消息列表格式化为可读的对话记录
 * 只取总结锚点之后的消息（总结本身已注入各切片 context）
 */
export function formatCrosstimeMessages(
    messages: CrosstimeMessage[],
    participants: CrosstimeParticipant[],
    characters: CharacterProfile[],
    userProfile: UserProfile,
    limit: number = 30,
): string {
    // 找到最新的总结消息位置，只发送之后的原文
    const lastSummaryIdx = messages.map((m, i) => m.participantId === CROSSTIME_SUMMARY_PARTICIPANT_ID ? i : -1)
        .filter(i => i >= 0).pop();
    const startIdx = (lastSummaryIdx !== undefined && lastSummaryIdx >= 0) ? lastSummaryIdx + 1 : 0;

    const afterSummary = messages.slice(startIdx);
    const recent = afterSummary.slice(-limit);
    if (recent.length === 0) return '';

    return recent.map(m => {
        if (m.participantId === CROSSTIME_SUMMARY_PARTICIPANT_ID) return '';
        // 悄悄话不进入导演视野——真正的硬隔离
        if (m.isPrivate) return '';
        if (m.role === 'user') {
            return `${userProfile.name}: ${m.content}`;
        }
        const participant = participants.find(p => p.id === m.participantId);
        const char = participant ? characters.find(c => c.id === participant.charId) : null;
        const displayName = char ? `${char.name}·${participant?.label}` : '未知';
        return `${displayName}: ${m.content}`;
    }).filter(Boolean).join('\n');
}

/**
 * 构建 per-participant 总结 prompt
 * 输出 JSON：{ "pid": "该切片视角的回忆", ... }
 * 每个切片只知道自己的体验，不会混淆同名角色
 */
export function buildCrosstimeSummaryPrompt(
    messagesToSummarize: CrosstimeMessage[],
    participants: CrosstimeParticipant[],
    characters: CharacterProfile[],
    userProfile: UserProfile,
    existingSummaries?: Record<string, string>,
): string {
    const dialogue = messagesToSummarize.map(m => {
        if (m.participantId === CROSSTIME_SUMMARY_PARTICIPANT_ID) return '';
        // 悄悄话不参与总结——隐私隔离
        if (m.isPrivate) return '';
        if (m.role === 'user') {
            return `${userProfile.name}: ${m.content}`;
        }
        const p = participants.find(pp => pp.id === m.participantId);
        const char = p ? characters.find(c => c.id === p.charId) : null;
        const name = char ? `${char.name}·${p?.label}` : '未知';
        return `${name}: ${m.content}`;
    }).filter(Boolean).join('\n');

    const participantDescriptions = participants.map(p => {
        const c = characters.find(ch => ch.id === p.charId);
        const name = c ? `${c.name}·${p.label}` : p.label;
        return `  - PID "${p.id}" → ${name}`;
    }).join('\n');

    // 已有总结的注入
    let existingBlock = '';
    if (existingSummaries && Object.keys(existingSummaries).length > 0) {
        existingBlock = '\n## 各参与者已有的回忆\n';
        for (const [pid, summary] of Object.entries(existingSummaries)) {
            const p = participants.find(pp => pp.id === pid);
            const c = p ? characters.find(ch => ch.id === p.charId) : null;
            const name = c ? `${c.name}·${p?.label}` : pid;
            existingBlock += `### ${name}\n${summary}\n\n`;
        }
        existingBlock += '请将新内容融合进各自的回忆中，输出完整的更新版。\n';
    }

    return `你是跨时空对话的记忆整理员。请为每个参与者分别整理出「他自己视角」的对话回忆。

## 重要规则
1. 每个参与者只能记住自己说过的话、听到的话、感受到的情绪
2. 用第二人称「你」来称呼该参与者本人
3. 其他参与者用「名字·标签」格式提及
4. 如果有人悄悄对用户说了话，只出现在说话者的回忆里
5. 保留关键情节和情绪转折，不需要逐条复述
6. 每个参与者的回忆控制在 100-200 字以内

## 参与者列表
${participantDescriptions}

## 用户: ${userProfile.name}
${existingBlock}
## 需要整理的对话
${dialogue}

## 输出格式（严格 JSON）
\`\`\`json
{
  "pid_value_1": "该参与者视角的回忆文本...",
  "pid_value_2": "该参与者视角的回忆文本..."
}
\`\`\`
只输出 JSON，不要有其他文字。`;
}

/**
 * 解析已有总结消息为 per-participant map
 */
export function parseSummaryContent(content: string): Record<string, string> {
    try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, string>;
        }
    } catch { /* ignore */ }
    return {};
}

/**
 * 检查是否需要触发自动总结
 * 返回需要被总结的消息 + 已有的 per-participant 总结
 */
export function checkNeedsSummary(
    messages: CrosstimeMessage[],
    threshold: number = 18,
): { messagesToSummarize: CrosstimeMessage[]; existingSummaries?: Record<string, string> } | null {
    // 找到最新总结的位置
    const lastSummaryIdx = messages.map((m, i) => m.participantId === CROSSTIME_SUMMARY_PARTICIPANT_ID ? i : -1)
        .filter(i => i >= 0).pop();

    const lastSummary = lastSummaryIdx !== undefined ? messages[lastSummaryIdx] : undefined;
    const afterSummary = lastSummaryIdx !== undefined ? messages.slice(lastSummaryIdx + 1) : messages;

    // 只统计非系统消息
    const chatMsgs = afterSummary.filter(m => m.participantId !== CROSSTIME_SUMMARY_PARTICIPANT_ID);
    if (chatMsgs.length < threshold) return null;

    // 保留最后 5 条不总结，让上下文衔接
    const keepRecent = 5;
    const toSummarize = chatMsgs.slice(0, -keepRecent);
    if (toSummarize.length < 8) return null;

    return {
        messagesToSummarize: toSummarize,
        existingSummaries: lastSummary ? parseSummaryContent(lastSummary.content) : undefined,
    };
}

export { findSameCharCollisions };

/**
 * 为悄悄话构建单角色回复 prompt
 * 只包含目标角色人设 + 用户与该角色的悄悄话历史
 */
export function buildWhisperReplyPrompt(
    participantContext: string,
    whisperHistory: CrosstimeMessage[],
    currentWhisper: string,
    userProfile: UserProfile,
    targetDisplayName: string,
): string {
    // 构建历史对话
    let historyBlock = '';
    if (whisperHistory.length > 0) {
        historyBlock = '### 之前的悄悄话\n' + whisperHistory.map(m => {
            if (m.role === 'user') return `${userProfile.name}: ${m.content}`;
            return `${targetDisplayName}: ${m.content}`;
        }).join('\n') + '\n\n';
    }

    return `【悄悄话 · 线下私语】

${participantContext}

### 场景
这不是线上私信，而是在同一个跨时空空间里的贴近低声对话。
${userProfile.name}靠近你，小声对你说话；其他时间线听不到这段对话。
你能看到${userProfile.name}的表情、动作、距离感和停顿，也可以用动作、沉默、压低声音、回避视线等方式回应。

${historyBlock}### ${userProfile.name}现在悄悄对你说
"${currentWhisper}"

### 输出格式
只输出 JSON 数组本身，不要包代码块，不要在数组外写任何解释。
数组里的每一项都会成为一个独立气泡：
[
  { "type": "action", "content": "他微微皱眉，视线从你脸上移开。" },
  { "type": "say", "content": "别出声。你到底是谁？" }
]

### 要求
- 你是${targetDisplayName}，用你最自然的方式回应这句悄悄话
- 保持你在这个时空切片中的性格和认知
- 这是线下低声私语，可以有动作、停顿、压低声音和情绪反应
- 禁止解释空间规则，禁止旁白总结，禁止说明“这是超出常理的空间”
- 不要写角色名前缀，不要写 Markdown，不要输出用户的话
- 可以输出 1 项或多项；每一项都必须是这个角色当下真实会做或会说的内容
`;
}
