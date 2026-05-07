
import { DB } from './db';
import { LocalNotifications } from '@capacitor/local-notifications';
import { stripCoTResidual } from './thinkingExtractor';
import type { SongShareCard } from '../types/music';

// ═══════════════════════════════════════════════════════════════════════
//  Bilingual Marker — single source of truth for the %%BILINGUAL%% system
// ═══════════════════════════════════════════════════════════════════════

/** Canonical marker written into new messages (no spaces) */
export const BILINGUAL_MARKER = '%%BILINGUAL%%';

/**
 * Regex that matches BOTH old format `%% BILINGUAL %%` (with spaces)
 * and new format `%%BILINGUAL%%` (no spaces) for backward compatibility.
 * Use with `gi` flags for global/case-insensitive matching.
 */
export const BILINGUAL_RE = /%%\s*BILINGUAL\s*%%/gi;

export type ChatResponsePart =
    | { type: 'text'; content: string }
    | { type: 'emoji'; content: string }
    | { type: 'song'; content: SongShareCard };

function stripOuterTagJunk(value: string): string {
    return value
        .replace(/`+/g, '')
        .replace(/^[\s\[\]【】]+/, '')
        .replace(/[\s\[\]【】]+$/, '')
        .trim();
}

function isToolWrapperJunk(value: string): boolean {
    return /^[\s`[\]【】]+$/.test(value);
}

