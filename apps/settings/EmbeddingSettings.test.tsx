// @vitest-environment jsdom

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import EmbeddingSettings from './EmbeddingSettings';
import { getEmbeddingConfig,setEmbeddingConfig } from '../../utils/runtimeConfig';

const { addToast,getMemoryEmbeddingEngineStatus,switchMemoryEmbeddingEngine,cancelMemoryEngineReindex } = vi.hoisted(() => ({
    addToast: vi.fn(),
    getMemoryEmbeddingEngineStatus: vi.fn(),
    switchMemoryEmbeddingEngine: vi.fn(),
    cancelMemoryEngineReindex: vi.fn(),
}));

vi.mock('../../context/OSContext', () => ({
    useOS: () => ({ addToast }),
}));

vi.mock('./BackendDiagnosticsCard', () => ({
    default: () => <div data-testid="backend-diagnostics-card" />,
}));

vi.mock('../../utils/backendClient', () => ({
    getMemoryEmbeddingEngineStatus,
    switchMemoryEmbeddingEngine,
    cancelMemoryEngineReindex,
}));

describe('EmbeddingSettings', () => {
    beforeEach(() => {
        localStorage.clear();
        addToast.mockReset();
        getMemoryEmbeddingEngineStatus.mockReset();
        switchMemoryEmbeddingEngine.mockReset();
        cancelMemoryEngineReindex.mockReset();
        getMemoryEmbeddingEngineStatus.mockResolvedValue(null);
    });

    it('loads from runtime config and saves a round-tripped embedding config', async () => {
        setEmbeddingConfig({
            provider: 'openai',
            apiKey: 'seed-key',
            baseUrl: 'https://api.siliconflow.cn/v1/',
            model: 'Qwen/Qwen3-Embedding-8B',
            rerankModel: 'ignored',
            dimensions: 2048,
            rerankApiKey: '',
            rerankUsePaid: false,
        });

        render(<EmbeddingSettings />);
        await waitFor(() => {
            expect(getMemoryEmbeddingEngineStatus).toHaveBeenCalled();
        });

        const baseUrlInput = screen.getByPlaceholderText('https://api.siliconflow.cn/v1');
        const apiKeyInput = screen.getByPlaceholderText('sk-...');

        expect(baseUrlInput).toHaveValue('https://api.siliconflow.cn/v1');
        expect(apiKeyInput).toHaveValue('seed-key');

        fireEvent.change(baseUrlInput, { target: { value: ' https://embedding.example.com/v1/ ' } });
        fireEvent.change(apiKeyInput, { target: { value: ' next-key ' } });
        fireEvent.click(screen.getByRole('button', { name: '保存凭证' }));

        expect(getEmbeddingConfig()).toEqual({
            provider: 'openai',
            apiKey: 'next-key',
            baseUrl: 'https://embedding.example.com/v1',
            model: 'Qwen/Qwen3-Embedding-8B',
            rerankModel: 'Qwen/Qwen3-Reranker-8B',
            dimensions: 1024,
            rerankApiKey: '',
            rerankUsePaid: false,
        });
        expect(addToast).toHaveBeenCalledWith('记忆引擎凭证已保存', 'success');
    });
});
