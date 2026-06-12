import type {
    NianNianChoiceOption,
    NianNianEndingRoute,
    NianNianEventCategory,
    NianNianEventPrototype,
    NianNianEventWeights,
    NianNianFateBookSection,
    NianNianStage,
    NianNianStatusField,
    NianNianWorldBible,
    NianNianWorldOpeningStep,
} from '../types/niannian';
import {
    createEmptyWorldBible,
    parseNianNianStatusBlock,
    parseNianNianStatusLines,
} from './niannianEngine';

export interface NianNianWorldPackDefinition {
    id: string;
    name: string;
    url: string;
    description: string;
}

export const DEFAULT_NIANNIAN_WORLD_PACK_ID = 'ancient-china';
export const DEFAULT_NIANNIAN_WORLD_PACK_URL = '/worldpacks/ancient-china.md';

export const AVAILABLE_NIANNIAN_WORLD_PACKS: NianNianWorldPackDefinition[] = [
    {
        id: 'ancient-china',
        name: '古代中国',
        url: DEFAULT_NIANNIAN_WORLD_PACK_URL,
        description: '市井、宅门、朝堂之间的慢热旧缘。',
    },
    {
        id: 'westfantasy',
        name: '西幻宫廷',
        url: '/worldpacks/westfantasy.md',
        description: '骑士誓约、宫廷流言与王座前的抉择。',
    },
    {
        id: 'minguo',
        name: '民国旧梦',
        url: '/worldpacks/minguo.md',
        description: '报馆风声、家族体面与月台汽笛。',
    },
];

const HEADING_PREFIX_RE = /^#{1,6}\s+/;
const DELIMITER_LINE_RE = /^<<<\s*([A-Z_]+)\s*>>>$/i;
const STAGE_NAMES: NianNianStage[] = ['初遇', '拉扯', '心意渐明', '情动', '厮守', '别离'];

export function getNianNianWorldPackDefinition(id: string): NianNianWorldPackDefinition {
    return AVAILABLE_NIANNIAN_WORLD_PACKS.find(pack => pack.id === id)
        || AVAILABLE_NIANNIAN_WORLD_PACKS[0];
}

function normalizeHeading(value: string): string {
    return value
        .replace(HEADING_PREFIX_RE, '')
        .replace(/[（(].*?[）)]/g, '')
        .trim()
        .toLowerCase();
}

function extractHeadingSection(markdown: string, headingName: string): string {
    const lines = markdown.split(/\r?\n/);
    const target = headingName.toLowerCase();
    let start = -1;
    let level = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (!headingMatch) continue;

        if (start >= 0 && headingMatch[1].length <= level) {
            return lines.slice(start + 1, index).join('\n').trim();
        }

        if (normalizeHeading(line) === target) {
            start = index;
            level = headingMatch[1].length;
        }
    }

    return start >= 0 ? lines.slice(start + 1).join('\n').trim() : '';
}

function extractFencedBlock(markdown: string, headingName: string): string {
    const section = extractHeadingSection(markdown, headingName);
    const match = section.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
    return (match?.[1] || section).trim();
}

function extractFirstHeadingSection(markdown: string, headingNames: string[]): string {
    for (const headingName of headingNames) {
        const section = extractHeadingSection(markdown, headingName);
        if (section) return section;
    }
    return '';
}

function extractFirstFencedBlock(markdown: string, headingNames: string[]): string {
    for (const headingName of headingNames) {
        const block = extractFencedBlock(markdown, headingName);
        if (block) return block;
    }
    return '';
}

function cleanMarkdownText(value: string): string {
    return value
        .split(/\r?\n/)
        .map(line => line.replace(/^>\s?/, '').trim())
        .filter(line => line && !line.startsWith('---') && !line.startsWith('```'))
        .join('\n')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim();
}

