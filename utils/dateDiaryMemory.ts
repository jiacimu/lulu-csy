export interface DateDiaryMemoryDraft {
    title: string;
    content: string;
    emotionalJourney?: string;
    importance: number;
}

const clampImportance = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return 5;
    return Math.min(10, Math.max(1, Math.round(parsed)));
};

const cleanText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeDateDiaryMemoryPlaceholders = (text: string): string => (
    text
        .replace(/[｛{]\s*userName\s*[｝}]/gi, '{userName}')
        .replace(/[｛{]\s*charName\s*[｝}]/gi, '{charName}')
);

export const renderDateDiaryMemoryTemplate = (
    text: string,
    charName: string,
    userName: string,
): string => (
    normalizeDateDiaryMemoryPlaceholders(text)
        .replace(/\{charName\}/g, charName)
        .replace(/\{userName\}/g, userName)
);

export const toDateDiaryMemoryTemplate = (
    text: string,
    charName: string,
    userName: string,
): string => {
    let normalized = normalizeDateDiaryMemoryPlaceholders(text);
    const replacements = [
        [userName.trim(), '{userName}'],
        [charName.trim(), '{charName}'],
    ] as const;

    for (const [name, placeholder] of replacements
        .filter(([name]) => name.length > 0)
        .sort((a, b) => b[0].length - a[0].length)) {
        normalized = normalized.replace(new RegExp(escapeRegExp(name), 'g'), placeholder);
    }

    return normalized;
};

export const buildDateDiaryMemoryPrompt = (
    charName: string,
    userName: string,
    time: string,
    summary: string,
): string => `你正在把一次线下见面总结拆成可长期保存的「角色日记式向量记忆」。

角色真实名字: ${charName}
用户真实名字: ${userName}
当前时间: ${time}

【见面总结】
${summary}

【任务】
从这份总结中提取 3 到 6 条最值得长期记住的情感碎片。每条都要像角色写给自己的私密日记片段，而不是客观总结。

【强制规则】
1. 只根据总结中已经发生的事实写，不要新增剧情、承诺、动作或关系进展。
2. content 使用角色第一人称，可以用“我”自称。
3. 提到用户时必须写字面量占位符 {userName}，不要写真实名字“${userName}”，也不要只写“你/她/他”。
4. 如必须提到角色名字，写字面量占位符 {charName}，不要写真实名字“${charName}”；通常用“我”即可。
5. 每条 content 80 到 220 字，保留情绪、身体距离、没说出口的话、关系变化或之后可以承接的钩子。
6. title 6 到 16 个中文字符，像记忆标题，不要包含真实姓名。
7. emotionalJourney 不超过 40 字。
8. importance 是 1 到 10 的整数：越能改变关系、越值得以后自然想起，分数越高。

只输出 JSON 数组，不要 markdown 代码块，不要解释：
[
  {
    "title": "分别前的沉默",
    "content": "我记得 {userName} 快分别时忽然安静下来。那一瞬间我没有立刻说话，因为我怕自己把舍不得说得太明显。那段沉默像被我们一起握住了，没有催我，也没有放过我。",
    "emotionalJourney": "舍不得、克制、想靠近",
    "importance": 8
  }
]`;

export const parseDateDiaryMemoryResponse = (raw: string): DateDiaryMemoryDraft[] => {
    let cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
        cleaned = cleaned.slice(arrStart, arrEnd + 1);
    }
    cleaned = cleaned.replace(/,\s*]/g, ']');

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        return [];
    }

    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records
        .map((item): DateDiaryMemoryDraft | null => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            const title = cleanText(record.title).slice(0, 40);
            const content = cleanText(record.content);
            if (!title || !content) return null;
            const emotionalJourney = cleanText(record.emotionalJourney);
            return {
                title,
                content,
                emotionalJourney: emotionalJourney || undefined,
                importance: clampImportance(record.importance),
            };
        })
        .filter((item): item is DateDiaryMemoryDraft => Boolean(item))
        .slice(0, 8);
};
