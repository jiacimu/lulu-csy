import type { GalleryImage, Message } from '../types';

export const GENERATED_IMAGE_ORIGINAL_PREFIX = 'generated-image-original:';

export function buildGeneratedImageOriginalAssetId(imageId: string): string {
    return `${GENERATED_IMAGE_ORIGINAL_PREFIX}${imageId}`;
}

export function isGeneratedImageOriginalAssetId(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(GENERATED_IMAGE_ORIGINAL_PREFIX);
}

export function getMessageGeneratedImageOriginalAssetId(message: Pick<Message, 'metadata'> | null | undefined): string | undefined {
    const originalAssetId = message?.metadata?.originalAssetId;
    return isGeneratedImageOriginalAssetId(originalAssetId) ? originalAssetId : undefined;
}

export function getGalleryGeneratedImageOriginalAssetId(image: Pick<GalleryImage, 'originalAssetId'> | null | undefined): string | undefined {
    const originalAssetId = image?.originalAssetId;
    return isGeneratedImageOriginalAssetId(originalAssetId) ? originalAssetId : undefined;
}

export function collectGeneratedImageOriginalAssetIdsFromValue(value: unknown): string[] {
    const ids = new Set<string>();
    const seen = new WeakSet<object>();

    const visit = (item: unknown) => {
        if (isGeneratedImageOriginalAssetId(item)) {
            ids.add(item);
            return;
        }
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }
        if (!item || typeof item !== 'object') return;
        if (seen.has(item)) return;

        seen.add(item);
        Object.values(item as Record<string, unknown>).forEach(visit);
    };

    visit(value);
    return Array.from(ids);
}

export function collectGeneratedImageOriginalAssetIdsFromMessages(messages: Iterable<Pick<Message, 'metadata'> | null | undefined>): string[] {
    const ids = new Set<string>();
    for (const message of messages) {
        collectGeneratedImageOriginalAssetIdsFromValue(message).forEach(id => ids.add(id));
    }
    return Array.from(ids);
}

export function collectGeneratedImageOriginalAssetIdsFromGalleryImages(images: Iterable<Pick<GalleryImage, 'originalAssetId'> | null | undefined>): string[] {
    const ids = new Set<string>();
    for (const image of images) {
        collectGeneratedImageOriginalAssetIdsFromValue(image).forEach(id => ids.add(id));
    }
    return Array.from(ids);
}
