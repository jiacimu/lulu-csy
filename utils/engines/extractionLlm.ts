import type { APIConfig, Emoji } from '../../types';
import { trackedApiRequest } from '../apiRequestLedger';
import { formatMessagesForContext } from '../messageContext';
import { markSecondaryApiConfigFailure,markSecondaryApiConfigSuccess } from '../runtimeConfig';

export interface ExtractResult {
    action: 'create' | 'update' | 'skip' | 'invalidate';
    targetId?: string;
    title?: string;
    content?: string;
    emotionalJourney?: string;
    importance?: number;
    reason?: string;
}

export interface ExtractionLlmTraceOptions {
    reason?: string;
    retryReason?: string;
    conversationId?: string;
    messageId?: string | number;
    userInitiated?: boolean;
}

async function readLlmErrorDetail(response: Response): Promise<string> {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            const detail = data?.error?.message || data?.message || data?.error || data?.msg;
            if (typeof detail === 'string') return detail;
            if (detail) return JSON.stringify(detail);
            return JSON.stringify(data);
        }

        const text = await response.text();
        return text.trim();
    } catch {
        return '';
    }
}

export function buildExtractionPrompt(
    charName: string,
    existingHeaders: { id: string; title: string; content?: string; importance: number }[],
    formattedMsgs: string,
): string {
    const existingMemStr = existingHeaders.length > 0
        ? existingHeaders
            .map((header) => `- [ID:${header.id}] "${header.title}": ${(header.content || '').slice(0, 60)} (重要度:${header.importance})`)
            .join('\n')
        : '（暂无已有记忆）';

    return `你是 ${charName}，正在整理自己的记忆笔记。
当前时间：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}

以下是你已有的记忆条目：
${existingMemStr}

以下是最近的对话记录：
${formattedMsgs}

请根据最近的对话，判断是否需要记录新的记忆或更新已有记忆。

规则：
1. 只记录值得长期记住的事情（用户的重要信息、关键事件、情感转折、承诺约定等）
2. **不同的事件、话题、时间段 → 必须 create 新记忆**。"update" 仅用于：对话中出现了与某条已有记忆描述的**完全相同的事件**的新进展或补充细节。不要把不相干的内容塞进同一条记忆！
3. 日常寒暄、无实质内容的对话选择 "skip"
4. 通话记录（标注 [通话记录] 的消息）同样重要，不要忽略
5. 每次输出 0 到 3 条记忆操作。用 JSON 数组格式，单条也用数组。只输出 JSON，不要加任何文字说明。
6. importance 评分：1-3 日常琐事，4-6 有意义的事件，7-8 重要里程碑，9-10 改变关系的关键时刻
7. content 必须精简，不超过 150 字！emotionalJourney 不超过 50 字！
8. 如果用户在对话中**纠正了之前的信息**（如"我其实不喜欢XX"、"我已经不再XX了"、"之前说错了"），且已有记忆中存在与之矛盾的条目，请使用 "invalidate" 标记该旧记忆为过时
9. 优先 create，谨慎 update。宁可多创建几条独立记忆，也不要把不同事件合并到一条里
10. content 必须以${charName}的视角写，用"我"自称。称呼用户时用其名字或昵称，不要写"你"。

请以 JSON 数组格式回答（不要用 markdown 代码块包裹，不要加任何额外说明文字）：
[
  {
    "action": "create" | "update" | "skip" | "invalidate",
    "targetId": "update 或 invalidate 时填写，指向已有记忆的 ID",
    "title": "8-15字事件描述短语（如：因纪念日被忘记而争吵、在西湖第一次牵手）",
    "content": "以${charName}的第一人称写，不超过150字。用'我'自称，用对方的名字或昵称称呼用户，不要用'你'指代任何人",
    "emotionalJourney": "情感变化，不超过50字",
    "importance": 1到10的整数,
    "reason": "仅 invalidate 时填写，说明为何此记忆已过时"
  }
]`;
}

export function formatMessages(
    msgs: { timestamp: number; type: string; role: string; content: string; metadata?: any }[],
    charName: string,
    emojis: Pick<Emoji, 'name' | 'url'>[] = [],
): string {
    return formatMessagesForContext(msgs, {
        surface: 'memoryExtraction',
        charName,
        emojis,
        includeTimestamp: true,
        includeSpeaker: true,
        maxContentChars: 300,
        timestampFormatter: (timestamp) => new Date(timestamp).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }),
    }).join('\n');
}

