import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatusCardRenderer from '../components/chat/StatusCardRenderer';
import type { StatusCardData } from '../types/statusCard';

describe('StatusCardRenderer', () => {
    it('sizes freeform cards from the reported html width and height', async () => {
        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Custom card',
            meta: {
                html: '<html><body><div style="height:360px">Marcus</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card');
        expect(frame).toHaveStyle({ height: '1px' });

        fireEvent.load(frame);

        const channel = frame.getAttribute('data-preview-channel');
        expect(channel).toBeTruthy();

        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'preview-height', channel, width: 286, height: 360 },
            }));
        });

        await waitFor(() => {
            expect(frame).toHaveStyle({ width: '294px' });
            expect(frame).toHaveStyle({ height: '368px' });
        });
    });

    it('renders custom text cards with the dedicated non-fallback shell', () => {
        const data: StatusCardData = {
            cardType: 'custom_text',
            title: 'Location',
            body: '中环泰臣大厦顶层，执行总裁办公室',
            footer: 'Marcus',
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        expect(screen.getByTestId('custom-text-status-card')).toHaveTextContent('Location');
        expect(screen.getByTestId('custom-text-status-card')).toHaveTextContent('中环泰臣大厦顶层');
        expect(screen.queryByText('Inner Voice')).not.toBeInTheDocument();
    });
});
