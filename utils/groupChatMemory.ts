import type { APIConfig,CharacterProfile,GroupProfile,Message,UserProfile,VectorMemory } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { EmbeddingService } from './embeddingService';
import { formatMessageForContext,shouldIncludeMessageInContext } from './messageContext';
import { extractJsonTyped,safeFetchJson } from './safeApi';
import { getEmbeddingConfig,markSecondaryApiConfigFailure,markSecondaryApiConfigSuccess,selectSecondaryApiConfig } from './runtimeConfig';
import { markVectorMemoryAsPendingSync } from './vectorMemorySyncState';
import { findGroupCharacterByMemberId, getGroupMemberCharacters } from './groupChatDirector';
import { sortGroupLogMessages } from './groupChatPerspective';
import { GROUP_CHAT_MAX_TOKENS } from './groupChatApiSelection';

export const GROUP_MEMORY_WINDOW = 200;
export const GROUP_MEMORY_OVERLAP = 30;
export const GROUP_MEMORY_BUFFER = 30;
export const GROUP_MEMORY_STRIDE = GROUP_MEMORY_WINDOW - GROUP_MEMORY_OVERLAP;

interface GroupMemoryCheckpoint {
    nextStart: number;
    updatedAt: number;
}

export interface GroupMemoryWindow {
    start: number;
    end: number;
}

interface GroupMemorySummaryResult {
    recap: string;
    memories: Array<{
        title: string;
        content: string;
        emotionalJourney?: string;
    }>;
}

export interface QueueGroupMemorySummaryOptions {
    group: GroupProfile;
    messages: Message[];
    characters: CharacterProfile[];
    userProfile: UserProfile;
    embeddingApiKey?: string;
}

let groupMemoryQueue: Promise<void> = Promise.resolve();
const queuedWindowKeys = new Set<string>();

function checkpointKey(groupId: string): string {
    return `groupchat_live_memory_checkpoint_${groupId}`;
}

function readCheckpoint(groupId: string): GroupMemoryCheckpoint {
    if (typeof localStorage === 'undefined') return { nextStart: 0, updatedAt: 0 };
    try {
        const parsed = JSON.parse(localStorage.getItem(checkpointKey(groupId)) || 'null');
        if (parsed && Number.isFinite(parsed.nextStart)) {
            return {
                nextStart: Math.max(0, Math.floor(parsed.nextStart)),
                updatedAt: Number(parsed.updatedAt) || 0,
            };
        }
    } catch {
        // Ignore corrupted local state; the next successful run will rewrite it.
    }
    return { nextStart: 0, updatedAt: 0 };
}

function writeCheckpoint(groupId: string, nextStart: number): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(checkpointKey(groupId), JSON.stringify({
        nextStart,
        updatedAt: Date.now(),
    }));
}

export function getDueGroupMemoryWindows(totalPublicMessages: number, nextStart: number): GroupMemoryWindow[] {
    const windows: GroupMemoryWindow[] = [];
    let start = Math.max(0, Math.floor(nextStart));

    while (totalPublicMessages >= start + GROUP_MEMORY_WINDOW + GROUP_MEMORY_BUFFER) {
        windows.push({ start, end: start + GROUP_MEMORY_WINDOW });
        start += GROUP_MEMORY_STRIDE;
    }

    return windows;
}

