import { type NutrientGap, type NutrientKey } from './types';

interface RecommendedFood {
    name: string;
    per100g: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        fiber: number;
    };
}

export const RECOMMENDATIONS: Record<NutrientKey, RecommendedFood[]> = {
    protein: [
        { name: '鸡胸肉', per100g: { calories: 133, protein: 31, carbs: 0, fat: 1.2, fiber: 0 } },
        { name: '鸡蛋', per100g: { calories: 144, protein: 13, carbs: 1.5, fat: 10, fiber: 0 } },
        { name: '豆腐', per100g: { calories: 73, protein: 8, carbs: 1.5, fat: 4, fiber: 0.3 } },
        { name: '牛奶', per100g: { calories: 54, protein: 3, carbs: 5, fat: 2, fiber: 0 } },
        { name: '虾仁', per100g: { calories: 87, protein: 18, carbs: 0, fat: 1, fiber: 0 } },
    ],
    carbs: [
        { name: '糙米饭', per100g: { calories: 111, protein: 2.5, carbs: 23, fat: 0.8, fiber: 1.8 } },
        { name: '全麦面包', per100g: { calories: 247, protein: 10, carbs: 41, fat: 3, fiber: 7 } },
        { name: '红薯', per100g: { calories: 86, protein: 1.6, carbs: 20, fat: 0.1, fiber: 3 } },
        { name: '燕麦', per100g: { calories: 389, protein: 17, carbs: 66, fat: 7, fiber: 11 } },
    ],
    fat: [
        { name: '牛油果', per100g: { calories: 160, protein: 2, carbs: 9, fat: 15, fiber: 7 } },
        { name: '坚果混合', per100g: { calories: 607, protein: 20, carbs: 21, fat: 52, fiber: 7 } },
        { name: '橄榄油', per100g: { calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    ],
    fiber: [
        { name: '西兰花', per100g: { calories: 34, protein: 3, carbs: 7, fat: 0.4, fiber: 2.6 } },
        { name: '菠菜', per100g: { calories: 23, protein: 3, carbs: 3.6, fat: 0.4, fiber: 2.2 } },
        { name: '苹果', per100g: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4 } },
    ],
};


export function getRecommendations(gaps: NutrientGap[]): Array<{
    nutrient: NutrientKey;
    label: string;
    gap: number;
    foods: RecommendedFood[];
}> {
    return gaps
        .filter((gap) => gap.gapPercent > 30)
        .sort((left, right) => right.gapPercent - left.gapPercent)
        .map((gap) => ({
            nutrient: gap.nutrient,
            label: gap.label,
            gap: gap.gap,
            foods: RECOMMENDATIONS[gap.nutrient] || [],
        }));
}
