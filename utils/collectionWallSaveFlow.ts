import type { CollectionWall, CollectionWallItem } from '../types';

export type CollectionWallSnapshot = {
    wall: CollectionWall;
    items: CollectionWallItem[];
};

export type SaveCollectionWallEditorDraftSnapshotOptions = {
    draftWall: CollectionWall;
    wallId: string;
    name: string;
    items: CollectionWallItem[];
    writeSnapshot: (wall: CollectionWall, items: CollectionWallItem[]) => Promise<CollectionWallSnapshot>;
    refreshAfterSave: () => Promise<unknown> | unknown;
};

const clampWallDim = (value: unknown): number => Math.min(Math.max(Number(value) || 0, 0), 0.6);

export async function saveCollectionWallEditorDraftSnapshot({
    draftWall,
    wallId,
    name,
    items,
    writeSnapshot,
    refreshAfterSave,
}: SaveCollectionWallEditorDraftSnapshotOptions): Promise<CollectionWallSnapshot> {
    const saved = await writeSnapshot({
        ...draftWall,
        name,
        layoutMode: 'free',
        background: {
            ...draftWall.background,
            dim: draftWall.background.type === 'asset' ? 0 : clampWallDim(draftWall.background.dim),
        },
        changeCountSinceVisit: (draftWall.changeCountSinceVisit || 0) + 1,
    }, items.map(item => ({ ...item, wallId })));

    await refreshAfterSave();
    return saved;
}