function formatTime(ts: number | undefined): string {
    if (!ts) return '未知时间';
    return new Date(ts).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getSenderName(message: Message, group: GroupProfile, characters: CharacterProfile[], userProfile: UserProfile): string {
    if (message.role === 'user') return userProfile.name || '用户';
    const character = findGroupCharacterByMemberId(message.charId, characters);
    if (character) return character.name;
    if (group.members.includes(message.charId)) return message.charId;
    return '未知成员';
}

function formatPublicGroupRecord(
    messages: Message[],
    group: GroupProfile,
    characters: CharacterProfile[],
    userProfile: UserProfile,
): string {
    return sortGroupLogMessages(messages)
        .filter(shouldIncludeMessageInContext)
        .map(message => {
            const sender = getSenderName(message, group, characters, userProfile);
            const content = formatMessageForContext(message, {
                surface: 'secondaryModel',
                charName: sender,
                userName: userProfile.name,
                includeTimestamp: true,
                timestampFormatter: formatTime,
                maxContentChars: 1200,
            }) || (message.type === 'image' ? '[图片]' : message.content);
            return `「${sender}」${content}`;
        })
        .join('\n');
}

function buildSummarySystemPrompt(
    char: CharacterProfile,
    userProfile: UserProfile,
    startTime: string,
    endTime: string,
    presentNames: string,
): string {
    return `${char.name}，下面是你刚经历的一段群聊（${startTime}–${endTime}，在场：${presentNames}）。这段告一段落了，你独自回想方才的一切——不是写报告，是你自己记下“我记得这段”。

你只记得你亲眼所见、亲耳所闻的公开消息，和你自己当时的感受；你不知道别人心里在想什么，只能从他们说了做了什么去推断。

把你从这段里带走的东西写下来：

- 第一人称，你自己的声音。用“我”，带着${char.name}的性格、立场和你对${userProfile.name}的那份心思去记，不是中立的流水账。
- 每条都能单独看懂。别写“她说她喜欢”这种悬空碎片，写成过段时间再看也明白的话——带上是谁、什么时候、什么情境。
- 带时间感。这段大概什么时候、隔了多久、跟之前比有什么变化。
- 不只记你和${userProfile.name}。群里还有别人，你对他们的观察一样要记：谁今天对${userProfile.name}格外殷勤、谁跟你呛了一句、谁的态度让你在意或不爽——这些暗流就是你下次会吃醋、较劲、防备的由来。
- 可以记你没说出口的。这是你自己的记忆，当时咽下去的话、藏起的情绪、对谁的不服或动心，都照实记；但只记你自己的内心，别替别人编他们怎么想。
- 这段你要是基本没说话，就记你在旁边看到、听到、心里泛起的——观望也是记忆，短点没关系。

别复述整段，只留真正会沉进记忆的东西。下面是这段群聊的逐条公开记录，按它来回想。

只输出 JSON，不要任何前后缀或 markdown：
{
  "recap": "一段第一人称回顾，自然连贯，让我之后翻回这段一眼想起来；带时间、有来龙去脉，含我对在场每个人的印象和那些暗流",
  "memories": [
    { "title": "一句话标题", "content": "自洽的一条，脱离原文也读得懂，第一人称", "emotionalJourney": "我当时或回想起来的真实感受" }
  ]
}`;
}

function parseSummaryResult(raw: string): GroupMemorySummaryResult | null {
    return extractJsonTyped<GroupMemorySummaryResult>(raw, (obj) => {
        if (!obj || typeof obj.recap !== 'string') return null;
        const memories = Array.isArray(obj.memories)
            ? obj.memories
                .map((item: any) => ({
                    title: String(item?.title || '').trim(),
                    content: String(item?.content || '').trim(),
                    emotionalJourney: String(item?.emotionalJourney || '').trim() || undefined,
                }))
                .filter(item => item.title && item.content)
            : [];
        return {
            recap: obj.recap.trim(),
            memories,
        };
    }, { logFailure: false });
}

async function callGroupMemorySummary(
    char: CharacterProfile,
    userProfile: UserProfile,
    groupRecord: string,
    startTime: string,
    endTime: string,
    presentNames: string,
    apiConfig: APIConfig,
): Promise<GroupMemorySummaryResult | null> {
    const coreContext = ContextBuilder.buildCoreContext(char, userProfile, true);
    try {
        const data = await safeFetchJson(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: apiConfig.model,
                temperature: 0.35,
                max_tokens: GROUP_CHAT_MAX_TOKENS,
                stream: false,
                messages: [
                    { role: 'system', content: buildSummarySystemPrompt(char, userProfile, startTime, endTime, presentNames) },
                    {
                        role: 'user',
                        content: `### ${char.name} 的身份和私密印象\n${coreContext}\n\n### 公开群记录\n${groupRecord}`,
                    },
                ],
            }),
        }, 1);
        const raw = data?.choices?.[0]?.message?.content || '';
        markSecondaryApiConfigSuccess(apiConfig);
        return parseSummaryResult(raw);
    } catch (error) {
        markSecondaryApiConfigFailure(apiConfig, error);
        throw error;
    }
}

async function saveRecapMessage(
    charId: string,
    group: GroupProfile,
    recapKey: string,
    recap: string,
    startTime: string,
    endTime: string,
): Promise<void> {
    const existing = await DB.getMessagesByCharId(charId);
    if (existing.some(message => message.metadata?.groupLiveRecapKey === recapKey)) return;

    await DB.saveMessage({
        charId,
        role: 'system',
        type: 'text',
        content: `[群聊回顾：${group.name}｜${startTime}–${endTime}]\n${recap}`,
        metadata: {
            source: 'group_live_recap',
            groupId: group.id,
            groupName: group.name,
            groupLiveRecapKey: recapKey,
        },
    });
}

