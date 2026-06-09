// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ThinkingPanel from './ThinkingPanel';

describe('ThinkingPanel', () => {
    it('renders collapsed thinking and expands on click', () => {
        render(<ThinkingPanel thinking={'Step 1\nStep 2'} textColor="#123456" />);

        const collapse = screen.getByTestId('thinking-panel-collapse');
        expect(collapse).toHaveStyle({ maxHeight: '0', opacity: '0' });

        fireEvent.click(screen.getByRole('button'));

        expect(collapse).toHaveStyle({ maxHeight: '240px', opacity: '1' });
        expect(collapse).toHaveTextContent(/Step 1\s+Step 2/);
    });

    it('does not bubble clicks to parent message containers', () => {
        const onParentClick = vi.fn();
        render(
            <div onClick={onParentClick}>
                <ThinkingPanel thinking="private thought" />
            </div>,
        );

        fireEvent.click(screen.getByRole('button'));

        expect(onParentClick).not.toHaveBeenCalled();
    });
});
