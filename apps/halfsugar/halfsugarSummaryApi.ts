import {
    buildBackendHeaders,
    buildBackendUrl,
    readBackendPayload,
} from '../../utils/backendClient';
import { getSecondaryApiConfig } from '../../utils/runtimeConfig';
import type {
    FavoriteFood,
    GoalType,
    HealthSummary,
    HealthSummaryStats,
    SummaryPeriodType,
} from './types';

interface ApiHealthSummary {
    id: string;
    period_type: SummaryPeriodType;
    period_key: string;
    start_date: string;
    end_date: string;
    stats_json?: Partial<ApiHealthSummaryStats> | null;
    summary_text: string;
    char_id?: string | null;
    char_name?: string | null;
    created_at: number;
    updated_at: number;
}

interface ApiHealthSummaryStats {
    periodDays: number;
    recordedDays: number;
    avgCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    totalFiber: number;
    weightStart?: number;
    weightEnd?: number;
    weightChange?: number;
    exerciseCount: number;
    exerciseCalories: number;
    topExercise?: string;
    avgSleepMinutes?: number;
    sleepRecordedDays: number;
    goalTargets?: Partial<Record<GoalType, number>>;
}

interface ApiFavoriteFood {
    id: string;
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number | null;
    portion?: string | null;
    use_count: number;
    created_at: number;
    updated_at: number;
}

interface LlmApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

async function parsePayload<T>(response: Response): Promise<T> {
    const { detail, payload } = await readBackendPayload(response);
    if (!response.ok) {
        throw new Error(detail || `请求失败 (${response.status})`);
    }
    return payload as T;
}

function sanitizeSummaryStats(stats: Partial<ApiHealthSummaryStats> | null | undefined): HealthSummaryStats {
    return {
        periodDays: Number(stats?.periodDays) || 0,
        recordedDays: Number(stats?.recordedDays) || 0,
        avgCalories: Number(stats?.avgCalories) || 0,
        totalProtein: Number(stats?.totalProtein) || 0,
        totalCarbs: Number(stats?.totalCarbs) || 0,
        totalFat: Number(stats?.totalFat) || 0,
        totalFiber: Number(stats?.totalFiber) || 0,
        weightStart: stats?.weightStart === undefined ? undefined : Number(stats.weightStart) || 0,
        weightEnd: stats?.weightEnd === undefined ? undefined : Number(stats.weightEnd) || 0,
        weightChange: stats?.weightChange === undefined ? undefined : Number(stats.weightChange) || 0,
        exerciseCount: Number(stats?.exerciseCount) || 0,
        exerciseCalories: Number(stats?.exerciseCalories) || 0,
        topExercise: typeof stats?.topExercise === 'string' && stats.topExercise.trim()
            ? stats.topExercise.trim()
            : undefined,
        avgSleepMinutes: stats?.avgSleepMinutes === undefined ? undefined : Number(stats.avgSleepMinutes) || 0,
        sleepRecordedDays: Number(stats?.sleepRecordedDays) || 0,
        goalTargets: stats?.goalTargets,
    };
}

function toHealthSummary(summary: ApiHealthSummary): HealthSummary {
    return {
        id: summary.id,
        periodType: summary.period_type,
        periodKey: summary.period_key,
        startDate: summary.start_date,
        endDate: summary.end_date,
        statsJson: sanitizeSummaryStats(summary.stats_json),
        summaryText: summary.summary_text,
        charId: summary.char_id || undefined,
        charName: summary.char_name || undefined,
        createdAt: Number(summary.created_at) || Date.now(),
        updatedAt: Number(summary.updated_at) || Number(summary.created_at) || Date.now(),
    };
}

function toFavoriteFood(food: ApiFavoriteFood): FavoriteFood {
    return {
        id: food.id,
        name: food.name,
        calories: Number(food.calories) || 0,
        protein: Number(food.protein) || 0,
        carbs: Number(food.carbs) || 0,
        fat: Number(food.fat) || 0,
        fiber: food.fiber === null || food.fiber === undefined ? undefined : Number(food.fiber) || 0,
        portion: typeof food.portion === 'string' && food.portion.trim() ? food.portion.trim() : undefined,
        useCount: Number(food.use_count) || 0,
        createdAt: Number(food.created_at) || Date.now(),
        updatedAt: Number(food.updated_at) || Number(food.created_at) || Date.now(),
    };
}

