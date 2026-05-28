// @vitest-environment jsdom

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import MessageItem from '../components/chat/MessageItem';

const storageMocks = vi.hoisted(() => ({
    resolveOriginalImageUrl: vi.fn(),
}));

vi.mock('../utils/generatedImageStorage', () => ({
    getImageMessageDisplayUrl: (message: any) => String(message.metadata?.thumbnailUrl || message.content || ''),
    resolveOriginalImageUrl: storageMocks.resolveOriginalImageUrl,
}));

vi.mock('../utils/haptics', () => ({
    haptic: {
        heavy: vi.fn(),
    },
}));

vi.mock('../components/chat/ThemeRegistry', () => ({
    THEME_PLUGINS: {},
}));

vi.mock('../components/chat/StatusCardRenderer', () => ({
    default: () => <div data-testid="mock-status-card-renderer" />,
}));

const baseTheme = {
    id: 'default',
    type: 'preset',
    user: {},
    ai: {},
} as any;

function renderImageMessage() {
    const thumb = 'data:image/webp;base64,thumb';
    return render(
        <MessageItem
            msg={{
                id: 91,
                charId: 'char-1',
                role: 'assistant',
                type: 'image',
                content: thumb,
                timestamp: 1,
                metadata: {
                    thumbnailUrl: thumb,
                    originalAssetId: 'asset-original-1',
                    visualSummary: '窗边自拍',
                },
            } as any}
            isFirstInGroup
            isLastInGroup
            activeTheme={baseTheme}
            charAvatar="/char.png"
            charName="Sully"
            userAvatar="/user.png"
            onLongPress={vi.fn()}
            selectionMode={false}
            isSelected={false}
            onToggleSelect={vi.fn()}
        />,
    );
}

describe('MessageItem image storage', () => {
    it('renders the thumbnail in chat and lazy-loads the original for preview', async () => {
        storageMocks.resolveOriginalImageUrl.mockResolvedValueOnce('data:image/png;base64,original');

        renderImageMessage();

        expect(screen.getByTestId('chat-image-thumbnail')).toHaveAttribute(
            'src',
            'data:image/webp;base64,thumb',
        );

        fireEvent.click(screen.getByRole('button', { name: '打开原图预览' }));
        await waitFor(() => {
            expect(screen.getByTestId('chat-image-preview-img')).toHaveAttribute(
                'src',
                'data:image/png;base64,original',
            );
        });
        expect(storageMocks.resolveOriginalImageUrl).toHaveBeenCalledWith(
            'asset-original-1',
            'data:image/webp;base64,thumb',
        );
    });
});
