/**
 * 念念浮生 — self-contained VN instance types.
 *
 * Creative content, prompt wording, world packets, balance values and art style
 * are intentionally left as TODO(人工) fields.
 */

export type NianNianStage = '初遇' | '拉扯' | '心意渐明' | '情动' | '厮守' | '别离';

export type NianNianStatusFieldType = 'number' | 'text';

export interface NianNianStatusField {
    key: string;
    label: string;
    type: NianNianStatusFieldType;
    min?: number;
    max?: number;
}

export interface NianNianWorldBible {
    theme: string;
    tone: string;
    charIdentity: string;
    protagonistIdentity: string;
    opening: string;
    statusSchema: NianNianStatusField[];
    eventWeights: Record<string, number>;
    customPrompt?: string;
}

export interface NianNianStatusState {
    ta: {
        好感: number;
        心情: string;
        神态: string;
        暧昧度: number;
        心声: string;
    };
    me: {
        身份: string;
        银两: number;
        体力: number;
        名声: number;
    };
    scene: {
        时辰: string;
        地点: string;
        情境: string;
    };
    npcsOnScene: Array<{ name: string; mood: string }>;
    worldExtra: Record<string, number | string>;
}

export interface NianNianFrozenSegment {
    idx: number;
    turnRange: [number, number];
    summary: string;
}

export interface NianNianDirectorState {
    turn: number;
    stage: NianNianStage;
    hiddenVars: Record<string, number>;
}

export type NianNianInputBeatKind = 'speech' | 'action';

export interface NianNianInputBeat {
    kind: NianNianInputBeatKind;
    text: string;
}

export interface NianNianChoiceOption {
    id: string;
    label: string;
    hint?: string;
    directorHint?: string;
}

export interface NianNianInteractionStep {
    id: string;
    sceneText: string;
    options: NianNianChoiceOption[];
    allowFreeInput: boolean;
    createdAt: number;
    source: 'director' | 'fallback' | 'manual';
}

export interface NianNianRawMessage {
    id: string;
    role: 'user' | 'assistant' | 'director' | 'system';
    content: string;
    createdAt: number;
    beats?: NianNianInputBeat[];
    choiceId?: string;
}

export interface NianNianSession {
    id: string;
    charId: string;
    charName: string;
    userName: string;
    world: NianNianWorldBible;
    status: NianNianStatusState;
    milestones: string[];
    segments: NianNianFrozenSegment[];
    rawBuffer: NianNianRawMessage[];
    director: NianNianDirectorState;
    currentStep: NianNianInteractionStep;
    ended: boolean;
    ending?: string;
    createdAt: number;
    updatedAt: number;
}

export type NianNianModelLane = 'main' | 'director';

export type NianNianModelPurpose = 'roleplay' | 'event_landing' | 'compression' | 'settlement';

export interface NianNianModelMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface NianNianModelRequest {
    lane: NianNianModelLane;
    purpose: NianNianModelPurpose;
    max_tokens: number;
    messages: NianNianModelMessage[];
    metadata: {
        sessionId: string;
        charId: string;
        turn: number;
        statusDelimiter: ['<<<STATUS>>>', '<<<END>>>'];
    };
}

export interface NianNianTurnPlan {
    userInput: string;
    mainRequest: NianNianModelRequest;
    directorRequest: NianNianModelRequest;
    compressionRequest?: NianNianModelRequest;
    fallbackStep: NianNianInteractionStep;
}

export interface NianNianParsedStatusBlock {
    statusPatch: Record<string, any>;
    raw: string;
}
