import { afterEach,describe,expect,it,vi } from 'vitest';

import {
  buildDaySnapshotSummaryForPrompt,
  formatCurrentWeatherForPrompt,
  getLocalDateInfo,
  getWeatherCacheStateKey,
  loadCurrentWeather,
  sanitizeDaySnapshot,
  sanitizePlaceSeed,
} from '../../csyos-workers/src/services/charLifeSnapshot';
import { buildFragmentPrompt } from '../../csyos-workers/src/services/lifeStreamService';

class FakeD1Database {
    private readonly state = new Map<string, string>();

    prepare(sql: string) {
        const db = this;
        return {
            params: [] as unknown[],
            bind(...params: unknown[]) {
                this.params = params;
                return this;
            },
            async first<T>() {
                if (sql.startsWith('SELECT value FROM agent_state')) {
                    const [userId, key] = this.params as [string, string];
                    const value = db.state.get(`${userId}:${key}`);
                    return value ? ({ value } as T) : null;
                }
                return null;
            },
            async run() {
                if (sql.includes('INSERT INTO agent_state')) {
                    const [userId, key, value] = this.params as [string, string, string];
                    db.state.set(`${userId}:${key}`, value);
                    return { success: true };
                }
                throw new Error(`Unsupported SQL in FakeD1Database: ${sql}`);
            },
        };
    }

