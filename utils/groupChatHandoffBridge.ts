import type { CharacterProfile, Emoji, GroupProfile, Message, UserProfile } from '../types';
import { formatMessageForContext, shouldIncludeMessageInContext } from './messageContext';
import { findGroupCharacterByMemberId } from './groupChatDirector';
import { sortGroupLogMessages } from './groupChatPerspective';
import { getGroupMemoryHandoffStartIndex } from './groupChatMemory';

export const GROUP_CHAT_HANDOFF_BRIDGE_KEY_PREFIX = 'groupchat_handoff_bridge_';
export const GROUP_CHAT_HANDOFF_SOURCE_LIMIT = 40;
export const GROUP_CHAT_HANDOFF_ENTRY_LIMIT = 24;
export const GROUP_CHAT_HANDOFF_ENTRY_CHAR_LIMIT = 220;

const GROUP_CHAT_HANDOFF_BRIDGE_VERSION = 1;
const GROUP_CHAT_HANDOFF_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface GroupChatHandoffEntry {
    id?: number;
    role: 'user' | 'assistant';
    senderId: string;
    senderName: string;
    content: string;
    timestamp: number;
}

export interface GroupChatHandoffBridge {
    version: number;
    groupId: string;
    groupName: string;
    updatedAt: number;
    startTimestamp?: number;
    endTimestamp?: number;
    handoffStartIndex: number;
    sourceMessageCount: number;
    participantNames: string[];
    summary: string;
    entries: GroupChatHandoffEntry[];
}

