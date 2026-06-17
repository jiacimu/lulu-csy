import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageGenerationConfig, PhotoMeta } from '../types';
import {
    createPhotoMeta,
    generatePhotoImage,
} from './photoGeneration';

describe('photoGeneration OpenAI-compatible requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the configured square size for Gemini-compatible image requests', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || '{}'));
            expect(body.size).toBe('1024x1024');

            return new Response(JSON.stringify({
                data: [{ b64_json: 'aW1hZ2U=' }],
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        const config: ImageGenerationConfig = {
            activeProvider: 'openai-compatible',
            imageStyle: 'real',
            novelai: {
                apiUrl: '',
                apiToken: '',
                model: 'nai-diffusion-4-5-full',
                width: 832,
                height: 1216,
                steps: 28,
                scale: 5,
                sampler: 'k_euler',
                noiseSchedule: 'native',
                qualityTags: '',
                negativePrompt: '',
            },
            openaiCompatible: {
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                apiKey: 'test-key',
                model: 'gemini-3.1-flash-image-preview',
                size: '1024x1024',
                responseFormat: 'b64_json',
                n: 1,
                quality: '',
                style: '',
                background: '',
                outputFormat: '',
                outputCompression: null,
                moderation: '',
                user: '',
                stream: false,
                partialImages: null,
                extraRequestBody: '',
                qualityTags: '',
                negativePrompt: '',
            },
        };
        const meta: PhotoMeta = createPhotoMeta(
            'manual',
            config,
            {
                id: 'square-style',
                name: 'Square Style',
                providerScope: 'openai-gemini',
                positivePrompt: 'natural snapshot',
                negativePrompt: '',
            },
            {
                positivePrompt: 'portrait',
                negativePrompt: '',
                finalPrompt: 'portrait',
            },
            1234,
        );

        await generatePhotoImage(config, meta);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
