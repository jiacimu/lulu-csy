import { type MealType, type NutrientGap, type NutrientKey } from './types';

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

// ── Meal-Type Style Preferences ──
// Each meal type prioritizes different food styles for more relevant recommendations.

const MEAL_STYLE_PREFERENCES: Record<MealType, FoodStyle[]> = {
    breakfast: ['daily', 'snack'],          // 蛋、粥、面包、牛奶
    lunch: ['daily', 'fast_food'],          // 正餐、炒菜、快餐
    dinner: ['daily', 'soup'],              // 家常、清淡、汤品
    snack: ['snack', 'dessert', 'street_food'],  // 零食、甜品、小吃
    afternoon_tea: ['dessert', 'snack'],    // 甜品、饮品
};

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

/** Simple hash for a string, used to mix mealType into the seed */
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
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
    mealType?: MealType,
): RecommendedFood[] {
    const tag = TAG_MAP[nutrient];
    const preferredStyles = mealType
        ? MEAL_STYLE_PREFERENCES[mealType] || ['daily', 'snack']
        : ['daily', 'snack'];

    // Preferred styles first
    const preferred = FOOD_DATABASE.filter(
        (f) => f.tags.includes(tag) && f.styles.some((s) => preferredStyles.includes(s)),
    );
    // Fallback: any style with the right tag
    const fallback = FOOD_DATABASE.filter(
        (f) => f.tags.includes(tag) && !preferred.includes(f),
    );

    // Mix mealType into the seed so different meals get different results
    const mealSeedOffset = mealType ? simpleHash(mealType) : 0;
    const seed = dailySeed() + nutrient.length + mealSeedOffset;
    const pool = [...seededShuffle(preferred, seed), ...seededShuffle(fallback, seed + 1)];

    return pool.slice(0, count).map((f) => ({ name: f.name }));
}

// ── Public API ──

export function getRecommendations(gaps: NutrientGap[], mealType?: MealType): Array<{
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
            foods: sampleFoods(gap.nutrient, 4, mealType),
        }));
}

// ── Always-Positive Narrations (internet-savvy, meme-friendly) ──

const POSITIVE_NARRATIONS = [
    '干饭人干饭魂，干饭都是人上人 🍚',
    '今天也是为了吃饭而努力的一天 💪',
    '认真记录的你，比想象中更酷 😎',
    '食物面前没有体面，只有快乐 🤤',
    '人生苦短，再来一碗 🍜',
    '打工人的快乐就是吃 ☀️',
    '有在好好吃饭，给你比心 🫰',
    '你不吃饱，哪有力气搞事业 💼',
    '好好吃饭的人运气不会差 🍀',
    '今天也辛苦啦，你值得所有好吃的 🌈',
    '吃饱了才有力气摆烂嘛 🛋️',
    '认真干饭的样子很可爱 ✿',
    '谁还不是个宝宝了，想吃就吃 🍰',
    '你的胃在说谢谢 💛',
    '卡路里是什么？不认识 🙈',
    '这顿吃得很有格局 👏',
    '每一口都是对自己的投资 📈',
    '好好吃饭就是最大的自律 ✨',
];

export function getDailyNarration(): string {
    const seed = dailySeed();
    return POSITIVE_NARRATIONS[seed % POSITIVE_NARRATIONS.length];
}

// ── Themed Suggestions (day-of-week / holidays / seasonal / vibes) ──

/** Pick one from an array using the daily seed */
function pickDaily<T>(arr: T[], offset = 0): T {
    const s = dailySeed() + offset;
    return arr[((s * 1103515245 + 12345) & 0x7fffffff) % arr.length];
}

// Chinese lunar festival approximate dates (month-day, rough Gregorian mapping)
// These shift each year but we use 2025-2027 approximate windows
function getChineseFestival(month: number, date: number): string | null {
    // 春节 (late Jan / early Feb)
    if ((month === 1 && date >= 25) || (month === 2 && date <= 5)) return '过年好！饺子汤圆安排上 🧧';
    // 元宵节 (~Feb 12-15)
    if (month === 2 && date >= 10 && date <= 16) return '元宵节快乐，汤圆还是饺子？评论区打起来 🥟';
    // 清明 (~Apr 4-6)
    if (month === 4 && date >= 3 && date <= 6) return '清明时节，来个青团应个景 🍡';
    // 端午 (~Jun 1-15 range)
    if (month === 6 && date >= 1 && date <= 15) return '端午安康！甜粽咸粽，我全都要 🫡';
    // 七夕 (~Aug 1-15)
    if (month === 8 && date >= 1 && date <= 15) return '七夕快乐，没对象也要吃好的 🍫';
    // 中秋 (~Sep 10-20)
    if (month === 9 && date >= 10 && date <= 20) return '中秋快乐！五仁月饼退退退 🥮';
    // 重阳 (~Oct 10-15)
    if (month === 10 && date >= 10 && date <= 15) return '重阳节，来碗桂花糕敬自己 🌸';
    // 腊八 (~Jan 10-20)
    if (month === 1 && date >= 10 && date <= 20) return '腊八节，熬一碗腊八粥暖暖 🥣';
    // 冬至 (~Dec 21-23)
    if (month === 12 && date >= 20 && date <= 23) return '冬至了！北方饺子南方汤圆，你站哪队 🤔';
    return null;
}

