import type { Emoji, Message } from '../types';

export type MessageContextSurface = 'chat' | 'groupDirector' | 'memoryExtraction' | 'voiceCall' | 'secondaryModel' | 'retrieval' | 'agent';

export interface ContextMessage {
    id?: number;
    charId?: string;
    role: Message['role'] | string;
    type: Message['type'] | string;
    content: string;
    timestamp?: number;
    metadata?: any;
    replyTo?: Message['replyTo'];
}

export interface FormatMessageContextOptions {
    surface?: MessageContextSurface;
    charName?: string;
    userName?: string;
    emojis?: Pick<Emoji, 'name' | 'url'>[];
    includeTimestamp?: boolean;
    timestampFormatter?: (timestamp: number) => string;
    includeSpeaker?: boolean;
    compact?: boolean;
    maxContentChars?: number;
}

const STATUS_ECOSYSTEM_TYPES = new Set([
    'status_card',
    'inner_voice',
    'creative_status',
    'freeform_status',
    'custom_status',
]);

const STATUS_ECOSYSTEM_SOURCES = new Set([
    'status_card',
    'statusBar',
    'status_bar',
    'inner_voice',
    'innerVoice',
    'classic_inner_voice',
    'creative_card',
    'creative_status',
    'freeform_card',
    'freeform_status',
    'custom_card',
    'custom_status',
    'status_workshop',
]);

const DEFAULT_CONTENT_LIMIT = 300;

function compactText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function clipText(text: string, limit?: number): string {
    if (!Number.isFinite(limit) || !limit || limit <= 0) return text;
    return text.length > limit ? text.slice(0, limit) : text;
}

function formatScalar(value: unknown, fallback = ''): string {
    if (value === null || value === undefined) return fallback;
    return String(value);
}

function roleLabel(role: string, options: FormatMessageContextOptions): string {
    if (role === 'user') return options.userName || '用户';
    if (role === 'assistant') return options.charName || '角色';
    return '系统';
}

function isGenerationSurface(options: FormatMessageContextOptions): boolean {
    return options.surface === 'chat' || options.surface === 'groupDirector';
}

function isAssistantRole(message: ContextMessage): boolean {
    return message.role === 'assistant';
}

function normalizeTransferAmount(value: unknown): string {
    const raw = formatScalar(value, '?').trim();
    if (raw === '?') return raw;
    const cleaned = raw
        .replace(/[￥¥]/g, '')
        .replace(/[，,]/g, '')
        .replace(/\s+/g, '');
    const match = cleaned.match(/\d+(?:\.\d{1,2})?/);
    return match?.[0] || raw;
}

function hasStatusCardShape(value: any): boolean {
    return !!value
        && typeof value === 'object'
        && typeof value.body === 'string'
        && typeof value.cardType === 'string'
        && typeof value.style === 'object';
}

export function isStatusEcosystemMessage(message: ContextMessage): boolean {
    const type = String(message.type || '');
    const metadata = message.metadata || {};
    const source = String(metadata.source || '');

    return STATUS_ECOSYSTEM_TYPES.has(type)
        || STATUS_ECOSYSTEM_SOURCES.has(source)
        || typeof metadata.innerVoice === 'string'
        || hasStatusCardShape(metadata.statusCardData)
        || hasStatusCardShape(metadata.lastStatusCard)
        || hasStatusCardShape(metadata.cardData)
        || (typeof metadata.statusBarMode === 'string' && metadata.source !== 'soul_reflection');
}

export function shouldIncludeMessageInContext(message: ContextMessage): boolean {
    if (!message) return false;
    if (isStatusEcosystemMessage(message)) return false;
    if (
        message.metadata?.hiddenFromUser
        && message.type !== 'soul_reflection'
        && message.metadata?.source !== 'photo_continuity'
        && message.metadata?.source !== 'photo_delivery_failed'
    ) return false;
    return true;
}

const IMAGE_REPLY_CONTENT_RE = /^(?:data:image\/|blob:|https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$))/i;

function looksLikeImageReplyContent(value: string | undefined): boolean {
    return !!value && IMAGE_REPLY_CONTENT_RE.test(value.trim());
}

function formatReplyPrefix(message: ContextMessage): string {
    const reply = message.replyTo;
    if (!reply?.content) return '';
    const isImageReply = reply.type === 'image'
        || !!reply.thumbnailUrl
        || !!reply.imageUrl
        || looksLikeImageReplyContent(reply.content);
    const content = isImageReply
        ? (reply.visualSummary || (looksLikeImageReplyContent(reply.content) ? '图片' : reply.content))
        : reply.content;
    return `[回复 "${content.substring(0, 50)}..."]: `;
}

