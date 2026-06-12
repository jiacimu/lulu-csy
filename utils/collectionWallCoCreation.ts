import type { CollectionWallItem, CollectionWallLayoutMode } from '../types';

export type CharWallNotePlacement = 'near_anchor' | 'bottom_right' | 'free';

export type CharWallNoteParseResult =
    | { action: 'skip' }
    | {
        action: 'note';
        anchorId: string;
        placement: CharWallNotePlacement;
        content: string;
    };

export interface WallRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type NewCharWallNoteItem = Omit<CollectionWallItem, 'id' | 'createdAt'>;

const NOTE_W = 220;
const NOTE_H = 150;
const CANVAS_W = 750;
const CANVAS_H = 900;
const EDGE = 16;
const STEP = 24;
const ALLOWED_NOTE_KEYS = new Set(['action', 'anchorId', 'placement', 'content']);
const ALLOWED_PLACEMENTS = new Set<CharWallNotePlacement>(['near_anchor', 'bottom_right', 'free']);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const hashText = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const extractFirstJsonObject = (text: string): string | null => {
    const source = String(text || '');
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (start < 0) {
            if (char === '{') {
                start = index;
                depth = 1;
            }
            continue;
        }

        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = inString;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }

    return null;
};

const stripMarkdownFences = (text: string): string =>
    String(text || '')
        .replace(/```(?:json|JSON)?\s*/g, '')
        .replace(/```/g, '');

export function truncateCharWallNoteContent(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function parseCharWallNoteResponse(raw: unknown): CharWallNoteParseResult {
    const jsonText = extractFirstJsonObject(stripMarkdownFences(String(raw || '')));
    if (!jsonText) return { action: 'skip' };

    try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { action: 'skip' };
        if (Object.keys(parsed).some(key => !ALLOWED_NOTE_KEYS.has(key))) return { action: 'skip' };
        if (parsed.action === 'skip') return { action: 'skip' };
        if (parsed.action !== 'note') return { action: 'skip' };

        const anchorId = typeof parsed.anchorId === 'string' ? parsed.anchorId.trim() : '';
        const placement = typeof parsed.placement === 'string' ? parsed.placement.trim() as CharWallNotePlacement : '';
        const content = truncateCharWallNoteContent(parsed.content);
        if (!anchorId || !ALLOWED_PLACEMENTS.has(placement as CharWallNotePlacement) || !content) return { action: 'skip' };

        return { action: 'note', anchorId, placement: placement as CharWallNotePlacement, content };
    } catch {
        return { action: 'skip' };
    }
}

const toRect = (item: CollectionWallItem): WallRect => ({
    x: typeof item.x === 'number' ? item.x : EDGE + (item.order % 2) * 250,
    y: typeof item.y === 'number' ? item.y : EDGE + Math.floor(item.order / 2) * 180,
    w: Number.isFinite(item.w) ? item.w : NOTE_W,
    h: Number.isFinite(item.h) ? item.h : NOTE_H,
});

export function rectCoversItemCenter(rect: WallRect, item: CollectionWallItem): boolean {
    const itemRect = toRect(item);
    const centerX = itemRect.x + itemRect.w / 2;
    const centerY = itemRect.y + itemRect.h / 2;
    return centerX >= rect.x
        && centerX <= rect.x + rect.w
        && centerY >= rect.y
        && centerY <= rect.y + rect.h;
}

export function noteCoversAnyUserItemCenter(rect: WallRect, items: CollectionWallItem[]): boolean {
    return items.some(item => item.author === 'user' && rectCoversItemCenter(rect, item));
}

export function resolveCharWallNoteRect(
    preferred: Pick<WallRect, 'x' | 'y'>,
    items: CollectionWallItem[],
): WallRect {
    const clampX = (x: number) => clamp(x, EDGE, CANVAS_W - NOTE_W - EDGE);
    const clampY = (y: number) => clamp(y, EDGE, CANVAS_H - NOTE_H - EDGE);
    const candidate = { x: clampX(preferred.x), y: clampY(preferred.y), w: NOTE_W, h: NOTE_H };
    if (!noteCoversAnyUserItemCenter(candidate, items)) return candidate;

    for (let y = CANVAS_H - NOTE_H - EDGE; y >= EDGE; y -= STEP) {
        for (let x = CANVAS_W - NOTE_W - EDGE; x >= EDGE; x -= STEP) {
            const rect = { x, y, w: NOTE_W, h: NOTE_H };
            if (!noteCoversAnyUserItemCenter(rect, items)) return rect;
        }
    }

    return { x: CANVAS_W - NOTE_W - EDGE, y: CANVAS_H - NOTE_H - EDGE, w: NOTE_W, h: NOTE_H };
}

export function buildCharWallNoteItem(options: {
    wallId: string;
    layoutMode: CollectionWallLayoutMode;
    items: CollectionWallItem[];
    content: string;
    charName?: string;
    rotationSeed?: string | number;
}): NewCharWallNoteItem {
    const { wallId, layoutMode, items, content, charName, rotationSeed = Date.now() } = options;
    const order = items.length;
    const maxZ = items.reduce((max, item) => Math.max(max, item.z || 0), 0);
    const orderedItems = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));
    const last = orderedItems[orderedItems.length - 1];
    const preferredX = (typeof last?.x === 'number' ? last.x : EDGE) + 28;
    const preferredY = (typeof last?.y === 'number' ? last.y : EDGE) + 28;
    const rect = layoutMode === 'free'
        ? resolveCharWallNoteRect({ x: preferredX, y: preferredY }, items)
        : null;

    return {
        wallId,
        type: 'text',
        author: 'char',
        x: rect?.x ?? null,
        y: rect?.y ?? null,
        w: NOTE_W,
        h: NOTE_H,
        rotation: ((hashText(`${wallId}:${rotationSeed}:${content}`) % 7) - 3) * 0.45,
        z: maxZ + 1,
        order,
        text: { content: truncateCharWallNoteContent(content), preset: 'char_note' },
        name: `${charName || 'TA'} 的便签`,
    };
}
