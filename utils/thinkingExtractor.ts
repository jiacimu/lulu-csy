/**
 * Thinking Chain Extractor — 思考链提取器（前端版）
 *
 * 纯函数，零依赖。与后端 thinkingExtractor.ts 共用同一套正则逻辑。
 * 从 LLM 原始输出中提取 <thinking>/<think> 标签内的推理过程，
 * 返回清洗后的显示文本 + 可选的思考链内容。
 */

export interface ExtractionResult {
    /** 清洗后的显示文本（已去除所有思考标签） */
    content: string;
    /** 提取到的思考链文本（可能为 undefined） */
    thinking?: string;
}

export const THINKING_CONTENT_FALLBACK_REPLY = '嗯...刚刚卡了一下';

export function safeThinkingFallbackReply(_thinkingContent?: string): string {
    return THINKING_CONTENT_FALLBACK_REPLY;
}

/**
 * 从 LLM 原始输出中提取思考链并清洗内容。
 *
 * 支持的标签格式（按优先级）：
 * 1. `<thinking>...</thinking>` — CoT 协议标签（本项目主用）
 * 2. 未闭合 `<thinking>...` — 输出被截断的情况
 * 3. `<think>...</think>` — DeepSeek-R1, Qwen3 等原生推理标签兜底
 * 4. 未闭合 `<think>...` — 输出被截断的情况
 */
export function extractThinking(raw: string): ExtractionResult {
    let thinking = '';

    // ── 1. 优先提取 <thinking> 项目 CoT 协议标签 ─────────────
    const cotMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (cotMatch) {
        thinking = cotMatch[1].trim();
    } else {
        const unclosedCot = raw.match(/<thinking>([\s\S]*)$/i);
        if (unclosedCot) {
            thinking = unclosedCot[1].replace(/<\/?thinking>/gi, '').trim();
        }
    }

    // ── 2. 没有项目 CoT 时才兜底提取 <think> 原生标签 ────────
    if (!thinking) {
        const nativeMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
        if (nativeMatch) {
            thinking = nativeMatch[1].trim();
        } else {
            const unclosed = raw.match(/<think>([\s\S]*)$/i);
            if (unclosed) {
                thinking = unclosed[1].replace(/<\/?think>/gi, '').trim();
            }
        }
    }

    // ── 3. 清洗：移除所有思考标签 ────────────────────────────
    let content = raw;
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    content = content.replace(/<think>[\s\S]*/gi, '').trim();
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    content = content.replace(/<thinking>[\s\S]*/gi, '').trim();

    // ── 4. 清洗 CoT 协议残留（模型未包裹在标签里的思考链内容）──
    content = stripCoTResidual(content);

    // 安全回退
    if (!content) {
        content = raw.replace(/<\/?think(?:ing)?>/gi, '').trim();
    }

    return {
        content,
        thinking: cleanThinkingForDisplay(thinking) || undefined,
    };
}

function stripStatusBlocks(value: string): string {
    return value
        .replace(/<status\b[^>]*>[\s\S]*?<\/status>/gi, '')
        .replace(/<status\b[^>]*>[\s\S]*$/gi, '')
        .trim();
}

export function cleanThinkingForDisplay(value: string): string {
    return stripStatusBlocks(value);
}

export function selectThinkingForDisplay(
    projectThinking?: string,
    nativeThinking?: string,
): string | undefined {
    return cleanThinkingForDisplay(projectThinking || '')
        || cleanThinkingForDisplay(nativeThinking || '')
        || undefined;
}

function stringifyCompletionContent(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value == null) return '';

    if (Array.isArray(value)) {
        return value.map(part => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object') return '';

            const record = part as Record<string, unknown>;
            if (typeof record.text === 'string') return record.text;
            if (typeof record.content === 'string') return record.content;
            return '';
        }).join('');
    }

    return String(value);
}