function formatTransfer(message: ContextMessage, options: FormatMessageContextOptions): string {
    const amt = normalizeTransferAmount(message.metadata?.amount);
    const status = message.metadata?.status || 'pending';
    const isFromUser = message.role === 'user';

    if (isGenerationSurface(options)) {
        if (isAssistantRole(message)) {
            const statusSuffix: Record<string, string> = {
                pending: '',
                accepted: '（历史状态：用户已收款）',
                returned: '（历史状态：用户已退还）',
            };
            return `[[ACTION:TRANSFER:${amt}]]${statusSuffix[status] || ''}`;
        }

        const userStatusMap: Record<string, string> = {
            pending: `用户给你转账 ¥${amt}，等待你收款`,
            accepted: `你已收取用户的 ¥${amt} 转账`,
            returned: `你已退还用户的 ¥${amt} 转账`,
        };
        return `[${userStatusMap[status] || userStatusMap.pending}]`;
    }

    const statusMap: Record<string, string> = isFromUser
        ? {
            pending: `用户给你转账 ¥${amt}，等待你收款`,
            accepted: `你已收取用户的 ¥${amt} 转账`,
            returned: `你已退还用户的 ¥${amt} 转账`,
        }
        : {
            pending: `你给用户转账 ¥${amt}，等待用户收款`,
            accepted: `用户已收取你的 ¥${amt} 转账`,
            returned: `用户已退还你的 ¥${amt} 转账`,
        };
    return `[系统: ${statusMap[status] || statusMap.pending}]`;
}

function formatSocialCard(message: ContextMessage, options: FormatMessageContextOptions): string {
    const post = message.metadata?.post || {};
    const commentsSample = Array.isArray(post.comments)
        ? post.comments.map((c: any) => `${c.authorName || '评论'}: ${c.content || ''}`).filter(Boolean).join(' | ')
        : '';
    const title = post.title || '无标题';
    const content = post.content || message.content || '';
    const suffix = options.surface === 'chat' && message.role === 'user'
        ? '\n(请根据你的性格对这个帖子发表看法，比如吐槽、感兴趣或者不屑)'
        : '';
    return `[用户分享了 Spark 笔记]\n标题: ${title}\n内容: ${clipText(content, 300)}${commentsSample ? `\n热评: ${clipText(commentsSample, 300)}` : ''}${suffix}`;
}

function formatXhsCard(message: ContextMessage, options: FormatMessageContextOptions): string {
    const note = message.metadata?.xhsNote || {};
    const sender = message.role === 'user' ? '用户' : '你';
    const suffix = options.surface === 'chat' && message.role === 'user'
        ? '\n(请根据你的性格对这个帖子发表看法)'
        : '';
    return `[${sender}分享了小红书笔记]\n标题: ${note.title || '无标题'}\n作者: ${note.author || '未知'}\n赞: ${note.likes || 0}\n简介: ${note.desc || '无'}${suffix}`;
}

function formatForwardedMessageContent(forwarded: any): string {
    const type = String(forwarded?.type || 'text');
    if (type === 'image') return '[图片]';
    if (type === 'emoji') return '[表情]';
    if (type === 'voice') return `[语音] ${formatScalar(forwarded?.metadata?.sourceText || forwarded?.content, '').slice(0, 200)}`;
    return formatScalar(forwarded?.content, '').slice(0, 200);
}

function formatChatForward(message: ContextMessage): string {
    try {
        const fwd = JSON.parse(message.content || '{}');
        const messages = Array.isArray(fwd.messages) ? fwd.messages : [];
        const lines = messages.slice(0, 8).map((fm: any) => {
            const sender = fm.role === 'user' ? (fwd.fromUserName || '用户') : (fwd.fromCharName || '角色');
            return `  ${sender}: ${formatForwardedMessageContent(fm)}`;
        });
        const count = fwd.count || messages.length || '?';
        return `[用户转发了与 ${fwd.fromCharName || '另一个角色'} 的 ${count} 条聊天记录]${lines.length ? `\n${lines.join('\n')}` : ''}`;
    } catch {
        return '[用户转发了一段聊天记录]';
    }
}

function formatVoice(message: ContextMessage, options: FormatMessageContextOptions): string {
    const text = formatScalar(message.metadata?.sourceText || message.content, '').trim();
    const duration = message.metadata?.duration || '?';
    const neutral = options.surface !== 'chat';
    const generation = isGenerationSurface(options);

    if (message.role === 'user') {
        if (neutral && text) return `[语音消息] ${clipText(text, options.maxContentChars)}`;
        if (neutral) return `[语音消息（${duration}秒）]`;
        if (text) return `[🎤用户语音] ${clipText(text, options.maxContentChars)}`;
        return `[用户发来一条语音消息（${duration}秒）]`;
    }

    if (message.role === 'assistant') {
        if (generation) return text ? `[语音消息] ${clipText(text, options.maxContentChars)}` : `[语音消息（${duration}秒）]`;
        if (neutral) return text ? `[语音消息] ${clipText(text, options.maxContentChars)}` : `[语音消息（${duration}秒）]`;
        const name = options.charName || '角色';
        return `[${name}发送了语音消息]${text ? ` ${clipText(text, options.maxContentChars)}` : ''}`;
    }

    return text ? `[语音消息] ${clipText(text, options.maxContentChars)}` : `[语音消息（${duration}秒）]`;
}

