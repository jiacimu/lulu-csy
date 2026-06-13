import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    autoArrangeWallItems,
    buildDefaultBondWidgetItem,
    buildCollectionWallDecorPreset,
    buildInitialWallItems,
    buildWallAssetEntry,
    CharRemarkPopup,
    CharInviteOrb,
    CollectionWallCardFrame,
    CollectionWallHtmlFrame,
    COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND,
    createCollectionWallPersistQueue,
    createCollectionWallDecorItemsFromPreset,
    getCharInviteAvatarAsset,
    getCharInviteOrbStorageKey,
    getMoveableStartTranslate,
    getWallBackgroundEffects,
    getPersistableWallItems,
    isCollectionWallDecorPresetItem,
    isCharInviteAvatarAsset,
    materializePlacedLooseWallItems,
    clientPointToWallCanvasPoint,
    normalizeWallItemFrameForCanvas,
    pickCharRemarkTemplate,
    resolveCollectionWallPresetBackground,
    wallAssetUsesTransparentCanvas,
    wallItemsOverlap,
} from '../apps/CollectionHallApp';
import type { CollectionBook, CollectionWall, CollectionWallAsset, CollectionWallItem } from '../types';

const HTML = '<!DOCTYPE html><html><body><main data-card="real">真实碎片</main></body></html>';

function makeBook(overrides: Partial<CollectionBook> = {}): CollectionBook {
    return {
        id: overrides.id || 'book-1',
        charId: 'char-a',
        kind: 'freeform',
        title: '票根',
        body: '摘要不应该出现在占位态',
        cardData: {
            cardType: 'freeform',
            body: '摘要不应该出现在占位态',
            meta: { html: HTML },
            style: {},
        },
        tags: [],
        meta: { html: HTML, summary: '摘要不应该出现在占位态', shape: '票根' },
        createdAt: 1,
        collectedAt: 1,
        ...overrides,
    };
}

function makeWallItem(index: number): CollectionWallItem {
    return {
        id: `item-${index}`,
        wallId: 'wall-a',
        type: 'card',
        author: 'user',
        x: null,
        y: null,
        w: 375,
        h: 220,
        rotation: 0,
        z: index,
        order: index,
        bookId: `book-${index}`,
        createdAt: index,
    };
}

function makeAsset(): CollectionWallAsset {
    return {
        id: 'asset-sticker',
        blob: new Blob(['sticker'], { type: 'image/png' }),
        mime: 'image/png',
        width: 128,
        height: 128,
        bytes: 7,
        hash: 'sticker-hash',
        origin: 'upload',
        meta: { name: '星星贴纸', uploadedFileName: 'star.png' },
        createdAt: 10,
    };
}

function makeWall(): CollectionWall {
    return {
        id: 'wall-a',
        charId: 'char-a',
        name: '深夜歌单',
        isDefault: true,
        layoutMode: 'free',
        background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
        allowCharDecorate: true,
        changeCountSinceVisit: 0,
        charRemarks: [],
        hasUnseenCharItem: false,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
    };
}

function makeDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

class ImmediateIntersectionObserver {
    private callback: IntersectionObserverCallback;

    root = null;
    rootMargin = '';
    thresholds = [0];

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
    }

    observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }

    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
}

