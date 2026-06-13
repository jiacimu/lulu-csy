import type { Message } from '../types';
import type { MixedStatusMode, StatusBarMode } from '../types/statusCard';

export const MIXED_STATUS_MODES: readonly MixedStatusMode[] = ['classic', 'freeform', 'afterglow', 'story_phone'];

export const isMixedStatusMode = (value: unknown): value is MixedStatusMode => (
    typeof value === 'string' && (MIXED_STATUS_MODES as readonly string[]).includes(value)
);

export const pickMixedStatusMode = (random = Math.random): MixedStatusMode => {
    const index = Math.min(MIXED_STATUS_MODES.length - 1, Math.floor(random() * MIXED_STATUS_MODES.length));
    return MIXED_STATUS_MODES[index];
};

export const resolveChatStatusMode = (
    configuredMode: StatusBarMode | undefined,
    message?: Pick<Message, 'metadata'> | null,
): StatusBarMode => {
    const mode = configuredMode || 'classic';
    if (mode !== 'mixed') return mode;

    const mixedMode = message?.metadata?.mixedStatusMode;
    return isMixedStatusMode(mixedMode) ? mixedMode : 'mixed';
};
