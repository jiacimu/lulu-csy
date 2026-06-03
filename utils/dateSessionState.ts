import type { CharacterProfile, DateState, DialogueItem, Message } from '../types';

export const REQUIRED_DATE_EMOTION_KEYS = ['normal', 'happy', 'angry', 'sad', 'shy'] as const;

const INLINE_ASSET_KEEP_LIMIT = 4096;
const DATA_URL_RE = /^data:/i;

type DateDeviceInfo = {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    connection?: { saveData?: boolean };
    mozConnection?: { saveData?: boolean };
    webkitConnection?: { saveData?: boolean };
};

export interface DateStateDraft {
    dialogueQueue: DialogueItem[];
    dialogueBatch: DialogueItem[];
    currentText: string;
    bgImage?: string;
    currentSprite?: string;
    currentSpriteKey?: string;
    isNovelMode: boolean;
    visualSafeMode?: boolean;
    timestamp?: number;
    peekStatus: string;
    restoredFromHistory?: boolean;
}

export function getActiveDateSprites(char: CharacterProfile): Record<string, string> {
    if (char.activeSkinSetId && char.dateSkinSets) {
        const skin = char.dateSkinSets.find(item => item.id === char.activeSkinSetId);
        if (skin && Object.keys(skin.sprites || {}).length > 0) return skin.sprites || {};
    }
    return char.sprites || {};
}

export function getDateEmotionKeys(char: CharacterProfile): string[] {
    return [...REQUIRED_DATE_EMOTION_KEYS, ...(char.customDateSprites || [])];
}

export function findDateSpriteKey(char: CharacterProfile, src?: string): string | undefined {
    if (!src) return undefined;
    if (src === char.avatar) return 'avatar';
    const sprites = getActiveDateSprites(char);
    return Object.entries(sprites).find(([, value]) => value === src)?.[0];
}

export function resolveDateStateBackground(char: CharacterProfile, state?: Partial<DateState>): string {
    if (!state) return char.dateBackground || '';
    if (state.bgSource === 'characterDateBackground') return char.dateBackground || '';
    return state.bgImage || '';
}

export function resolveDateStateSprite(char: CharacterProfile, state?: Partial<DateState>, fallbackKey = 'normal'): string {
    const sprites = getActiveDateSprites(char);
    const key = state?.currentSpriteKey;
    if (key === 'avatar') return char.avatar || '';
    if (key && sprites[key]) return sprites[key];
    if (state?.currentSprite) return state.currentSprite;
    return sprites[fallbackKey] || sprites.default || Object.values(sprites).find(Boolean) || char.avatar || '';
}

export function isInlineHeavyAsset(src?: string): boolean {
    if (!src) return false;
    return DATA_URL_RE.test(src) || src.length > INLINE_ASSET_KEEP_LIMIT;
}

function keepInlineAsset(src?: string): string {
    return src && !isInlineHeavyAsset(src) ? src : '';
}

export function createLightweightDateState(
    draft: DateStateDraft,
    char: CharacterProfile,
    reason: string,
): DateState {
    const bgImage = draft.bgImage || '';
    const bgMatchesCharacter = !!char.dateBackground && (!bgImage || bgImage === char.dateBackground);
    const bgSource: DateState['bgSource'] = bgMatchesCharacter
        ? 'characterDateBackground'
        : bgImage && !isInlineHeavyAsset(bgImage)
            ? 'inline'
            : 'none';

    const currentSprite = draft.currentSprite || '';
    const currentSpriteKey = draft.currentSpriteKey || findDateSpriteKey(char, currentSprite);

    return {
        dialogueQueue: draft.dialogueQueue || [],
        dialogueBatch: draft.dialogueBatch || [],
        currentText: draft.currentText || '',
        bgImage: bgSource === 'inline' ? keepInlineAsset(bgImage) : '',
        bgSource,
        currentSprite: currentSpriteKey ? '' : keepInlineAsset(currentSprite),
        currentSpriteKey,
        isNovelMode: draft.isNovelMode,
        visualSafeMode: !!draft.visualSafeMode,
        autosaveReason: reason,
        autosavedAt: Date.now(),
        restoredFromHistory: draft.restoredFromHistory,
        timestamp: draft.timestamp || Date.now(),
        peekStatus: draft.peekStatus || '',
    };
}

export function shouldUseDateVisualSafeMode(state?: Partial<DateState>, device?: DateDeviceInfo): boolean {
    if (state?.visualSafeMode) return true;
    if (state?.autosaveReason && state.autosaveReason !== 'manual-exit') return true;

    const nav = device || (typeof navigator !== 'undefined' ? navigator as DateDeviceInfo : undefined);
    if (!nav) return false;
    if (nav.connection?.saveData || nav.mozConnection?.saveData || nav.webkitConnection?.saveData) return true;
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true;
    if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4) return true;
    return false;
}

const isDateRawDialogueMessage = (message: Message): boolean => (
    message.metadata?.source === 'date'
    && !message.metadata?.isSummary
    && !message.metadata?.isDateContextBridge
);

export function buildDateHistoryRecoveryState(
    messages: Message[],
    char: CharacterProfile,
): DateState | null {
    const dateMessages = messages
        .filter(isDateRawDialogueMessage)
        .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
    if (dateMessages.length === 0) return null;

    const openingIndex = dateMessages.map(message => message.metadata?.isOpening === true).lastIndexOf(true);
    const sessionMessages = openingIndex >= 0 ? dateMessages.slice(openingIndex) : dateMessages;
    if (sessionMessages.length === 0) return null;

    const hasUserReply = sessionMessages.some(message => message.role === 'user');
    const hasOpening = sessionMessages.some(message => message.metadata?.isOpening === true);
    if (!hasOpening && !hasUserReply) return null;

    const opening = sessionMessages.find(message => message.metadata?.isOpening === true);
    const lastAssistant = [...sessionMessages].reverse().find(message => message.role === 'assistant');
    const lastMessage = lastAssistant || sessionMessages[sessionMessages.length - 1];

    return createLightweightDateState({
        dialogueQueue: [],
        dialogueBatch: [],
        currentText: lastMessage?.content || '',
        currentSpriteKey: 'normal',
        isNovelMode: true,
        visualSafeMode: true,
        timestamp: Date.now(),
        peekStatus: opening?.content || '',
        restoredFromHistory: true,
    }, char, 'history-recovery');
}
