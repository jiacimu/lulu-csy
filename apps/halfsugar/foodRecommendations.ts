import { type NutrientGap, type NutrientKey } from './types';

// ── Food Tag & Style System ──

type FoodTag = 'high_protein' | 'high_carbs' | 'high_fat' | 'high_fiber';
type FoodStyle = 'daily' | 'fitness' | 'snack' | 'soup' | 'dessert' | 'fast_food' | 'street_food';

interface FoodEntry {
    name: string;
    tags: FoodTag[];
    styles: FoodStyle[];
}

/** Public-facing food type returned to UI components */
export interface RecommendedFood {
    name: string;
}

// ── Food Database (~95 items, tagged by dominant nutrient & style) ──

const FOOD_DATABASE: FoodEntry[] = [
    // ── 蛋白质重点 ──
    // 日常家常
    { name: '鸡蛋', tags: ['high_protein'], styles: ['daily'] },
    { name: '牛奶', tags: ['high_protein'], styles: ['daily'] },
    { name: '酸奶', tags: ['high_protein'], styles: ['daily', 'snack'] },
    { name: '豆腐', tags: ['high_protein'], styles: ['daily'] },
    { name: '红烧肉', tags: ['high_protein', 'high_fat'], styles: ['daily'] },
    { name: '卤牛肉', tags: ['high_protein'], styles: ['daily'] },
    { name: '清蒸鱼', tags: ['high_protein'], styles: ['daily'] },
    { name: '红烧鱼', tags: ['high_protein'], styles: ['daily'] },
    { name: '鸡腿', tags: ['high_protein'], styles: ['daily'] },
    { name: '虾', tags: ['high_protein'], styles: ['daily'] },
    { name: '排骨', tags: ['high_protein', 'high_fat'], styles: ['daily'] },
    { name: '猪排', tags: ['high_protein'], styles: ['daily'] },
    { name: '鸭肉', tags: ['high_protein'], styles: ['daily'] },
    { name: '番茄炒蛋', tags: ['high_protein'], styles: ['daily'] },
    { name: '蒸蛋', tags: ['high_protein'], styles: ['daily'] },
    { name: '宫保鸡丁', tags: ['high_protein'], styles: ['daily'] },
    { name: '鱼香肉丝', tags: ['high_protein'], styles: ['daily'] },
    { name: '青椒肉丝', tags: ['high_protein'], styles: ['daily'] },
    // 减脂健身
    { name: '鸡胸肉', tags: ['high_protein'], styles: ['fitness'] },
    { name: '虾仁', tags: ['high_protein'], styles: ['fitness'] },
    { name: '牛肉干', tags: ['high_protein'], styles: ['fitness', 'snack'] },
    // 零食
    { name: '毛豆', tags: ['high_protein', 'high_fiber'], styles: ['snack'] },
    { name: '茶叶蛋', tags: ['high_protein'], styles: ['snack'] },
    { name: '豆干', tags: ['high_protein'], styles: ['snack'] },
    { name: '鱼丸', tags: ['high_protein'], styles: ['snack', 'street_food'] },
    // 快餐
    { name: '炸鸡腿', tags: ['high_protein', 'high_fat'], styles: ['fast_food'] },
    { name: '鸡块', tags: ['high_protein'], styles: ['fast_food'] },
    { name: '炸鸡翅', tags: ['high_protein', 'high_fat'], styles: ['fast_food'] },
    { name: '鸡肉卷', tags: ['high_protein'], styles: ['fast_food'] },
    // 汤
    { name: '排骨汤', tags: ['high_protein'], styles: ['soup'] },
    { name: '鸡汤', tags: ['high_protein'], styles: ['soup'] },

    // ── 碳水重点 ──
    // 日常家常
    { name: '白米饭', tags: ['high_carbs'], styles: ['daily'] },
    { name: '面条', tags: ['high_carbs'], styles: ['daily'] },
    { name: '馒头', tags: ['high_carbs'], styles: ['daily'] },
    { name: '包子', tags: ['high_carbs', 'high_protein'], styles: ['daily'] },
    { name: '饺子', tags: ['high_carbs', 'high_protein'], styles: ['daily'] },
    { name: '白粥', tags: ['high_carbs'], styles: ['daily'] },
    { name: '米粉', tags: ['high_carbs'], styles: ['daily'] },
    { name: '蛋炒饭', tags: ['high_carbs'], styles: ['daily'] },
    { name: '炒河粉', tags: ['high_carbs'], styles: ['daily'] },
    { name: '担担面', tags: ['high_carbs'], styles: ['daily'] },
    { name: '馄饨', tags: ['high_carbs'], styles: ['daily'] },
    { name: '土豆', tags: ['high_carbs', 'high_fiber'], styles: ['daily'] },
    { name: '红薯', tags: ['high_carbs', 'high_fiber'], styles: ['daily', 'snack'] },
    { name: '玉米', tags: ['high_carbs', 'high_fiber'], styles: ['daily', 'snack'] },
    { name: '南瓜', tags: ['high_carbs'], styles: ['daily'] },
    { name: '土豆丝', tags: ['high_carbs'], styles: ['daily'] },
    // 减脂健身
    { name: '糙米饭', tags: ['high_carbs', 'high_fiber'], styles: ['fitness'] },
    { name: '全麦面包', tags: ['high_carbs', 'high_fiber'], styles: ['fitness'] },
    { name: '燕麦', tags: ['high_carbs', 'high_fiber'], styles: ['fitness'] },
    // 零食
    { name: '烤红薯', tags: ['high_carbs', 'high_fiber'], styles: ['snack', 'street_food'] },
    { name: '年糕', tags: ['high_carbs'], styles: ['snack'] },
    { name: '面包', tags: ['high_carbs'], styles: ['snack'] },
    { name: '蛋糕', tags: ['high_carbs', 'high_fat'], styles: ['snack', 'dessert'] },
    // 快餐
    { name: '薯条', tags: ['high_carbs', 'high_fat'], styles: ['fast_food'] },
    { name: '汉堡', tags: ['high_carbs', 'high_protein'], styles: ['fast_food'] },
    // 汤粥
    { name: '小米粥', tags: ['high_carbs'], styles: ['soup'] },
    { name: '八宝粥', tags: ['high_carbs'], styles: ['soup'] },

    // ── 脂肪重点 ──
    { name: '花生', tags: ['high_fat', 'high_protein'], styles: ['snack'] },
    { name: '核桃', tags: ['high_fat'], styles: ['snack'] },
    { name: '腰果', tags: ['high_fat'], styles: ['snack'] },
    { name: '开心果', tags: ['high_fat'], styles: ['snack'] },
    { name: '瓜子', tags: ['high_fat'], styles: ['snack'] },
    { name: '芝麻酱', tags: ['high_fat', 'high_protein'], styles: ['daily'] },
    { name: '巧克力', tags: ['high_fat', 'high_carbs'], styles: ['snack', 'dessert'] },
    { name: '冰淇淋', tags: ['high_fat', 'high_carbs'], styles: ['dessert'] },
    { name: '蛋黄酥', tags: ['high_fat', 'high_carbs'], styles: ['snack', 'dessert'] },
    { name: '薯片', tags: ['high_fat', 'high_carbs'], styles: ['snack'] },
    { name: '牛油果', tags: ['high_fat', 'high_fiber'], styles: ['fitness'] },
    { name: '坚果混合', tags: ['high_fat', 'high_protein'], styles: ['snack', 'fitness'] },

    // ── 膳食纤维重点 ──
    { name: '苹果', tags: ['high_fiber'], styles: ['daily', 'snack'] },
    { name: '香蕉', tags: ['high_fiber', 'high_carbs'], styles: ['daily', 'snack'] },
    { name: '橙子', tags: ['high_fiber'], styles: ['snack'] },
    { name: '猕猴桃', tags: ['high_fiber'], styles: ['snack'] },
    { name: '木耳', tags: ['high_fiber'], styles: ['daily'] },
    { name: '芹菜', tags: ['high_fiber'], styles: ['daily'] },
    { name: '菠菜', tags: ['high_fiber'], styles: ['daily'] },
    { name: '西兰花', tags: ['high_fiber'], styles: ['daily', 'fitness'] },
    { name: '竹笋', tags: ['high_fiber'], styles: ['daily'] },
    { name: '海带', tags: ['high_fiber'], styles: ['daily'] },
    { name: '炒青菜', tags: ['high_fiber'], styles: ['daily'] },

    // ── 街头小吃 ──
    { name: '烤串', tags: ['high_protein', 'high_fat'], styles: ['street_food'] },
    { name: '煎饼果子', tags: ['high_carbs'], styles: ['street_food'] },
    { name: '关东煮', tags: ['high_protein'], styles: ['street_food'] },
    { name: '烤冷面', tags: ['high_carbs'], styles: ['street_food'] },
    { name: '肉夹馍', tags: ['high_carbs', 'high_protein'], styles: ['street_food'] },
    { name: '凉皮', tags: ['high_carbs'], styles: ['street_food'] },
    { name: '麻辣烫', tags: ['high_protein', 'high_fiber'], styles: ['street_food'] },

    // ── 甜品饮品 ──
    { name: '珍珠奶茶', tags: ['high_carbs'], styles: ['dessert'] },
    { name: '杨枝甘露', tags: ['high_carbs'], styles: ['dessert'] },
    { name: '双皮奶', tags: ['high_protein', 'high_carbs'], styles: ['dessert'] },
    { name: '芋圆', tags: ['high_carbs'], styles: ['dessert'] },
    { name: '豆浆', tags: ['high_protein'], styles: ['daily', 'dessert'] },
    { name: '绿豆汤', tags: ['high_carbs'], styles: ['soup', 'dessert'] },
    { name: '蛋挞', tags: ['high_fat', 'high_carbs'], styles: ['fast_food', 'dessert'] },

    // ── 汤品 ──
    { name: '紫菜蛋花汤', tags: ['high_protein'], styles: ['soup'] },
    { name: '番茄蛋汤', tags: ['high_protein'], styles: ['soup'] },
    { name: '酸辣汤', tags: ['high_protein'], styles: ['soup'] },

    // ── 快餐 / 特定 ──
    { name: 'KFC 全家桶', tags: ['high_protein', 'high_fat'], styles: ['fast_food'] },
    { name: '麦辣鸡腿堡', tags: ['high_protein', 'high_carbs'], styles: ['fast_food'] },
];

