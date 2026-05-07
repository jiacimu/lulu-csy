/**
 * Theater Prompts — 导演 Prompt + 场景注入 Prompt
 * 导演（副 API）生成结构化事件 JSON，主 API 基于事件演绎角色。
 */

import type { EventType, DirectorEvent, TheaterLocation, TimeSlot } from '../types';
import { TIME_SLOT_LABELS } from '../types/theater';

// ── Director Prompt (for Secondary API) ──

const EVENT_TYPE_DESCRIPTIONS: Record<EventType, string> = {
    ambient:   '纯氛围描写。不需要具体事件发生，只描述此时此刻的环境、气氛、感觉。让读者"进入"这个场景。',
    encounter: '偶遇/发现/意外。在这个地点发生了一件出乎意料的事——遇到某个人、发现某个东西、突然出现的状况。',
    romantic:  '浪漫时刻。制造一个让两人关系更近一步的小契机——不需要大告白，一个眼神、一个意外的亲密接触就够了。',
    callback:  '回忆关联。设计一个"似曾相识"的场景——某个细节让角色想起过去的事。如果有记忆片段可用，融入场景。',
    conflict:  '小冲突/分歧。一个微妙的紧张时刻——意见不合、误会、第三者介入、尴尬时刻。注意：不要太严重，是生活中常见的小摩擦。',
    surprise:  '完全意想不到的转折。天气骤变、偶遇名人、捡到奇怪的东西、手机突然响了带来消息——打破当前节奏的意外。',
};

/**
 * Build the director prompt for the secondary API.
 * The director must return a structured JSON object.
 */
export function buildDirectorPrompt(
    charName: string,
    userName: string,
    location: TheaterLocation,
    timeSlot: TimeSlot,
    eventType: EventType,
    recentEvents: DirectorEvent[],
    recentMemories?: string,
): string {
    const timeLabel = TIME_SLOT_LABELS[timeSlot];
    const recentEventsText = recentEvents.length > 0
        ? recentEvents.slice(-3).map((e, i) => `  ${i + 1}. [${e.sceneType}] ${e.event}`).join('\n')
        : '  (无)';

    const memoryBlock = recentMemories
        ? `\n### 可用记忆片段（如果事件类型是 callback，请融入以下记忆）\n${recentMemories}\n`
        : '';

    return `你是一个互动小说的"导演"。你不扮演任何角色，你的工作是设计场景和事件。

### 当前场景
- 地点：${location.name}
- 地点氛围：${location.description}
- 时段：${timeLabel.icon} ${timeLabel.zh}
- 角色：${charName}（AI角色），${userName}（用户）

### 最近发生的事件
${recentEventsText}
${memoryBlock}
### 你的任务
设计一个 **${EVENT_TYPE_DESCRIPTIONS[eventType]}**

### 输出格式（严格 JSON，不要添加任何其他内容）
\`\`\`json
{
  "sceneType": "${eventType}",
  "atmosphere": "（100-150字的场景氛围描写：环境细节、光线、声音、气味、温度）",
  "event": "（50-100字的事件核心描述：发生了什么，谁做了什么）",
  "tension": 0.5,
  "npcHint": "（如果有NPC出现，简短描述NPC；没有则为空字符串）",
  "suggestedBeats": ["建议1", "建议2", "建议3"]
}
\`\`\`

### 规则
1. atmosphere 要有画面感，像电影开场镜头
2. event 是客观描述，不要写角色的内心活动
3. tension 范围 0.0-1.0（0=轻松，0.5=日常，0.8=紧张，1.0=高潮）
4. suggestedBeats 是给角色扮演者的提示，不是给用户看的
5. 不要重复最近发生过的事件
6. 事件必须符合地点和时段的逻辑（深夜的咖啡厅可能要打烊了）
7. 只输出 JSON，不要输出任何其他文字`;
}

// ── Scene Injection Prompt (injected into Main API system prompt) ──

/**
 * Build the scene injection block that gets added to the character's system prompt.
 * This tells the character AI what's happening around them.
 */
export function buildTheaterSceneInjection(
    event: DirectorEvent,
    location: TheaterLocation,
    timeSlot: TimeSlot,
): string {
    const timeLabel = TIME_SLOT_LABELS[timeSlot];

    return `
### 【约会剧场 · 导演指令】
你正在和对方在 **${location.name}** 度过 ${timeLabel.icon}${timeLabel.zh} 的时光。

**当前场景氛围**：
${event.atmosphere}

**正在发生的事**：
${event.event}
${event.npcHint ? `\n**周围的人**：${event.npcHint}` : ''}

**导演提示**（仅供参考，你可以自由发挥）：
${event.suggestedBeats.map(b => `- ${b}`).join('\n')}

### 重要规则
1. 你**不能无视**正在发生的事。必须对事件做出自然反应。
2. 你的反应必须符合你的性格，不要因为事件而突然变成另一个人。
3. 不要照搬导演提示的原文，用你自己的方式演绎。
4. 场景氛围是你看到、听到、感受到的，自然融入你的描写。
`;
}

