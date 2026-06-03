// @vitest-environment jsdom

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import DateSession from './DateSession';
import type { CharacterProfile,DateState,Message,UserProfile } from '../../types';

vi.mock('../../context/OSContext', () => ({
    useOS: () => ({
        addToast: vi.fn(),
        registerBackHandler: vi.fn(() => vi.fn()),
    }),
}));

const makeCharacter = (): CharacterProfile => ({
    id: 'char-1',
    name: 'Sully',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    dateLightReading: true,
} as CharacterProfile);

const userProfile: UserProfile = {
    name: '小米',
    avatar: '',
    bio: '',
};

const makeMessage = (
    id: number,
    role: Message['role'],
    content: string,
    metadata: Record<string, unknown>,
): Message => ({
    id,
    charId: 'char-1',
    role,
    type: 'text',
    content,
    timestamp: id * 1000,
    metadata,
});

const initialState: DateState = {
    dialogueQueue: [],
    dialogueBatch: [],
    currentText: 'opening',
    bgImage: '',
    currentSprite: '',
    isNovelMode: true,
    visualSafeMode: true,
    timestamp: 1,
    peekStatus: 'opening',
};

const renderSession = (onRetryMissingReply = vi.fn().mockResolvedValue({
    content: '[normal]我回来了',
    whispers: [],
})) => render(
    <DateSession
        char={makeCharacter()}
        userProfile={userProfile}
        messages={[
            makeMessage(1, 'assistant', 'opening', { source: 'date', isOpening: true }),
            makeMessage(2, 'user', '你在吗', { source: 'date', dateReplyStatus: 'failed' }),
        ]}
        peekStatus="opening"
        initialState={initialState}
        onSendMessage={vi.fn()}
        onReroll={vi.fn()}
        pendingReplyGap={{ userMessageId: 2, userText: '你在吗', status: 'failed' }}
        onRetryMissingReply={onRetryMissingReply}
        onExit={vi.fn()}
        onAutosaveState={vi.fn()}
        onEditMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
        isSummaryGenerating={false}
        hasPendingSummary={false}
        canManualSummary
        canAutoSummary={false}
        onRequestSummary={vi.fn()}
        onReviewPendingSummary={vi.fn()}
        onDiscardPendingSummary={vi.fn()}
        onToggleAutoSummary={vi.fn()}
        onToggleAutoHideSummary={vi.fn()}
        onChangeThreshold={vi.fn()}
        onOpenSummarySettings={vi.fn()}
        onChangeWordCount={vi.fn()}
        onChangeWritingStyle={vi.fn()}
        onChangeTemperature={vi.fn()}
        onChangeFontScale={vi.fn()}
    />,
);

describe('DateSession pending reply recovery', () => {
    it('shows a retry card and retries with the existing user message id', async () => {
        const onRetryMissingReply = vi.fn().mockResolvedValue({
            content: '[normal]我回来了',
            whispers: [],
        });

        renderSession(onRetryMissingReply);

        expect(screen.getByText('上一条回复中断了')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '重新生成' }));

        await waitFor(() => {
            expect(onRetryMissingReply).toHaveBeenCalledWith(2);
        });
        expect(onRetryMissingReply).toHaveBeenCalledTimes(1);
    });
});
