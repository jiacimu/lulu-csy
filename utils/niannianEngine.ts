import type {
    NianNianChoiceOption,
    NianNianInputBeat,
    NianNianInteractionStep,
    NianNianModelPurpose,
    NianNianModelRequest,
    NianNianParsedStatusBlock,
    NianNianRawMessage,
    NianNianSession,
    NianNianStatusField,
    NianNianStatusState,
    NianNianTurnPlan,
    NianNianWorldBible,
} from '../types/niannian';
import { extractJson } from './safeApi';

export const NIANNIAN_MAX_COMPLETION_TOKENS = 65536;
export const NIANNIAN_RAW_BUFFER_LIMIT = 5;
export const NIANNIAN_COMPRESSION_TURN_INTERVAL = 20;
export const NIANNIAN_RAW_CHAR_THRESHOLD = 24000;

const STATUS_BLOCK_RE = /<<<STATUS>>>([\s\S]*?)<<<END>>>/i;

const clampNumber = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

export function createNianNianId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyWorldBible(): NianNianWorldBible {
    return {
        theme: '',
        tone: '',
        charIdentity: '',
        protagonistIdentity: '',
        opening: '',
        statusSchema: [],
        eventWeights: {},
        customPrompt: '',
    };
}

export function createInitialNianNianStatus(world: NianNianWorldBible): NianNianStatusState {
    const worldExtra: Record<string, number | string> = {};
    for (const field of world.statusSchema) {
        worldExtra[field.key] = field.type === 'number' ? field.min ?? 0 : '';
    }

    return {
        ta: {
            好感: 0,
            心情: '未定',
            神态: 'normal',
            暧昧度: 0,
            心声: '',
        },
        me: {
            身份: world.protagonistIdentity || '未设定',
            银两: 0,
            体力: 100,
            名声: 0,
        },
        scene: {
            时辰: '',
            地点: '',
            情境: world.opening || '',
        },
        npcsOnScene: [],
        worldExtra,
    };
}

export function createFallbackInteractionStep(now = Date.now()): NianNianInteractionStep {
    return {
        id: createNianNianId('nn_step'),
        sceneText: 'TODO(人工)：天意事件落地文本待生成。',
        options: [
            { id: 'todo-option-1', label: 'TODO(人工)：节点选项一' },
            { id: 'todo-option-2', label: 'TODO(人工)：节点选项二' },
        ],
        allowFreeInput: true,
        createdAt: now,
        source: 'fallback',
    };
}

export function createNianNianSession(input: {
    charId: string;
    charName: string;
    userName: string;
    world: NianNianWorldBible;
    now?: number;
}): NianNianSession {
    const now = input.now || Date.now();
    const world = {
        ...createEmptyWorldBible(),
        ...input.world,
        statusSchema: input.world.statusSchema || [],
        eventWeights: input.world.eventWeights || {},
    };
    return {
        id: createNianNianId('nn_session'),
        charId: input.charId,
        charName: input.charName,
        userName: input.userName,
        world,
        status: createInitialNianNianStatus(world),
        milestones: [],
        segments: [],
        rawBuffer: [],
        director: {
            turn: 0,
            stage: '初遇',
            hiddenVars: {},
        },
        currentStep: createFallbackInteractionStep(now),
        ended: false,
        createdAt: now,
        updatedAt: now,
    };
}

export function sanitizeNianNianInputBeats(beats: NianNianInputBeat[]): NianNianInputBeat[] {
    return beats
        .map(beat => ({
            kind: beat.kind === 'action' ? 'action' as const : 'speech' as const,
            text: beat.text.trim(),
        }))
        .filter(beat => beat.text.length > 0);
}

export function formatNianNianUserInput(input: {
    beats: NianNianInputBeat[];
    selectedOption?: NianNianChoiceOption | null;
}): string {
    const lines: string[] = [];
    if (input.selectedOption) {
        lines.push(`【选项】${input.selectedOption.label}`);
    }

    for (const beat of sanitizeNianNianInputBeats(input.beats)) {
        const tag = beat.kind === 'action' ? '动作' : '台词';
        lines.push(`【${tag}】${beat.text}`);
    }

    return lines.join('\n').trim();
}