function stripOuterCodeFence(value: string): string {
    const trimmed = value.trim();
    const fenceMatch = trimmed.match(/^```(?:json|JSON|text|markdown|md)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/);
    return fenceMatch ? fenceMatch[1].trim() : value;
}

function getJsonTextCandidate(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    for (const key of ['content', 'text', 'reply', 'response', 'answer']) {
        if (typeof record[key] === 'string') return record[key] as string;
    }

    const message = record.message;
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
        const messageRecord = message as Record<string, unknown>;
        if (typeof messageRecord.content === 'string') return messageRecord.content;
    }

    return null;
}

function normalizeChatTextEnvelope(text: string): string {
    let result = stripOuterCodeFence(text);

    for (let i = 0; i < 2; i++) {
        const trimmed = stripOuterCodeFence(result).trim();
        const looksJsonWrapped =
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'));
        if (!looksJsonWrapped) break;

        try {
            const candidate = getJsonTextCandidate(JSON.parse(trimmed));
            if (candidate === null) break;
            result = stripOuterCodeFence(candidate);
        } catch {
            break;
        }
    }

    return result
        .replace(/\\r\\n|\\n|\\r/g, '\n')
        .replace(/\\t/g, '\t');
}

function stripLeakedChatLinePrefixes(text: string): string {
    return text
        .replace(/^[ \t]*[\[【(（][ \t]*(?:\d{4}[-/年]\d{1,2}(?:[-/月]\d{1,2}日?)?[ \t]*)?(?:[上下]午[ \t]*)?\d{1,2}[：:]\d{2}(?:[ \t]*(?:AM|PM))?[ \t]*[\]】)）][ \t]*(?:[\w\u4e00-\u9fa5·•._ -]{1,40}[：:][ \t]*)?/gim, '')
        .replace(/^[ \t]*(?:\d{4}[-/年]\d{1,2}(?:[-/月]\d{1,2}日?)?[ T\t]+(?:[上下]午[ \t]*)?\d{1,2}[：:]\d{2}(?:[ \t]*(?:AM|PM))?[ \t]+(?:[\w\u4e00-\u9fa5·•._ -]{1,40}[：:][ \t]*)?|(?:[上下]午[ \t]*)?\d{1,2}[：:]\d{2}(?:[ \t]*(?:AM|PM))?[ \t]+[\w\u4e00-\u9fa5·•._ -]{1,40}[：:][ \t]*)/gim, '');
}

function normalizeSongShareTags(text: string): string {
    let result = text.replace(
        /(?:\[\[|\[|【)\s*(?:分享(?:歌曲|音乐)|(?:share[-_]?)?song)\s*[:：]\s*([\s\S]*?)\s*(?:\]\]|]|】)/gi,
        (_fullMatch, content: string) => `[[SHARE_SONG: ${stripOuterTagJunk(content)}]]`,
    );

    result = result.replace(
        /(?:\[\[|\[|【)\s*SHARE_SONG\s*[:：]\s*([\s\S]*?)\s*(?:\]\]|]|】)/gi,
        (_fullMatch, content: string) => `[[SHARE_SONG: ${stripOuterTagJunk(content)}]]`,
    );

    if (/\[\[(?:SEND_EMOJI|SHARE_SONG):/i.test(result)) {
        result = result
            .split(/(?:\r\n|\r|\n)/)
            .filter((line) => !isToolWrapperJunk(line))
            .join('\n')
            .trim();
    }

    return result;
}

function parseSongShareContent(content: string): SongShareCard | null {
    const cleaned = stripOuterTagJunk(content)
        .replace(/^(?:SHARE_SONG|分享(?:歌曲|音乐)|(?:share[-_]?)?song)\s*[:：]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const rawParts = cleaned.includes('|') || cleaned.includes('｜')
        ? cleaned.split(/[|｜]/)
        : cleaned.split(/\s+(?:-|—|－)\s+/);
    const parts = rawParts.map((part) => stripOuterTagJunk(part));

    const songName = parts[0]?.replace(/^(?:歌名|歌曲名|歌曲|song(?:\s*name)?)\s*[:：]\s*/i, '').trim() || '';
    const artist = parts[1]?.replace(/^(?:歌手|歌手名|artist)\s*[:：]\s*/i, '').trim() || '';
    if (!songName || !artist) return null;

    const songIdText = parts[2]?.replace(/^(?:(?:歌曲)?ID|song\s*id)\s*[:：]\s*/i, '') || '0';
    const rawSongId = Number(songIdText.match(/\d+/)?.[0] || '0');
    const songId = Number.isFinite(rawSongId) ? Math.max(0, Math.trunc(rawSongId)) : 0;

    return {
        songId,
        songName,
        artist,
    };
}

/**
 * Parse a content string that may contain a %%BILINGUAL%% marker.
 * Returns { hasBilingual, langA, langB }
 *   - langA = original text (before marker)
 *   - langB = translated text (after marker), empty string if no marker
 *
 * @param raw  The raw message content
 * @param clean  Optional cleanup function to apply to each half (e.g. stripJunk)
 */
export function parseBilingual(
    raw: string,
    clean?: (s: string) => string,
): { hasBilingual: boolean; langA: string; langB: string } {
    const match = raw.match(/%%\s*BILINGUAL\s*%%/i);
    if (!match) {
        const a = clean ? clean(raw) : raw;
        return { hasBilingual: false, langA: a, langB: '' };
    }
    const idx = match.index!;
    const markerLen = match[0].length;
    const a = clean ? clean(raw.substring(0, idx)) : raw.substring(0, idx).trim();
    const b = clean ? clean(raw.substring(idx + markerLen)) : raw.substring(idx + markerLen).trim();
    return { hasBilingual: true, langA: a, langB: b };
}

export const ChatParser = {
    // Return cleaned content and perform side effects
    parseAndExecuteActions: async (
        aiContent: string,
        charId: string,
        charName: string,
        addToast: (msg: string, type: 'info' | 'success' | 'error') => void
    ) => {
        let content = aiContent;

        // POKE
        if (content.includes('[[ACTION:POKE]]')) {
            await DB.saveMessage({ charId, role: 'assistant', type: 'interaction', content: '[戳一戳]' });
            content = content.replace('[[ACTION:POKE]]', '').trim();
        }

        // TRANSFER (AI initiates a transfer to the user)
        const transferMatch = content.match(/\[\[ACTION:TRANSFER:(\d+)\]\]/);
        if (transferMatch) {
            await DB.saveMessage({ charId, role: 'assistant', type: 'transfer', content: '[转账]', metadata: { amount: transferMatch[1], status: 'pending' } });
            content = content.replace(transferMatch[0], '').trim();
        }

        // RECEIVE_TRANSFER (AI accepts a pending user transfer)
        if (content.includes('[[ACTION:RECEIVE_TRANSFER]]')) {
            try {
                const recentMsgs = await DB.getRecentMessagesByCharId(charId, 50);
                const pendingUserTransfer = recentMsgs.slice().reverse().find(
                    m => m.role === 'user' && m.type === 'transfer' && m.metadata?.status === 'pending'
                );
                if (pendingUserTransfer) {
                    await DB.updateMessageMetadata(pendingUserTransfer.id, { status: 'accepted' });
                    addToast(`${charName} 已收取 ¥${pendingUserTransfer.metadata?.amount}`, 'success');
                }
            } catch (e) { console.error('RECEIVE_TRANSFER failed:', e); }
            content = content.replace('[[ACTION:RECEIVE_TRANSFER]]', '').trim();
        }

        // RETURN_TRANSFER (AI returns/rejects a pending user transfer)
        if (content.includes('[[ACTION:RETURN_TRANSFER]]')) {
            try {
                const recentMsgs = await DB.getRecentMessagesByCharId(charId, 50);
                const pendingUserTransfer = recentMsgs.slice().reverse().find(
                    m => m.role === 'user' && m.type === 'transfer' && m.metadata?.status === 'pending'
                );
                if (pendingUserTransfer) {
                    await DB.updateMessageMetadata(pendingUserTransfer.id, { status: 'returned' });
                    addToast(`${charName} 退还了 ¥${pendingUserTransfer.metadata?.amount}`, 'info');
                }
            } catch (e) { console.error('RETURN_TRANSFER failed:', e); }
            content = content.replace('[[ACTION:RETURN_TRANSFER]]', '').trim();
        }

        // ADD_EVENT
        const eventMatch = content.match(/\[\[ACTION:ADD_EVENT\s*\|\s*(.*?)\s*\|\s*(.*?)\]\]/);
        if (eventMatch) {
            const title = eventMatch[1].trim();
            const date = eventMatch[2].trim();
            if (title && date) {
                const anni: any = { id: `anni-${Date.now()}`, title: title, date: date, charId };
                await DB.saveAnniversary(anni);
                addToast(`${charName} 添加了新日程: ${title}`, 'success');
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 新增了日程 "${title}" (${date})]`, metadata: { source: 'schedule', scheduleEvent: 'add_event' } });
            }
            content = content.replace(eventMatch[0], '').trim();
        }

        // SCHEDULE
        const scheduleRegex = /\[schedule_message \| (.*?) \| fixed \| (.*?)\]/g;
        let match;
        while ((match = scheduleRegex.exec(content)) !== null) {
            const timeStr = match[1].trim();
            const msgContent = match[2].trim();
            const dueTime = new Date(timeStr).getTime();
            if (!isNaN(dueTime) && dueTime > Date.now()) {
                await DB.saveScheduledMessage({ id: `sched-${Date.now()}-${Math.random()}`, charId, content: msgContent, dueAt: dueTime, createdAt: Date.now() });
                try {
                    const hasPerm = await LocalNotifications.checkPermissions();
                    if (hasPerm.display === 'granted') {
                        await LocalNotifications.schedule({ notifications: [{ title: charName, body: msgContent, id: Math.floor(Math.random() * 100000), schedule: { at: new Date(dueTime) }, smallIcon: 'ic_stat_icon_config_sample' }] });
                    }
                } catch (e) { console.log("Notification schedule skipped (web mode)"); }
                addToast(`${charName} 似乎打算一会儿找你...`, 'info');
            }
        }
        content = content.replace(scheduleRegex, '').trim();

        // RECALL tag removal (handling done in main loop logic, but cleaning here just in case)
        content = content.replace(/\[\[RECALL:.*?\]\]/g, '').trim();

        return content;
    },

    /**
     * Post-API-call cleanup for AI output.
     * Strips leaked timestamps, name prefixes, and normalises sticker tags.
     * Called after every API completion (initial + re-calls from search/diary/xhs).
     */
    cleanAiSecondPass: (text: string): string => {
        let result = stripLeakedChatLinePrefixes(normalizeChatTextEnvelope(text))
            .replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}.*?\]/g, '')
            .replace(/^[\w\u4e00-\u9fa5·•._ -]{1,40}\s*[:：]\s*/, '')
            .replace(/[【\[](?:(?:你|User|用户|System|我)\s*)?发送了?表情包?[:：]\s*(.*?)[】\]]/g, '[[SEND_EMOJI: $1]]')
            // Normalize single-bracket [SEND_EMOJI: ...] / 【SEND_EMOJI: ...】 → [[SEND_EMOJI: ...]]
            .replace(/(?:\[{1,2}|【)\s*SEND_EMOJI\s*[:：]\s*([\s\S]*?)\s*(?:\]{1,2}|】)/gi, '[[SEND_EMOJI: $1]]');
        result = normalizeSongShareTags(result);
        // Strip any CoT protocol residual that leaked through (e.g. from Gemini native thinking)
        result = stripCoTResidual(result);
        return stripLeakedChatLinePrefixes(result);
    },

    /**
     * Comprehensive sanitizer for AI output before saving to DB.
     * Removes AI-specific artifacts that should never appear in chat bubbles.
     * Safe to call multiple times (idempotent). Preserves %%BILINGUAL%% markers.
     */
    sanitize: (text: string): string => {
        return stripLeakedChatLinePrefixes(normalizeChatTextEnvelope(text))
            // Strip leaked timestamps from chat history context:
            // [2026-02-11 13:52] format (bracketed, from history entries)
            .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '')
            // 2026-02-11 13:52 format (unbracketed, at line start)
            .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*/gm, '')
            // （下午1:52）or（上午10:30）Chinese 12h parenthetical
            .replace(/（[上下]午\d{1,2}[：:]\d{2}）/g, '')
            // (1:52 PM) or (10:30 AM) English 12h parenthetical
            .replace(/\(\d{1,2}:\d{2}\s*[AP]M\)/gi, '')
            // Strip markdown headers (# ## ### etc) → keep the text
            .replace(/^#{1,6}\s+/gm, '')
            // Strip residual action/system tags that weren't caught earlier
            .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END|CALL)[:\s][\s\S]*?\]\]/g, '')
            .replace(/\[schedule_message[^\]]*\]/g, '')
            .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
            .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
            // [回复 "content"]: format (AI mimics history context format)
            .replace(/\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g, '')
            // Strip backtick-wrapped action tags and empty backtick pairs
            .replace(/`(\[\[[\s\S]*?\]\])`/g, '$1')
            .replace(/``+/g, '')
            .replace(/(^|\s)`(\s|$)/gm, '$1$2')
            // Strip markdown links → keep text only: [text](url) → text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Strip all ** sequences (orphaned bold markers are common AI artifacts;
            // in chat context, losing bold formatting is acceptable for clean display)
            .replace(/\*{2,}/g, '')
            // Strip standalone separators and bullets
            .replace(/^\s*---\s*$/gm, '')
            .replace(/^\s*[-*+]\s*$/gm, '')
            // Strip legacy translation marker (but keep %%BILINGUAL%% and <翻译> XML tags)
            .replace(/%%TRANS%%[\s\S]*/gi, '')
            // Collapse excessive whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    /**
     * Check if text has meaningful display content after stripping all markers/junk.
     * Used to decide whether a chunk is worth saving as a message.
     */
    hasDisplayContent: (text: string): boolean => {
        const stripped = text
            .replace(/%%\s*BILINGUAL\s*%%/gi, '')
            .replace(/%%TRANS%%[\s\S]*/gi, '')
            .replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '')
            .replace(/^\s*---\s*$/gm, '')
            .replace(/``+/g, '')
            .replace(/(^|\s)`(\s|$)/gm, '$1$2')
            .replace(/\[\[[\s\S]*?\]\]/g, '')
            .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
            .replace(/\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g, '')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[-*+]\s*$/gm, '')
            .trim();
        return stripped.length > 0;
    },

    // Split text into bubbles (text and emojis)
    parseSongShareContent,

    splitResponse: (content: string): ChatResponsePart[] => {
        content = normalizeSongShareTags(content);
        const tokenPattern = /\[\[(SEND_EMOJI|SHARE_SONG):\s*([\s\S]*?)\]\]/g;
        const parts: ChatResponsePart[] = [];
        let lastIndex = 0;
        let tokenMatch: RegExpExecArray | null;

        while ((tokenMatch = tokenPattern.exec(content)) !== null) {
            if (tokenMatch.index > lastIndex) {
                const textBefore = content.slice(lastIndex, tokenMatch.index).trim();
                if (textBefore && !isToolWrapperJunk(textBefore)) parts.push({ type: 'text', content: textBefore });
            }

            if (tokenMatch[1] === 'SEND_EMOJI') {
                parts.push({ type: 'emoji', content: tokenMatch[2].trim() });
            } else {
                const songCard = parseSongShareContent(tokenMatch[2]);
                if (songCard) {
                    parts.push({ type: 'song', content: songCard });
                } else {
                    const rawTag = tokenMatch[0].trim();
                    if (rawTag) parts.push({ type: 'text', content: rawTag });
                }
            }

            lastIndex = tokenMatch.index + tokenMatch[0].length;
        }

        if (lastIndex < content.length) {
            const remaining = content.slice(lastIndex).trim();
            if (remaining && !isToolWrapperJunk(remaining)) parts.push({ type: 'text', content: remaining });
        }

        if (parts.length === 0 && content.trim()) parts.push({ type: 'text', content: content.trim() });
        return parts;
    },

    // Chunking text for typing effect - splits into separate chat bubbles
    // Primary: split on line breaks (AI decides where to break)
    // Fallback: if no line breaks and text is long, split on spaces between CJK characters
    //   (Chinese text normally has no spaces, so "汉字 汉字" means the AI intended a line break)
    chunkText: (text: string): string[] => {
        // Try line breaks first
        let chunks = text.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
            .map(c => c.trim())
            .filter(c => c.length > 0);

        // Fallback: no line breaks found and text is long enough
        // Split on spaces that sit between CJK characters/punctuation (中文里不该有空格)
        // NOTE: We avoid regex lookbehind (?<=...) because Safari ≤ 16.3 does not
        // support it and would throw a SyntaxError at module parse time, killing the
        // entire app.  Instead, we use a capture-group approach: match the CJK char
        // before + space + CJK char after, then reconstruct the chunks by keeping the
        // surrounding characters with their respective halves.
        if (chunks.length <= 1 && text.trim().length > 50) {
            const CJK_SPACE_CJK_RE = /([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2000-\u206f\u2e80-\u2eff\u3001-\u3003\u2018-\u201f\u300a-\u300f\uff01-\uff0f\uff1a-\uff20])\s+([\u4e00-\u9fff\u3400-\u4dbf])/g;
            const parts: string[] = [];
            let lastIdx = 0;
            let m: RegExpExecArray | null;
            while ((m = CJK_SPACE_CJK_RE.exec(text)) !== null) {
                // Include the CJK char before the space in the current chunk
                const splitPos = m.index + m[1].length;
                parts.push(text.slice(lastIdx, splitPos));
                lastIdx = splitPos;
                // Skip the whitespace; the next CJK char starts a new chunk
                const spaceLen = m[0].length - m[1].length - m[2].length;
                lastIdx += spaceLen;
                // Move the regex index back so the trailing CJK char can be matched
                // as a leading char for the next split
                CJK_SPACE_CJK_RE.lastIndex = m.index + m[1].length + spaceLen;
            }
            if (lastIdx < text.length) parts.push(text.slice(lastIdx));
            chunks = parts.map(c => c.trim()).filter(c => c.length > 0);
        }

        return chunks;
    }
}