const WEEKDAY_THEMES: Record<number, string[]> = {
    0: [ // 周日
        '周日 = 合法赖床 + 暴饮暴食日 🛌',
        '周末最后一天，brunch 走起 🥞',
        '今天拒绝内卷，只卷春饼 🫔',
        '周日限定：什么都不做也是一种努力 🧘',
    ],
    1: [ // 周一
        '周一综合症？得靠碳水治 🍝',
        '新的一周从吃饱开始，格局打开 📐',
        '周一能准时干饭的都是狠人 🫡',
        '我不是不想上班，我只是想吃饭 🥺',
    ],
    2: [ // 周二
        '周二了，离周末又近了一步，吃串庆祝 🍢',
        '摸鱼第二天，补充能量继续摸 🐟',
        '今天适合来点重口的，麻辣烫走起 🌶️',
    ],
    3: [ // 周三
        '周三，一周过半，下午茶安排上 ☕',
        '驼峰日，需要甜食续命 🍩',
        '熬过今天就是下坡路了，奶茶打气 🧋',
    ],
    4: [ // 周四
        'V 我 50 🫴 疯狂星期四谁请我吃 🍗',
        '疯四文学：今天不吃炸鸡，不配当打工人 🍟',
        '周四了，肯德基已经在向你招手 🐔',
        'KFC：你有一个未使用的星期四 📩',
    ],
    5: [ // 周五
        '周五！摸鱼成功，奶茶犒劳自己 🧋',
        '今天下班后的火锅，已经在脑子里点好了 🍲',
        '周五 = 合法提前进入周末模式 🎉',
        '摸鱼最后一天，吃好点对得起自己 🫰',
    ],
    6: [ // 周六
        '周六快乐！没有什么是一顿火锅解决不了的 🍲',
        '周末第一天，热量不存在的 🙈',
        '今天的我：放肆吃、不后悔 💅',
        '有一种快乐叫：周六 + 烤肉 🥩',
    ],
};

const SEASONAL_VIBES: Array<{ months: number[]; lines: string[] }> = [
    {
        months: [3, 4],
        lines: [
            '春天来了，万物可爱，你也可爱 🌱',
            '春日限定：草莓 + 樱花味的一切 🍓',
        ],
    },
    {
        months: [5, 6],
        lines: [
            '天热了，雪糕自由安排上 🍦',
            '夏天的快乐就是空调 + 西瓜 + 冰可乐 🍉',
        ],
    },
    {
        months: [7, 8],
        lines: [
            '三伏天，靠冷饮续命中 🧊',
            '这个温度出门就是铁板烧，在家吃凉面吧 🥶',
            '秋天的第一杯奶茶，不如夏天的第 N 杯 🧋',
        ],
    },
    {
        months: [9, 10],
        lines: [
            '秋天的第一杯奶茶，你喝了吗 🧋',
            '贴秋膘正式开始，不接受反驳 🫡',
            '入秋了，糖炒栗子的味道好近 🌰',
        ],
    },
    {
        months: [11, 12],
        lines: [
            '降温了，没有什么是一碗热汤解决不了的 🍜',
            '冬天的幸福 = 暖气 + 火锅 + 不上班 🔥',
            '天冷就要吃热的，这是写进 DNA 的 🧬',
        ],
    },
    {
        months: [1, 2],
        lines: [
            '冬天嘛，多吃点没关系的 ❄️',
            '窝在家里吃热汤，人生赢家 🏠',
        ],
    },
];

const PAYDAY_VIBES = [
    '发工资了！今天配吃好的 💰',
    '工资到账，火锅自由达成 🍲',
    '这个月的第一顿好的，敬自己 🥂',
];

const MONTH_END_VIBES = [
    '月底了，泡面也是一种生活态度 🍜',
    '钱包：我已经尽力了。你：没事还有外卖红包 📱',
    '月底穷到吃土？土也要加个蛋 🍳',
];

const DAILY_INSPIRATIONS = [
    '今天也许适合来碗热干面 🥢',
    '试试久违的街边烤串？🍢',
    '要不要来个煎饼果子？🥚',
    '今天感觉适合吃面 🍝',
    '突然想吃包子了怎么办 🥟',
    '今天的你值得一碗螺蛳粉 🐌',
    '不如来份麻辣烫，丰俭由人 🌶️',
    '生活建议：偶尔来杯豆浆 🥛',
    '今天有没有想吃甜的 🍮',
    '鸡蛋灌饼，永远的神 🫓',
];

export function getThemedSuggestion(): string | null {
    const now = new Date();
    const day = now.getDay();
    const month = now.getMonth() + 1;
    const date = now.getDate();

    // Priority 1: Chinese festivals
    const festival = getChineseFestival(month, date);
    if (festival) return festival;

    // Priority 2: Payday / month-end vibes
    if (date >= 1 && date <= 3) return pickDaily(PAYDAY_VIBES);
    if (date >= 28) return pickDaily(MONTH_END_VIBES);

    // Priority 3: Day-of-week memes
    const weekdayOptions = WEEKDAY_THEMES[day];
    if (weekdayOptions) {
        const weekdayPick = pickDaily(weekdayOptions, 1);
        // 50% chance to also append a seasonal vibe on weekdays
        const seasonal = SEASONAL_VIBES.find((s) => s.months.includes(month));
        if (seasonal && (dailySeed() % 3 === 0)) {
            return pickDaily(seasonal.lines, 2);
        }
        return weekdayPick;
    }

    // Priority 4: Seasonal fallback
    const seasonal = SEASONAL_VIBES.find((s) => s.months.includes(month));
    if (seasonal) return pickDaily(seasonal.lines, 3);

    // Priority 5: Random daily inspiration
    return pickDaily(DAILY_INSPIRATIONS, 4);
}