function getImageContextSummary(message: ContextMessage, maxContentChars?: number): string {
    const metadata = message.metadata || {};
    const photoMeta = metadata.photoMeta || {};
    const director = photoMeta.directorResult || {};
    const summary = metadata.visualSummary
        || metadata.photoSummary
        || metadata.caption
        || metadata.description
        || metadata.ocrText
        || photoMeta.continuity_summary
        || director.continuity_summary
        || director.scene_zh
        || director.caption
        || '';

    return clipText(compactText(String(summary || '')), maxContentChars);
}

function getUrlFileLabel(value: string): string {
    const text = value.trim();
    if (!text || text.startsWith('data:')) return '';

    try {
        const url = /^https?:\/\//i.test(text) ? new URL(text) : null;
        const pathname = url ? url.pathname : text.split(/[?#]/)[0];
        const fileName = pathname.split('/').filter(Boolean).pop() || '';
        return decodeURIComponent(fileName)
            .replace(/\.(?:png|jpe?g|gif|webp|avif|svg)$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim()
            .slice(0, 80);
    } catch {
        return '';
    }
}

function getEmojiContextName(message: ContextMessage, options: FormatMessageContextOptions): string {
    const metadata = message.metadata || {};
    const registryName = options.emojis?.find(e => e.url === message.content)?.name;
    const fallbackName = registryName
        || metadata.name
        || metadata.emojiName
        || metadata.label
        || metadata.contentLabel
        || getUrlFileLabel(message.content || '');
    return compactText(String(fallbackName || '未命名表情包')).slice(0, 80);
}

function formatMessageBody(message: ContextMessage, options: FormatMessageContextOptions): string | null {
    const type = String(message.type || 'text');
    const maxContentChars = options.maxContentChars ?? (options.surface === 'chat' ? undefined : DEFAULT_CONTENT_LIMIT);
    const replyPrefix = formatReplyPrefix(message);

    switch (type) {
        case 'text':
        case 'system':
            return `${replyPrefix}${clipText(message.content || '', maxContentChars)}`;
        case 'health_signal':
            return clipText(message.content || '', maxContentChars);
        case 'call_log':
            return `[通话记录] ${clipText(message.content || '', maxContentChars)}`;
        case 'voice':
            return formatVoice(message, { ...options, maxContentChars });
        case 'image': {
            const summary = getImageContextSummary(message, maxContentChars);
            if (isGenerationSurface(options)) {
                const label = isAssistantRole(message) ? '你发送过的图片' : '用户发来的图片';
                return summary
                    ? `[${label}] ${summary}`
                    : `[${label}]`;
            }
            const prefix = '发送了';
            return summary
                ? `[${prefix}一张图片] ${summary}`
                : `[${prefix}一张图片]`;
        }
        case 'emoji': {
            const stickerName = getEmojiContextName(message, options);
            if (isGenerationSurface(options)) {
                return isAssistantRole(message)
                    ? `[[SEND_EMOJI: ${stickerName}]]`
                    : `[用户发来的表情包「${stickerName}」]`;
            }
            const prefix = '发送了';
            return `[${prefix}表情包: ${stickerName}]`;
        }
        case 'interaction':
            return message.role === 'user' ? '[系统: 用户戳了你一下]' : '[系统: 你戳了用户一下]';
        case 'transfer':
            return formatTransfer(message, options);
        case 'social_card':
            return formatSocialCard(message, options);
        case 'xhs_card':
            return formatXhsCard(message, options);
        case 'chat_forward':
            return formatChatForward(message);
        case 'moments':
            return message.content ? `[分享了朋友圈] ${clipText(message.content, maxContentChars)}` : '[分享了朋友圈]';
        case 'soul_reflection': {
            const name = options.charName || '角色';
            return `[${name}的回神 - 停下来审视自己]\n${clipText(message.content || '', maxContentChars)}\n[这段回神已经完成。从现在起自然地在言行中体现调整，但绝对不要在对话中提到"回神"、"反省"或这段思考过程本身。]`;
        }
        default:
            return message.content ? `${replyPrefix}${clipText(message.content, maxContentChars)}` : null;
    }
}

export function formatMessageForContext(
    message: ContextMessage,
    options: FormatMessageContextOptions = {},
): string | null {
    if (!shouldIncludeMessageInContext(message)) return null;

    const body = formatMessageBody(message, options);
    if (!body?.trim()) return null;

    const parts: string[] = [];
    if (options.includeTimestamp && typeof message.timestamp === 'number') {
        const formatted = options.timestampFormatter
            ? options.timestampFormatter(message.timestamp)
            : new Date(message.timestamp).toLocaleString('zh-CN');
        parts.push(`[${formatted}]`);
    }
    if (options.includeSpeaker) {
        parts.push(`${roleLabel(String(message.role), options)}:`);
    }
    parts.push(body);

    const text = parts.join(' ');
    return options.compact ? compactText(text) : text;
}

export function formatMessagesForContext(
    messages: ContextMessage[],
    options: FormatMessageContextOptions = {},
): string[] {
    return messages
        .map(message => formatMessageForContext(message, options))
        .filter((text): text is string => !!text);
}
