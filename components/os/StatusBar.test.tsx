import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatusBar from './StatusBar';
import { VirtualTimeProvider } from '../../context/VirtualTimeContext';
import { useOS } from '../../context/OSContext';

vi.mock('../../context/OSContext', () => ({
  useOS: vi.fn(),
}));

const mockedUseOS = vi.mocked(useOS);

describe('StatusBar', () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({
      theme: { contentColor: '#ffffff' },
      systemLogs: [],
      clearLogs: vi.fn(),
    } as any);
  });

  it('renders as an overlay below the top safe area without reserving layout height', () => {
    render(
      <VirtualTimeProvider>
        <StatusBar />
      </VirtualTimeProvider>,
    );

    const statusBar = screen.getByTestId('system-status-bar');

    expect(statusBar.style.paddingTop).toBe('var(--system-status-top, 8px)');
    expect(statusBar.style.height).toBe('0px');
    expect(statusBar.style.minHeight).toBe('');
  });
});
