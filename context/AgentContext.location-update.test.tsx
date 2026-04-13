// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProvider } from './AgentContext';

const mockUseCharacter = vi.hoisted(() => vi.fn());
const mockConsumeCharacterUpdateOptions = vi.hoisted(() => vi.fn());
const mockUseConfig = vi.hoisted(() => vi.fn());
const agentMocks = vi.hoisted(() => ({
    disconnectFrontend: vi.fn(),
    getAgentConfig: vi.fn(() => ({ notificationsEnabled: false })),
    pushContext: vi.fn(() => Promise.resolve()),
    start: vi.fn(),
    stop: vi.fn(),
}));

vi.mock('./CharacterContext', () => ({
    consumeCharacterUpdateOptions: mockConsumeCharacterUpdateOptions,
    useCharacter: mockUseCharacter,
}));

vi.mock('./ConfigContext', () => ({
    useConfig: mockUseConfig,
}));

vi.mock('../utils/autonomousAgent', () => ({
    BackendAgentManager: class MockBackendAgentManager {
        disconnectFrontend = agentMocks.disconnectFrontend;
        pushContext = agentMocks.pushContext;
        start = agentMocks.start;
        stop = agentMocks.stop;
    },
    getAgentConfig: agentMocks.getAgentConfig,
}));

vi.mock('../utils/runtimeConfig', () => ({
    getSecondaryApiConfig: vi.fn(() => ({
        apiKey: 'sub-key',
        baseUrl: 'https://example.com',
        model: 'gpt-test',
    })),
}));

vi.mock('../utils/pushSubscription', () => ({
    disablePushSubscription: vi.fn(() => Promise.resolve()),
    initPushSubscription: vi.fn(() => Promise.resolve()),
}));

const baseCharacter = {
    avatar: 'avatar.png',
    description: '测试角色',
    id: 'char-1',
    memories: [],
    name: 'Sully',
    systemPrompt: '',
} as any;

describe('AgentContext location updates', () => {
    let characterState: any;

    beforeEach(() => {
        vi.clearAllMocks();

        characterState = {
            activeCharacterId: 'char-1',
            characters: [baseCharacter],
            isCharacterDataLoaded: true,
        };

        mockUseCharacter.mockImplementation(() => characterState);
        mockUseConfig.mockReturnValue({ isConfigLoaded: true });
        mockConsumeCharacterUpdateOptions.mockReturnValue(null);
    });

    it('does not push agent context immediately for location updates marked to skip', async () => {
        const { rerender } = render(
            <AgentProvider>
                <div>child</div>
            </AgentProvider>,
        );

        const updatedCharacter = {
            ...baseCharacter,
            cityAdcode: '310000',
            cityOverride: '上海',
        };

        mockConsumeCharacterUpdateOptions.mockReturnValueOnce({
            reason: 'location',
            skipImmediateAgentContextPush: true,
        });
        characterState = {
            ...characterState,
            characters: [updatedCharacter],
        };

        await act(async () => {
            rerender(
                <AgentProvider>
                    <div>child</div>
                </AgentProvider>,
            );
            await Promise.resolve();
        });

        expect(mockConsumeCharacterUpdateOptions).toHaveBeenCalledWith('char-1');
        expect(agentMocks.pushContext).not.toHaveBeenCalled();
    });

    it('does not push agent context for location-only updates even without a skip marker', async () => {
        const { rerender } = render(
            <AgentProvider>
                <div>child</div>
            </AgentProvider>,
        );

        const updatedCharacter = {
            ...baseCharacter,
            cityAdcode: '330100',
            cityOverride: '杭州',
        };

        characterState = {
            ...characterState,
            characters: [updatedCharacter],
        };

        await act(async () => {
            rerender(
                <AgentProvider>
                    <div>child</div>
                </AgentProvider>,
            );
            await Promise.resolve();
        });

        expect(mockConsumeCharacterUpdateOptions).toHaveBeenCalledWith('char-1');
        expect(agentMocks.pushContext).not.toHaveBeenCalled();
    });

    it('still pushes agent context for regular same-character updates', async () => {
        const { rerender } = render(
            <AgentProvider>
                <div>child</div>
            </AgentProvider>,
        );

        const updatedCharacter = {
            ...baseCharacter,
            description: '更新后的描述',
        };

        characterState = {
            ...characterState,
            characters: [updatedCharacter],
        };

        await act(async () => {
            rerender(
                <AgentProvider>
                    <div>child</div>
                </AgentProvider>,
            );
            await Promise.resolve();
        });

        expect(mockConsumeCharacterUpdateOptions).toHaveBeenCalledWith('char-1');
        expect(agentMocks.pushContext).toHaveBeenCalledTimes(1);
        expect(agentMocks.pushContext).toHaveBeenCalledWith(updatedCharacter);
    });
});