function stringifyThinkingCandidate(value: unknown): string {
    if (typeof value === 'string') return value.trim();

    if (Array.isArray(value)) {
        return value
            .map(stringifyThinkingCandidate)
            .filter(Boolean)
            .join('\n\n')
            .trim();
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return stringifyThinkingCandidate(
            record.text ??
            record.content ??
            record.reasoning_content ??
            record.reasoning ??
            record.thinking ??
            '',
        );
    }

    return '';
}

/**
 * Extract thinking from OpenAI-compatible Chat Completion responses.
 *
 * Some providers put reasoning in native fields instead of embedding
 * `<think>/<thinking>` tags in message.content. Prefer the project's explicit
 * `<thinking>` CoT when present, and only fall back to native fields otherwise.
 */
export function extractThinkingFromChatCompletionResponse(data: unknown): ExtractionResult {
    const root = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const choice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
    const message = choice.message && typeof choice.message === 'object' ? choice.message as Record<string, unknown> : {};
    const contentParts = Array.isArray(message.content) ? message.content : [];

    const rawContent = stringifyCompletionContent(message.content ?? choice.text ?? '');
    const extracted = extractThinking(rawContent);
    const nativeThinking = [
        message.reasoning_content,
        message.thinking,
        message.reasoning,
        choice.reasoning_content,
        choice.thinking,
        choice.reasoning,
        ...contentParts.map(part => {
            if (!part || typeof part !== 'object') return '';
            const record = part as Record<string, unknown>;
            return record.reasoning_content ?? record.thinking ?? record.reasoning ?? '';
        }),
    ]
        .map(stringifyThinkingCandidate)
        .filter(Boolean)
        .join('\n\n')
        .trim();

    return {
        content: extracted.content,
        thinking: selectThinkingForDisplay(extracted.thinking, nativeThinking),
    };
}

/**
 * Strip CoT (Chain-of-Thought) protocol residual patterns from AI output.
 * 
 * When models like Gemini 2.5 Pro use native thinking, they may still output
 * CoT protocol steps directly in the text response without wrapping them
 * in <thinking> tags. This function detects and removes those patterns.
 * 
 * Uses a two-phase approach to avoid false positives:
 * 1. First detects CoT signature patterns (Step N — headers)
 * 2. Only then strips all CoT-related content
 */
export function stripCoTResidual(content: string): string {
    if (!content) return content;

    // Phase 1: Check for CoT signature — at least one "Step N —" pattern
    const cotSignature = /^Step\s+\d+\s*[—–-]\s*/m;
    const hasCotSeparator = /^[━─═]{4,}/m;
    const hasCotProtocolTag = /<\/?cot_protocol[^>]*>/i;

    const hasCoTLeak = cotSignature.test(content) || hasCotSeparator.test(content) || hasCotProtocolTag.test(content);

    if (!hasCoTLeak) return content;

    console.log(`🧹 [CoT Strip] Detected CoT residual in output (${content.length} chars), stripping...`);

    // Phase 2: Remove all CoT-related patterns line by line
    const lines = content.split('\n');
    const cleanLines: string[] = [];
    let inCoTBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines when in a CoT block
        if (inCoTBlock && !trimmed) continue;

        // CoT protocol XML tags
        if (/<\/?cot_protocol[^>]*>/i.test(trimmed)) continue;

        // Step headers: "Step 0 — 规则就位", "Step 1 — 理解 user", etc.
        if (/^Step\s+\d+\s*[—–-]\s*.*/i.test(trimmed)) {
            inCoTBlock = true;
            continue;
        }

        // Full-width separator lines: ━━━━━━ or ══════ or ──────
        if (/^[━─═]{4,}\s*$/.test(trimmed)) {
            // Separators mark CoT block boundaries
            if (inCoTBlock) {
                inCoTBlock = false; // end of a CoT step block
            }
            continue;
        }

        // Sub-step lines within a CoT block: "a. ...", "b. ...", "c. ..." etc.
        if (inCoTBlock && /^[a-z]\.\s+/.test(trimmed)) continue;

        // Checkbox patterns within CoT: "□ ..."
        if (inCoTBlock && /^[□☐✓✗☑]\s+/.test(trimmed)) continue;

        // Arrow patterns within CoT: "→ ..."
        if (inCoTBlock && /^→\s+/.test(trimmed)) continue;

        // Lines starting with "- " in a CoT block that look like analysis steps
        // Be more conservative: only strip if it looks like meta-analysis, not dialogue
        if (inCoTBlock && /^-\s+(Analyze|Formulate|Check|Review|Assess|Evaluate|Consider|Identify|Note|Observe|Reflect|Plan|Think|内心|分析|检查|回顾|评估|思考|判断|注意|观察|反思|计划|制定|确认|核实)/i.test(trimmed)) continue;

        // If we hit substantive content (not matching any CoT pattern), exit the block
        if (inCoTBlock && trimmed.length > 0) {
            // Check if it still looks like CoT reasoning (contains meta-language)
            const isMeta = /^(快速回答|你是一个|你正在|你现在|我是|我正在|当前|目前|这轮|这次|本轮|以上|综上|深呼吸)/.test(trimmed)
                || /^(你的|我的|用户的|对方的)(意图|诉求|情绪|状态|想法|核心|真实|潜台词)/.test(trimmed)
                || /^(回看|检查|审视|确认|没有问题|有问题|需要修改)/.test(trimmed);
            if (isMeta) continue;

            // Substantive content found — exit CoT block
            inCoTBlock = false;
            cleanLines.push(line);
        } else if (!inCoTBlock) {
            cleanLines.push(line);
        }
    }

    const result = cleanLines.join('\n').trim();
    
    // If stripping removed everything, return original (safety net)
    if (!result) {
        console.warn('🧹 [CoT Strip] Stripping removed all content, returning original');
        return content;
    }

    console.log(`🧹 [CoT Strip] Stripped CoT residual: ${content.length} → ${result.length} chars`);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// Inner Whispers (内心低语) — 520 约会剧场 CYOA 选项提取器