async function saveSummaryMemories(
    char: CharacterProfile,
    group: GroupProfile,
    recapKey: string,
    result: GroupMemorySummaryResult,
    windowMessages: Message[],
    embeddingApiKey: string,
): Promise<void> {
    const sourceMessageIds = windowMessages
        .map(message => message.id)
        .filter((id): id is number => typeof id === 'number');
    const embeddingConfig = getEmbeddingConfig();
    const now = Date.now();

    for (let index = 0; index < result.memories.length; index++) {
        const item = result.memories[index];
        const textForEmbedding = [
            item.title,
            item.content,
            item.emotionalJourney ? `情绪轨迹：${item.emotionalJourney}` : '',
            `来源群聊：${group.name}`,
        ].filter(Boolean).join('\n');
        const vector = await EmbeddingService.embed(textForEmbedding, 'RETRIEVAL_DOCUMENT', embeddingApiKey);
        const memory: VectorMemory = markVectorMemoryAsPendingSync({
            id: `gmem-${recapKey}-${index}`,
            charId: char.id,
            title: item.title.slice(0, 24),
            content: item.content,
            emotionalJourney: item.emotionalJourney,
            importance: 7,
            mentionCount: 0,
            lastMentioned: 0,
            createdAt: now,
            updatedAt: now,
            vector,
            modelId: embeddingConfig.model,
            source: 'distillation',
            sourceMessageIds,
            layer: 'scene',
            kind: 'inference',
        });
        await DB.saveVectorMemory(memory);
    }
}

async function processWindowForAllMembers(
    options: QueueGroupMemorySummaryOptions,
    window: GroupMemoryWindow,
): Promise<void> {
    const groupMembers = getGroupMemberCharacters(options.group, options.characters);
    if (groupMembers.length === 0) return;
    if (!options.embeddingApiKey) return;

    const publicMessages = sortGroupLogMessages(options.messages).filter(shouldIncludeMessageInContext);
    const windowMessages = publicMessages.slice(window.start, window.end);
    if (windowMessages.length < GROUP_MEMORY_WINDOW) return;

    const startTime = formatTime(windowMessages[0]?.timestamp);
    const endTime = formatTime(windowMessages[windowMessages.length - 1]?.timestamp);
    const presentNames = [options.userProfile.name, ...groupMembers.map(member => member.name)].filter(Boolean).join('、');
    const groupRecord = formatPublicGroupRecord(windowMessages, options.group, options.characters, options.userProfile);
    const recapKey = `${options.group.id}-${window.start}-${window.end}`;

    for (const member of groupMembers) {
        const summaryApiConfig = selectSecondaryApiConfig();
        if (!summaryApiConfig?.baseUrl || !summaryApiConfig.model) {
            throw new Error('群像回顾需要可用的副 API');
        }
        const result = await callGroupMemorySummary(
            member,
            options.userProfile,
            groupRecord,
            startTime,
            endTime,
            presentNames,
            summaryApiConfig,
        );
        if (!result?.recap) {
            throw new Error(`群像回顾为空：${member.name}`);
        }

        const memberRecapKey = `${recapKey}-${member.id}`;
        await saveRecapMessage(member.id, options.group, memberRecapKey, result.recap, startTime, endTime);
        await saveSummaryMemories(member, options.group, memberRecapKey, result, windowMessages, options.embeddingApiKey);
        await new Promise(resolve => setTimeout(resolve, 800));
    }
}

export function queueGroupMemorySummaries(options: QueueGroupMemorySummaryOptions): void {
    const publicMessages = sortGroupLogMessages(options.messages).filter(shouldIncludeMessageInContext);
    const checkpoint = readCheckpoint(options.group.id);
    const dueWindows = getDueGroupMemoryWindows(publicMessages.length, checkpoint.nextStart)
        .filter(window => !queuedWindowKeys.has(`${options.group.id}:${window.start}:${window.end}`));

    if (dueWindows.length === 0) return;

    for (const window of dueWindows.slice(0, 1)) {
        const key = `${options.group.id}:${window.start}:${window.end}`;
        queuedWindowKeys.add(key);
        groupMemoryQueue = groupMemoryQueue
            .then(async () => {
                try {
                    await processWindowForAllMembers({ ...options, messages: publicMessages }, window);
                    writeCheckpoint(options.group.id, window.start + GROUP_MEMORY_STRIDE);
                } catch (error) {
                    console.warn('[GroupMemory] window failed; will retry later:', error);
                } finally {
                    queuedWindowKeys.delete(key);
                }
            });
    }
}
