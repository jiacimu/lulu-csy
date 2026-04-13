import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MessageItem from '../components/chat/MessageItem';
import type { StatusCardData } from '../types/statusCard';

vi.mock('../utils/haptics', () => ({
    haptic: {
        heavy: vi.fn(),
    },
}));

vi.mock('../components/chat/ThemeRegistry', () => ({
    THEME_PLUGINS: {},
}));

vi.mock('../components/chat/StatusCardRenderer', () => ({
    default: ({ data }: { data: StatusCardData }) => (
        <div data-testid="mock-status-card-renderer">{data.body}</div>
    ),
}));

const baseTheme = {
    id: 'default',
    type: 'preset',
    user: {},
    ai: {},
} as any;

const baseMessage = {
    id: 42,
    role: 'assistant',
    type: 'text',
    content: '今晚见。',
    timestamp: new Date('2026-04-13T20:00:00+08:00').getTime(),
    metadata: {},
} as any;

function renderMessageItem(extraProps: Record<string, unknown> = {}) {
    return render(
        <MessageItem
            msg={baseMessage}
            isFirstInGroup
            isLastInGroup
            activeTheme={baseTheme}
            charAvatar="/char.png"
            charName="Marcus"
            userAvatar="/user.png"
            onLongPress={vi.fn()}
            selectionMode={false}
            isSelected={false}
            onToggleSelect={vi.fn()}
            onTransferAction={vi.fn()}
            onPlayVoice={vi.fn()}
            onStopVoice={vi.fn()}
            onRetryVoice={vi.fn()}
            onToggleVoiceText={vi.fn()}
            {...extraProps}
        />,
    );
}

afterEach(() => {
    vi.useRealTimers();
});

describe('MessageItem status overlay', () => {
    it('keeps status card overlays open past 8 seconds and closes only when the backdrop is clicked', async () => {
        vi.useFakeTimers();

        renderMessageItem({
            statusCardData: {
                cardType: 'custom_text',
                body: 'Location: Executive Office',
                style: {},
            } satisfies StatusCardData,
        });

        fireEvent.click(screen.getByAltText('avatar').parentElement!);
        expect(screen.getByTestId('status-card-overlay-shell')).toBeInTheDocument();

        vi.advanceTimersByTime(9000);
        expect(screen.getByTestId('status-card-overlay-shell')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('inner-voice-backdrop'));
        expect(screen.queryByTestId('status-card-overlay-shell')).not.toBeInTheDocument();
    });

    it('uses separate animation shells for status cards and classic inner voice cards', async () => {
        const firstRender = renderMessageItem({
            statusCardData: {
                cardType: 'custom_text',
                body: 'Action: Reviewing files',
                style: {},
            } satisfies StatusCardData,
        });

        fireEvent.click(screen.getByAltText('avatar').parentElement!);
        expect(await screen.findByTestId('status-card-overlay-shell')).toHaveClass('animate-status-card-in');
        expect(screen.getByTestId('status-card-overlay-shell')).toHaveClass('my-auto');
        expect(screen.getByTestId('status-card-overlay-shell')).toHaveClass('justify-center');

        firstRender.unmount();

        renderMessageItem({
            innerVoice: '今天想把这些话慢慢说完。',
        });

        fireEvent.click(screen.getByAltText('avatar').parentElement!);
        expect(screen.getByTestId('inner-voice-overlay-shell')).toHaveClass('animate-inner-voice-in');
        expect(screen.getByTestId('inner-voice-overlay-shell')).toHaveClass('my-auto');
        expect(screen.getByTestId('inner-voice-overlay-shell')).toHaveClass('justify-center');
    });
});
