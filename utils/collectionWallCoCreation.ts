import type { APIConfig, CollectionWallItem, CollectionWallLayoutMode } from '../types';
import { extractContent, safeFetchJson } from './safeApi';

export type CharWallNotePlacement = 'near_anchor' | 'bottom_right' | 'free';

export type CharWallNoteParseResult =
    | { action: 'skip' }
    | {
        action: 'note';
        anchorId?: string;
        placement?: CharWallNotePlacement;
        content: string;
    };

export interface WallRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type NewCharWallNoteItem = Omit<CollectionWallItem, 'id' | 'createdAt'>;

export interface CharWallNoteRequestOptions {
    apiConfig?: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'> | null;
    wallName: string;
    itemLabels: string[];
}

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
        if (placement && !ALLOWED_PLACEMENTS.has(placement as CharWallNotePlacement)) return { action: 'skip' };
        if (!content) return { action: 'skip' };

        return {
            action: 'note',
            ...(anchorId ? { anchorId } : {}),
            ...(placement ? { placement: placement as CharWallNotePlacement } : {}),
            content,
        };
    } catch {
        return { action: 'skip' };
    }
}

export async function requestCharWallNote(options: CharWallNoteRequestOptions): Promise<CharWallNoteParseResult> {
    const { apiConfig, wallName } = options;
    const baseUrl = apiConfig?.baseUrl?.trim().replace(/\/+$/, '');
    const model = apiConfig?.model?.trim();
    if (!baseUrl || !model) return { action: 'skip' };

    const itemLabels = options.itemLabels
        .map(label => String(label || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 30)
        .map(label => label.slice(0, 32));

    const context = {
        wallName: String(wallName || '未分类').replace(/\s+/g, ' ').trim().slice(0, 12),
        items: itemLabels,
    };
    const systemPrompt = [
        '你会看一面用户整理的拾光墙，只能决定是否留下一张很短的便签。',
        '只能输出 JSON，不能解释。格式之一：{"action":"note","content":"60字以内的便签"} 或 {"action":"skip"}。',
        '不要提出移动、删除、改写现有内容；不要输出现有内容的摘要；不确定就 skip。',
    ].join('\n');

    const data = await safeFetchJson(
        `${baseUrl}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiConfig?.apiKey || 'sk-none'}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(context) },
                ],
                temperature: 0.45,
                max_tokens: 120,
                stream: false,
            }),
        },
        0,
        {
            feature: 'collection-wall-char-note',
            reason: '手动邀请 TA 查看拾光墙',
            model,
            userInitiated: true,
        },
    );

    return parseCharWallNoteResponse(extractContent(data));
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
    const { wallId, items, content, charName, rotationSeed = Date.now() } = options;
    const order = items.length;
    const maxZ = items.reduce((max, item) => Math.max(max, item.z || 0), 0);
    const rect = resolveCharWallNoteRect({
        x: CANVAS_W - NOTE_W - EDGE,
        y: CANVAS_H - NOTE_H - EDGE,
    }, items);

    return {
        wallId,
        type: 'text',
        author: 'char',
        x: rect.x,
        y: rect.y,
        w: NOTE_W,
        h: NOTE_H,
        rotation: ((hashText(`${wallId}:${rotationSeed}:${content}`) % 7) - 3) * 0.45,
        z: maxZ + 1,
        order,
        text: { content: truncateCharWallNoteContent(content), preset: 'char_note' },
        name: `${charName || 'TA'} 的便签`,
    };
}
