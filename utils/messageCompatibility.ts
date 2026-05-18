import type { Message, MessageType } from '../types';
import { shouldIncludeMessageInContext } from './messageContext';

const MESSAGE_TYPES = new Set<MessageType>([
    'text',
    'image',
    'emoji',
    'interaction',
    'transfer',
    'system',
    'social_card',
    'chat_forward',
    'xhs_card',
    'score_card',
    'music_card',
    'mcd_card',
    'html_card',
    'moments',
    'voice',
    'call_log',
    'soul_reflection',
]);

const ROLE_ALIASES: Record<string, Message['role']> = {
    user: 'user',
    human: 'user',
    player: 'user',
    self: 'user',
    me: 'user',
    mine: 'user',
    我: 'user',
    用户: 'user',
    你: 'user',
    assistant: 'assistant',
    ai: 'assistant',
    bot: 'assistant',
    char: 'assistant',
    character: 'assistant',
    model: 'assistant',
    role: 'assistant',
    npc: 'assistant',
    角色: 'assistant',
    助手: 'assistant',
    system: 'system',
    系统: 'system',
};

const TYPE_ALIASES: Record<string, MessageType> = {
    plain: 'text',
    message: 'text',
    msg: 'text',
    chat: 'text',
    img: 'image',
    photo: 'image',
    picture: 'image',
    sticker: 'emoji',
    emotion: 'emoji',
    audio: 'voice',
    call: 'call_log',
    calllog: 'call_log',
    socialcard: 'social_card',
    chatforward: 'chat_forward',
    xhscard: 'xhs_card',
    scorecard: 'score_card',
    musiccard: 'music_card',
    mcdcard: 'mcd_card',
    htmlcard: 'html_card',
    soulreflection: 'soul_reflection',
};

const VECTOR_EXCLUDED_TYPES = new Set<string>(['system', 'moments']);
const VECTOR_EXCLUDED_SOURCES = new Set(['theater', 'date']);

function normalizeKey(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[\s_-]+/g, '')
        : '';
}

function normalizeTypeName(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
        : '';
}

function normalizeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function normalizeMessageRole(source: Record<string, any>): Message['role'] {
    const direct = ROLE_ALIASES[normalizeKey(source.role)];
    if (direct) return direct;

    const sender = ROLE_ALIASES[normalizeKey(source.sender ?? source.from ?? source.author ?? source.speaker)];
    if (sender) return sender;

    if (typeof source.isUser === 'boolean') return source.isUser ? 'user' : 'assistant';
    if (typeof source.is_user === 'boolean') return source.is_user ? 'user' : 'assistant';
    if (typeof source.fromUser === 'boolean') return source.fromUser ? 'user' : 'assistant';
    if (typeof source.is_user_message === 'boolean') return source.is_user_message ? 'user' : 'assistant';

    return 'assistant';
}

function normalizeMessageType(source: Record<string, any>, content: string): MessageType {
    const rawValue = source.type ?? source.messageType ?? source.message_type ?? source.kind;
    const rawType = normalizeTypeName(rawValue);
    if (MESSAGE_TYPES.has(rawType as MessageType)) return rawType as MessageType;
    const alias = TYPE_ALIASES[normalizeKey(rawValue)];
    if (alias) return alias;

    if (/^data:image\//.test(content) || /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(content)) {
        return 'image';
    }

    return 'text';
}

function parseCompactDate(value: string): number {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:[ T_-]?(\d{2})(\d{2})(\d{2})?)?$/);
    if (!match) return 0;
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
    const timestamp = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeTimestampValue(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }
        const compact = parseCompactDate(trimmed);
        if (compact > 0) return compact;
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
}

function normalizeMessageTimestamp(source: Record<string, any>): number {
    const candidates = [
        source.timestamp,
        source.createdAt,
        source.created_at,
        source.sendDate,
        source.send_date,
        source.date,
        source.time,
    ];

    for (const candidate of candidates) {
        const timestamp = normalizeTimestampValue(candidate);
        if (timestamp > 0) return timestamp;
    }

    return Date.now();
}

function normalizeMessageContent(source: Record<string, any>): string {
    const candidates = [
        source.content,
        source.text,
        source.message,
        source.mes,
        source.body,
        source.value,
        source.caption,
        source.url,
        source.imageUrl,
        source.image,
        source.src,
        source.metadata?.sourceText,
        source.metadata?.caption,
        source.metadata?.description,
        source.metadata?.ocrText,
    ];
    for (const candidate of candidates) {
        const text = normalizeString(candidate);
        if (text) return text;
    }
    return '';
}

function normalizeMessageId(source: Record<string, any>, target: Record<string, any>): void {
    if (!Object.prototype.hasOwnProperty.call(source, 'id')) return;
    const numericId = Number(source.id);
    if (Number.isInteger(numericId) && numericId > 0) {
        target.id = numericId;
        return;
    }
    delete target.id;
}

export function normalizeImportedMessage(raw: unknown): Record<string, any> | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Record<string, any>;
    const content = normalizeMessageContent(source);
    const target: Record<string, any> = {
        ...source,
        role: normalizeMessageRole(source),
        type: normalizeMessageType(source, content),
        content,
        timestamp: normalizeMessageTimestamp(source),
    };
    normalizeMessageId(source, target);
    return target;
}

export function normalizeMessageForVectorExtraction(raw: unknown): Message | null {
    const normalized = normalizeImportedMessage(raw) as Message | null;
    if (!normalized) return null;
    if (normalized.role !== 'user' && normalized.role !== 'assistant') return null;
    if (VECTOR_EXCLUDED_TYPES.has(normalized.type)) return null;
    if (VECTOR_EXCLUDED_SOURCES.has(String(normalized.metadata?.source || ''))) return null;
    if (!shouldIncludeMessageInContext(normalized)) return null;
    if (!normalized.content && normalized.type === 'text') return null;
    return normalized;
}
