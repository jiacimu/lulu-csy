import type { UserProfile } from '../../types';

/**
 * The Half Sugar module extends UserProfile with health-related fields
 * that are persisted at runtime via updateUserProfile.
 */
export interface HealthAwareUserProfile extends UserProfile {
    healthGender?: 'male' | 'female';
    healthHeight?: number;
    healthWeight?: number;
    healthBirthYear?: number;
    healthSetupDone?: boolean;
    healthShareBodyInfo?: boolean;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'afternoon_tea';
export type FoodSource = 'manual' | 'ai_vision';
export type FoodConfidence = 'high' | 'medium' | 'low';
export type NutrientKey = 'protein' | 'carbs' | 'fat' | 'fiber';
export type WeightTimeOfDay = 'morning' | 'evening';
export type SleepQuality = 'good' | 'fair' | 'poor';
export type GoalType =
    | 'weight_target'
    | 'daily_calories'
    | 'daily_protein'
    | 'daily_carbs'
    | 'daily_fat'
    | 'daily_fiber';

export interface FoodItem {
    id: string;
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    portion?: string;
    source?: FoodSource;
    confidence?: FoodConfidence;
}

export interface MealRecord {
    id: string;
    date: string;
    type: MealType;
    customLabel?: string;
    foods: FoodItem[];
    photoUrl?: string;
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    source: string;
    createdAt: number;
    updatedAt: number;
}

export interface WeightRecord {
    id: string;
    date: string;
    timeOfDay: WeightTimeOfDay;
    weight: number;
    createdAt: number;
    updatedAt: number;
}

export interface SleepRecord {
    id: string;
    date: string;
    sleepTime: string;
    wakeTime: string;
    durationMinutes: number;
    quality?: SleepQuality;
    createdAt: number;
    updatedAt: number;
}

export interface ExerciseRecord {
    id: string;
    date: string;
    exerciseType: string;
    exerciseLabel: string;
    durationMinutes: number;
    metValue: number;
    caloriesBurned: number;
    createdAt: number;
    updatedAt: number;
}

export interface HealthGoal {
    id: string;
    goalType: GoalType;
    targetValue: number;
    createdAt: number;
    updatedAt: number;
}

export type SummaryPeriodType = 'weekly' | 'monthly';

export interface HealthSummary {
    id: string;
    periodType: SummaryPeriodType;
    periodKey: string;
    startDate: string;
    endDate: string;
    statsJson: HealthSummaryStats;
    summaryText: string;
    charId?: string;
    charName?: string;
    createdAt: number;
    updatedAt: number;
}

export interface HealthSummaryStats {
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

export interface FavoriteFood {
    id: string;
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    portion?: string;
    useCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface HealthProfile {
    gender: 'male' | 'female' | '';
    height: string;
    weight: string;
    birthYear: string;
    isSetup: boolean;
}

export interface MealTypeDefinition {
    key: MealType;
    label: string;
    icon: string;
    bg: string;
    color: string;
}

export interface DailyNutrientTargets {
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
}

export interface NutrientGap {
    nutrient: NutrientKey;
    label: string;
    current: number;
    target: number;
    gap: number;
    gapPercent: number;
}

export const MEAL_TYPES: MealTypeDefinition[] = [
    { key: 'breakfast', label: '早餐', icon: '早', bg: 'var(--hs-clay-bg)', color: 'var(--hs-clay)' },
    { key: 'lunch', label: '午餐', icon: '午', bg: 'var(--hs-sage-bg)', color: 'var(--hs-sage)' },
    { key: 'dinner', label: '晚餐', icon: '晚', bg: 'var(--hs-dusk-bg)', color: 'var(--hs-dusk)' },
    { key: 'snack', label: '零食', icon: '零', bg: 'var(--hs-rose-bg)', color: 'var(--hs-rose)' },
    { key: 'afternoon_tea', label: '下午茶', icon: '茶', bg: 'var(--hs-ocean-bg)', color: 'var(--hs-ocean)' },
];

export const DEFAULT_NUTRIENT_TARGETS: DailyNutrientTargets = {
    protein: 60,
    carbs: 250,
    fat: 65,
    fiber: 25,
};

/** SVG icon paths for monochrome exercise icons (Heroicons outline style) */
const ICON = {
    walk: 'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z',
    run: 'M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.047 8.287 8.287 0 009 9.601a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z',
    cycle: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    swim: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12',
    yoga: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75',
    dance: 'M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303',
    jump: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    ball: 'M12 2.25c5.385 0 9.75 4.365 9.75 9.75s-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12 6.615 2.25 12 2.25z',
    racket: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z',
    hike: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
    strength: 'M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0L21.75 16.5 12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3',
    stretch: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    pilates: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47',
    elliptical: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3',
    stairs: 'M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15',
    skate: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    hula: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    custom: 'M12 4.5v15m7.5-7.5h-15',
};

export const MET_TABLE: Record<string, { label: string; met: number; icon: string }> = {
    // Female-priority ordering
    walking_slow: { label: '散步', met: 2.0, icon: ICON.walk },
    walking_fast: { label: '快走', met: 3.5, icon: ICON.walk },
    yoga: { label: '瑜伽', met: 2.5, icon: ICON.yoga },
    pilates: { label: '普拉提', met: 3.0, icon: ICON.pilates },
    dancing: { label: '跳舞', met: 5.0, icon: ICON.dance },
    stretching: { label: '拉伸', met: 2.3, icon: ICON.stretch },
    jogging: { label: '慢跑', met: 7.0, icon: ICON.run },
    running: { label: '跑步', met: 9.8, icon: ICON.run },
    swimming: { label: '游泳', met: 8.0, icon: ICON.swim },
    cycling_casual: { label: '骑行', met: 4.0, icon: ICON.cycle },
    cycling_fast: { label: '快骑', met: 8.0, icon: ICON.cycle },
    hula_hoop: { label: '呼啦圈', met: 6.0, icon: ICON.hula },
    jump_rope: { label: '跳绳', met: 12.3, icon: ICON.jump },
    elliptical: { label: '椭圆机', met: 5.0, icon: ICON.elliptical },
    stair_climber: { label: '爬楼梯', met: 4.0, icon: ICON.stairs },
    roller_skating: { label: '轮滑', met: 7.0, icon: ICON.skate },
    strength: { label: '力量训练', met: 6.0, icon: ICON.strength },
    badminton: { label: '羽毛球', met: 5.5, icon: ICON.racket },
    hiking: { label: '徒步', met: 6.0, icon: ICON.hike },
    basketball: { label: '篮球', met: 6.5, icon: ICON.ball },
    custom: { label: '自定义', met: 4.0, icon: ICON.custom },
};

const MEAL_TYPE_MAP = new Map(MEAL_TYPES.map((item) => [item.key, item]));
const NUTRIENT_LABELS: Record<NutrientKey, string> = {
    protein: '蛋白质',
    carbs: '碳水',
    fat: '脂肪',
    fiber: '膳食纤维',
};

export function getMealTypeDefinition(type: string): MealTypeDefinition {
    return MEAL_TYPE_MAP.get(type as MealType) || {
        key: 'snack',
        label: '餐食',
        icon: '餐',
        bg: 'var(--hs-glass)',
        color: 'var(--hs-text-secondary)',
    };
}

export function buildHealthProfileFromUserProfile(userProfile: HealthAwareUserProfile): HealthProfile {
    return {
        gender: userProfile.healthGender || '',
        height: userProfile.healthHeight?.toString() || '',
        weight: userProfile.healthWeight?.toString() || '',
        birthYear: userProfile.healthBirthYear?.toString() || '',
        isSetup: Boolean(userProfile.healthSetupDone),
    };
}

export function formatLocalDateKey(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getCurrentISOWeekKey(date = new Date()): string {
    const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = normalized.getUTCDay() || 7;
    normalized.setUTCDate(normalized.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${normalized.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Convert an ISO week key like "2026-W16" to a date range string like "4/13 – 4/19".
 * Falls back to the original key if parsing fails.
 */
export function formatWeekKeyAsRange(weekKey: string): string {
    const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return weekKey;
    const year = Number(match[1]);
    const week = Number(match[2]);
    // ISO week 1 contains the year's first Thursday.
    // Jan 4 is always in ISO week 1.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
    // Monday of ISO week 1
    const week1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
    // Monday of the target week
    const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    return `${fmt(monday)} – ${fmt(sunday)}`;
}

/** Get the current week's date range string, e.g. "4/13 – 4/19" */
export function getCurrentWeekRange(date = new Date()): string {
    return formatWeekKeyAsRange(getCurrentISOWeekKey(date));
}

export function getCurrentMonthKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function computeBmr(userProfile: HealthAwareUserProfile, now = new Date()): number | null {
    const height = userProfile.healthHeight;
    const weight = userProfile.healthWeight;
    const birthYear = userProfile.healthBirthYear;
    if (!height || !weight) {
        return null;
    }

    const age = birthYear ? Math.max(0, now.getFullYear() - birthYear) : 25;
    return userProfile.healthGender === 'female'
        ? 10 * weight + 6.25 * height - 5 * age - 161
        : 10 * weight + 6.25 * height - 5 * age + 5;
}

export function computeCalorieTarget(userProfile: HealthAwareUserProfile, now = new Date()): number {
    const bmr = computeBmr(userProfile, now);
    if (!bmr) {
        return 2000;
    }
    return Math.round(bmr * 1.4);
}

export function computeDailyCalorieGoal(userProfile: HealthAwareUserProfile, targetWeightKg?: number, now = new Date()): number {
    const bmr = computeBmr(userProfile, now);
    if (!bmr) {
        return 2000;
    }

    const currentWeight = userProfile.healthWeight;
    const multiplier = targetWeightKg && currentWeight && targetWeightKg < currentWeight ? 1.2 : 1.4;
    return Math.round(bmr * multiplier);
}

export function sortMealsByCreatedAtDesc(meals: MealRecord[]): MealRecord[] {
    return [...meals].sort((left, right) => {
        if (right.createdAt !== left.createdAt) {
            return right.createdAt - left.createdAt;
        }
        return right.updatedAt - left.updatedAt;
    });
}

export function computeNutrientGaps(
    meals: MealRecord[],
    targets: DailyNutrientTargets,
): NutrientGap[] {
    return (Object.keys(NUTRIENT_LABELS) as NutrientKey[]).map((nutrient) => {
        const current = meals.reduce(
            (mealSum, meal) => mealSum + meal.foods.reduce(
                (foodSum, food) => foodSum + (Number(food[nutrient] ?? 0) || 0),
                0,
            ),
            0,
        );
        const target = Number(targets[nutrient]) || 0;
        const gap = Math.max(0, target - current);
        const gapPercent = target > 0 ? (gap / target) * 100 : 0;

        return {
            nutrient,
            label: NUTRIENT_LABELS[nutrient],
            current,
            target,
            gap,
            gapPercent,
        };
    });
}

export function estimateCaloriesBurned(met: number, weightKg: number, durationMinutes: number): number {
    return Math.round(met * weightKg * (durationMinutes / 60));
}

export function computeBMI(weightKg: number, heightCm: number): number {
    const heightM = heightCm / 100;
    return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

export function getBMICategory(bmi: number): string {
    if (bmi < 18.5) return '偏瘦';
    if (bmi < 24) return '正常';
    if (bmi < 28) return '偏重';
    return '肥胖';
}

export function computeSleepDurationMinutes(sleepTime: string, wakeTime: string): number {
    const [sleepHour, sleepMinute] = sleepTime.split(':').map((value) => Number(value) || 0);
    const [wakeHour, wakeMinute] = wakeTime.split(':').map((value) => Number(value) || 0);

    const sleepTotal = sleepHour * 60 + sleepMinute;
    let wakeTotal = wakeHour * 60 + wakeMinute;

    if (wakeTotal <= sleepTotal) {
        wakeTotal += 24 * 60;
    }

    return Math.max(0, wakeTotal - sleepTotal);
}

export function formatDurationMinutes(durationMinutes: number): string {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return `${hours}h${minutes}m`;
}

export function sortWeightRecordsByLatest(records: WeightRecord[]): WeightRecord[] {
    const timePriority: Record<WeightTimeOfDay, number> = {
        evening: 2,
        morning: 1,
    };

    return [...records].sort((left, right) => {
        if (right.date !== left.date) {
            return right.date.localeCompare(left.date);
        }
        if (timePriority[right.timeOfDay] !== timePriority[left.timeOfDay]) {
            return timePriority[right.timeOfDay] - timePriority[left.timeOfDay];
        }
        return right.updatedAt - left.updatedAt;
    });
}
