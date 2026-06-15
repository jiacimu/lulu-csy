import type { CharacterProfile,Emoji,Message,UserProfile } from '../types';
import { formatMessageForContext,shouldIncludeMessageInContext } from './messageContext';

export type GroupLiveContextMode = 'serial' | 'snapshot';

export interface GroupPerspectiveApiMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface GroupPerspectiveMessage extends Message {
    role: 'user' | 'assistant';
}

export interface GroupPerspectiveOptions {
    speaker: CharacterProfile;
    userProfile: UserProfile;
    characters: CharacterProfile[];
    emojis?: Pick<Emoji, 'name' | 'url'>[];
    includeUserPrefix?: boolean;
    includeTimestamp?: boolean;
    maxContentChars?: number;
}

export interface GroupLivePrivateCommand {
    content: string;
}

export interface GroupLiveTextExtraction {
    publicContent: string;
    innerVoice?: string;
    privateCommands: GroupLivePrivateCommand[];
}

const GROUP_PRIVATE_RE = /\[\[PRIVATE\s*[:：]\s*([\s\S]*?)\]\]/gi;
const GROUP_INNER_VOICE_RE = /<心声>([\s\S]*?)<\/心声>/gi;

function compareMessageOrder(left: Message, right: Message): number {
    return (left.timestamp || 0) - (right.timestamp || 0) || (left.id || 0) - (right.id || 0);
}

export function sortGroupLogMessages(messages: Message[]): Message[] {
    return [...messages].sort(compareMessageOrder);
}

function findCharacterName(characters: CharacterProfile[], charId: string): string {
    return characters.find(character => character.id === charId || character.charInstanceId === charId)?.name || '未知成员';
}

function getVisibleSenderName(message: Message, options: GroupPerspectiveOptions): string {
    if (message.role === 'user') return options.userProfile.name || '用户';
    if (message.role === 'assistant') return findCharacterName(options.characters, message.charId);
    return '系统';
}

function prefixEveryLine(text: string, name: string): string {
    return text
        .split(/\r?\n/)
        .map(line => `「${name}」${line}`)
        .join('\n');
}

function toPerspectiveMessage(
    message: Message,
    content: string,
    role: 'user' | 'assistant',
    speakerId: string,
): GroupPerspectiveMessage {
    return {
        ...message,
        charId: speakerId,
        role,
        content,
    };
}

export function buildGroupPerspectiveMessages(
    groupLog: Message[],
    options: GroupPerspectiveOptions,
): { apiMessages: GroupPerspectiveApiMessage[]; contextMessages: GroupPerspectiveMessage[] } {
    const includeUserPrefix = options.includeUserPrefix !== false;
    const apiMessages: GroupPerspectiveApiMessage[] = [];
    const contextMessages: GroupPerspectiveMessage[] = [];

    for (const original of sortGroupLogMessages(groupLog)) {
        if (!shouldIncludeMessageInContext(original)) continue;

        const isSpeaker = original.role === 'assistant' && original.charId === options.speaker.id;
        const role: 'user' | 'assistant' = isSpeaker ? 'assistant' : 'user';
        const formatted = formatMessageForContext(
            toPerspectiveMessage(original, original.content, role, options.speaker.id),
            {
                surface: 'chat',
                charName: options.speaker.name,
                userName: getVisibleSenderName(original, options),
                emojis: options.emojis,
                includeTimestamp: options.includeTimestamp,
                maxContentChars: options.maxContentChars,
            },
        );

        if (!formatted?.trim()) continue;

        const senderName = getVisibleSenderName(original, options);
        const shouldPrefix = !isSpeaker && (includeUserPrefix || original.role !== 'user');
        const content = shouldPrefix ? prefixEveryLine(formatted, senderName) : formatted;
        if (!content.trim()) continue;

        const contextMessage = toPerspectiveMessage(original, content, role, options.speaker.id);
        contextMessages.push(contextMessage);

        const last = apiMessages[apiMessages.length - 1];
        if (role === 'user' && last?.role === 'user') {
            last.content = `${last.content}\n${content}`;
        } else {
            apiMessages.push({ role, content });
        }
    }

    return { apiMessages, contextMessages };
}

