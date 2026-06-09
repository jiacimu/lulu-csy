// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DateSession from './DateSession';
import type { DateState, Message } from '../../types';

vi.mock('../../context/OSContext', () => ({
    useOS: () => ({
        addToast: vi.fn(),
        registerBackHandler: vi.fn(() => vi.fn()),
        theme: {},
    }),
}));

vi.mock('./DateSettings', () => ({
    default: () => <div data-testid="mock-date-settings" />,
}));

vi.mock('./DatePhotoPanel', () => ({
    default: () => <div data-testid="mock-date-photo-panel" />,
}));

vi.mock('./SummaryFloatingBall', () => ({
    default: () => <div data-testid="mock-summary-floating-ball" />,
}));

vi.mock('../chat/VibeReferencePicker', () => ({
    default: () => <div data-testid="mock-vibe-reference-picker" />,
}));

const char = {
    id: 'char-date-thinking',
    name: 'Sully',
    avatar: '/sully.png',
    description: '',
    systemPrompt: '',
    memories: [],
    sprites: { normal: '/normal.png' },
    spriteConfig: { scale: 1, x: 0, y: 0 },
    showThinking: true,
} as any;

const userProfile = {
    name: 'User',
    avatar: '/user.png',
    bio: '',
};

const initialState: DateState = {
    dialogueQueue: [],
    dialogueBatch: [],
    currentText: '今晚见。',
    bgImage: '',
    currentSprite: '/normal.png',
    isNovelMode: true,
    timestamp: 1,
    peekStatus: '',
};

const assistantMessage: Message = {
    id: 1,
    charId: char.id,
    role: 'assistant',
    type: 'text',
    content: '[normal]今晚见。',
    timestamp: 1,
    metadata: {
        source: 'date',
        isOpening: true,
        thinking: 'Step 1: read the room.\nStep 2: answer softly.',
    },
};

function renderDateSession(overrides: Record<string, unknown> = {}) {
    return render(
        <DateSession
            char={char}
            userProfile={userProfile}
            messages={[assistantMessage]}
            peekStatus=""
            initialState={initialState}
            onSendMessage={vi.fn()}
            onReroll={vi.fn()}
            onExit={vi.fn()}
            onEditMessage={vi.fn()}
            onEditStatusCard={vi.fn()}
            onDeleteMessage={vi.fn()}
            isSummaryGenerating={false}
            hasPendingSummary={false}
            canManualSummary={false}
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
            {...overrides}
        />,
    );
}

describe('DateSession thinking panel', () => {
    it('shows assistant date thinking as a collapsible panel in reader mode', async () => {
        renderDateSession();

        const panel = await screen.findByTestId('thinking-panel');
        const collapse = screen.getByTestId('thinking-panel-collapse');
        expect(collapse).toHaveStyle({ maxHeight: '0', opacity: '0' });

        fireEvent.click(within(panel).getByRole('button'));

        expect(collapse).toHaveStyle({ maxHeight: '240px', opacity: '1' });
        expect(collapse).toHaveTextContent(/read the room/);
        expect(collapse).toHaveTextContent(/answer softly/);
    }, 15000);

    it('hides date thinking when the character-level thinking toggle is off', async () => {
        renderDateSession({
            char: { ...char, showThinking: false },
        });

        await waitFor(() => {
            expect(screen.queryByTestId('thinking-panel')).not.toBeInTheDocument();
        });
    });

    it('shows opening peek thinking before the opening message is present in the message list', async () => {
        renderDateSession({
            messages: [],
            peekStatus: '[normal]开场白。',
            peekThinking: 'Opening thought before DB refresh.',
        });

        const panel = await screen.findByTestId('thinking-panel');
        fireEvent.click(within(panel).getByRole('button'));

        expect(screen.getByTestId('thinking-panel-collapse')).toHaveTextContent('Opening thought before DB refresh.');
    }, 15000);

});
