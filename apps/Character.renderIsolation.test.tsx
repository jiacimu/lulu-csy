// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Character from './Character';
import { useCharacterScreenDeps } from '../hooks/useCharacterScreenDeps';

const { locationSummaryRenderSpy } = vi.hoisted(() => ({
    locationSummaryRenderSpy: vi.fn(),
}));

vi.mock('../hooks/useCharacterScreenDeps', () => ({
    useCharacterScreenDeps: vi.fn(),
}));

vi.mock('../components/os/Modal', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

vi.mock('../components/character/ImpressionPanel', () => ({
    default: () => <div>Impression Panel</div>,
}));

vi.mock('../components/character/MemoryCenter', () => ({
    default: () => <div>Memory Center</div>,
}));

vi.mock('../components/character/CharacterLocationSummaryCard', () => ({
    default: (props: any) => {
        locationSummaryRenderSpy(props);
        return (
            <button type="button" role="button" onClick={props.onEdit}>
                地理设定卡
            </button>
        );
    },
}));

vi.mock('../utils/file', () => ({
    processImage: vi.fn(),
}));

vi.mock('../utils/db', () => ({
    DB: {
        getAllVectorMemories: vi.fn(() => Promise.resolve([])),
        deleteMessage: vi.fn(),
        getMessagesByCharId: vi.fn(() => Promise.resolve([])),
        saveMessage: vi.fn(),
    },
}));

vi.mock('../utils/context', () => ({
    ContextBuilder: {
        buildCoreContext: vi.fn(() => ''),
    },
}));

vi.mock('../utils/safeApi', () => ({
    safeResponseJson: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        writeFile: vi.fn(),
        getUri: vi.fn(),
    },
    Directory: {
        Cache: 'CACHE',
    },
    Encoding: {
        UTF8: 'utf8',
    },
}));

vi.mock('@capacitor/share', () => ({
    Share: {
        share: vi.fn(),
    },
}));

const mockedUseCharacterScreenDeps = vi.mocked(useCharacterScreenDeps);

const mockAddCharacter = vi.fn();
const mockAddCustomTheme = vi.fn();
const mockAddToast = vi.fn();
const mockCloseApp = vi.fn();
const mockDeleteCharacter = vi.fn();
const mockOpenApp = vi.fn();
const mockSetActiveCharacterId = vi.fn();
const mockUpdateCharacter = vi.fn();

const baseCharacter = {
    id: 'char-1',
    name: 'Sully',
    avatar: 'avatar-1.png',
    description: '测试角色',
    systemPrompt: '',
    worldview: '',
    memories: [],
    mountedWorldbooks: [{
        id: 'wb-1',
        title: '世界书 1',
        content: 'content',
        category: '测试',
        position: 'top',
    }],
} as any;

function renderCharacterDetail() {
    render(<Character />);
    fireEvent.click(screen.getByText('Sully'));
}

describe('Character render isolation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();

        mockedUseCharacterScreenDeps.mockReturnValue({
            closeApp: mockCloseApp,
            openApp: mockOpenApp,
            characters: [baseCharacter],
            setActiveCharacterId: mockSetActiveCharacterId,
            addCharacter: mockAddCharacter,
            updateCharacter: mockUpdateCharacter,
            deleteCharacter: mockDeleteCharacter,
            apiConfig: {
                apiKey: '',
                baseUrl: 'https://example.com',
                model: 'gpt-test',
            },
            addToast: mockAddToast,
            userProfile: {
                name: 'Tester',
                avatar: 'user.png',
                bio: '',
            },
            customThemes: [],
            addCustomTheme: mockAddCustomTheme,
            worldbooks: [],
        } as any);
    });

    it('keeps support panels from rerendering when typing in identity fields', () => {
        renderCharacterDetail();

        expect(locationSummaryRenderSpy).toHaveBeenCalledTimes(1);

        const nameInput = screen.getByPlaceholderText('名称');
        fireEvent.change(nameInput, { target: { value: 'S' } });
        fireEvent.change(nameInput, { target: { value: 'Su' } });
        fireEvent.change(nameInput, { target: { value: 'Sully Prime' } });

        expect(locationSummaryRenderSpy).toHaveBeenCalledTimes(1);
    });
});