export function parseNianNianStatusBlock(aiOutput: string): NianNianParsedStatusBlock | null {
    const match = (aiOutput || '').match(STATUS_BLOCK_RE);
    if (!match) return null;

    const raw = match[1].trim();
    const parsed = extractJson(raw, { logFailure: false });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    return {
        statusPatch: parsed,
        raw,
    };
}

export function stripNianNianStatusBlock(aiOutput: string): string {
    return (aiOutput || '').replace(STATUS_BLOCK_RE, '').trim();
}

function applyDelta(
    current: Record<string, any>,
    patch: Record<string, any> | undefined,
    limits: Record<string, { min: number; max: number }>,
): Record<string, any> {
    if (!patch || typeof patch !== 'object') return current;
    const next = { ...current };

    for (const [key, value] of Object.entries(patch)) {
        if (key.endsWith('_delta')) {
            const targetKey = key.slice(0, -'_delta'.length);
            const delta = Number(value);
            if (!Number.isFinite(delta)) continue;
            const currentValue = Number(next[targetKey] || 0);
            const limit = limits[targetKey] || { min: -999999, max: 999999 };
            next[targetKey] = clampNumber(currentValue + delta, limit.min, limit.max);
            continue;
        }
        next[key] = value;
    }

    return next;
}

function worldExtraLimits(schema: NianNianStatusField[]): Record<string, { min: number; max: number }> {
    const limits: Record<string, { min: number; max: number }> = {};
    for (const field of schema) {
        if (field.type !== 'number') continue;
        limits[field.key] = {
            min: field.min ?? -999999,
            max: field.max ?? 999999,
        };
    }
    return limits;
}

export function applyNianNianStatusPatch(
    previous: NianNianStatusState,
    patch: Record<string, any>,
    schema: NianNianStatusField[] = [],
): NianNianStatusState {
    const ta = applyDelta(previous.ta, patch.ta, {
        好感: { min: 0, max: 100 },
        暧昧度: { min: 0, max: 100 },
    }) as NianNianStatusState['ta'];

    const me = applyDelta(previous.me, patch.me, {
        银两: { min: 0, max: 999999 },
        体力: { min: 0, max: 100 },
        名声: { min: -100, max: 100 },
    }) as NianNianStatusState['me'];

    const scene = patch.scene && typeof patch.scene === 'object'
        ? { ...previous.scene, ...patch.scene }
        : previous.scene;

    const worldExtra = applyDelta(
        previous.worldExtra,
        patch.worldExtra,
        worldExtraLimits(schema),
    );

    return {
        ta,
        me,
        scene,
        npcsOnScene: Array.isArray(patch.npcs)
            ? patch.npcs
                .filter((npc: any) => npc && typeof npc.name === 'string')
                .map((npc: any) => ({ name: npc.name, mood: String(npc.mood || '') }))
            : previous.npcsOnScene,
        worldExtra,
    };
}

export function appendNianNianRawMessage(
    session: NianNianSession,
    message: NianNianRawMessage,
): NianNianSession {
    return {
        ...session,
        rawBuffer: [...session.rawBuffer, message].slice(-NIANNIAN_RAW_BUFFER_LIMIT),
        updatedAt: Date.now(),
    };
}

export function appendNianNianFrozenSegment(
    session: NianNianSession,
    input: {
        summary: string;
        turnRange: [number, number];
        now?: number;
    },
): NianNianSession {
    const now = input.now || Date.now();
    return {
        ...session,
        segments: [
            ...session.segments,
            {
                idx: session.segments.length,
                turnRange: input.turnRange,
                summary: input.summary,
            },
        ],
        rawBuffer: session.rawBuffer.slice(-NIANNIAN_RAW_BUFFER_LIMIT),
        updatedAt: now,
    };
}