// ── Random Sampling (daily-seeded so recommendations feel fresh but stable within a day) ──

const TAG_MAP: Record<NutrientKey, FoodTag> = {
    protein: 'high_protein',
    carbs: 'high_carbs',
    fat: 'high_fat',
    fiber: 'high_fiber',
};

function dailySeed(): number {
    const today = new Date();
    return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
    if (arr.length <= 1) return [...arr];
    const shuffled = [...arr];
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const j = s % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function sampleFoods(
    nutrient: NutrientKey,
    count: number,
    preferredStyles: FoodStyle[] = ['daily', 'snack'],
): RecommendedFood[] {
    const tag = TAG_MAP[nutrient];
    // Preferred styles first
    const preferred = FOOD_DATABASE.filter(
        (f) => f.tags.includes(tag) && f.styles.some((s) => preferredStyles.includes(s)),
    );
    // Fallback: any style with the right tag
    const fallback = FOOD_DATABASE.filter(
        (f) => f.tags.includes(tag) && !preferred.includes(f),
    );

    const seed = dailySeed() + nutrient.length; // vary seed per nutrient
    const pool = [...seededShuffle(preferred, seed), ...seededShuffle(fallback, seed + 1)];

    return pool.slice(0, count).map((f) => ({ name: f.name }));
}

// ── Public API ──

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
            foods: sampleFoods(gap.nutrient, 4),
        }));
}

