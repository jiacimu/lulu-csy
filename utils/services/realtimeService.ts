/**
 * 实时上下文管理器 - 让AI角色感知真实世界
 * Real-time Context Manager - Give AI characters awareness of the real world
 */

import { safeResponseJson } from '../safeApi';
import { buildBackendUrl } from '../backendClient';

export interface WeatherData {
    temp: number;
    feelsLike: number;
    humidity: number;
    description: string;
    icon: string;
    city: string;
}

export interface NewsItem {
    title: string;
    source?: string;
    url?: string;
}

export interface SearchResult {
    title: string;
    description: string;
    url: string;
}

export interface RealtimeConfig {
    // 天气配置
    weatherEnabled: boolean;
    weatherProvider?: 'openweathermap';
    weatherApiKey: string;  // OpenWeatherMap API Key
    weatherCity: string;    // 城市名 (如 "Beijing" 或 "Shanghai")

    // 新闻配置
    newsEnabled: boolean;
    newsApiKey?: string;    // 可选，用于更多新闻源

    // 热搜配置
    hotSearchEnabled?: boolean;

    // AI HOT 资讯配置
    aihotEnabled?: boolean;

    // Notion 配置
    notionEnabled: boolean;
    notionApiKey: string;   // Notion Integration Token
    notionDatabaseId: string; // 日记数据库ID
    notionNotesDatabaseId?: string; // 用户笔记数据库ID（可选）

    // 飞书配置
    feishuEnabled?: boolean;
    feishuAppId?: string;
    feishuAppSecret?: string;
    feishuBaseId?: string;
    feishuTableId?: string;

    // 小红书配置 (Bridge / MCP)
    xhsEnabled?: boolean;
    xhsMcpConfig?: { enabled: boolean; serverUrl: string };

    // 缓存配置
    cacheMinutes: number;   // 缓存时长（分钟）
}

// 默认配置
export const defaultRealtimeConfig: RealtimeConfig = {
    weatherEnabled: false,
    weatherProvider: 'openweathermap',
    weatherApiKey: '',
    weatherCity: 'Beijing',
    newsEnabled: false,
    newsApiKey: '',
    hotSearchEnabled: false,
    aihotEnabled: false,
    notionEnabled: false,
    notionApiKey: '',
    notionDatabaseId: '',
    xhsEnabled: false,
    xhsMcpConfig: { enabled: false, serverUrl: 'http://localhost:18061/api' },
    cacheMinutes: 30
};

// 缓存
let weatherCache: { data: WeatherData | null; timestamp: number } = { data: null, timestamp: 0 };
let newsCache: { data: NewsItem[]; timestamp: number } = { data: [], timestamp: 0 };
let hotSearchCache: { data: any[]; timestamp: number } = { data: [], timestamp: 0 };
let aihotCache: { data: any[]; timestamp: number } = { data: [], timestamp: 0 };

// 特殊日期表
const SPECIAL_DATES: Record<string, string> = {
    '01-01': '元旦',
    '02-14': '情人节',
    '03-08': '妇女节',
    '03-12': '植树节',
    '04-01': '愚人节',
    '05-01': '劳动节',
    '05-04': '青年节',
    '06-01': '儿童节',
    '09-10': '教师节',
    '10-01': '国庆节',
    '10-31': '万圣节',
    '11-11': '光棍节',
    '12-24': '平安夜',
    '12-25': '圣诞节'
};

