import {
    buildBackendHeaders,
    buildBackendUrl,
    readBackendPayload,
} from '../../utils/backendClient';
import {
    type FoodItem,
    type MealRecord,
    type MealType,
} from './types';

interface ApiFoodItem {
    id: string;
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    portion?: string | null;
    source?: string | null;
    confidence?: 'high' | 'medium' | 'low' | null;
}

interface ApiMealRecord {
    id: string;
    date: string;
    meal_type: MealType;
    custom_label?: string | null;
    foods: ApiFoodItem[];
    total_calories: number;
    total_protein: number;
    total_carbs: number;
    total_fat: number;
    photo_url?: string | null;
    source?: string | null;
    created_at: number;
    updated_at: number;
}

function sanitizeFoodItems(input: unknown): FoodItem[] {
    if (!Array.isArray(input)) {
        return [];
    }

    return input.map((item, index) => {
        const candidate = item as Partial<ApiFoodItem> | null | undefined;
        return {
            id: typeof candidate?.id === 'string' && candidate.id ? candidate.id : `food-${index}`,
            name: typeof candidate?.name === 'string' ? candidate.name : '',
            calories: Number(candidate?.calories) || 0,
            protein: Number(candidate?.protein) || 0,
            carbs: Number(candidate?.carbs) || 0,
            fat: Number(candidate?.fat) || 0,
            fiber: Number(candidate?.fiber) || 0,
            portion: typeof candidate?.portion === 'string' && candidate.portion.trim()
                ? candidate.portion.trim()
                : undefined,
            source: typeof candidate?.source === 'string' && candidate.source.trim()
                ? candidate.source.trim() as FoodItem['source']
                : 'manual',
            confidence: candidate?.confidence === 'high' || candidate?.confidence === 'medium' || candidate?.confidence === 'low'
                ? candidate.confidence
                : undefined,
        };
    }).filter((item) => item.name.trim().length > 0);
}

function toInternalMealRecord(apiMeal: ApiMealRecord): MealRecord {
    return {
        id: apiMeal.id,
        date: apiMeal.date,
        type: apiMeal.meal_type,
        customLabel: apiMeal.custom_label || undefined,
        foods: sanitizeFoodItems(apiMeal.foods),
        photoUrl: apiMeal.photo_url || undefined,
        totalCalories: Number(apiMeal.total_calories) || 0,
        totalProtein: Number(apiMeal.total_protein) || 0,
        totalCarbs: Number(apiMeal.total_carbs) || 0,
        totalFat: Number(apiMeal.total_fat) || 0,
        source: apiMeal.source || 'manual',
        createdAt: Number(apiMeal.created_at) || Date.now(),
        updatedAt: Number(apiMeal.updated_at) || Number(apiMeal.created_at) || Date.now(),
    };
}

function toApiMealRecord(meal: MealRecord): ApiMealRecord {
    return {
        id: meal.id,
        date: meal.date,
        meal_type: meal.type,
        custom_label: meal.customLabel || null,
        foods: meal.foods,
        total_calories: meal.totalCalories,
        total_protein: meal.totalProtein,
        total_carbs: meal.totalCarbs,
        total_fat: meal.totalFat,
        photo_url: meal.photoUrl || null,
        source: meal.source || 'manual',
        created_at: meal.createdAt,
        updated_at: meal.updatedAt,
    };
}

async function parsePayload<T>(response: Response): Promise<T> {
    const { detail, payload } = await readBackendPayload(response);
    if (!response.ok) {
        throw new Error(detail || `请求失败 (${response.status})`);
    }
    return payload as T;
}

export async function fetchMeals(date: string): Promise<MealRecord[]> {
    const response = await fetch(
        buildBackendUrl('/api/health/meals', { date }),
        {
            method: 'GET',
            headers: buildBackendHeaders({ contentType: false }),
        },
    );

    const payload = await parsePayload<{ meals?: ApiMealRecord[] }>(response);
    return Array.isArray(payload?.meals)
        ? payload.meals.map(toInternalMealRecord)
        : [];
}

export async function saveMeal(meal: MealRecord): Promise<MealRecord> {
    const response = await fetch(buildBackendUrl('/api/health/meals'), {
        method: 'POST',
        headers: buildBackendHeaders(),
        body: JSON.stringify(toApiMealRecord(meal)),
    });

    const payload = await parsePayload<{ meal?: ApiMealRecord }>(response);
    return payload?.meal ? toInternalMealRecord(payload.meal) : meal;
}

export async function deleteMeal(id: string): Promise<void> {
    const response = await fetch(buildBackendUrl(`/api/health/meals/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: buildBackendHeaders({ contentType: false }),
    });

    await parsePayload<{ deleted: boolean; id: string }>(response);
}