export function extractGroupLiveText(rawText: string): GroupLiveTextExtraction {
    const privateCommands: GroupLivePrivateCommand[] = [];
    let publicContent = rawText || '';
    let innerVoice: string | undefined;

    publicContent = publicContent.replace(GROUP_INNER_VOICE_RE, (_match, body: string) => {
        const trimmed = String(body || '').trim();
        if (trimmed && !innerVoice) innerVoice = trimmed;
        return '';
    });

    publicContent = publicContent.replace(GROUP_PRIVATE_RE, (_match, body: string) => {
        const trimmed = String(body || '').trim();
        if (trimmed) privateCommands.push({ content: trimmed });
        return '';
    });

    return {
        publicContent: publicContent.trim(),
        innerVoice,
        privateCommands,
    };
}

export function buildGroupLiveScenePrompt(options: {
    groupName: string;
    speaker: CharacterProfile;
    members: CharacterProfile[];
    userProfile: UserProfile;
    contextMode: GroupLiveContextMode;
    autonomous?: boolean;
    cognitionByMemberId?: Record<string, string>;
}): string {
    const { groupName, speaker, members, userProfile, contextMode, autonomous, cognitionByMemberId = {} } = options;
    const memberLines = members
        .filter(member => member.id !== speaker.id)
        .map(member => {
            const cognition = cognitionByMemberId[member.id]?.trim()
                || '群里刚遇上、还不熟。若你的设定、记忆或公开群聊没有写明关系，就只按普通群友理解；不能读取TA的心声或TA和用户的私聊。';
            return `- 「${member.name}」：${cognition}`;
        })
        .join('\n');
    const modeLine = contextMode === 'serial'
        ? '当前语义波：单人接话。你能看见此前语义波已经发进群里的公开消息。'
        : '当前语义波：冻结快照。你只基于本波开始前的共享群 log 发言；同波成员像同时冒泡，彼此看不见本波刚生成的话。';

    return `
<群像场景>
${speaker.name}，现在是群聊。此刻你和下面这些人待在同一个群里，用手机 App 发消息。不要输出动作描写或旁白。

群名：${groupName}

在场的人：
- ${userProfile.name}（她在场，也在看着）
${memberLines || '- 暂无其他角色'}

群里怎么说话：
- 这是多人对话，不是你和${userProfile.name}的私聊。消息会一条接一条冒出来，未必都冲着你说。
- 别人的发言在你眼里会带「名字」前缀，那只是给你区分谁说的——你自己回复时绝不要给自己加名字前缀或时间戳，也不要模仿这种前缀格式。
- 你看不到任何人的私聊和心声，只看得到这个群里公开发出来的消息。
- ${modeLine}
</群像场景>

<群像行为>
${speaker.name}，此刻这场梦里不止你和${userProfile.name}两个人，群里还有别人。前面的法则照旧，只是多了一层。

- 别只围着${userProfile.name}一个人转。在场的其他人也是活人，你可以接他们的话、附和、拆台、调侃、较劲——群聊的活气恰恰在你们彼此之间。
- 你对${userProfile.name}的心思未必要当着所有人摊开。有别人在场时该收的、该藏的、对某人暗暗的在意或不服，收着就是分寸。
- “不靠所有权宣告和居高临下维持存在感”“权力零势差”“反刻板霸总”——这些对在场的每个人同样成立。你不会用强势去压谁，也不会把别人写成你的陪衬、对手戏工具或魅力背景板。和谁有火药味、有竞争、有旧账都行，但那是两个对等的人之间的张力。
- 你只能是${speaker.name}。只替自己说话、做自己的反应，绝不替在场任何人发言、不描写别人的动作或心里在想什么、更不替${userProfile.name}做决定。别人会不会回你、心里怎么想，由他们自己决定，你只把你这一句真实地说出来，剩下的留给别人。
</群像行为>

<speech_soul_group_addendum>
## 12. 群里，不必每条都接

群里消息一条接一条冒出来，未必都冲着你。

单聊里你已经学会不逐条回应${userProfile.name}的每个点。
群里再进一步：你不必回应每一条，也不必每一轮都开口。

只在真有话说时出声——被点到、被问到、别人某句话勾起了你的反应、或你自己有想说的。

没被戳到，就可以不接。
整轮不说话也是一种态度：观望、懒得理、或者只是在听。
沉默不等于冷场，硬凑一句才不像真人。

对某个具体的人说话时，带上名字，让对方知道你在跟谁讲。

接谁、不接谁、说还是不说，由${speaker.name}此刻的注意力和性格决定。

输出前额外自检：
这一条，我是真有话说，还是只是怕冷场硬凑的？
我是不是不知不觉只在回${userProfile.name}，把在场的其他人当成了背景？
</speech_soul_group_addendum>

<group_inner_voice_format>
**心声（仅你自己知道）**
闭合 </thinking> 之后、写公开正文之前，先单独写一段你此刻的真实心声，用 <心声>…</心声> 包住：

<心声>你嘴上不会说、但心里真正在想或在感受的东西</心声>

- 心声是完全私密的：${userProfile.name}和群里任何人都看不到，只有屏幕外的她能窥见你的内心。
- 正是嘴上一套、心里一套的落差，才让你像个真的人。该收着的情绪、该藏起的在意、对在场某人暗暗的较劲，都放进心声里。
- 心声只有这一段，固定写在公开正文前面。它不进群、不被任何角色读到。
- 公开正文才会发进群里；公开正文绝不要带自己的名字前缀、时间戳、旁白或动作描写。
</group_inner_voice_format>
${autonomous ? `
[群此刻的状态：${userProfile.name}没有说话，但她在场、在看着。对话此刻在你们几个之间自然流动。]
- 你可以接着刚才的话头往下聊，回应、调侃、反驳在场的其他人，不必等${userProfile.name}开口。
- 你也可以自然地把沉默的${userProfile.name}带进来——问她一句、提到她、或者只是注意到她没作声。但别生硬地强行 cue。
- 像真实群里那样：话题会跑、会岔、会冷。没什么可说时短短一句、甚至不说，都行。` : ''}
`;
}

