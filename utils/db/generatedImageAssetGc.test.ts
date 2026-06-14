// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { buildGeneratedImageOriginalAssetId } from '../generatedImageAssets';
import { DB } from './index';

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
    localStorage.clear();
    localStorage.setItem('csyos_user_id', 'owner-a');
}

async function saveGeneratedImagePair(imageId: string): Promise<number> {
    const originalAssetId = buildGeneratedImageOriginalAssetId(imageId);
    await DB.saveAsset(originalAssetId, `data:image/png;base64,${imageId}`);
    const messageId = await DB.saveMessage({
        charId: 'char-1',
        role: 'assistant',
        type: 'image',
        content: `data:image/webp;base64,thumb-${imageId}`,
        timestamp: Date.now(),
        metadata: {
            imageId,
            thumbnailUrl: `data:image/webp;base64,thumb-${imageId}`,
            originalAssetId,
        },
    });
    await DB.saveGalleryImage({
        id: imageId,
        charId: 'char-1',
        url: `data:image/webp;base64,thumb-${imageId}`,
        timestamp: Date.now(),
        originalAssetId,
    });
    return messageId;
}

describe('generated image original asset cleanup', () => {
    beforeEach(() => {
        resetIndexedDb();
    });

    it('keeps the original asset when deleting a gallery image that is still referenced by chat', async () => {
        const imageId = 'photo-gallery-delete';
        const originalAssetId = buildGeneratedImageOriginalAssetId(imageId);
        await saveGeneratedImagePair(imageId);

        await DB.deleteGalleryImage(imageId);

        expect(await DB.getAsset(originalAssetId)).toBe(`data:image/png;base64,${imageId}`);
    });

    it('keeps the original asset when deleting a message that is still referenced by gallery', async () => {
        const imageId = 'photo-message-delete';
        const originalAssetId = buildGeneratedImageOriginalAssetId(imageId);
        const messageId = await saveGeneratedImagePair(imageId);

        await DB.deleteMessage(messageId);

        expect(await DB.getAsset(originalAssetId)).toBe(`data:image/png;base64,${imageId}`);
    });

    it('deletes the original asset after the final gallery and message references are removed', async () => {
        const imageId = 'photo-final-delete';
        const originalAssetId = buildGeneratedImageOriginalAssetId(imageId);
        const messageId = await saveGeneratedImagePair(imageId);

        await DB.deleteGalleryImage(imageId);
        expect(await DB.getAsset(originalAssetId)).toBe(`data:image/png;base64,${imageId}`);

        await DB.deleteMessages([messageId]);

        expect(await DB.getAsset(originalAssetId)).toBeNull();
    });

    it('cleans unreferenced generated originals when clearing chat messages', async () => {
        const imageId = 'photo-clear-messages';
        const originalAssetId = buildGeneratedImageOriginalAssetId(imageId);
        await DB.saveAsset(originalAssetId, `data:image/png;base64,${imageId}`);
        await DB.saveMessage({
            charId: 'char-1',
            role: 'assistant',
            type: 'image',
            content: `data:image/webp;base64,thumb-${imageId}`,
            timestamp: Date.now(),
            metadata: {
                imageId,
                thumbnailUrl: `data:image/webp;base64,thumb-${imageId}`,
                originalAssetId,
            },
        });

        await DB.clearMessages('char-1');

        expect(await DB.getAsset(originalAssetId)).toBeNull();
    });
});