describe('collection wall real card rendering', () => {
    beforeEach(() => {
        vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders a wall card iframe from the book meta.html srcdoc', () => {
        render(<CollectionWallCardFrame book={makeBook()} width={330} height={360} forceMounted />);

        const frame = screen.getByTitle('拾光墙真渲染：票根') as HTMLIFrameElement;
        expect(frame.getAttribute('srcdoc')).toContain('data-freeform-compat="summary"');
        expect(frame.getAttribute('srcdoc')).toContain('function getFreeformSummaryCompat');
        expect(frame.getAttribute('srcdoc')).toContain('data-card="real"');
        expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    });

    it('renders a custom HTML wall item from item.html srcdoc', () => {
        const item: CollectionWallItem = {
            ...makeWallItem(1),
            type: 'html',
            bookId: undefined,
            html: HTML,
            name: '自定义卡',
        };

        render(<CollectionWallHtmlFrame item={item} />);

        const frame = screen.getByTitle('拾光墙 HTML 卡：自定义卡') as HTMLIFrameElement;
        expect(frame.getAttribute('srcdoc')).toContain('data-freeform-compat="summary"');
        expect(frame.getAttribute('srcdoc')).toContain('function getFreeformSummaryCompat');
        expect(frame.getAttribute('srcdoc')).toContain('data-card="real"');
        expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    });

    it('uses only a paper frame and title while a card is not mounted', () => {
        const { container } = render(<CollectionWallCardFrame book={makeBook()} width={330} height={360} forceMounted={false} />);

        expect(container.querySelector('iframe')).toBeNull();
        expect(screen.getByText('票根')).toBeInTheDocument();
        expect(screen.queryByText('摘要不应该出现在占位态')).toBeNull();
    });

    it('keeps iframe mounts capped for a 30 card wall', async () => {
        const books = Array.from({ length: 30 }, (_, index) => makeBook({ id: `book-${index}`, title: `碎片 ${index}` }));

        const { container } = render(
            <div>
                {books.map(book => (
                    <CollectionWallCardFrame key={book.id} book={book} width={330} height={360} />
                ))}
            </div>,
        );

        await waitFor(() => {
            const mountedFrames = container.querySelectorAll('iframe');
            expect(mountedFrames.length).toBeGreaterThan(0);
            expect(mountedFrames.length).toBeLessThanOrEqual(12);
        });
    });

    it('auto-arranges wall items without overlap', () => {
        const arranged = autoArrangeWallItems(Array.from({ length: 30 }, (_, index) => makeWallItem(index)));

        for (let i = 0; i < arranged.length; i += 1) {
            for (let j = i + 1; j < arranged.length; j += 1) {
                expect(wallItemsOverlap(arranged[i], arranged[j])).toBe(false);
            }
        }
    });

    it('builds sticker wall entries from uploaded assets', () => {
        const item: CollectionWallItem = {
            ...makeWallItem(1),
            type: 'sticker',
            bookId: undefined,
            assetId: 'asset-sticker',
            name: '星星贴纸',
        };
        const entry = buildWallAssetEntry(item, makeAsset());

        expect(entry?.type).toBe('sticker');
        expect(entry?.asset.origin).toBe('upload');
        expect(entry?.item.assetId).toBe('asset-sticker');
    });

    it('does not dim or texture uploaded asset wallpapers', () => {
        expect(getWallBackgroundEffects({ type: 'asset', value: 'asset-bg', fit: 'cover', dim: 0.6 })).toEqual({
            dim: 0,
            noiseOpacity: 0,
        });
        expect(getWallBackgroundEffects({ type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 })).toEqual({
            dim: 0.18,
            noiseOpacity: 0.035,
        });
    });

    it('uses a transparent canvas for alpha-capable wall assets', () => {
        expect(wallAssetUsesTransparentCanvas({ ...makeAsset(), meta: { ...makeAsset().meta, hasTransparency: true } })).toBe(true);
        expect(wallAssetUsesTransparentCanvas({ ...makeAsset(), meta: { ...makeAsset().meta, hasTransparency: false } })).toBe(false);
        expect(wallAssetUsesTransparentCanvas(makeAsset())).toBe(true);
        expect(wallAssetUsesTransparentCanvas({ ...makeAsset(), mime: 'image/jpeg' })).toBe(false);
    });

    it('clamps non-asset background dim values', () => {
        expect(getWallBackgroundEffects({ type: 'color', value: '#17120e', fit: 'cover', dim: 2 }).dim).toBe(0.6);
        expect(getWallBackgroundEffects({ type: 'color', value: '#17120e', fit: 'cover', dim: -1 }).dim).toBe(0);
    });

    it('converts scaled client points into wall canvas coordinates', () => {
        const point = clientPointToWallCanvasPoint(160, 260, { left: 10, top: 20 }, 0.5);

        expect(point).toEqual({ x: 300, y: 480 });
    });

    it('normalizes moveable drag frames as absolute canvas coordinates', () => {
        const item = { ...makeWallItem(1), x: 220, y: 160, w: 120, h: 90 };
        const start = getMoveableStartTranslate(item);
        const saved = normalizeWallItemFrameForCanvas(item, {
            x: start[0] + 42,
            y: start[1] + 35,
        }, { canvasHeight: 700 });

        expect(start).toEqual([220, 160]);
        expect(saved).toMatchObject({ x: 262, y: 195 });
        expect(saved.x).not.toBe(42);
        expect(saved.y).not.toBe(35);
    });

    it('normalizes resized moveable frames for save roundtrip', () => {
        const item = { ...makeWallItem(1), x: 690, y: 640, w: 100, h: 80 };
        const saved = normalizeWallItemFrameForCanvas(item, {
            x: 720,
            y: 690,
            w: 120,
            h: 90,
        }, { canvasHeight: 720 });

        expect(saved).toMatchObject({ w: 120, h: 90, x: 630, y: 630 });
    });

    it('builds the default wall-head avatar bond widget', () => {
        const item = buildDefaultBondWidgetItem(makeWall());

        expect(item.type).toBe('bond');
        expect(item.bond?.variant).toBe('default');
        expect(item.name).toBe('头像连接');
        expect(item.x).toBeGreaterThan(200);
        expect(item.y).toBeLessThan(60);
    });

    it('adds the default avatar bond widget unless the wall hid it', () => {
        expect(buildInitialWallItems(makeWall(), []).some(item => item.type === 'bond')).toBe(true);
        expect(buildInitialWallItems({ ...makeWall(), defaultBondWidgetHidden: true }, []).some(item => item.type === 'bond')).toBe(false);
    });

    it('selects hidden char invite avatars without treating ordinary assets as invite avatars', () => {
        const normal = makeAsset();
        const inviteAvatar: CollectionWallAsset = {
            ...makeAsset(),
            id: 'asset-invite-avatar',
            createdAt: 20,
            meta: {
                assetKind: COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND,
                charId: 'char-a',
                name: 'Sully 的Q版小人',
                hiddenFromLibrary: true,
            },
        };

        expect(isCharInviteAvatarAsset(normal, 'char-a')).toBe(false);
        expect(isCharInviteAvatarAsset(inviteAvatar, 'char-a')).toBe(true);
        expect(getCharInviteAvatarAsset([normal, inviteAvatar], 'char-a')?.id).toBe('asset-invite-avatar');
        expect(getCharInviteAvatarAsset([inviteAvatar], 'char-b')).toBeNull();
    });

    it('persists the draggable char invite orb position', () => {
        render(
            <CharInviteOrb
                wall={makeWall()}
                entries={[]}
                charName="Sully"
                inviting={false}
                uploading={false}
                pinning={false}
                onRequestRemark={vi.fn()}
                onUploadAvatar={vi.fn()}
                onPinRemark={vi.fn()}
            />,
        );

        const orb = screen.getByLabelText('Sully 的拾光墙邀请球');
        fireEvent.pointerDown(orb, { button: 0, pointerId: 7, clientX: 900, clientY: 640 });
        fireEvent.pointerMove(orb, { pointerId: 7, clientX: 820, clientY: 590 });
        fireEvent.pointerUp(orb, { pointerId: 7, clientX: 820, clientY: 590 });

        const stored = JSON.parse(localStorage.getItem(getCharInviteOrbStorageKey('char-a')) || '{}');
        expect(stored.x).toBeGreaterThanOrEqual(14);
        expect(stored.y).toBeGreaterThanOrEqual(14);
        expect(screen.queryByRole('button', { name: '邀请他来' })).toBeNull();
    });

    it('turns invite into poke mode and reveals the reply with a typewriter state', async () => {
        vi.useFakeTimers();
        const onRequestRemark = vi.fn(async () => ({
            wall: makeWall({ charLastVisitAt: 22, charRemarks: [{ text: '这张票根别挪，我喜欢它在这里。', ts: 22 }] }),
            entries: [],
            charName: 'Sully',
            text: '这张票根别挪，我喜欢它在这里。',
        }));
        const { container } = render(
            <CharInviteOrb
                wall={makeWall()}
                entries={[]}
                charName="Sully"
                inviting={false}
                uploading={false}
                pinning={false}
                onRequestRemark={onRequestRemark}
                onUploadAvatar={vi.fn()}
                onPinRemark={vi.fn()}
            />,
        );

        const orb = screen.getByLabelText('Sully 的拾光墙邀请球');
        fireEvent.pointerDown(orb, { button: 0, pointerId: 1, clientX: 920, clientY: 650 });
        fireEvent.pointerUp(orb, { pointerId: 1, clientX: 920, clientY: 650 });
        expect(screen.getByRole('button', { name: /邀请他来/ })).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /邀请他来/ }));
            await Promise.resolve();
        });

        expect(onRequestRemark).toHaveBeenCalledWith('invite');
        expect(screen.getByRole('button', { name: /戳一戳，听听他说/ })).toBeInTheDocument();
        expect(container.querySelector('.ar-char-orb-speech.typing')).not.toBeNull();

        act(() => {
            vi.runAllTimers();
        });

        expect(screen.getByText(/这张票根别挪/)).toBeInTheDocument();
    });

    it('routes char remarks to popup templates by character count', () => {
        expect(pickCharRemarkTemplate('短句').pick).toBe('ticket');
        expect(pickCharRemarkTemplate('字'.repeat(30)).pick).toBe('pol');
        expect(pickCharRemarkTemplate('字'.repeat(52)).pick).toBe('card');
        expect(pickCharRemarkTemplate('字'.repeat(120)).pick).toBe('letter');
        expect(pickCharRemarkTemplate('字'.repeat(340)).pick).toBe('receipt');
        expect(pickCharRemarkTemplate('字'.repeat(80), 'card').pick).toBe('letter');
    });

    it('lets users skip the char remark popup reveal and use both actions', () => {
        const onClose = vi.fn();
        const onPin = vi.fn();
        const { container } = render(
            <CharRemarkPopup
                remark={{ wall: makeWall(), charName: 'Sully', text: '字'.repeat(30) }}
                pinning={false}
                onClose={onClose}
                onPin={onPin}
            />,
        );

        expect(container.querySelector('.tk-pol')).not.toBeNull();
        fireEvent.click(container.querySelector('.tk-card-slot')!);
        fireEvent.click(screen.getByRole('button', { name: '钉到墙上' }));
        fireEvent.click(screen.getByRole('button', { name: '收下了' }));

        expect(onPin).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('exports and restores only decor layers in wall style presets', async () => {
        const stickerAsset = makeAsset();
        const backgroundAsset: CollectionWallAsset = {
            ...makeAsset(),
            id: 'asset-bg',
            hash: 'bg-hash',
            width: 750,
            height: 1200,
            meta: { name: '蓝天墙纸', uploadedFileName: 'sky.png' },
        };
        const frameAsset: CollectionWallAsset = {
            ...makeAsset(),
            id: 'asset-frame',
            hash: 'frame-hash',
            meta: { name: '头像框', uploadedFileName: 'frame.png' },
        };
        const fontAsset: CollectionWallAsset = {
            id: 'asset-font',
            blob: new Blob(['font'], { type: 'font/woff2' }),
            mime: 'font/woff2',
            bytes: 4,
            hash: 'font-hash',
            origin: 'upload',
            meta: { assetKind: 'font', name: '手写字体', uploadedFileName: 'hand.woff2' },
            createdAt: 11,
        };
        const wall = {
            ...makeWall(),
            background: { type: 'asset', value: backgroundAsset.id, fit: 'cover', dim: 0 },
        } satisfies CollectionWall;
        const stickerItem: CollectionWallItem = {
            ...makeWallItem(2),
            type: 'sticker',
            bookId: undefined,
            assetId: stickerAsset.id,
            x: 42,
            y: 88,
            w: 120,
            h: 96,
            rotation: 18,
            z: 7,
            name: '星星贴纸',
        };
        const htmlItem: CollectionWallItem = {
            ...makeWallItem(3),
            type: 'html',
            bookId: undefined,
            html: '<main>decor</main>',
            x: 150,
            y: 260,
            w: 280,
            h: 180,
            rotation: -6,
            name: '花边 HTML',
        };
        const textItem: CollectionWallItem = {
            ...makeWallItem(4),
            type: 'text',
            bookId: undefined,
            x: 280,
            y: 420,
            w: 240,
            h: 120,
            rotation: 3,
            text: { content: 'Through dawns still yours', preset: 'big_plain', fontAssetId: fontAsset.id, color: '#9f4f64' },
            name: '英文诗',
        };
        const contentCard: CollectionWallItem = {
            ...makeWallItem(5),
            type: 'card',
            bookId: 'book-content',
            x: 20,
            y: 500,
        };
        const charRemark: CollectionWallItem = {
            ...makeWallItem(6),
            type: 'text',
            author: 'char',
            bookId: undefined,
            text: { content: 'TA 的到访便签', preset: 'char_note' },
        };
        const bondItem: CollectionWallItem = {
            ...makeWallItem(7),
            type: 'bond',
            bookId: undefined,
            bond: { variant: 'default', avatarFrame: frameAsset.id },
            name: '头像连接',
        };
        const assets = new Map([
            [stickerAsset.id, stickerAsset],
            [backgroundAsset.id, backgroundAsset],
            [frameAsset.id, frameAsset],
            [fontAsset.id, fontAsset],
        ]);

        const preset = await buildCollectionWallDecorPreset(
            wall,
            [stickerItem, htmlItem, textItem, contentCard, charRemark, bondItem],
            assets,
        );

        expect(preset.decor.items.map(item => item.type)).toEqual(['sticker', 'html', 'text']);
        expect(preset.decor.backgroundAssetKey).toBe(backgroundAsset.id);
        expect(preset.decor.avatarFrameAssetKey).toBe(frameAsset.id);
        expect(preset.decor.items.find(item => item.type === 'text')?.fontAssetKey).toBe(fontAsset.id);
        expect(preset.decor.assets.map(asset => asset.key).sort()).toEqual([
            backgroundAsset.id,
            fontAsset.id,
            frameAsset.id,
            stickerAsset.id,
        ].sort());
        expect(isCollectionWallDecorPresetItem(contentCard)).toBe(false);
        expect(isCollectionWallDecorPresetItem(charRemark)).toBe(false);
        expect(isCollectionWallDecorPresetItem(bondItem)).toBe(false);

        const assetIdByKey = new Map([
            [backgroundAsset.id, 'imported-bg'],
            [fontAsset.id, 'imported-font'],
            [frameAsset.id, 'imported-frame'],
            [stickerAsset.id, 'imported-sticker'],
        ]);
        const restored = createCollectionWallDecorItemsFromPreset(preset, assetIdByKey, 'wall-b');
        const restoredBackground = resolveCollectionWallPresetBackground(preset, assetIdByKey, makeWall().background);

        expect(restored).toHaveLength(3);
        expect(restored.some(item => item.type === 'bond' || item.bookId)).toBe(false);
        expect(restored.find(item => item.type === 'sticker')?.assetId).toBe('imported-sticker');
        expect(restored.find(item => item.type === 'text')?.text?.fontAssetId).toBe('imported-font');
        expect(restoredBackground).toEqual({ type: 'asset', value: 'imported-bg', fit: 'cover', dim: 0 });
    });

    it('materializes placed loose book cards before saving wall layouts', () => {
        const unplacedLoose: CollectionWallItem = {
            ...makeWallItem(1),
            id: 'loose-book-unplaced',
            bookId: 'book-unplaced',
            x: null,
            y: null,
        };
        const placedLoose: CollectionWallItem = {
            ...makeWallItem(2),
            id: 'loose-book-placed',
            bookId: 'book-placed',
            x: 120,
            y: 260,
            rotation: -8,
        };

        const materialized = materializePlacedLooseWallItems([unplacedLoose, placedLoose]);
        const saved = getPersistableWallItems([unplacedLoose, placedLoose]);

        expect(materialized[0].id).toBe('loose-book-unplaced');
        expect(materialized[1].id.startsWith('loose-')).toBe(false);
        expect(saved).toHaveLength(1);
        expect(saved[0].bookId).toBe('book-placed');
        expect(saved[0].id.startsWith('loose-')).toBe(false);
        expect(saved[0].x).toBe(120);
        expect(saved[0].rotation).toBe(-8);
    });

    it('queues a forced final save after an in-flight autosave', async () => {
        const oldWall = { ...makeWall(), name: '旧布局' };
        const finalWall = { ...makeWall(), name: '完成布局' };
        const oldItem = { ...makeWallItem(1), x: 10, y: 10 };
        const finalItem = { ...makeWallItem(1), x: 220, y: 360, rotation: 11 };
        const oldStarted = makeDeferred<void>();
        const releaseOld = makeDeferred<void>();
        const writes: string[] = [];
        const queue = createCollectionWallPersistQueue(async (wall, items) => {
            writes.push(`start:${wall.name}`);
            if (wall.name === '旧布局') {
                oldStarted.resolve();
                await releaseOld.promise;
            }
            writes.push(`finish:${wall.name}`);
            return { wall, items };
        });

        const oldToken = queue.nextToken();
        const oldSave = queue.enqueue(oldWall, [oldItem], oldToken);
        await oldStarted.promise;

        const finalToken = queue.nextToken();
        const finalSave = queue.enqueue(finalWall, [finalItem], finalToken, true);
        releaseOld.resolve();

        await oldSave;
        const saved = await finalSave;

        expect(saved.wall.name).toBe('完成布局');
        expect(saved.items[0].x).toBe(220);
        expect(saved.items[0].rotation).toBe(11);
        expect(writes).toEqual(['start:旧布局', 'finish:旧布局', 'start:完成布局', 'finish:完成布局']);
    });

    it('queues cancel rollback after an in-flight autosave', async () => {
        const autosaveWall = { ...makeWall(), name: '临时乱序' };
        const snapshotWall = { ...makeWall(), name: '装修前' };
        const autosaveItem = { ...makeWallItem(1), x: 420, y: 520, rotation: -17 };
        const snapshotItem = { ...makeWallItem(1), x: 88, y: 96, rotation: 0 };
        const autosaveStarted = makeDeferred<void>();
        const releaseAutosave = makeDeferred<void>();
        const queue = createCollectionWallPersistQueue(async (wall, items) => {
            if (wall.name === '临时乱序') {
                autosaveStarted.resolve();
                await releaseAutosave.promise;
            }
            return { wall, items };
        });

        const autosaveToken = queue.nextToken();
        const autosave = queue.enqueue(autosaveWall, [autosaveItem], autosaveToken);
        await autosaveStarted.promise;

        const rollbackToken = queue.nextToken();
        const rollback = queue.enqueue(snapshotWall, [snapshotItem], rollbackToken, true);
        releaseAutosave.resolve();

        await autosave;
        const saved = await rollback;

        expect(saved.wall.name).toBe('装修前');
        expect(saved.items[0].x).toBe(88);
        expect(saved.items[0].rotation).toBe(0);
    });
});