function getGroupChatHandoffBridgeKey(groupId: string): string {
    return `${GROUP_CHAT_HANDOFF_BRIDGE_KEY_PREFIX}${groupId}`;
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function clipText(value: string, limit: number): string {
    const compacted = compactText(value);
    return compacted.length > limit ? `${compacted.slice(0, Math.max(0, limit - 1))}…` : compacted;
}

function stripNonPublicInlineTags(value: string): string {
    return value
        .replace(/<心声>[\s\S]*?<\/心声>/gi, '')
        .replace(/\[\[PRIVATE\s*[:：]\s*[\s\S]*?\]\]/gi, '')
        .trim();
}

export function isPublicGroupHandoffMessage(message: Message): boolean {
    if (message.role !== 'user' && message.role !== 'assistant') return false;
    if (!shouldIncludeMessageInContext(message)) return false;

    const metadata = message.metadata || {};
    const source = String(metadata.source || '');
    if (source === 'group_live_recap' || source === 'group_private' || source === 'private') return false;
    if (metadata.groupLiveRecapKey || metadata.privateCommand || metadata.privateMessage || metadata.isPrivate) return false;

    return true;
}

function fallbackContent(message: Message): string {
    if (message.type === 'image') return '[图片]';
    if (message.type === 'emoji') return '[表情]';
    if (message.type === 'voice') return '[语音]';
    return message.content || '';
}

function getSenderName(message: Message, characters: CharacterProfile[], userProfile: UserProfile): string {
    if (message.role === 'user') return userProfile.name || '用户';
    return findGroupCharacterByMemberId(message.charId, characters)?.name || '群成员';
}

function buildEntry(
    message: Message,
    characters: CharacterProfile[],
    userProfile: UserProfile,
    emojis?: Emoji[],
): GroupChatHandoffEntry | null {
    if (message.role !== 'user' && message.role !== 'assistant') return null;

    const senderName = getSenderName(message, characters, userProfile);
    const formatted = formatMessageForContext(message, {
        surface: 'chat',
        charName: senderName,
        userName: userProfile.name,
        emojis,
        compact: true,
        maxContentChars: GROUP_CHAT_HANDOFF_ENTRY_CHAR_LIMIT,
    });
    const content = clipText(stripNonPublicInlineTags(formatted || fallbackContent(message)), GROUP_CHAT_HANDOFF_ENTRY_CHAR_LIMIT);
    if (!content) return null;

    return {
        id: message.id,
        role: message.role,
        senderId: message.role === 'user' ? 'user' : message.charId,
        senderName,
        content,
        timestamp: message.timestamp,
    };
}

function buildSummary(group: GroupProfile, entries: GroupChatHandoffEntry[], participantNames: string[]): string {
    const last = entries[entries.length - 1];
    const participants = participantNames.length > 0 ? participantNames.join('、') : '群成员';
    const lastLine = last ? `最后停在${last.senderName}说「${clipText(last.content, 80)}」。` : '';
    return `「${group.name}」的近期公开群聊片段，在场发言有${participants}。${lastLine}`;
}

export function buildGroupChatHandoffBridge(options: {
    group: GroupProfile;
    messages: Message[];
    characters: CharacterProfile[];
    userProfile: UserProfile;
    emojis?: Emoji[];
}): GroupChatHandoffBridge | null {
    const handoffStartIndex = getGroupMemoryHandoffStartIndex(options.group.id);
    const unsummarizedMessages = sortGroupLogMessages(options.messages)
        .filter(shouldIncludeMessageInContext)
        .slice(handoffStartIndex);
    const sourceMessages = unsummarizedMessages
        .filter(isPublicGroupHandoffMessage)
        .slice(-GROUP_CHAT_HANDOFF_SOURCE_LIMIT);
    const entries = sourceMessages
        .slice(-GROUP_CHAT_HANDOFF_ENTRY_LIMIT)
        .map(message => buildEntry(message, options.characters, options.userProfile, options.emojis))
        .filter((entry): entry is GroupChatHandoffEntry => Boolean(entry));

    if (entries.length === 0) return null;

    const participantNames = Array.from(new Set(entries.map(entry => entry.senderName).filter(Boolean)));
    const startTimestamp = entries[0]?.timestamp;
    const endTimestamp = entries[entries.length - 1]?.timestamp;

    return {
        version: GROUP_CHAT_HANDOFF_BRIDGE_VERSION,
        groupId: options.group.id,
        groupName: options.group.name,
        updatedAt: Date.now(),
        startTimestamp,
        endTimestamp,
        handoffStartIndex,
        sourceMessageCount: sourceMessages.length,
        participantNames,
        summary: buildSummary(options.group, entries, participantNames),
        entries,
    };
}

export function writeGroupChatHandoffBridge(bridge: GroupChatHandoffBridge): void {
    try {
        localStorage.setItem(getGroupChatHandoffBridgeKey(bridge.groupId), JSON.stringify(bridge));
    } catch {
        // Best effort: this is only a short private-chat handoff cache.
    }
}

export function readGroupChatHandoffBridge(groupId: string): GroupChatHandoffBridge | null {
    try {
        const raw = localStorage.getItem(getGroupChatHandoffBridgeKey(groupId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as GroupChatHandoffBridge;
        if (!parsed || parsed.version !== GROUP_CHAT_HANDOFF_BRIDGE_VERSION || parsed.groupId !== groupId) return null;
        if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
        const currentHandoffStartIndex = getGroupMemoryHandoffStartIndex(groupId);
        if (!Number.isFinite(parsed.handoffStartIndex) || parsed.handoffStartIndex < currentHandoffStartIndex) {
            localStorage.removeItem(getGroupChatHandoffBridgeKey(groupId));
            return null;
        }
        if (Date.now() - Number(parsed.updatedAt || 0) > GROUP_CHAT_HANDOFF_MAX_AGE_MS) {
            localStorage.removeItem(getGroupChatHandoffBridgeKey(groupId));
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function refreshGroupChatHandoffBridge(options: {
    group: GroupProfile;
    messages: Message[];
    characters: CharacterProfile[];
    userProfile: UserProfile;
    emojis?: Emoji[];
}): GroupChatHandoffBridge | null {
    const bridge = buildGroupChatHandoffBridge(options);
    if (bridge) writeGroupChatHandoffBridge(bridge);
    return bridge;
}

function formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString([], {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatEntrySender(entry: GroupChatHandoffEntry, char: CharacterProfile, userProfile: UserProfile): string {
    if (entry.role === 'user') return userProfile.name || '用户';
    if (entry.senderId === char.id) return `${char.name}（我）`;
    return entry.senderName || '群成员';
}

export function formatGroupChatHandoffBridgeForPrompt(
    bridge: GroupChatHandoffBridge,
    char: CharacterProfile,
    userProfile: UserProfile,
): string {
    const timeRange = [formatTime(bridge.startTimestamp), formatTime(bridge.endTimestamp)]
        .filter(Boolean)
        .join(' - ');
    const lines = bridge.entries.map(entry => {
        const senderName = formatEntrySender(entry, char, userProfile);
        const time = formatTime(entry.timestamp);
        return `[${time}] ${senderName}: ${entry.content}`;
    });

    return [
        `【${bridge.groupName}${timeRange ? `｜${timeRange}` : ''}】`,
        `桥接范围：正式群聊回顾 checkpoint 之后的未总结公开消息。请按上面的时间判断它离现在有多近。`,
        bridge.summary,
        '现场尾巴：',
        lines.join('\n'),
    ].join('\n');
}
