import { describe, expect, it } from 'vitest';
import {
    assertCollectionWallImageBlobCanBeSaved,
    COLLECTION_WALL_IMAGE_ASSET_MAX_BYTES,
    getCollectionWallImageSaveErrorMessage,
} from './collectionWallAssetErrors';

describe('collection wall image asset errors', () => {
    it('keeps supported image blobs under the wall asset size limit', () => {
        expect(() => assertCollectionWallImageBlobCanBeSaved(new Blob(['ok'], { type: 'image/png' }))).not.toThrow();
    });

    it('reports image blobs over 10MB with a clear message', () => {
        const blob = { size: COLLECTION_WALL_IMAGE_ASSET_MAX_BYTES + 1 };

        expect(() => assertCollectionWallImageBlobCanBeSaved(blob)).toThrow('图片超过 10MB');
        expect(getCollectionWallImageSaveErrorMessage(new Error('图片超过 10MB，先压缩后再收进拾光墙'))).toContain('10MB');
    });

    it('preserves unsupported upload format messages', () => {
        expect(getCollectionWallImageSaveErrorMessage(new Error('只支持 PNG、JPG、WEBP、GIF 图片'))).toBe('只支持 PNG、JPG、WEBP、GIF 图片');
    });

    it('classifies original image fetch failures', () => {
        expect(getCollectionWallImageSaveErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
        expect(getCollectionWallImageSaveErrorMessage(new Error('读取原图失败，服务器返回 403'))).toContain('服务器返回 403');
    });

    it('classifies IndexedDB quota failures', () => {
        const error = new DOMException('The quota has been exceeded.', 'QuotaExceededError');

        expect(getCollectionWallImageSaveErrorMessage(error)).toContain('本地素材空间不足');
    });
});
