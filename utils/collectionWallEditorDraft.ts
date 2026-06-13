import type { CollectionWall, CollectionWallItem } from '../types';

const normalizeOptional = (value: unknown): string | undefined => {
    const text = String(value || '').trim();
    return text || undefined;
};

const serializeItem = (item: CollectionWallItem) => ({
    id: item.id,
    wallId: item.wallId,
    type: item.type,
    author: item.author,
    x: typeof item.x === 'number' ? item.x : null,
    y: typeof item.y === 'number' ? item.y : null,
    w: Number.isFinite(item.w) ? item.w : 0,
    h: Number.isFinite(item.h) ? item.h : 0,
    rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
    z: Number.isFinite(item.z) ? item.z : 0,
    order: Number.isFinite(item.order) ? item.order : 0,
    bookId: normalizeOptional(item.bookId),
    assetId: normalizeOptional(item.assetId),
    html: normalizeOptional(item.html),
    name: normalizeOptional(item.name),
    text: item.text
        ? {
            content: String(item.text.content || ''),
            preset: item.text.preset,
            color: normalizeOptional(item.text.color),
            stroke: Boolean(item.text.stroke),
            remarkTemplate: normalizeOptional(item.text.remarkTemplate),
        }
        : undefined,
    bond: item.bond
        ? {
            variant: normalizeOptional(item.bond.variant),
            avatarFrame: normalizeOptional(item.bond.avatarFrame),
        }
        : undefined,
});

export function serializeWallEditorDraft(
    wall: CollectionWall,
    items: CollectionWallItem[],
    textDraft = '',
): string {
    return JSON.stringify({
        wall: {
            id: wall.id,
            name: wall.name,
            layoutMode: wall.layoutMode,
            background: {
                type: wall.background.type,
                value: wall.background.value,
                fit: wall.background.fit,
                dim: Number.isFinite(wall.background.dim) ? wall.background.dim : 0,
            },
            allowCharDecorate: wall.allowCharDecorate !== false,
            defaultBondWidgetHidden: Boolean(wall.defaultBondWidgetHidden),
        },
        items: items.map(serializeItem),
        textDraft,
    });
}

export function hasWallEditorDraftChanges(
    initialSnapshot: string,
    wall: CollectionWall,
    items: CollectionWallItem[],
    textDraft = '',
): boolean {
    return initialSnapshot !== serializeWallEditorDraft(wall, items, textDraft);
}
