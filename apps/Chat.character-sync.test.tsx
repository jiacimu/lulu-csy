// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chat from './Chat';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';

vi.mock('../context/OSContext', () => ({
    useOS: vi.fn(),
}));

vi.mock('../utils/db', () => ({
    DB: {
        getMessagesByCharId: vi.fn(() => Promise.resolve([])),
        getRecentMessagesWithCount: vi.fn(() => Promise.resolve({ messages: [], totalCount: 0 })),
        initializeEmojiData: vi.fn(() => Promise.resolve()),
        getEmojis: vi.fn(() => Promise.resolve([])),
        getEmojiCategories: vi.fn(() => Promise.resolve([])),
    },
}));

vi.mock('../components/chat/MessageItem', () => ({
    default: (props: any) => {
        return (
            <button type="button" data-testid={`message-item-${props.msg.id}`} onClick={() => props.onLongPress(props.msg)}>
                {props.msg.content || 'Message Item'}
            </button>
        );
    },
}));

vi.mock('../components/chat/ChatHeader', () => ({
    default: () => <div>Chat Header</div>,
}));

vi.mock('../components/chat/ChatInputArea', () => ({
    default: (props: any) => (
        <div>
            <div>Chat Input</div>
            <button type="button" onClick={props.onSoulReflection}>打开回神</button>
        </div>
    ),
}));

vi.mock('../components/chat/ChatModals', () => ({
    default: (props: any) => (
        <div data-testid="chat-modals-state">
            {props.selectedMessage ? `selected:${props.selectedMessage.id}` : 'selected:none'}
            {props.modalType === 'message-options' && (
                <div data-testid="message-options-modal">
                    <button type="button" onClick={props.onReplyMessage}>引用 / 回复</button>
                    <button type="button" onClick={props.onCloseMessageOptions}>关闭消息操作</button>
                </div>
            )}
        </div>
    ),
}));

vi.mock('../components/os/Modal', () => ({
    default: () => null,
}));

vi.mock('../hooks/useChatAI', () => ({
    useChatAI: () => ({
        isTyping: false,
        recallStatus: '',
        searchStatus: '',
        diaryStatus: '',
        weiboStatus: '',
        lastTokenUsage: null,
        tokenBreakdown: null,
        setLastTokenUsage: vi.fn(),
        triggerAI: vi.fn(),
        retryMindSnapshot: vi.fn(),
    }),
}));

vi.mock('../hooks/useVoiceTts', () => ({
    useVoiceTts: () => ({
        playingMsgId: null,
        loadingMsgIds: new Set<number>(),
        playVoice: vi.fn(),
        stopVoice: vi.fn(),
        synthesizeForMessage: vi.fn(),
    }),
}));

vi.mock('../hooks/useVoiceRecorder', () => ({
    useVoiceRecorder: () => ({
        error: '',
        state: 'idle',
        duration: 0,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        cancelRecording: vi.fn(),
        analyserNode: null,
        isSpeaking: false,
    }),
}));

vi.mock('../utils/file', () => ({
    processImage: vi.fn(),
}));

vi.mock('../utils/safeApi', () => ({
    safeResponseJson: vi.fn(),
}));

vi.mock('../utils/chatParser', () => ({
    parseBilingual: vi.fn((content: string) => ({ langA: content, langB: '' })),
}));

vi.mock('../utils/xhsMcpClient', () => ({
    XhsMcpClient: {
        getNoteDetail: vi.fn(),
    },
    normalizeNote: vi.fn(),
}));

vi.mock('./voicecall/unlockAudio', () => ({
    unlockAudio: vi.fn(),
}));

vi.mock('../utils/cloudStt', () => ({
    CloudStt: {
        transcribe: vi.fn(),
    },
    SttNotConfiguredError: class extends Error {},
}));

vi.mock('../utils/haptics', () => ({
    haptic: {
        light: vi.fn(),
        medium: vi.fn(),
    },
}));

vi.mock('../utils/autonomousAgent', () => ({
    BackendAgentManager: {
        notifyUserReplied: vi.fn(() => Promise.resolve()),
        refreshCharacterContext: vi.fn(() => Promise.resolve()),
    },
    getLifeStreamVisibleInChat: vi.fn(() => false),
    LIFE_STREAM_VISIBILITY_EVENT_NAME: 'life-stream-visibility-change',
}));

const mockedUseOS = vi.mocked(useOS);
const mockedDB = vi.mocked(DB);

function buildOsContext(overrides: Record<string, unknown> = {}) {
    return {
        characters: [
            {
                id: 'char-2',
                name: 'Backup',
                avatar: 'backup.png',
            },
        ],
        activeCharacterId: 'char-missing',
        setActiveCharacterId: vi.fn(),
        updateCharacter: vi.fn(),
        apiConfig: {
            apiKey: '',
            baseUrl: 'https://example.com',
            model: 'gpt-test',
        },
        closeApp: vi.fn(),
        openApp: vi.fn(),
        customThemes: [],
        removeCustomTheme: vi.fn(),
        addToast: vi.fn(),
        userProfile: {
            name: 'Tester',
            avatar: 'user.png',
        },
        lastMsgTimestamp: 0,
        groups: [],
        clearUnread: vi.fn(),
        realtimeConfig: {},
        ttsConfig: null,
        sttConfig: null,
        isDataLoaded: true,
        ...overrides,
    } as any;
}