export function shouldCompressNianNianHistory(session: NianNianSession): boolean {
    if (session.director.turn > 0 && session.director.turn % NIANNIAN_COMPRESSION_TURN_INTERVAL === 0) {
        return true;
    }

    const rawSize = session.rawBuffer.reduce((sum, item) => sum + item.content.length, 0);
    return rawSize >= NIANNIAN_RAW_CHAR_THRESHOLD;
}

function baseRequestMetadata(session: NianNianSession): NianNianModelRequest['metadata'] {
    return {
        sessionId: session.id,
        charId: session.charId,
        turn: session.director.turn,
        statusDelimiter: ['<<<STATUS>>>', '<<<END>>>'],
    };
}

function buildStructuredContext(session: NianNianSession, extra: Record<string, any> = {}): string {
    return JSON.stringify({
        contract: '念念浮生接口骨架；创作内容与提示词由 TODO(人工) 后续填写。',
        world: session.world,
        status: session.status,
        director: session.director,
        milestones: session.milestones,
        frozenSegments: session.segments,
        rawBuffer: session.rawBuffer,
        currentStep: session.currentStep,
        ...extra,
    }, null, 2);
}

export function buildNianNianModelRequest(input: {
    session: NianNianSession;
    lane: NianNianModelRequest['lane'];
    purpose: NianNianModelPurpose;
    payload: Record<string, any>;
}): NianNianModelRequest {
    const systemPlaceholder = input.lane === 'main'
        ? 'TODO(人工)：主模型提示词。要求角色扮演正文，并在末尾输出固定状态块。'
        : 'TODO(人工)：副模型提示词。负责导演、事件落地、压缩或结算。';

    return {
        lane: input.lane,
        purpose: input.purpose,
        max_tokens: NIANNIAN_MAX_COMPLETION_TOKENS,
        messages: [
            { role: 'system', content: systemPlaceholder },
            { role: 'user', content: buildStructuredContext(input.session, input.payload) },
        ],
        metadata: baseRequestMetadata(input.session),
    };
}

export function buildNianNianTurnPlan(session: NianNianSession, userInput: string): NianNianTurnPlan {
    const fallbackStep = createFallbackInteractionStep();
    const mainRequest = buildNianNianModelRequest({
        session,
        lane: 'main',
        purpose: 'roleplay',
        payload: { userInput },
    });
    const directorRequest = buildNianNianModelRequest({
        session,
        lane: 'director',
        purpose: 'event_landing',
        payload: {
            userInput,
            fallbackStep,
        },
    });
    const compressionRequest = shouldCompressNianNianHistory(session)
        ? buildNianNianModelRequest({
            session,
            lane: 'director',
            purpose: 'compression',
            payload: {
                compressionPolicy: {
                    rawBufferLimit: NIANNIAN_RAW_BUFFER_LIMIT,
                    intervalTurns: NIANNIAN_COMPRESSION_TURN_INTERVAL,
                    charThreshold: NIANNIAN_RAW_CHAR_THRESHOLD,
                },
            },
        })
        : undefined;

    return {
        userInput,
        mainRequest,
        directorRequest,
        compressionRequest,
        fallbackStep,
    };
}

export function applyNianNianAssistantOutput(
    session: NianNianSession,
    aiOutput: string,
    now = Date.now(),
): {
    session: NianNianSession;
    parsedStatus: NianNianParsedStatusBlock | null;
} {
    const parsedStatus = parseNianNianStatusBlock(aiOutput);
    const status = parsedStatus
        ? applyNianNianStatusPatch(session.status, parsedStatus.statusPatch, session.world.statusSchema)
        : session.status;
    const assistantMessage: NianNianRawMessage = {
        id: createNianNianId('nn_ai'),
        role: 'assistant',
        content: stripNianNianStatusBlock(aiOutput) || aiOutput,
        createdAt: now,
    };

    return {
        session: appendNianNianRawMessage({
            ...session,
            status,
            updatedAt: now,
        }, assistantMessage),
        parsedStatus,
    };
}
