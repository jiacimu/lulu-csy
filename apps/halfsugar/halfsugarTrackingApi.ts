import {
    buildBackendHeaders,
    buildBackendUrl,
    readBackendPayload,
} from '../../utils/backendClient';
import type {
    ExerciseRecord,
    GoalType,
    HealthGoal,
    SleepQuality,
    SleepRecord,
    WeightRecord,
    WeightTimeOfDay,
} from './types';

interface ApiWeightRecord {
    id: string;
    date: string;
    time_of_day: WeightTimeOfDay;
    weight: number;
    created_at: number;
    updated_at: number;
}

interface ApiSleepRecord {
    id: string;
    date: string;
    sleep_time: string;
    wake_time: string;
    duration_minutes: number;
    quality?: SleepQuality | null;
    created_at: number;
    updated_at: number;
}

interface ApiExerciseRecord {
    id: string;
    date: string;
    exercise_type: string;
    exercise_label?: string | null;
    duration_minutes: number;
    met_value: number;
    calories_burned: number;
    created_at: number;
    updated_at: number;
}

interface ApiHealthGoal {
    id: string;
    goal_type: GoalType;
    target_value: number;
    created_at: number;
    updated_at: number;
}

async function parsePayload<T>(response: Response): Promise<T> {
    const { detail, payload } = await readBackendPayload(response);
    if (!response.ok) {
        throw new Error(detail || `请求失败 (${response.status})`);
    }
    return payload as T;
}

function toWeightRecord(record: ApiWeightRecord): WeightRecord {
    return {
        id: record.id,
        date: record.date,
        timeOfDay: record.time_of_day,
        weight: Number(record.weight) || 0,
        createdAt: Number(record.created_at) || Date.now(),
        updatedAt: Number(record.updated_at) || Number(record.created_at) || Date.now(),
    };
}

function toApiWeightRecord(record: WeightRecord): ApiWeightRecord {
    return {
        id: record.id,
        date: record.date,
        time_of_day: record.timeOfDay,
        weight: record.weight,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
    };
}

function toSleepRecord(record: ApiSleepRecord): SleepRecord {
    return {
        id: record.id,
        date: record.date,
        sleepTime: record.sleep_time,
        wakeTime: record.wake_time,
        durationMinutes: Number(record.duration_minutes) || 0,
        quality: record.quality || undefined,
        createdAt: Number(record.created_at) || Date.now(),
        updatedAt: Number(record.updated_at) || Number(record.created_at) || Date.now(),
    };
}

function toApiSleepRecord(record: SleepRecord): ApiSleepRecord {
    return {
        id: record.id,
        date: record.date,
        sleep_time: record.sleepTime,
        wake_time: record.wakeTime,
        duration_minutes: record.durationMinutes,
        quality: record.quality || null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
    };
}

function toExerciseRecord(record: ApiExerciseRecord): ExerciseRecord {
    return {
        id: record.id,
        date: record.date,
        exerciseType: record.exercise_type,
        exerciseLabel: record.exercise_label || record.exercise_type,
        durationMinutes: Number(record.duration_minutes) || 0,
        metValue: Number(record.met_value) || 0,
        caloriesBurned: Number(record.calories_burned) || 0,
        createdAt: Number(record.created_at) || Date.now(),
        updatedAt: Number(record.updated_at) || Number(record.created_at) || Date.now(),
    };
}

function toApiExerciseRecord(record: ExerciseRecord): ApiExerciseRecord {
    return {
        id: record.id,
        date: record.date,
        exercise_type: record.exerciseType,
        exercise_label: record.exerciseLabel,
        duration_minutes: record.durationMinutes,
        met_value: record.metValue,
        calories_burned: record.caloriesBurned,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
    };
}