// ── Always-Positive Narrations (no judgment, only warmth) ──

const POSITIVE_NARRATIONS = [
    '有在好好吃饭，真好 ☀️',
    '认真生活的你，很棒 ✨',
    '今天也辛苦了，好好吃饭吧 💛',
    '会照顾自己的人最酷了 😎',
    '记录生活的你，好认真呀 📝',
    '吃饱了才有力气做喜欢的事 💪',
    '好好吃饭的人，运气不会太差 🍀',
    '今天也要开心哦 🌸',
    '每一口都是对自己的温柔 🌷',
    '好好吃饭就是好好爱自己 🥰',
    '认真吃饭的样子很可爱 ✿',
    '你值得所有好吃的 🌈',
];

export function getDailyNarration(): string {
    const seed = dailySeed();
    return POSITIVE_NARRATIONS[seed % POSITIVE_NARRATIONS.length];
}

// ── Themed Suggestions (day-of-week / seasonal) ──

export function getThemedSuggestion(): string | null {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const month = now.getMonth() + 1;

    if (day === 4) return '疯狂星期四，来份炸鸡 🍗';
    if (day === 5) return '周五了，奶茶犒劳一下自己 🧋';
    if (day === 6) return '周末快乐，吃点好的 🎉';
    if (day === 0) return '周日慢慢来，享受一顿好的 ☕';

    if (month >= 6 && month <= 8) return '天热了，来根冰棍降降温 🍦';
    if (month >= 11 || month <= 2) return '天冷了，来碗热汤暖暖 🍜';

    return null;
}
