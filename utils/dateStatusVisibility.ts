import type { Message } from '../types';

export const RECENT_DATE_STATUS_CARD_RENDER_LIMIT = 3;

export function findLatestDateStatusMessage(messages: Message[]): Message | undefined {
    return [...messages].reverse().find(message => (
        message.role === 'assistant'
        && message.metadata?.statusCardData
    ));
}

export function findLatestDateStatusDialogueMessage(messages: Message[]): Message | undefined {
    return [...messages].reverse().find(message => (
        message.type === 'text'
        && (message.role === 'assistant' || message.role === 'user')
    ));
}

export function getRecentDateStatusMessageIds(
    messages: Message[],
    limit = RECENT_DATE_STATUS_CARD_RENDER_LIMIT,
): Set<Message['id']> {
    const ids = new Set<Message['id']>();
    for (let index = messages.length - 1; index >= 0 && ids.size < limit; index -= 1) {
        const message = messages[index];
        if (message.role === 'assistant' && message.metadata?.statusCardData) {
            ids.add(message.id);
        }
    }
    return ids;
}