function toHealthGoal(goal: ApiHealthGoal): HealthGoal {
    return {
        id: goal.id,
        goalType: goal.goal_type,
        targetValue: Number(goal.target_value) || 0,
        createdAt: Number(goal.created_at) || Date.now(),
        updatedAt: Number(goal.updated_at) || Number(goal.created_at) || Date.now(),
    };
}

function toApiHealthGoal(goal: HealthGoal): ApiHealthGoal {
    return {
        id: goal.id,
        goal_type: goal.goalType,
        target_value: goal.targetValue,
        created_at: goal.createdAt,
        updated_at: goal.updatedAt,
    };
}

export async function fetchWeightRecords(start: string, end: string): Promise<WeightRecord[]> {
    const response = await fetch(
        buildBackendUrl('/api/health/weight', { start, end }),
        {
            method: 'GET',
            headers: buildBackendHeaders({ contentType: false }),
        },
    );

    const payload = await parsePayload<{ weights?: ApiWeightRecord[] }>(response);
    return Array.isArray(payload?.weights) ? payload.weights.map(toWeightRecord) : [];
}

export async function saveWeight(record: WeightRecord): Promise<WeightRecord> {
    const response = await fetch(buildBackendUrl('/api/health/weight'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiWeightRecord(record)),
    });

    const payload = await parsePayload<{ weight?: ApiWeightRecord }>(response);
    return payload?.weight ? toWeightRecord(payload.weight) : record;
}

export async function deleteWeight(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/weight/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}

export async function fetchSleep(date: string): Promise<SleepRecord | null> {
    const response = await fetch(
        buildBackendUrl('/api/health/sleep', { date }),
        {
            method: 'GET',
            headers: buildBackendHeaders({ contentType: false }),
        },
    );

    const payload = await parsePayload<{ sleep?: ApiSleepRecord | null }>(response);
    return payload?.sleep ? toSleepRecord(payload.sleep) : null;
}

export async function saveSleep(record: SleepRecord): Promise<SleepRecord> {
    const response = await fetch(buildBackendUrl('/api/health/sleep'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiSleepRecord(record)),
    });

    const payload = await parsePayload<{ sleep?: ApiSleepRecord }>(response);
    return payload?.sleep ? toSleepRecord(payload.sleep) : record;
}

export async function deleteSleep(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/sleep/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}

export async function fetchExercises(date: string): Promise<ExerciseRecord[]> {
    const response = await fetch(
        buildBackendUrl('/api/health/exercise', { date }),
        {
            method: 'GET',
            headers: buildBackendHeaders({ contentType: false }),
        },
    );

    const payload = await parsePayload<{ exercises?: ApiExerciseRecord[] }>(response);
    return Array.isArray(payload?.exercises) ? payload.exercises.map(toExerciseRecord) : [];
}

export async function saveExercise(record: ExerciseRecord): Promise<ExerciseRecord> {
    const response = await fetch(buildBackendUrl('/api/health/exercise'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiExerciseRecord(record)),
    });

    const payload = await parsePayload<{ exercise?: ApiExerciseRecord }>(response);
    return payload?.exercise ? toExerciseRecord(payload.exercise) : record;
}

export async function deleteExercise(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/exercise/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}

export async function fetchGoals(): Promise<HealthGoal[]> {
    const response = await fetch(buildBackendUrl('/api/health/goals'), {
        method: 'GET',
        headers: buildBackendHeaders({ contentType: false }),
    });

    const payload = await parsePayload<{ goals?: ApiHealthGoal[] }>(response);
    return Array.isArray(payload?.goals) ? payload.goals.map(toHealthGoal) : [];
}

export async function saveGoal(goal: HealthGoal): Promise<HealthGoal> {
    const response = await fetch(buildBackendUrl('/api/health/goals'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiHealthGoal(goal)),
    });

    const payload = await parsePayload<{ goal?: ApiHealthGoal }>(response);
    return payload?.goal ? toHealthGoal(payload.goal) : goal;
}

export async function deleteGoal(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/goals/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}