function toApiFavoriteFood(food: FavoriteFood): ApiFavoriteFood {
    return {
        id: food.id,
        name: food.name,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        fiber: food.fiber ?? null,
        portion: food.portion || null,
        use_count: food.useCount,
        created_at: food.createdAt,
        updated_at: food.updatedAt,
    };
}

function buildSummaryHeaders(apiConfig?: LlmApiConfig): Record<string, string> {
    const headers = buildBackendHeaders();
    const effectiveConfig = apiConfig || getSecondaryApiConfig();

    if (effectiveConfig?.apiKey && effectiveConfig.baseUrl && effectiveConfig.model) {
        headers['X-LLM-Key'] = effectiveConfig.apiKey;
        headers['X-LLM-Base-URL'] = effectiveConfig.baseUrl;
        headers['X-LLM-Model'] = effectiveConfig.model;
    }

    return headers;
}

export async function fetchSummaries(periodType?: SummaryPeriodType, limit?: number): Promise<HealthSummary[]> {
    const response = await fetch(buildBackendUrl('/api/health/summaries', {
        period_type: periodType,
        limit,
    }), {
        method: 'GET',
        headers: buildBackendHeaders({ contentType: false }),
    });

    const payload = await parsePayload<{ summaries?: ApiHealthSummary[] }>(response);
    return Array.isArray(payload?.summaries)
        ? payload.summaries.map(toHealthSummary)
        : [];
}

export async function fetchSummary(periodKey: string): Promise<HealthSummary | null> {
    const response = await fetch(buildBackendUrl(`/api/health/summaries/${encodeURIComponent(periodKey)}`), {
        method: 'GET',
        headers: buildBackendHeaders({ contentType: false }),
    });

    const payload = await parsePayload<{ summary?: ApiHealthSummary | null }>(response);
    return payload?.summary ? toHealthSummary(payload.summary) : null;
}

export async function generateSummary(opts: {
    periodType: SummaryPeriodType;
    periodKey?: string;
    charId?: string;
    charName?: string;
    apiConfig?: LlmApiConfig;
}): Promise<HealthSummary> {
    const response = await fetch(buildBackendUrl('/api/health/summaries/generate'), {
        method: 'POST',
        headers: buildSummaryHeaders(opts.apiConfig),
        body: JSON.stringify({
            periodType: opts.periodType,
            periodKey: opts.periodKey,
            charId: opts.charId,
            charName: opts.charName,
        }),
    });

    const payload = await parsePayload<{ summary?: ApiHealthSummary }>(response);
    if (!payload?.summary) {
        throw new Error('总结生成成功，但返回数据为空');
    }
    return toHealthSummary(payload.summary);
}

export async function deleteSummary(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/summaries/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}

export async function fetchFavorites(): Promise<FavoriteFood[]> {
    const response = await fetch(buildBackendUrl('/api/health/favorites'), {
        method: 'GET',
        headers: buildBackendHeaders({ contentType: false }),
    });

    const payload = await parsePayload<{ favorites?: ApiFavoriteFood[] }>(response);
    return Array.isArray(payload?.favorites)
        ? payload.favorites.map(toFavoriteFood)
        : [];
}

export async function saveFavorite(food: FavoriteFood): Promise<FavoriteFood> {
    const response = await fetch(buildBackendUrl('/api/health/favorites'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiFavoriteFood(food)),
    });

    const payload = await parsePayload<{ favorite?: ApiFavoriteFood }>(response);
    return payload?.favorite ? toFavoriteFood(payload.favorite) : food;
}

export async function deleteFavorite(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/favorites/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}

export async function incrementFavoriteUse(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/favorites/${encodeURIComponent(id)}/use`), {
        method: 'POST',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ favorite?: ApiFavoriteFood }>(response);
}