// ═══════════════════════════════════════════════════════════════

/** A single whisper option surfaced from the AI's response */
export interface InnerWhisper {
    /** Displayed text — an implicit action/emotion, NOT dialogue.  e.g. "悄悄握紧他的手…" */
    whisper: string;
    /** Emotional tone tag: 大胆 | 温柔 | 克制 | 调皮 | 退缩 … */
    tone: string;
    /** Hidden director note injected into the NEXT turn's system prompt.
     *  The user never sees this — it tells the AI how to react to the user's choice. */
    secret: string;
}

export interface WhisperExtractionResult {
    /** Display content with the whisper block stripped */
    content: string;
    /** Extracted whispers (empty array if none or parse failure) */
    whispers: InnerWhisper[];
}

/**
 * Extract `<inner_whispers>[...]</inner_whispers>` from AI output.
 *
 * Designed to be called AFTER `extractThinking()` on the already-cleaned content.
 * The whisper block should appear at the very end of the response.
 */
export function extractInnerWhispers(raw: string): WhisperExtractionResult {
    if (!raw) return { content: raw, whispers: [] };

    // Match the tagged block (case-insensitive, may have whitespace around JSON)
    const match = raw.match(/<inner_whispers>\s*([\s\S]*?)\s*<\/inner_whispers>/i);

    if (!match) return { content: raw, whispers: [] };

    // Strip the block from display content
    const content = raw.replace(/<inner_whispers>[\s\S]*?<\/inner_whispers>/gi, '').trim();

    // Parse JSON array
    let whispers: InnerWhisper[] = [];
    try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
            whispers = parsed
                .filter((w: any) => w && typeof w.whisper === 'string' && w.whisper.trim())
                .map((w: any) => ({
                    whisper: w.whisper.trim(),
                    tone: typeof w.tone === 'string' ? w.tone.trim() : '',
                    secret: typeof w.secret === 'string' ? w.secret.trim() : '',
                }));
        }
    } catch (e) {
        console.warn('[InnerWhispers] Failed to parse whispers JSON:', e);
    }

    if (whispers.length > 0) {
        console.log(`💭 [InnerWhispers] Extracted ${whispers.length} whisper(s)`);
    }

    return { content, whispers };
}