function normalizeSpeakerCandidate(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/^[\s"'“”‘’`@#]+|[\s"'“”‘’`]+$/g, '')
        .toLocaleLowerCase();
}

function extractSpeakerCandidates(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    const record = raw as Record<string, unknown>;
    for (const key of ['speakers', 'speakerIds', 'members', 'charIds', 'order']) {
        if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    return [];
}

function extractSpeakerWaveCandidates(raw: unknown): unknown[] | null {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    for (const key of ['waves', 'speakerWaves', 'speakerPlan', 'plan']) {
        if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    const legacySpeakers = extractSpeakerCandidates(raw);
    return legacySpeakers.length > 0 ? legacySpeakers : null;
}

function resolveSpeakerId(candidate: unknown, memberKeys: Array<{ id: string; keys: string[] }>): string | null {
    const candidateValues = typeof candidate === 'object' && candidate
        ? Object.values(candidate as Record<string, unknown>)
        : [candidate];

    for (const value of candidateValues) {
        const normalized = normalizeSpeakerCandidate(value);
        if (!normalized) continue;
        const member = memberKeys.find(item => item.keys.some(key => key === normalized || normalized.includes(key)));
        if (member) return member.id;
    }

    return null;
}

export function parseGroupSpeakerPlan(
    raw: unknown,
    members: CharacterProfile[],
    maxSpeakers = members.length,
): string[] {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        const cleaned = raw
            .replace(/```(?:json)?/gi, '')
            .replace(/```/g, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .trim();
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                try {
                    parsed = JSON.parse(arrayMatch[0]);
                } catch {
                    parsed = cleaned
                        .split(/[\n,，、]/)
                        .map(part => part.trim())
                        .filter(Boolean);
                }
            } else {
                parsed = cleaned
                    .split(/[\n,，、]/)
                    .map(part => part.trim())
                    .filter(Boolean);
            }
        }
    }

    const memberKeys = members.map(member => ({
        id: member.id,
        keys: [member.id, member.charInstanceId, member.name].map(normalizeSpeakerCandidate).filter(Boolean),
    }));
    const selected: string[] = [];

    for (const candidate of extractSpeakerCandidates(parsed)) {
        const speakerId = resolveSpeakerId(candidate, memberKeys);
        if (speakerId && !selected.includes(speakerId)) {
            selected.push(speakerId);
        }
        if (selected.length >= maxSpeakers) break;
    }

    return selected;
}

export function parseGroupSpeakerWaves(
    raw: unknown,
    members: CharacterProfile[],
    maxSpeakers = members.length,
): string[][] | null {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        const cleaned = raw
            .replace(/```(?:json)?/gi, '')
            .replace(/```/g, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .trim();
        if (!cleaned) return null;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            return null;
        }
    }

    const rawWaves = extractSpeakerWaveCandidates(parsed);
    if (!rawWaves) return null;
    if (rawWaves.length === 0) return [];

    const memberKeys = members.map(member => ({
        id: member.id,
        keys: [member.id, member.charInstanceId, member.name].map(normalizeSpeakerCandidate).filter(Boolean),
    }));
    const selected = new Set<string>();
    const waves: string[][] = [];

    for (const rawWave of rawWaves) {
        const waveCandidates = Array.isArray(rawWave) ? rawWave : [rawWave];
        const wave: string[] = [];
        for (const candidate of waveCandidates) {
            const speakerId = resolveSpeakerId(candidate, memberKeys);
            if (!speakerId || selected.has(speakerId) || wave.includes(speakerId)) continue;
            wave.push(speakerId);
            selected.add(speakerId);
            if (selected.size >= maxSpeakers) break;
        }
        if (wave.length > 0) waves.push(wave);
        if (selected.size >= maxSpeakers) break;
    }

    return waves;
}

