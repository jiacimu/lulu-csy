// @vitest-environment jsdom

import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import SubApiSettings from './SubApiSettings';
import {
    LEGACY_SUB_API_BASE_URL_KEY,
    LEGACY_SUB_API_KEY,
    LEGACY_SUB_API_MODEL_KEY,
    SECONDARY_API_CONFIG_KEY,
} from '../../utils/runtimeConfig';

const { addToast } = vi.hoisted(() => ({
    addToast: vi.fn(),
}));

vi.mock('../../context/OSContext', () => ({
    useOS: () => ({ addToast }),
}));

describe('SubApiSettings', () => {
    beforeEach(() => {
        localStorage.clear();
        addToast.mockReset();
    });

    it('prefers structured secondary config on load and rewrites legacy keys on save', () => {
        localStorage.setItem(SECONDARY_API_CONFIG_KEY, JSON.stringify({
            apiKey: 'structured-key',
            baseUrl: 'https://structured.example.com/',
            model: 'gpt-structured',
        }));
        localStorage.setItem(LEGACY_SUB_API_KEY, 'legacy-key');
        localStorage.setItem(LEGACY_SUB_API_BASE_URL_KEY, 'https://legacy.example.com');
        localStorage.setItem(LEGACY_SUB_API_MODEL_KEY, 'gpt-legacy');

        render(<SubApiSettings />);

        expect(screen.getByPlaceholderText('https://...')).toHaveValue('https://structured.example.com');
        expect(screen.getByPlaceholderText('sk-...')).toHaveValue('structured-key');
        expect(screen.getByPlaceholderText('模型名称...')).toHaveValue('gpt-structured');

        fireEvent.click(screen.getByRole('button', { name: /保存配置/i }));

        expect(JSON.parse(localStorage.getItem(SECONDARY_API_CONFIG_KEY) || '{}')).toMatchObject({
            apiKey: 'structured-key',
            baseUrl: 'https://structured.example.com',
            model: 'gpt-structured',
        });
        expect(localStorage.getItem(LEGACY_SUB_API_KEY)).toBe('structured-key');
        expect(localStorage.getItem(LEGACY_SUB_API_BASE_URL_KEY)).toBe('https://structured.example.com');
        expect(localStorage.getItem(LEGACY_SUB_API_MODEL_KEY)).toBe('gpt-structured');
    });
});