describe('Chat active character fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();

        mockedUseOS.mockReturnValue(buildOsContext());
    });

    it('falls back to the first available character when the active character id is stale', async () => {
        const setActiveCharacterId = vi.fn();
        mockedUseOS.mockReturnValue(buildOsContext({ setActiveCharacterId }));

        render(<Chat />);

        expect(screen.getByText('Chat Header')).toBeInTheDocument();
        expect(screen.getByText('Chat Input')).toBeInTheDocument();
        expect(screen.queryByText('角色资料同步中')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(setActiveCharacterId).toHaveBeenCalledWith('char-2');
        });
    });

    it('renders a loading fallback while character data is still booting', async () => {
        const closeApp = vi.fn();
        mockedUseOS.mockReturnValue(buildOsContext({
            characters: [],
            activeCharacterId: '',
            isDataLoaded: false,
            closeApp,
        }));

        render(<Chat />);

        await waitFor(() => {
            expect(screen.getByText('角色资料同步中')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '返回桌面' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: '返回桌面' }));

        expect(closeApp).toHaveBeenCalledTimes(1);
    });

    it('shows a loading state while the first page of chat history is still loading', async () => {
        let resolveRecentMessages: ((value: { messages: any[]; totalCount: number }) => void) | null = null;
        mockedUseOS.mockReturnValue(buildOsContext({
            characters: [{ id: 'char-1', name: 'Sully', avatar: 'sully.png' }],
            activeCharacterId: 'char-1',
        }));
        mockedDB.getRecentMessagesWithCount.mockImplementationOnce(() => (
            new Promise((resolve) => {
                resolveRecentMessages = resolve;
            })
        ));

        render(<Chat />);

        expect(screen.getByText('正在载入最近的聊天记录...')).toBeInTheDocument();

        const fulfillRecentMessages = resolveRecentMessages as
            | ((value: { messages: any[]; totalCount: number }) => void)
            | null;
        if (fulfillRecentMessages) {
            fulfillRecentMessages({ messages: [], totalCount: 0 });
        }

        await waitFor(() => {
            expect(screen.queryByText('正在载入最近的聊天记录...')).not.toBeInTheDocument();
        });
    });

    it('opens the soul reflection panel with the active character name', async () => {
        mockedUseOS.mockReturnValue(buildOsContext({
            characters: [{ id: 'char-1', name: 'Sully', avatar: 'sully.png' }],
            activeCharacterId: 'char-1',
        }));

        render(<Chat />);

        await waitFor(() => {
            expect(screen.getByText('Chat Input')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '打开回神' }));

        expect(screen.getByPlaceholderText('和Sully说...')).toBeInTheDocument();
    });

    it('clears the selected message after choosing reply and allows another quote target', async () => {
        const messages = [
            {
                id: 1,
                charId: 'char-1',
                role: 'assistant',
                type: 'text',
                content: '第一条可引用',
                timestamp: 1000,
            },
            {
                id: 2,
                charId: 'char-1',
                role: 'assistant',
                type: 'text',
                content: '第二条可引用',
                timestamp: 2000,
            },
        ];
        mockedUseOS.mockReturnValue(buildOsContext({
            characters: [{ id: 'char-1', name: 'Sully', avatar: 'sully.png' }],
            activeCharacterId: 'char-1',
        }));
        mockedDB.getRecentMessagesWithCount.mockResolvedValue({
            messages,
            totalCount: messages.length,
        });

        render(<Chat />);

        await waitFor(() => {
            expect(screen.getByTestId('message-item-1')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTestId('message-item-1'));
        expect(screen.getByTestId('chat-modals-state')).toHaveTextContent('selected:1');
        fireEvent.click(screen.getByRole('button', { name: '引用 / 回复' }));

        expect(screen.getByText('正在回复:')).toBeInTheDocument();
        expect(screen.getAllByText('第一条可引用')).toHaveLength(2);
        expect(screen.getByTestId('chat-modals-state')).toHaveTextContent('selected:none');

        fireEvent.click(screen.getByTestId('message-item-2'));
        expect(screen.getByTestId('chat-modals-state')).toHaveTextContent('selected:2');
        fireEvent.click(screen.getByRole('button', { name: '引用 / 回复' }));

        expect(screen.getByTestId('chat-modals-state')).toHaveTextContent('selected:none');
        expect(screen.getAllByText('第一条可引用')).toHaveLength(1);
        expect(screen.getAllByText('第二条可引用')).toHaveLength(2);
    });
});
