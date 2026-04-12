import { getVoiceCallVisibleText } from './voiceCallTextSanitizer';

export const VOICE_CALL_OPENING_PROMPT = '[系统：电话接通，请说开场白]';

export interface VoiceCallHistoryEntry {
    role: string;
    content: string;
    audioBlob?: Blob;
}

export interface PersistedCallConversationEntry {
    role: string;
    content: string;
    hasAudio?: boolean;
}

export function filterPersistedCallHistory(history: VoiceCallHistoryEntry[]): VoiceCallHistoryEntry[] {
    return history.filter((entry) => entry.content !== VOICE_CALL_OPENING_PROMPT);
}

export function buildPersistedCallConversation(
    history: VoiceCallHistoryEntry[],
): PersistedCallConversationEntry[] {
    return filterPersistedCallHistory(history).map((entry) => ({
        role: entry.role,
        content: getVoiceCallVisibleText(entry.role, entry.content),
        ...(entry.audioBlob ? { hasAudio: true } : {}),
    }));
}

export function buildPersistedCallAudioEntries(
    savedMsgId: number | string,
    history: VoiceCallHistoryEntry[],
): Array<{ key: string; blob: Blob }> {
    return filterPersistedCallHistory(history).flatMap((entry, index) => (
        entry.audioBlob
            ? [{ key: `call_${savedMsgId}_${index}`, blob: entry.audioBlob }]
            : []
    ));
}

export function buildVoiceCallAudioLookupKeys(
    savedMsgId: number | string,
    index: number,
    includeLegacyShiftedKey = false,
): string[] {
    return [
        `call_${savedMsgId}_${index}`,
        ...(includeLegacyShiftedKey ? [`call_${savedMsgId}_${index + 1}`] : []),
    ];
}