function parseJsonValue(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function parseJsonObject(raw: string): Record<string, any> | null {
    const parsed = parseJsonValue(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, any>
        : null;
}

function parseJsonArray(raw: string): any[] | null {
    const parsed = parseJsonValue(raw);
    return Array.isArray(parsed) ? parsed : null;
}

function parseDelimitedSections(
    raw: string,
    acceptedSections: string[],
): Partial<Record<string, string>> {
    const accepted = new Set(acceptedSections.map(section => section.toUpperCase()));
    const sections: Partial<Record<string, string[]>> = {};
    let current: string | null = null;

    for (const sourceLine of (raw || '').replace(/\r/g, '').split('\n')) {
        const delimiter = sourceLine.trim().match(DELIMITER_LINE_RE);
        if (delimiter) {
            const key = delimiter[1].toUpperCase();
            if (key === 'END') break;
            current = accepted.has(key) ? key : null;
            if (current && !sections[current]) sections[current] = [];
            continue;
        }

        if (!current || sourceLine.trim().startsWith('```')) continue;
        sections[current] = [...(sections[current] || []), sourceLine];
    }

    return Object.fromEntries(
        Object.entries(sections).map(([key, lines]) => [key, (lines || []).join('\n').trim()]),
    );
}

function parseMeta(markdown: string): Record<string, string> {
    const meta = extractHeadingSection(markdown, 'meta');
    const parsed: Record<string, string> = {};
    for (const sourceLine of meta.split(/\r?\n/)) {
        const line = sourceLine.trim().replace(/^-\s*/, '');
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*[:：]\s*`?([^`]+)`?\s*$/);
        if (!match) continue;
        parsed[match[1]] = match[2].trim();
    }
    return parsed;
}

function parseOpeningOptions(raw: string): NianNianChoiceOption[] {
    return raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index): NianNianChoiceOption | null => {
            const pieces = line.split('|').map(part => part.trim());
            if (pieces.length < 2) return null;
            const key = pieces[0].replace(/[.、:：-]/g, '').trim() || String.fromCharCode(65 + index);
            const label = pieces[1];
            if (!label) return null;
            return {
                id: `opening-${key.toLowerCase()}-${index + 1}`,
                label,
                directorHint: pieces.slice(2).join(' | ').trim() || undefined,
            };
        })
        .filter((option): option is NianNianChoiceOption => Boolean(option));
}

function parseOpeningStep(raw: string): NianNianWorldOpeningStep | undefined {
    const parsed = parseJsonObject(raw);
    if (parsed && typeof parsed.sceneText === 'string' && Array.isArray(parsed.options)) {
        const options: NianNianChoiceOption[] = parsed.options
            .filter((option: any) => option && typeof option.id === 'string' && typeof option.label === 'string')
            .map((option: any) => ({
                id: option.id,
                label: option.label,
                hint: typeof option.hint === 'string' ? option.hint : undefined,
                directorHint: typeof option.directorHint === 'string' ? option.directorHint : undefined,
            }));

        return {
            sceneText: parsed.sceneText.trim(),
            options,
            allowFreeInput: typeof parsed.allowFreeInput === 'boolean' ? parsed.allowFreeInput : true,
        };
    }

    const sections = parseDelimitedSections(raw, ['SCENE', 'OPTIONS']);
    const sceneText = (sections.SCENE || '').trim();
    if (!sceneText) return undefined;

    return {
        sceneText,
        options: parseOpeningOptions(sections.OPTIONS || ''),
        allowFreeInput: true,
    };
}

function parseHiddenVarsSeed(raw: string): Record<string, number> {
    const parsed = parseJsonObject(raw);
    if (parsed) {
        return Object.fromEntries(
            Object.entries(parsed)
                .map(([key, value]) => [key, Number(value)] as const)
                .filter(([, value]) => Number.isFinite(value)),
        );
    }

    const values: Record<string, number> = {};
    for (const sourceLine of raw.split(/\r?\n/)) {
        const line = sourceLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('```')) continue;
        const match = line.match(/^([^:：]+)\s*[:：]\s*([+-]?\d+(?:\.\d+)?)/);
        if (!match) continue;
        const key = cleanMarkdownText(match[1]);
        const value = Number(match[2]);
        if (key && Number.isFinite(value)) values[key] = value;
    }
    return values;
}

function parseSeedStatus(raw: string): Record<string, any> | undefined {
    const block = parseNianNianStatusBlock(raw);
    if (block) return block.statusPatch;

    const parsed = parseNianNianStatusLines(raw);
    return parsed.parsedLineCount > 0 ? parsed.patch : undefined;
}