export const RealtimeContextManager = {

    /**
     * 获取天气信息
     */
    fetchWeather: async (config: RealtimeConfig): Promise<WeatherData | null> => {
        if (!config.weatherEnabled || !config.weatherApiKey) {
            return null;
        }

        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;

        // 检查缓存
        if (weatherCache.data && (now - weatherCache.timestamp) < cacheMs) {
            return weatherCache.data;
        }

        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(config.weatherCity)}&appid=${config.weatherApiKey}&units=metric&lang=zh_cn`;

            const response = await fetch(url);
            if (!response.ok) {
                console.error('Weather API error:', response.status);
                return null;
            }

            const data = await safeResponseJson(response);

            const weather: WeatherData = {
                temp: Math.round(data.main.temp),
                feelsLike: Math.round(data.main.feels_like),
                humidity: data.main.humidity,
                description: data.weather[0]?.description || '未知',
                icon: data.weather[0]?.icon || '01d',
                city: data.name
            };

            // 更新缓存
            weatherCache = { data: weather, timestamp: now };

            return weather;
        } catch (e) {
            console.error('Failed to fetch weather:', e);
            return null;
        }
    },

    /**
     * 使用 Brave Search API 获取新闻（通过自建 Cloudflare Worker 代理）
     */
    fetchBraveNews: async (apiKey: string): Promise<NewsItem[]> => {
        try {
            // 使用自建的 Cloudflare Worker 代理
            const workerUrl = 'https://sully-n.qegj567.workers.dev/news?q=热点新闻&count=5&country=cn';

            const response = await fetch(workerUrl, {
                headers: {
                    'Accept': 'application/json',
                    'X-Brave-API-Key': apiKey  // Worker 需要这个 header
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Brave API error:', response.status, errorText);
                return [];
            }

            const data = await safeResponseJson(response);

            // Brave News API 返回结构
            if (data.results && data.results.length > 0) {
                return data.results.slice(0, 5).map((item: any) => ({
                    title: item.title,
                    source: item.meta_url?.netloc || item.source || 'Brave新闻',
                    url: item.url
                }));
            }
            return [];
        } catch (e) {
            console.error('Brave Search failed:', e);
            return [];
        }
    },

    /**
     * 获取热点新闻
     * 优先级: Brave Search API > Hacker News
     */
    fetchNews: async (config: RealtimeConfig): Promise<NewsItem[]> => {
        if (!config.newsEnabled) {
            return [];
        }

        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;

        // 检查缓存
        if (newsCache.data.length > 0 && (now - newsCache.timestamp) < cacheMs) {
            return newsCache.data;
        }

        let news: NewsItem[] = [];

        // 1. 优先使用 Brave Search API（如果配置了）
        if (config.newsApiKey) {
            news = await RealtimeContextManager.fetchBraveNews(config.newsApiKey);
            if (news.length > 0) {
                newsCache = { data: news, timestamp: now };
                return news;
            }
        }

        // 2. 备用：Hacker News（英文但稳定，无CORS限制）
        news = await RealtimeContextManager.fetchBackupNews();
        if (news.length > 0) {
            newsCache = { data: news, timestamp: now };
        }
        return news;
    },

    /**
     * 获取微博热搜
     */
    fetchHotSearch: async (config: RealtimeConfig): Promise<any[]> => {
        if (!config.hotSearchEnabled) {
            return [];
        }

        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;

        // 检查缓存
        if (hotSearchCache.data.length > 0 && (now - hotSearchCache.timestamp) < cacheMs) {
            return hotSearchCache.data;
        }

        try {
            const res = await fetch(buildBackendUrl('/api/public/hotlist', { type: 'wbHot' }));
            if (res.ok) {
                const json = await res.json() as any;
                if (json.success && json.data) {
                    const sortedData = json.data.sort((a: any, b: any) => a.index - b.index).slice(0, 30);
                    hotSearchCache = { data: sortedData, timestamp: now };
                    return sortedData;
                }
            }
        } catch (e) {
            console.error('Fetch hot search failed:', e);
        }
        return [];
    },

    /**
     * 获取 AI HOT 资讯（精选条目）
     */
    fetchAiHot: async (config: RealtimeConfig): Promise<any[]> => {
        if (!config.aihotEnabled) {
            return [];
        }

        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;

        // 检查缓存
        if (aihotCache.data.length > 0 && (now - aihotCache.timestamp) < cacheMs) {
            return aihotCache.data;
        }

        try {
            const res = await fetch('https://sully-n.sully-tts-proxy.workers.dev/aihot');
            if (res.ok) {
                const json = await res.json() as any;
                if (json.success && json.items) {
                    const items = json.items.slice(0, 30);
                    aihotCache = { data: items, timestamp: now };
                    return items;
                }
            }
        } catch (e) {
            console.error('Fetch AI HOT failed:', e);
        }
        return [];
    },

    /**
     * 备用新闻源 - 使用Hacker News API（总是可用）
     */
    fetchBackupNews: async (): Promise<NewsItem[]> => {
        try {
            const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
            if (!response.ok) return [];

            const ids = await safeResponseJson(response);
            const topIds = ids.slice(0, 5);

            const stories = await Promise.all(
                topIds.map(async (id: number) => {
                    const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                    return safeResponseJson(storyRes);
                })
            );

            return stories.map((s: any) => ({
                title: s.title,
                source: 'Hacker News',
                url: s.url
            }));
        } catch (e) {
            return [];
        }
    },

    /**
     * 获取时间上下文
     */
    getTimeContext: () => {
        const now = new Date();
        const hour = now.getHours();
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const dayOfWeek = dayNames[now.getDay()];

        let timeOfDay = '凌晨';
        let mood = '安静';

        if (hour >= 5 && hour < 9) {
            timeOfDay = '早晨';
            mood = '清新';
        } else if (hour >= 9 && hour < 12) {
            timeOfDay = '上午';
            mood = '精神';
        } else if (hour >= 12 && hour < 14) {
            timeOfDay = '中午';
            mood = '放松';
        } else if (hour >= 14 && hour < 17) {
            timeOfDay = '下午';
            mood = '平静';
        } else if (hour >= 17 && hour < 19) {
            timeOfDay = '傍晚';
            mood = '慵懒';
        } else if (hour >= 19 && hour < 22) {
            timeOfDay = '晚上';
            mood = '温馨';
        } else if (hour >= 22 || hour < 5) {
            timeOfDay = '深夜';
            mood = '安静';
        }

        return {
            timestamp: now.toISOString(),
            dateStr: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
            timeStr: `${hour.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
            dayOfWeek,
            timeOfDay,
            mood,
            hour,
            isWeekend: now.getDay() === 0 || now.getDay() === 6
        };
    },

    /**
     * 检查特殊日期
     */
    checkSpecialDates: (): string[] => {
        const now = new Date();
        const monthDay = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

        const special: string[] = [];

        if (SPECIAL_DATES[monthDay]) {
            special.push(SPECIAL_DATES[monthDay]);
        }

        // 检查农历节日（简化版，只检查大概日期）
        // 这里可以后续接入农历API

        return special;
    },

    /**
     * 生成天气建议
     */
    generateWeatherAdvice: (weather: WeatherData): string => {
        const advices: string[] = [];

        // 温度建议
        if (weather.temp < 5) {
            advices.push('天气很冷，记得多穿点');
        } else if (weather.temp < 15) {
            advices.push('有点凉，注意保暖');
        } else if (weather.temp > 30) {
            advices.push('天气炎热，注意防暑');
        } else if (weather.temp > 25) {
            advices.push('天气不错，适合出门');
        }

        // 天气状况建议
        const desc = weather.description.toLowerCase();
        if (desc.includes('雨')) {
            advices.push('记得带伞');
        } else if (desc.includes('雪')) {
            advices.push('路上小心，注意防滑');
        } else if (desc.includes('雾') || desc.includes('霾')) {
            advices.push('空气不太好，建议戴口罩');
        } else if (desc.includes('晴')) {
            advices.push('阳光明媚');
        }

        // 湿度建议
        if (weather.humidity > 80) {
            advices.push('湿度较高，可能会闷热');
        } else if (weather.humidity < 30) {
            advices.push('空气干燥，记得多喝水');
        }

        return advices.join('，') || '天气正常';
    },

    /**
     * 构建完整的实时上下文（注入到系统提示词）
     */
    buildFullContext: async (config: RealtimeConfig): Promise<string> => {
        const parts: string[] = [];

        // 开头强调：这是真实世界的信息
        parts.push(`### 【真实世界感知系统】`);
        parts.push(`⚠️ 重要：以下信息来自真实世界，不是虚构的。你现在真的能"看到"外面的世界。`);
        parts.push('');

        // 1. 时间信息（总是包含）
        const time = RealtimeContextManager.getTimeContext();
        parts.push(`📅 当前真实时间: ${time.dateStr} ${time.dayOfWeek} ${time.timeOfDay} ${time.timeStr}`);

        // 2. 特殊日期
        const specialDates = RealtimeContextManager.checkSpecialDates();
        if (specialDates.length > 0) {
            parts.push(`🎉 今日特殊: ${specialDates.join('、')}`);
        }

        // 3. 天气信息
        if (config.weatherEnabled && config.weatherApiKey) {
            const weather = await RealtimeContextManager.fetchWeather(config);
            if (weather) {
                parts.push('');
                parts.push(`🌤️ 【${weather.city}实时天气】`);
                parts.push(`现在外面: ${weather.description}，气温 ${weather.temp}°C（体感 ${weather.feelsLike}°C），湿度 ${weather.humidity}%`);
                parts.push(`你的建议: ${RealtimeContextManager.generateWeatherAdvice(weather)}`);
            }
        }

        // 4. 新闻热点
        if (config.newsEnabled) {
            const news = await RealtimeContextManager.fetchNews(config);
            if (news.length > 0) {
                parts.push('');
                parts.push(`📰 【你刚刷到的热搜/新闻】`);
                parts.push(`（这些是真实的热点话题，你可以主动和用户聊这些）`);
                news.forEach((n, i) => {
                    const source = n.source ? ` [${n.source}]` : '';
                    parts.push(`${i + 1}. ${n.title}${source}`);
                });
            }
        }

        // 4.5 热搜已解耦到 hotSearchContext.ts，由 chatPrompts.ts 独立注入

        // 5. 行为指令（强调）
        parts.push('');
        parts.push(`### 【如何使用这些信息】`);
        parts.push(`1. 这些信息是真实的，你可以直接引用（比如"我看到今天热搜有xxx"）`);
        parts.push(`2. 天气是真实的，可以主动关心用户（"外面在下雨，你带伞了吗？"）`);
        parts.push(`3. 新闻和热搜是真实的，可以主动聊起（"诶你看到xxx的新闻了吗？我觉得..."）`);
        parts.push(`4. 如果用户问你"你怎么知道的"，可以说你刚刷到的/刚看到的`);
        parts.push(`5. 不要假装不知道这些信息，这是你真的能感知到的外部世界`);

        return parts.join('\n');
    },

    /**
     * 清除缓存
     */
    clearCache: () => {
        weatherCache = { data: null, timestamp: 0 };
        newsCache = { data: [], timestamp: 0 };
        hotSearchCache = { data: [], timestamp: 0 };
        aihotCache = { data: [], timestamp: 0 };
    },

    /**
     * 主动搜索 - 让AI角色能够主动搜索任意内容
     * Active Search - Let AI characters actively search for anything
     */
    performSearch: async (query: string, apiKey: string): Promise<{ success: boolean; results: SearchResult[]; message: string }> => {
        if (!query || !apiKey) {
            return { success: false, results: [], message: '缺少搜索关键词或API Key' };
        }

        try {
            // 使用自建的 Cloudflare Worker 代理
            const workerUrl = `https://sully-n.qegj567.workers.dev/search?q=${encodeURIComponent(query)}&count=5`;

            const response = await fetch(workerUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Brave-API-Key': apiKey
                }
            });

            // 先读取 text，避免非 JSON 响应直接 crash
            const text = await response.text();

            // 非 2xx 直接抛错
            if (!response.ok) {
                console.error('Search API error:', response.status, text);
                // 尝试解析错误信息
                try {
                    const errJson = JSON.parse(text);
                    return { success: false, results: [], message: `搜索失败: ${errJson.error || response.status}` };
                } catch {
                    return { success: false, results: [], message: `搜索失败: ${response.status}` };
                }
            }

            // 解析 JSON
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error('Search response not JSON:', text.slice(0, 200));
                return { success: false, results: [], message: '搜索返回格式错误' };
            }

            // Brave Search API 返回结构
            if (data.web?.results && data.web.results.length > 0) {
                const results: SearchResult[] = data.web.results.slice(0, 5).map((item: any) => ({
                    title: item.title,
                    description: item.description || '',
                    url: item.url
                }));
                return { success: true, results, message: '搜索成功' };
            }

            return { success: false, results: [], message: '没有找到相关结果' };
        } catch (e: any) {
            console.error('Search failed:', e);
            return { success: false, results: [], message: `搜索出错: ${e.message}` };
        }
    }
};