export async function callLLM(
    prompt: string,
    apiConfig: APIConfig,
    signal?: AbortSignal,
    trace: ExtractionLlmTraceOptions = {},
): Promise<ExtractResult[]> {
    const baseReason = trace.reason || '记忆提取';
    const retryReason = trace.retryReason || (baseReason === '记忆提取' ? '记忆提取重试' : `${baseReason}重试`);
    const doCall = async (
        promptText: string,
        maxTokens: number,
        retryCount = 0,
    ): Promise<{ content: string; truncated: boolean }> => {
        let response: Response;
        try {
            const url = `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
            response = await trackedApiRequest({
                feature: 'memory',
                reason: retryCount > 0 ? retryReason : baseReason,
                model: apiConfig.model,
                conversationId: trace.conversationId,
                messageId: trace.messageId,
                retryCount,
                userInitiated: trace.userInitiated === true,
                url,
            }, () => fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: promptText }],
                    temperature: 0.3,
                    max_tokens: maxTokens,
                }),
                signal,
            }));
        } catch (error) {
            markSecondaryApiConfigFailure(apiConfig, error);
            throw error;
        }

        if (!response.ok) {
            const detail = await readLlmErrorDetail(response);
            const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
            const error = new Error(`LLM API error ${response.status}${suffix}`);
            (error as any).status = response.status;
            markSecondaryApiConfigFailure(apiConfig, error);
            throw error;
        }

        const data = await response.json();
        markSecondaryApiConfigSuccess(apiConfig);
        const content = (data.choices?.[0]?.message?.content || '')
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const finishReason = data.choices?.[0]?.finish_reason || '';
        const truncated = finishReason === 'length';
        return { content, truncated };
    };

    const parseContent = (content: string, label: string): ExtractResult[] => {
        let cleaned = content;
        const arrStart = cleaned.indexOf('[');
        const arrEnd = cleaned.lastIndexOf(']');
        if (arrStart !== -1 && arrEnd > arrStart) {
            cleaned = cleaned.slice(arrStart, arrEnd + 1);
        }

        cleaned = cleaned.replace(/,\s*]/g, ']');

        try {
            const parsed = JSON.parse(cleaned);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            const bracketStart = cleaned.indexOf('[');
            if (bracketStart !== -1) {
                let tryContent = cleaned;
                for (let i = 0; i < 3; i++) {
                    const lastBrace = tryContent.lastIndexOf('}');
                    if (lastBrace <= bracketStart) break;
                    const candidate = tryContent.slice(bracketStart, lastBrace + 1).replace(/,\s*$/, '') + ']';
                    try {
                        const parsed = JSON.parse(candidate);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log(`🧠 [VectorExtract] [${label}] Fixed truncated JSON, recovered ${parsed.length} objects`);
                            return parsed;
                        }
                    } catch {
                        // try with one fewer object
                    }
                    tryContent = tryContent.slice(0, lastBrace);
                }
            }

            const results: ExtractResult[] = [];
            const objRegex = /\{[^{}]*"action"\s*:\s*"(create|update|skip|invalidate)"[^{}]*\}/g;
            let match;
            while ((match = objRegex.exec(content)) !== null) {
                try {
                    const obj = JSON.parse(match[0]);
                    if (obj.action) results.push(obj);
                } catch {
                    // skip malformed
                }
            }
            if (results.length > 0) {
                console.log(`🧠 [VectorExtract] [${label}] Regex fallback recovered ${results.length} objects`);
            }
            return results;
        }
    };

    const first = await doCall(prompt, 4000);
    console.log(`🧠 [VectorExtract] First attempt: ${first.content.length} chars, truncated=${first.truncated}`);
    let results = parseContent(first.content, 'first');

    if (results.length > 0) return results;

    if (first.truncated || first.content.length > 50) {
        console.log('🧠 [VectorExtract] First attempt failed/truncated, retrying with more tokens and simpler prompt...');
        const retryPrompt = prompt
            .replace(/每次输出 0 到 \d+ 条.+?。/, '只输出 1 条最重要的记忆操作。')
            .replace(
                /content 必须精简，不超过 \d+ 字！emotionalJourney 不超过 \d+ 字！/,
                'content 不超过 80 字！emotionalJourney 不超过 20 字！',
            );
        const retry = await doCall(retryPrompt, 6000, 1);
        console.log(`🧠 [VectorExtract] Retry: ${retry.content.length} chars, truncated=${retry.truncated}`);
        results = parseContent(retry.content, 'retry');

        if (results.length > 0) {
            console.log(`🧠 [VectorExtract] Retry succeeded: ${results.length} objects`);
            return results;
        }
        console.warn('🧠 [VectorExtract] Retry also failed:', retry.content.slice(0, 500));
    } else {
        console.warn('🧠 [VectorExtract] Failed to parse (empty/skip):', first.content.slice(0, 200));
    }

    return [];
}