function parseStatusSchema(markdown: string): NianNianStatusField[] {
    const section = extractHeadingSection(markdown, 'status_schema');
    const fields: NianNianStatusField[] = [];
    const seen = new Set<string>();

    for (const sourceLine of section.split(/\r?\n/)) {
        const line = sourceLine.trim();
        const match = line.match(/world\.([^\s`\]*:：\[]+)[^\d+-]*([+-]?\d+)\s*[–~-]\s*([+-]?\d+)/);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        fields.push({
            key: match[1],
            label: match[1],
            type: 'number',
            min: Number(match[2]),
            max: Number(match[3]),
        });
    }

    return fields;
}

function resolveStageLabels(value: string): NianNianStage[] {
    const stages = STAGE_NAMES.filter(stage => value.includes(stage));
    if (value.includes('顶点')) {
        if (!stages.includes('厮守')) stages.push('厮守');
        if (!stages.includes('别离')) stages.push('别离');
    }
    return stages;
}

function parseEventWeightsTable(raw: string): NianNianEventWeights {
    const tableLines = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.includes('|'));
    const headerLine = tableLines.find(line => !/^\|?\s*:?-{2,}/.test(line));
    if (!headerLine) return {};

    const header = headerLine.split('|').map(cell => cell.trim()).filter(Boolean);
    const categories = header.slice(1);
    if (categories.length === 0) return {};

    const weights: NianNianEventWeights = {};
    for (const line of tableLines.slice(tableLines.indexOf(headerLine) + 1)) {
        if (/^\|?\s*:?-{2,}/.test(line)) continue;
        const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
        if (cells.length < categories.length + 1) continue;
        const stages = resolveStageLabels(cells[0]);
        for (const stage of stages) {
            const stageWeights: Record<string, number> = {};
            categories.forEach((category, index) => {
                const numeric = Number(cells[index + 1]);
                if (Number.isFinite(numeric)) stageWeights[category] = numeric;
            });
            weights[stage] = stageWeights;
        }
    }

    return weights;
}

function parseEventWeights(markdown: string): NianNianEventWeights {
    const raw = extractFencedBlock(markdown, 'event_weights');
    if (!raw) return {};

    const parsed = parseJsonObject(raw);
    if (parsed) {
        const weights: NianNianEventWeights = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                weights[key] = value;
                continue;
            }
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const stageWeights: Record<string, number> = {};
                for (const [eventName, eventWeight] of Object.entries(value)) {
                    const numeric = Number(eventWeight);
                    if (Number.isFinite(numeric)) stageWeights[eventName] = numeric;
                }
                weights[key] = stageWeights;
            }
        }
        return weights;
    }

    const tableWeights = parseEventWeightsTable(raw);
    if (Object.keys(tableWeights).length > 0) return tableWeights;

    const weights: NianNianEventWeights = {};
    for (const sourceLine of raw.split(/\r?\n/)) {
        const line = sourceLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('```')) continue;
        const match = line.match(/^([^:：|]+)\s*[:：|]\s*([+-]?\d+(?:\.\d+)?)$/);
        if (!match) continue;
        weights[match[1].trim()] = Number(match[2]);
    }
    return weights;
}

function categoryStagesFromWeights(weights: NianNianEventWeights, categoryName: string): NianNianStage[] {
    const stages: NianNianStage[] = [];
    for (const stage of STAGE_NAMES) {
        const stageWeights = weights[stage];
        if (stageWeights && typeof stageWeights === 'object' && !Array.isArray(stageWeights)) {
            const value = Number(stageWeights[categoryName] || 0);
            if (value > 0) stages.push(stage);
        }
    }
    return stages.length > 0 ? stages : STAGE_NAMES;
}

function parseEventCategories(markdown: string): NianNianEventCategory[] {
    const section = extractFirstHeadingSection(markdown, ['事件库', '事件类目', 'event_categories']);
    const parsed = parseJsonArray(extractFirstFencedBlock(markdown, ['event_categories']));
    if (parsed) {
        return parsed
            .filter(category => category && typeof category.name === 'string' && Array.isArray(category.events))
            .map(category => ({
                name: category.name,
                events: category.events
                    .filter((event: any) => event && typeof event.name === 'string' && typeof event.description === 'string')
                    .map((event: any) => ({
                        id: typeof event.id === 'string' ? event.id : undefined,
                        name: event.name,
                        description: event.description,
                    })),
            }));
    }

    const categories: NianNianEventCategory[] = [];
    let current: NianNianEventCategory | null = null;
    for (const sourceLine of section.split(/\r?\n/)) {
        const heading = sourceLine.match(/^#{3,6}\s+(.+)$/);
        if (heading) {
            current = { name: cleanMarkdownText(heading[1]), events: [] };
            categories.push(current);
            continue;
        }

        const bullet = sourceLine.trim().match(/^-\s*(.+?)\s*[—–-]\s*(.+)$/);
        if (!bullet || !current) continue;
        current.events.push({
            name: cleanMarkdownText(bullet[1]),
            description: cleanMarkdownText(bullet[2]),
        });
    }

    return categories.filter(category => category.events.length > 0);
}

function normalizeEventId(value: string, fallback: string): string {
    const ascii = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return ascii || fallback;
}

function buildEventPrototypesFromCategories(
    categories: NianNianEventCategory[],
    weights: NianNianEventWeights,
    worldId: string,
): NianNianEventPrototype[] {
    let index = 0;
    return categories.flatMap(category => {
        const stages = categoryStagesFromWeights(weights, category.name);
        return category.events.map(event => {
            index += 1;
            const id = event.id || `${worldId || 'world'}_${normalizeEventId(event.name, `event_${index}`)}`;
            return {
                id,
                类目: category.name,
                名称: event.name,
                功能: event.description,
                情绪: category.name,
                适配stage: stages,
                基础权重: 2,
                跨题材示例: {
                    [worldId || '当前世界']: event.name,
                },
            };
        });
    });
}

function parseFateBookSections(raw: string): NianNianFateBookSection[] | undefined {
    const parsed = parseJsonArray(raw);
    if (!parsed) return undefined;

    const sections = parsed
        .filter(section => section && typeof section.key === 'string' && Array.isArray(section.items))
        .map(section => ({
            key: section.key,
            seal: typeof section.seal === 'string' ? section.seal : section.key.slice(0, 1),
            title: typeof section.title === 'string' ? section.title : section.key,
            items: section.items
                .filter((item: any) => item && typeof item.label === 'string')
                .map((item: any) => ({
                    label: item.label,
                    path: typeof item.path === 'string' ? item.path : undefined,
                    value: ['string', 'number', 'boolean'].includes(typeof item.value) ? item.value : undefined,
                    format: typeof item.format === 'string' ? item.format : undefined,
                    fallback: typeof item.fallback === 'string' ? item.fallback : undefined,
                })),
        }));

    return sections.length > 0 ? sections : undefined;
}

function parseEndingRoutes(raw: string): NianNianEndingRoute[] {
    const parsed = parseJsonArray(raw);
    if (parsed) {
        return parsed
            .filter(route => route && typeof route.title === 'string')
            .map(route => ({
                key: typeof route.key === 'string' ? route.key : undefined,
                title: route.title,
                description: typeof route.description === 'string' ? route.description : undefined,
            }));
    }

    return raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('-'))
        .map(line => {
            const text = cleanMarkdownText(line.replace(/^-\s*/, ''));
            const match = text.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
            return match
                ? { title: match[1].trim(), description: match[2].trim() }
                : { title: text };
        })
        .filter(route => route.title);
}

export function parseNianNianWorldBibleMarkdown(markdown: string): NianNianWorldBible {
    const meta = parseMeta(markdown);
    const worldId = meta.world_id || meta.worldId || '';
    const worldName = meta.world_name || meta.worldName || '';
    const seedStatus = parseSeedStatus(extractFencedBlock(markdown, 'seedStatus'));
    const openingStep = parseOpeningStep(extractFencedBlock(markdown, 'openingStep'));
    const hiddenVarsSeed = parseHiddenVarsSeed(extractFencedBlock(markdown, 'hiddenVarsSeed'));
    const opening = openingStep?.sceneText || cleanMarkdownText(extractHeadingSection(markdown, 'opening'));
    const worldStyle = cleanMarkdownText(extractFirstHeadingSection(markdown, ['world_style', '文风', 'style']));
    const eventWeights = parseEventWeights(markdown);
    const eventCategories = parseEventCategories(markdown);
    const eventPrototypes = buildEventPrototypesFromCategories(eventCategories, eventWeights, worldId);

    return {
        ...createEmptyWorldBible(),
        worldId,
        worldName,
        theme: cleanMarkdownText(extractHeadingSection(markdown, 'genre')),
        tone: cleanMarkdownText(extractHeadingSection(markdown, 'tone')),
        charIdentity: cleanMarkdownText(extractHeadingSection(markdown, 'char_identity')),
        protagonistIdentity: cleanMarkdownText(extractHeadingSection(markdown, 'mc_identity')),
        opening,
        statusSchema: parseStatusSchema(markdown),
        eventWeights,
        eventCategories,
        eventPrototypes,
        customPrompt: worldStyle,
        worldStyle,
        intimacyConstraint: cleanMarkdownText(extractFirstHeadingSection(markdown, ['亲近约束句', 'intimacy_constraint'])),
        statusInstructions: cleanMarkdownText(extractFirstHeadingSection(markdown, ['状态块世界行', 'status_instructions'])),
        directorNotes: cleanMarkdownText(extractFirstHeadingSection(markdown, ['director_notes', '天意规则'])),
        endingRoutes: parseEndingRoutes(extractFirstHeadingSection(markdown, ['收束走向', 'ending_routes'])),
        fateBookSections: parseFateBookSections(extractFencedBlock(markdown, 'fateBook')),
        seedStatus,
        openingStep,
        hiddenVarsSeed,
    };
}

export async function loadNianNianWorldBibleFromMarkdown(
    url = DEFAULT_NIANNIAN_WORLD_PACK_URL,
): Promise<NianNianWorldBible> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load NianNian world pack: ${response.status}`);
    }

    return parseNianNianWorldBibleMarkdown(await response.text());
}
