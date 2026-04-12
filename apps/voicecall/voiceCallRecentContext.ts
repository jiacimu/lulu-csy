import type { Message } from '../../types';

export interface VoiceCallRecentContextMessage {
    id: number;
    charId: string;
    role: 'user' | 'assistant';
    type: 'text';
    content: string;
    timestamp: number;
}

const RECENT_CONTEXT_CHAR_LIMIT = 240;

function compactText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function clipText(text: string, limit: number = RECENT_CONTEXT_CHAR_LIMIT): string {
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function serializeRecentContextMessage(message: Message): string | null {
    const trimmed = compactText(message.content || '');

    switch (message.type) {
        case 'text':
            return trimmed || null;
        case 'voice':
            if (message.role === 'assistant') return null;
            return trimmed || '[发送了一条语音消息]';
        case 'image':
            return '[发送了一张图片]';
        case 'emoji':
            return '[发送了一个表情]';
        case 'interaction':
            return '[戳了你一下]';
        case 'transfer': {
            const amount = message.metadata?.amount;
            const status = message.metadata?.status;
            const amountText = amount ? ` ¥${amount}` : '';
            const statusText = status ? `（${status}）` : '';
            return `[发起了一笔转账${amountText}${statusText}]`;
        }
        case 'social_card': {
            const title = compactText(message.metadata?.post?.title || '');
            return title ? `[分享了一个 Spark 笔记] ${clipText(title)}` : '[分享了一个 Spark 笔记]';
        }
        case 'xhs_card': {
            const title = compactText(message.metadata?.xhsNote?.title || '');
            return title ? `[分享了一篇小红书笔记] ${clipText(title)}` : '[分享了一篇小红书笔记]';
        }
        case 'chat_forward':
            return '[转发了一段聊天记录]';
        case 'moments':
            return trimmed ? `[分享了朋友圈] ${clipText(trimmed)}` : '[分享了朋友圈]';
        default:
            return trimmed || null;
    }
}

export function buildVoiceCallRecentContextMessages(
    messages: Message[],
    options?: { limit?: number; hideBeforeMessageId?: number },
): VoiceCallRecentContextMessage[] {
    const limit = options?.limit ?? 50;
    const hideBeforeMessageId = options?.hideBeforeMessageId;

    const filtered = messages.filter((message) => {
        if (message.role !== 'user' && message.role !== 'assistant') return false;
        if (hideBeforeMessageId && message.id < hideBeforeMessageId) return false;
        return true;
    });

    return filtered
        .map((message) => {
            const serialized = serializeRecentContextMessage(message);
            if (!serialized) return null;

            return {
                id: message.id,
                charId: message.charId,
                role: message.role,
                type: 'text' as const,
                content: clipText(serialized),
                timestamp: message.timestamp,
            };
        })
        .filter((message): message is VoiceCallRecentContextMessage => !!message)
        .slice(-limit);
}

export function buildVoiceCallRecentContextTranscript(
    messages: VoiceCallRecentContextMessage[],
    userName: string,
    charName: string,
): string {
    return messages
        .map((message) => `${message.role === 'user' ? userName : charName}: ${message.content}`)
        .join('\n');
}