    readState(userId: string, key: string): Record<string, unknown> | null {
        const raw = this.state.get(`${userId}:${key}`);
        return raw ? JSON.parse(raw) as Record<string, unknown> : null;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('charLifeSnapshot helpers', () => {
    it('normalizes branded POI-like seeds into soft place categories', () => {
        expect(sanitizePlaceSeed('星巴克臻选门店')).toBe('常去咖啡店');
        expect(sanitizePlaceSeed('7-11 便利店')).toBe('便利店');
        expect(sanitizePlaceSeed('静安寺 889 广场')).toBeUndefined();
    });

    it('keeps day snapshot nodes within 3-6 entries and only uses soft place seeds', () => {
        const snapshot = sanitizeDaySnapshot(
            {
                dayTone: '今天会慢一点。',
                baseRhythm: '上午散，傍晚再收回来。',
                planNodes: [
                    {
                        timeHint: '上午',
                        place: '星巴克臻选门店',
                        mode: 'loose',
                        plan: '进去躲一会儿雨。',
                        whyNatural: '他本来就容易被天气推着拐进这种地方。',
                    },
                ],
                aftertasteSeed: '夜里会有一点回潮。',
            },
            {
                homeCity: '上海',
                timezone: 'Asia/Shanghai',
                confidence: 0.91,
                lifestyleSketch: '平时会在住处、工作地点和散步路线之间来回。',
                placeSeeds: ['住处', '工作地点', '散步路线'],
                generatedAt: Date.now(),
            },
            getLocalDateInfo('Asia/Shanghai', Date.UTC(2026, 3, 6, 2, 0, 0)),
        );

        expect(snapshot.planNodes.length).toBeGreaterThanOrEqual(3);
        expect(snapshot.planNodes.length).toBeLessThanOrEqual(6);
        expect(snapshot.planNodes.every(node => ['住处', '工作地点', '散步路线'].includes(node.place))).toBe(true);
    });

    it('queries current weather by char homeCity and records weather_unavailable fallback', async () => {
        const db = new FakeD1Database();
        const userId = 'user-1';
        const charId = 'char-1';
        const localDateInfo = getLocalDateInfo('Asia/Tokyo', Date.UTC(2026, 3, 6, 3, 0, 0));

        let requestedUrl = '';
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            requestedUrl = String(input);
            return new Response(JSON.stringify({
                code: '200',
                now: {
                    temp: '12',
                    feelsLike: '10',
                    text: '小雨',
                    humidity: '91',
                    windSpeed: '15',
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }));

        const weather = await loadCurrentWeather(
            db as unknown as D1Database,
            userId,
            charId,
            { weatherEnabled: true, weatherProvider: 'qweather' },
            {
                homeCity: 'Tokyo',
                timezone: 'Asia/Tokyo',
                confidence: 0.88,
                lifestyleSketch: '平时会在住处和工作地点之间移动。',
                placeSeeds: ['住处', '工作地点'],
                generatedAt: Date.now(),
            },
            localDateInfo,
            'test-qweather-key',
        );

        expect(requestedUrl).toContain('devapi.qweather.com');
        expect(requestedUrl).toContain('location=Tokyo');
        expect(weather?.city).toBe('Tokyo');
        expect(weather?.description).toBe('小雨');
        expect(weather?.provider).toBe('qweather');

        vi.stubGlobal('fetch', vi.fn());

        const missingConfigResult = await loadCurrentWeather(
            db as unknown as D1Database,
            userId,
            'char-2',
            { weatherEnabled: true, weatherProvider: 'qweather' },
            {
                homeCity: 'Kyoto',
                timezone: 'Asia/Tokyo',
                confidence: 0.41,
                lifestyleSketch: '平时在住处附近活动。',
                placeSeeds: ['住处'],
                generatedAt: Date.now(),
            },
            localDateInfo,
            '',
        );

        expect(missingConfigResult).toBeNull();

        const cacheKey = getWeatherCacheStateKey('char-2', `current_${localDateInfo.localDate}_${String(localDateInfo.hour).padStart(2, '0')}`);
        expect(db.readState(userId, cacheKey)).toMatchObject({
            unavailable: true,
            reason: 'weather_config_missing',
        });
    });

    it('produces different weather nudges and keeps life stream prompt in drift mode instead of weather-report mode', () => {
        const rainWeather = formatCurrentWeatherForPrompt({
            city: 'Tokyo',
            description: '小雨',
            temp: 12,
            feelsLike: 10,
            humidity: 90,
            windSpeed: 4,
            dominantCondition: '雨',
            provider: 'qweather',
            observedAt: Date.now(),
        });
        const coldWeather = formatCurrentWeatherForPrompt({
            city: 'Tokyo',
            description: '晴',
            temp: 5,
            feelsLike: 2,
            humidity: 42,
            windSpeed: 2,
            dominantCondition: '晴',
            provider: 'qweather',
            observedAt: Date.now(),
        });
        const sunnyWeather = formatCurrentWeatherForPrompt({
            city: 'Tokyo',
            description: '晴',
            temp: 22,
            feelsLike: 22,
            humidity: 41,
            windSpeed: 1,
            dominantCondition: '晴',
            provider: 'qweather',
            observedAt: Date.now(),
        });

        expect(rainWeather).toContain('往室内');
        expect(coldWeather).toContain('动作收紧');
        expect(sunnyWeather).toContain('loose 节点轻微偏掉');

        const snapshotSummary = buildDaySnapshotSummaryForPrompt({
            localDate: '2026-04-06',
            timezone: 'Asia/Tokyo',
            weekday: '星期一',
            isWorkday: true,
            dayTone: '今天整体会慢一点。',
            baseRhythm: '先顺着惯性，后面再松。',
            planNodes: [
                {
                    timeHint: '下午',
                    place: '散步路线',
                    mode: 'loose',
                    plan: '原本想沿着散步路线晃一圈再回去。',
                    whyNatural: '这是他最容易被天气和心情一起改动的节点。',
                },
                {
                    timeHint: '晚上',
                    place: '住处',
                    mode: 'stable',
                    plan: '最后还是会回住处把节奏收回来。',
                    whyNatural: '住处是他自然会落回去的地方。',
                },
            ],
            aftertasteSeed: '夜里会留一点潮气似的余韵。',
            generatedAt: Date.now(),
        });

        const prompt = buildFragmentPrompt({
            context: {
                charId: 'char-1',
                charName: 'K',
                charSystemPrompt: '他习惯把情绪压在很细小的动作里。',
                charPersonality: '寡言，留白多，日常感强。',
                worldview: '住在常下雨的城市。',
                mountedWorldbooksDigest: '工作和散步都绕不开河边。',
                coreMemoryDigest: '[2026-03] 他常在雨天临时改变路线。',
                cityOverride: 'Tokyo',
                moodState: null,
                updatedAt: Date.now(),
            },
            timeLabel: '下午',
            timeStr: '星期一 15:20',
            existingFragments: ['我本来已经走到拐角，后来又停了一下。'],
            snapshotSummary,
            weatherSummary: rainWeather,
        });

        expect(prompt.userPrompt).toContain('loose 节点轻微偏掉');
        expect(prompt.userPrompt).toContain('不要把输出写成天气播报');
        expect(prompt.userPrompt).toContain('今日原定生活快照');
    });
});
