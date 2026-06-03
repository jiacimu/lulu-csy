// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NianNianApp from './NianNianApp';
import { useOS } from '../../context/OSContext';
import type { NianNianSession } from '../../types';
import { DB } from '../../utils/db';

vi.mock('../../context/OSContext', () => ({
    useOS: vi.fn(),
}));

vi.mock('../../utils/db', () => ({
    DB: {
        getAllNianNianSessions: vi.fn(),
        saveNianNianSession: vi.fn(),
    },
}));

const mockedUseOS = vi.mocked(useOS);
const mockedGetAllSessions = vi.mocked(DB.getAllNianNianSessions);
const mockedSaveSession = vi.mocked(DB.saveNianNianSession);

const character = {
    id: 'char-1',
    name: '念念',
    avatar: '',
    description: '',
    systemPrompt: '',
    worldview: '',
    memories: [],
    mountedWorldbooks: [],
} as any;

describe('NianNianApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedGetAllSessions.mockResolvedValue([]);
        mockedSaveSession.mockResolvedValue(undefined);
        mockedUseOS.mockReturnValue({
            activeCharacterId: 'char-1',
            addToast: vi.fn(),
            characters: [character],
            closeApp: vi.fn(),
            userProfile: {
                name: '测试用户',
                avatar: '',
                bio: '',
            },
        } as any);
    });

    it('starts a session with options plus separated speech and action input', async () => {
        render(<NianNianApp />);

        await screen.findByText('副本初始化');
        fireEvent.click(screen.getByText('初始化 Session'));

        await screen.findByLabelText('念念浮生输入区');
        expect(screen.getByText('TODO(人工)：节点选项一')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('写要说的话...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('写动作、停顿或神态...')).toBeInTheDocument();

        mockedSaveSession.mockClear();
        fireEvent.change(screen.getByPlaceholderText('写要说的话...'), {
            target: { value: '你还记得这里吗？' },
        });
        fireEvent.change(screen.getByPlaceholderText('写动作、停顿或神态...'), {
            target: { value: '抬手拂开帘子' },
        });
        fireEvent.click(screen.getByRole('button', { name: '发送回合' }));

        await waitFor(() => expect(mockedSaveSession).toHaveBeenCalled());
        const saved = mockedSaveSession.mock.calls[0][0] as NianNianSession;
        const userMessage = saved.rawBuffer.find(item => item.role === 'user');

        expect(userMessage?.content).toContain('【选项】TODO(人工)：节点选项一');
        expect(userMessage?.content).toContain('【动作】抬手拂开帘子');
        expect(userMessage?.content).toContain('【台词】你还记得这里吗？');
    });
});
