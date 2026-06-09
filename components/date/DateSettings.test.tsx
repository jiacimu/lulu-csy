// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DateSettings from './DateSettings';
import type { CharacterProfile } from '../../types';

const mockUpdateCharacter = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockOpenApp = vi.hoisted(() => vi.fn());

vi.mock('../../context/OSContext', () => ({
    useOS: () => ({
        updateCharacter: mockUpdateCharacter,
        addToast: mockAddToast,
        openApp: mockOpenApp,
        userProfile: {
            name: 'User',
            avatar: '',
            bio: '',
        },
    }),
}));

vi.mock('./WritingStyleSheet', () => ({
    default: () => <div data-testid="mock-writing-style-sheet" />,
    isPresetKey: (value: string) => value !== '__custom__',
}));

const baseChar = {
    id: 'char-date-settings',
    name: 'Sully',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    manualPhotoEnabled: false,
    autoPhotoEnabled: false,
} as CharacterProfile;

describe('DateSettings photo controls', () => {
    beforeEach(() => {
        mockUpdateCharacter.mockClear();
        mockAddToast.mockClear();
        mockOpenApp.mockClear();
    });

    it('renders Date photo toggles and writes shared character photo flags', () => {
        render(<DateSettings char={baseChar} onBack={vi.fn()} />);

        expect(screen.getByText('线下生图 / 见面照片')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /手动生图入口/ }));
        expect(mockUpdateCharacter).toHaveBeenCalledWith(baseChar.id, {
            manualPhotoEnabled: true,
        });

        fireEvent.click(screen.getByRole('button', { name: /角色主动见面照片/ }));
        expect(mockUpdateCharacter).toHaveBeenCalledWith(baseChar.id, {
            autoPhotoEnabled: true,
        });
    });
});