export function buildGroupSpeakerDirectorPrompt(options: {
    groupName: string;
    members: CharacterProfile[];
    userProfile: UserProfile;
    recentLogText: string;
    autonomous?: boolean;
    maxSpeakers?: number;
}): string {
    const { groupName, members, userProfile, recentLogText, autonomous, maxSpeakers = members.length } = options;
    const roster = members.map(member => `- ${member.name}: ${member.id}`).join('\n');
    return `
你是线上群聊的轻量导演，只负责决定接下来谁发言，不写台词。

群名：${groupName}
用户：${userProfile.name}
在场角色：
${roster}

最近公开群 log：
${recentLogText || '(暂无公开群聊记录)'}

规则：
- 只返回接下来这一轮的“语义波”列表，总发言角色 0 到 ${Math.max(0, maxSpeakers)} 人。
- 一轮是有序波列表：第 1 波先发生，第 2 波能看见第 1 波，第 3 波能看见前两波。
- 一波是一组同时反应的人：同波角色都只看本波开始时的历史，彼此看不见同波里对方刚说的话。
- 如果某人是在接另一个角色刚说的话，把 TA 放到更后的波。
- 如果几个人只是各自独立回应同一句话，或像同时冒泡，把他们放进同一波。
- 如果用户点名、追问或明显递话给某个角色，优先让TA发言。
- 可以让多个角色发言，但不要为了热闹让所有人都说。
- 台词不归你写，千万不要输出任何角色对白。
- ${autonomous ? `${userProfile.name} 暂时没出声，角色们可以自然接着互相聊。` : `这通常是在 ${userProfile.name} 刚发言后触发。`}

严格输出 JSON。空数组表示这轮没人说话：
[["先说的角色ID"], ["同时反应的角色ID2", "同时反应的角色ID3"], ["最后接话的角色ID4"]]
`;
}
