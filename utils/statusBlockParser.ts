export interface ParsedStatusBlock {
    fields: Record<string, string | string[]>;
    raw: string;
}

type StatusFieldDef = {
    name: string;
    type?: 'text' | 'list';
    description?: string;
};

export const STATUS_MODULE_DISPLAY_NAME_TO_ID: Record<string, string> = {
    命途: 'plot_anchor',
    此幕: 'scene_progress',
    草蛇灰线: 'clue_foreshadow',
    人心向背: 'character_stance',
    怦然: 'romance_affection',
    暗涌: 'romance_tension',
    此身: 'player_condition',
    风云录: 'world_faction',
    伏机: 'event_trigger',
    执笔: 'narrative_control',
};

export const STATUS_MODULE_ID_TO_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
    Object.entries(STATUS_MODULE_DISPLAY_NAME_TO_ID).map(([name, id]) => [id, name]),
);

const STATUS_MODULE_LEGACY_NAME_TO_DISPLAY_NAME: Record<string, string> = {
    剧情锚点栏: '命途',
    场景推进栏: '此幕',
    线索伏笔栏: '草蛇灰线',
    角色立场栏: '人心向背',
    恋爱心动栏: '怦然',
    恋爱拉扯栏: '暗涌',
    玩家状态栏: '此身',
    世界势力栏: '风云录',
    事件触发栏: '伏机',
    叙事控制栏: '执笔',
};

const STATUS_BLOCK_RE = /<status>([\s\S]*?)<\/status>/i;
const FIELD_LINE_RE = /^\s*([^:：\n][^:：]*?)\s*[:：]\s*(.*?)\s*$/;
const LIST_ITEM_RE = /^\s*-\s*(.*?)\s*$/;

export function normalizeStatusModuleFieldName(value: string): string {
    const key = value.trim();
    const separatorMatch = key.match(/^(.+?)[-－—–](.+)$/);
    if (!separatorMatch) return key;

    const rawModuleName = separatorMatch[1].trim();
    const fieldName = separatorMatch[2].trim();
    const displayName = STATUS_MODULE_LEGACY_NAME_TO_DISPLAY_NAME[rawModuleName]
        || STATUS_MODULE_ID_TO_DISPLAY_NAME[rawModuleName]
        || (STATUS_MODULE_DISPLAY_NAME_TO_ID[rawModuleName] ? rawModuleName : '');

    return displayName ? `${displayName}-${fieldName}` : key;
}

function normalizeFieldName(value: string): string {
    return normalizeStatusModuleFieldName(value).trim().replace(/\s+/g, '').toLocaleLowerCase();
}

function getEditDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            );
        }
        for (let j = 0; j <= b.length; j += 1) {
            previous[j] = current[j];
        }
    }

    return previous[b.length];
}

function resolveFieldName(rawKey: string, fieldDefs?: Array<{ name: string }>): string {
    const key = normalizeStatusModuleFieldName(rawKey);
    if (!fieldDefs?.length) return key;

    const normalizedKey = normalizeFieldName(key);
    const exact = fieldDefs.find(field => normalizeFieldName(field.name) === normalizedKey);
    if (exact) return exact.name;

    const contained = fieldDefs.find(field => {
        const normalizedField = normalizeFieldName(field.name);
        return normalizedField && (normalizedKey.includes(normalizedField) || normalizedField.includes(normalizedKey));
    });
    if (contained) return contained.name;

    let best: { name: string; distance: number } | null = null;
    for (const field of fieldDefs) {
        const normalizedField = normalizeFieldName(field.name);
        if (!normalizedField) continue;

        const distance = getEditDistance(normalizedKey, normalizedField);
        if (!best || distance < best.distance) {
            best = { name: field.name, distance };
        }
    }

    if (!best) return key;

    const longest = Math.max(normalizedKey.length, normalizeFieldName(best.name).length);
    const threshold = longest <= 4 ? 1 : Math.max(1, Math.floor(longest * 0.34));
    return best.distance <= threshold ? best.name : key;
}

function resolveFieldDef(key: string, fieldDefs?: StatusFieldDef[]): StatusFieldDef | undefined {
    if (!fieldDefs?.length) return undefined;

    const normalizedKey = normalizeFieldName(key);
    return fieldDefs.find(field => normalizeFieldName(field.name) === normalizedKey);
}

function splitInlineListValue(value: string): string[] {
    const cleaned = value.trim();
    if (!cleaned) return [];

    const dashedParts = cleaned
        .split(/\s+-\s+/)
        .map(item => item.trim())
        .filter(Boolean);

    return dashedParts.length > 1 ? dashedParts : [cleaned];
}

function appendListItem(
    fields: Record<string, string | string[]>,
    currentKey: string | null,
    item: string,
): void {
    if (!currentKey) return;

    const existing = fields[currentKey];
    if (Array.isArray(existing)) {
        existing.push(item);
    } else if (typeof existing === 'string' && existing.trim()) {
        fields[currentKey] = [existing, item];
    } else {
        fields[currentKey] = [item];
    }
}

export function parseStatusBlock(
    aiOutput: string,
    fieldDefs?: StatusFieldDef[],
): ParsedStatusBlock | null {
    const blockMatch = (aiOutput || '').match(STATUS_BLOCK_RE);
    if (!blockMatch) return null;

    const raw = blockMatch[1].trim();
    const fields: Record<string, string | string[]> = {};
    let currentListKey: string | null = null;

    for (const sourceLine of raw.split(/\r?\n/)) {
        const line = sourceLine.trimEnd();
        if (!line.trim()) continue;

        const listMatch = line.match(LIST_ITEM_RE);
        if (listMatch && currentListKey) {
            appendListItem(fields, currentListKey, listMatch[1].trim());
            continue;
        }

        const fieldMatch = line.match(FIELD_LINE_RE);
        if (fieldMatch) {
            const key = resolveFieldName(fieldMatch[1], fieldDefs);
            const value = fieldMatch[2].trim();
            const fieldDef = resolveFieldDef(key, fieldDefs);

            if (value) {
                fields[key] = fieldDef?.type === 'list' ? splitInlineListValue(value) : value;
                currentListKey = null;
            } else {
                fields[key] = Array.isArray(fields[key]) ? fields[key] : [];
                currentListKey = key;
            }
            continue;
        }
    }

    return { fields, raw };
}

export function buildStatusSampleV2(fields: StatusFieldDef[]): string {
    const lines: string[] = ['<status>'];

    const fieldList = fields.length > 0
        ? fields
        : [{ name: '字段1', type: 'text' as const, description: '字段1示例值' }];

    for (const field of fieldList) {
        const name = field.name?.trim() || '字段';
        if (field.type === 'list') {
            lines.push(`${name}:`);
            lines.push(`  - ${name}示例1`);
            lines.push(`  - ${name}示例2`);
            lines.push(`  - ${name}示例3`);
        } else {
            lines.push(`${name}: ${name}示例值`);
        }
    }

    lines.push('</status>');
    return lines.join('\n');
}