/**
 * Build the initial ambient scene prompt (first entry into a location).
 * This is always triggered when entering a new location, not through pity.
 */
export function buildInitialScenePrompt(
    location: TheaterLocation,
    timeSlot: TimeSlot,
    charName: string,
    userName: string,
): string {
    const timeLabel = TIME_SLOT_LABELS[timeSlot];

    return `### 场景：感知新地点
当前时段: ${timeLabel.icon} ${timeLabel.zh}
地点: ${location.name}

### 任务
${userName}和${charName}刚刚来到 ${location.name}。
${location.description}

请用**第三人称**写一段到场描写（3-5行）。
描述：
1. 你们走进这个地方时的第一感受（视觉、听觉、嗅觉）
2. ${charName}此刻的状态和反应
3. 一个有趣的环境细节

不要输出任何前缀，直接输出描写内容。用 [emotion] 标签开头每一行。`;
}

// ── 520 Special Prompt Injection ──

/**
 * 520 confession easter egg injection.
 * Only injected during night + romantic event during 520 event window.
 */
export function build520ConfessionHint(charName: string): string {
    return `
[520 SPECIAL · 仅在时机成熟时触发]
今天是一个特殊的日子。如果在这个夜晚，在这个浪漫的时刻，你感觉时机到了——
你可以说出平时不会说出口的话。不是被要求的，是你自己想说的。
但如果你觉得还不到时候，就当这段话不存在。
${charName}，这个选择权在你。
`;
}

// ── Director Response Parser ──

/**
 * Parse the director API response into a DirectorEvent object.
 * Handles various response formats (raw JSON, markdown-wrapped JSON, etc.)
 */
export function parseDirectorResponse(raw: string): DirectorEvent | null {
    try {
        // 1. Strip thinking tokens (<think>...</think>, <Thought>...</Thought>, etc.)
        let cleaned = raw.replace(/<(?:think|thought|reasoning)[^>]*>[\s\S]*?<\/(?:think|thought|reasoning)>/gi, '').trim();
        if (!cleaned) cleaned = raw.trim();

        // 2. Try to extract JSON — multiple strategies
        let jsonStr: string | null = null;

        // Strategy A: markdown code block (```json ... ```)
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        // Strategy B: find first { ... } block
        if (!jsonStr) {
            const braceStart = cleaned.indexOf('{');
            const braceEnd = cleaned.lastIndexOf('}');
            if (braceStart !== -1 && braceEnd > braceStart) {
                jsonStr = cleaned.slice(braceStart, braceEnd + 1);
            }
        }

        // Strategy C: starts with { but may be truncated (no closing brace)
        if (!jsonStr) {
            const braceStart = cleaned.indexOf('{');
            if (braceStart !== -1) {
                jsonStr = cleaned.slice(braceStart);
            }
        }

        if (!jsonStr) {
            console.warn('[TheaterDirector] No JSON found in response:', cleaned.slice(0, 200));
            return null;
        }

        // 3. Attempt to repair truncated JSON
        let parsed: any;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            // Try to fix common truncation issues: missing closing brackets/braces
            let repaired = jsonStr;
            // Count unmatched braces and brackets
            const openBraces = (repaired.match(/{/g) || []).length;
            const closeBraces = (repaired.match(/}/g) || []).length;
            const openBrackets = (repaired.match(/\[/g) || []).length;
            const closeBrackets = (repaired.match(/\]/g) || []).length;

            // Strip trailing incomplete string/value (e.g. `"suggestedBeats": ["foo`, "bar`)
            repaired = repaired.replace(/,\s*"[^"]*$/, '');  // trailing incomplete key
            repaired = repaired.replace(/,\s*$/, '');          // trailing comma

            // Add missing brackets then braces
            for (let i = closeBrackets; i < openBrackets; i++) repaired += ']';
            for (let i = closeBraces; i < openBraces; i++) repaired += '}';

            try {
                parsed = JSON.parse(repaired);
                console.info('[TheaterDirector] Repaired truncated JSON successfully');
            } catch (e2) {
                console.error('[TheaterDirector] Failed to parse director response:', (e2 as Error).message);
                console.error('[TheaterDirector] Raw (first 300 chars):', raw.slice(0, 300));
                return null;
            }
        }

        // 4. Validate required fields
        if (!parsed.sceneType || !parsed.atmosphere || !parsed.event) {
            console.warn('[TheaterDirector] Incomplete director response:', parsed);
            return null;
        }

        return {
            sceneType: parsed.sceneType as EventType,
            atmosphere: String(parsed.atmosphere),
            event: String(parsed.event),
            tension: typeof parsed.tension === 'number' ? Math.max(0, Math.min(1, parsed.tension)) : 0.5,
            npcHint: parsed.npcHint ? String(parsed.npcHint) : undefined,
            suggestedBeats: Array.isArray(parsed.suggestedBeats)
                ? parsed.suggestedBeats.map(String)
                : [],
            timestamp: Date.now(),
        };
    } catch (e) {
        console.error('[TheaterDirector] Unexpected error parsing director response:', e);
        console.error('[TheaterDirector] Raw (first 300 chars):', raw.slice(0, 300));
        return null;
    }
}
