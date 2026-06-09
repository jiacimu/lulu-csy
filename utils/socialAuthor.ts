import type {
    CharacterProfile,
    SocialAuthorType,
    SocialComment,
    SocialCommentTone,
    SocialPost,
    SocialTargetType,
    SubAccount,
} from '../types';

type SocialAppProfileLike = {
    name?: string;
};

type GeneratedRecord = Record<string, unknown>;

export interface SocialIdentityIndex {
    userName: string;
    userSparkId?: string;
    charactersById: Map<string, CharacterProfile>;
    characterNames: Set<string>;
    handleLookup: Map<string, SocialHandleRef>;
    handlesByCharId: Map<string, SocialHandleRef[]>;
    reservedNpcNames: Set<string>;
}

export interface SocialHandleRef {
    charId: string;
    subAccountId: string;
    handle: string;
    note?: string;
}

export interface NormalizeGeneratedOptions {
    mode: 'post' | 'comment' | 'reply';
    allowedCharacterIds?: Set<string>;
    userContent?: string;
    postAuthorType?: SocialAuthorType;
}

export interface NormalizedGeneratedPost {
    authorType: 'character' | 'npc';
    authorName: string;
    authorAvatar?: string;
    charId?: string;
    subAccountId?: string;
    authorHandle?: string;
    title: string;
    content: string;
    emojis: string[];
    likes: number;
}

export interface NormalizedGeneratedComment {
    authorType: 'character' | 'npc';
    authorName: string;
    authorAvatar?: string;
    content: string;
    likes: number;
    isCharacter: boolean;
    charId?: string;
    subAccountId?: string;
    authorHandle?: string;
    tone?: SocialCommentTone;
    targetType?: SocialTargetType;
}

export interface NormalizedGeneratedBatch<T> {
    items: T[];
    shouldRetry: boolean;
    issues: string[];
}

export type SocialChatMessage = {
    role: 'system' | 'user';
    content: string;
};

export const SOCIAL_COMMENT_TONES: SocialCommentTone[] = [
    '吐槽',
    '吃瓜',
    '认真分析',
    '阴阳怪气',
    '共情',
    '玩梗',
    '好奇追问',
    '路过锐评',
];

export const SOCIAL_TARGET_TYPES: SocialTargetType[] = [
    'user_comment',
    'post_author',
    'thread_general',
];

export const LOCAL_NPC_NAME_POOL = [
    '路过的橘子',
    '今天也想下班',
    '匿名冲浪人',
    '嗑糖观察员',
    '睡不醒bot',
    '互联网野生评论员',
    '情绪稳定路人',
    '别管我在发疯',
];

const RESERVED_USER_ALIASES = ['user', 'User', 'USER', '用户'];
const PRIVATE_LEAK_TERMS = ['上次私聊', '你跟我说过', '我记得你', '主人', '宝宝'];
const BANNED_COMFORT_PHRASES = [
    '抱抱你',
    '慢慢来',
    '时间会治愈一切',
    '大家都会好起来',
    '交给时间吧',
    '别想太多',
];
const COMFORT_TONES = new Set<SocialCommentTone>(['共情']);

function normalizeKey(value: unknown): string {
    return String(value || '').replace(/\s+/g, '').trim().toLocaleLowerCase();
}

function compactText(value: unknown, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function readString(record: GeneratedRecord, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function readNumber(record: GeneratedRecord, keys: string[], fallback: number): number {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
            return Math.max(0, Math.round(Number(value)));
        }
    }
    return fallback;
}

function isRecord(value: unknown): value is GeneratedRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSocialAuthorType(value: unknown): value is SocialAuthorType {
    return value === 'user' || value === 'character' || value === 'npc';
}

function normalizeGeneratedAuthorType(record: GeneratedRecord): SocialAuthorType {
    const explicit = readString(record, ['authorType', 'type', 'role']);
    if (isSocialAuthorType(explicit)) return explicit;
    if (/角色|character/i.test(explicit)) return 'character';
    if (/路人|网友|npc|stranger|audience/i.test(explicit)) return 'npc';
    if (/用户|user/i.test(explicit)) return 'user';
    if (readString(record, ['charId', 'characterId', 'char_id'])) return 'character';
    return 'npc';
}

function isSocialTone(value: unknown): value is SocialCommentTone {
    return typeof value === 'string' && SOCIAL_COMMENT_TONES.includes(value as SocialCommentTone);
}

function isSocialTargetType(value: unknown): value is SocialTargetType {
    return typeof value === 'string' && SOCIAL_TARGET_TYPES.includes(value as SocialTargetType);
}

function normalizeGeneratedTone(value: unknown): SocialCommentTone | undefined {
    return isSocialTone(value) ? value : undefined;
}

function normalizeGeneratedTargetType(value: unknown): SocialTargetType | undefined {
    return isSocialTargetType(value) ? value : undefined;
}

function defaultHandlesForCharacter(char: CharacterProfile): SubAccount[] {
    return [{
        id: 'default',
        handle: char.socialProfile?.handle || char.name,
        note: '主账号',
    }];
}

export function buildSocialIdentityIndex(
    characters: CharacterProfile[],
    characterHandles: Record<string, SubAccount[]>,
    socialProfile: SocialAppProfileLike,
    options: { userSparkId?: string } = {},
): SocialIdentityIndex {
    const charactersById = new Map<string, CharacterProfile>();
    const characterNames = new Set<string>();
    const handleLookup = new Map<string, SocialHandleRef>();
    const handlesByCharId = new Map<string, SocialHandleRef[]>();
    const reservedNpcNames = new Set<string>();
    const userName = compactText(socialProfile.name, 40);
    const userSparkId = compactText(options.userSparkId, 40);

    if (userName) reservedNpcNames.add(normalizeKey(userName));
    if (userSparkId) reservedNpcNames.add(normalizeKey(userSparkId));
    RESERVED_USER_ALIASES.forEach(name => reservedNpcNames.add(normalizeKey(name)));

    characters.forEach(char => {
        charactersById.set(char.id, char);
        characterNames.add(normalizeKey(char.name));
        reservedNpcNames.add(normalizeKey(char.name));
        const handles = characterHandles[char.id]?.length ? characterHandles[char.id] : defaultHandlesForCharacter(char);
        const refs = handles
            .filter(handle => handle.handle && handle.handle.trim())
            .map((handle): SocialHandleRef => ({
                charId: char.id,
                subAccountId: handle.id,
                handle: handle.handle.trim(),
                note: handle.note,
            }));
        handlesByCharId.set(char.id, refs);
        refs.forEach(ref => {
            const key = normalizeKey(ref.handle);
            handleLookup.set(key, ref);
            reservedNpcNames.add(key);
        });
    });

    return {
        userName,
        userSparkId,
        charactersById,
        characterNames,
        handleLookup,
        handlesByCharId,
        reservedNpcNames,
    };
}

export function isUserName(index: SocialIdentityIndex, name: string): boolean {
    const key = normalizeKey(name);
    return Boolean(key && (key === normalizeKey(index.userName) || key === normalizeKey(index.userSparkId) || RESERVED_USER_ALIASES.some(alias => key === normalizeKey(alias))));
}

export function isCharacterHandle(index: SocialIdentityIndex, name: string): boolean {
    return index.handleLookup.has(normalizeKey(name));
}

export function isCharacterName(index: SocialIdentityIndex, name: string): boolean {
    return index.characterNames.has(normalizeKey(name));
}

export function resolveCharacterHandle(
    index: SocialIdentityIndex,
    charId: string | undefined,
    handle: string,
): SocialHandleRef | null {
    if (!charId) return null;
    const refs = index.handlesByCharId.get(charId) || [];
    const key = normalizeKey(handle);
    return refs.find(ref => normalizeKey(ref.handle) === key) || null;
}

export function isValidCharacterHandle(index: SocialIdentityIndex, charId: string | undefined, handle: string): boolean {
    return Boolean(resolveCharacterHandle(index, charId, handle));
}

function inferStoredAuthor(
    index: SocialIdentityIndex,
    authorName: string,
    rawType?: SocialAuthorType,
    rawCharId?: string,
    rawHandle?: string,
): {
    authorType: SocialAuthorType;
    charId?: string;
    subAccountId?: string;
    authorHandle?: string;
} {
    const handleName = rawHandle || authorName;
    if (rawType === 'character') {
        const ref = resolveCharacterHandle(index, rawCharId, handleName);
        if (ref) {
            return {
                authorType: 'character',
                charId: ref.charId,
                subAccountId: ref.subAccountId,
                authorHandle: ref.handle,
            };
        }
    }
    if (rawType === 'user' || isUserName(index, authorName)) {
        return { authorType: 'user' };
    }
    const ref = index.handleLookup.get(normalizeKey(handleName)) || index.handleLookup.get(normalizeKey(authorName));
    if (ref) {
        return {
            authorType: 'character',
            charId: ref.charId,
            subAccountId: ref.subAccountId,
            authorHandle: ref.handle,
        };
    }
    return { authorType: 'npc' };
}

export function normalizeStoredSocialComment(index: SocialIdentityIndex, comment: SocialComment): SocialComment {
    const inferred = inferStoredAuthor(index, comment.authorName, comment.authorType, comment.charId, comment.authorHandle);
    return {
        ...comment,
        ...inferred,
        authorName: inferred.authorType === 'character' ? inferred.authorHandle || comment.authorName : comment.authorName,
        isCharacter: inferred.authorType === 'character',
    };
}

export function normalizeStoredSocialPost(index: SocialIdentityIndex, post: SocialPost): SocialPost {
    const inferred = inferStoredAuthor(index, post.authorName, post.authorType, post.charId, post.authorHandle);
    const comments = (post.comments || []).map(comment => normalizeStoredSocialComment(index, comment));
    return {
        ...post,
        ...inferred,
        authorName: inferred.authorType === 'character' ? inferred.authorHandle || post.authorName : post.authorName,
        comments,
    };
}

function containsAnyNormalized(text: string, values: Iterable<string>): boolean {
    const source = normalizeKey(text);
    if (!source) return false;
    for (const value of values) {
        const key = normalizeKey(value);
        if (key && source.includes(key)) return true;
    }
    return false;
}

function contentHasPrivateLeak(index: SocialIdentityIndex, content: string): boolean {
    if (!content.trim()) return false;
    if (containsAnyNormalized(content, [index.userName, index.userSparkId || ''])) return true;
    if (containsAnyNormalized(content, PRIVATE_LEAK_TERMS)) return true;
    for (const char of index.charactersById.values()) {
        if (containsAnyNormalized(content, [char.name])) return true;
    }
    for (const ref of index.handleLookup.values()) {
        if (containsAnyNormalized(content, [ref.handle])) return true;
    }
    return false;
}

export function generateLocalNpcName(seed: string | number = Date.now()): string {
    const source = String(seed);
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return LOCAL_NPC_NAME_POOL[hash % LOCAL_NPC_NAME_POOL.length];
}

function normalizeNpcAuthorName(index: SocialIdentityIndex, authorName: string, content: string, seed: string | number): string | null {
    const safeName = compactText(authorName, 24) || generateLocalNpcName(seed);
    const key = normalizeKey(safeName);
    const collides = !key || index.reservedNpcNames.has(key) || isCharacterName(index, safeName) || isCharacterHandle(index, safeName) || isUserName(index, safeName);
    if (!collides) return safeName;
    if (contentHasPrivateLeak(index, content)) return null;
    return generateLocalNpcName(seed);
}

function normalizeGeneratedCharacterAuthor(
    index: SocialIdentityIndex,
    record: GeneratedRecord,
    options: NormalizeGeneratedOptions,
): SocialHandleRef | null {
    const charId = readString(record, ['charId', 'characterId', 'char_id']);
    const authorName = readString(record, ['authorName', 'author', 'name', 'nickname', 'authorHandle', 'handle']);
    if (!charId || !index.charactersById.has(charId)) return null;
    if (options.allowedCharacterIds && !options.allowedCharacterIds.has(charId)) return null;
    return resolveCharacterHandle(index, charId, authorName);
}

function normalizeEmojiList(value: unknown): string[] {
    if (Array.isArray(value)) {
        const emojis = value.map(item => compactText(item, 8)).filter(Boolean).slice(0, 4);
        if (emojis.length > 0) return emojis;
    }
    const emoji = compactText(value, 8);
    return emoji ? [emoji] : ['✨'];
}

export function normalizeGeneratedSocialPost(
    index: SocialIdentityIndex,
    raw: unknown,
    options: NormalizeGeneratedOptions,
    position: number,
): NormalizedGeneratedPost | null {
    if (!isRecord(raw)) return null;
    const authorType = normalizeGeneratedAuthorType(raw);
    if (authorType === 'user') return null;

    const content = compactText(readString(raw, ['content', 'body', 'text']), 600);
    if (!content) return null;
    const title = compactText(readString(raw, ['title', 'headline']), 80) || '无标题';
    const likes = readNumber(raw, ['likes', 'likeCount'], 0);

    if (authorType === 'character') {
        const ref = normalizeGeneratedCharacterAuthor(index, raw, options);
        const char = ref ? index.charactersById.get(ref.charId) : null;
        if (!ref || !char) return null;
        return {
            authorType: 'character',
            authorName: ref.handle,
            authorAvatar: char.avatar,
            charId: ref.charId,
            subAccountId: ref.subAccountId,
            authorHandle: ref.handle,
            title,
            content,
            emojis: normalizeEmojiList(raw.emojis ?? raw.images ?? raw.emoji),
            likes,
        };
    }

    const authorName = normalizeNpcAuthorName(index, readString(raw, ['authorName', 'author', 'name', 'nickname']), content, `${position}:${content}`);
    if (!authorName) return null;
    return {
        authorType: 'npc',
        authorName,
        title,
        content,
        emojis: normalizeEmojiList(raw.emojis ?? raw.images ?? raw.emoji),
        likes,
    };
}

export function normalizeGeneratedSocialComment(
    index: SocialIdentityIndex,
    raw: unknown,
    options: NormalizeGeneratedOptions,
    position: number,
): NormalizedGeneratedComment | null {
    if (!isRecord(raw)) return null;
    const authorType = normalizeGeneratedAuthorType(raw);
    if (authorType === 'user') return null;

    const content = compactText(readString(raw, ['content', 'body', 'text', 'comment']), 280);
    if (!content) return null;
    const tone = normalizeGeneratedTone(raw.tone);
    const targetType = normalizeGeneratedTargetType(raw.targetType);

    if (authorType === 'character') {
        const ref = normalizeGeneratedCharacterAuthor(index, raw, options);
        const char = ref ? index.charactersById.get(ref.charId) : null;
        if (!ref || !char) return null;
        return {
            authorType: 'character',
            authorName: ref.handle,
            authorAvatar: char.avatar,
            content,
            likes: readNumber(raw, ['likes', 'likeCount'], Math.floor(Math.random() * 100)),
            isCharacter: true,
            charId: ref.charId,
            subAccountId: ref.subAccountId,
            authorHandle: ref.handle,
            tone,
            targetType,
        };
    }

    const authorName = normalizeNpcAuthorName(index, readString(raw, ['authorName', 'author', 'name', 'nickname']), content, `${position}:${content}`);
    if (!authorName) return null;
    return {
        authorType: 'npc',
        authorName,
        content,
        likes: readNumber(raw, ['likes', 'likeCount'], Math.floor(Math.random() * 100)),
        isCharacter: false,
        tone,
        targetType,
    };
}

function containsBannedComfortPhrase(content: string): boolean {
    return BANNED_COMFORT_PHRASES.some(phrase => content.includes(phrase));
}

function isComfortComment(comment: NormalizedGeneratedComment): boolean {
    return (comment.tone ? COMFORT_TONES.has(comment.tone) : false) || containsBannedComfortPhrase(comment.content);
}

function uniqueDefined<T>(values: Array<T | undefined>): T[] {
    return [...new Set(values.filter((value): value is T => Boolean(value)))];
}

function extractUserAnchors(userContent: string): string[] {
    const normalized = userContent.replace(/[，。！？、,.!?;；:："'“”‘’()[\]{}<>《》]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = normalized.split(' ').map(part => part.trim()).filter(part => part.length >= 2);
    const anchors = new Set<string>();
    parts.forEach(part => {
        anchors.add(part.slice(0, Math.min(part.length, 8)));
        if (part.length > 4) anchors.add(part.slice(-Math.min(part.length, 8)));
    });
    const compact = normalized.replace(/\s+/g, '');
    if (compact.length >= 2) {
        const step = compact.length <= 8 ? 2 : 3;
        for (let i = 0; i <= compact.length - step; i += 1) {
            const anchor = compact.slice(i, i + step);
            if (!/^(哈哈|啊啊|真的|感觉|这个|那个|就是|可以)$/.test(anchor)) anchors.add(anchor);
        }
    }
    return [...anchors].slice(0, 12);
}

export function replyAnchorsUserContent(comments: NormalizedGeneratedComment[], userContent: string): boolean {
    const anchors = extractUserAnchors(userContent);
    if (anchors.length === 0) return comments.some(comment => comment.targetType === 'user_comment');
    return comments.some(comment => (
        comment.targetType === 'user_comment'
        && anchors.some(anchor => comment.content.includes(anchor))
    ));
}

export function normalizeGeneratedSocialCommentsBatch(
    index: SocialIdentityIndex,
    rawItems: unknown,
    options: NormalizeGeneratedOptions,
): NormalizedGeneratedBatch<NormalizedGeneratedComment> {
    const issues: string[] = [];
    const source = Array.isArray(rawItems) ? rawItems : [];
    const items = source
        .map((item, position) => normalizeGeneratedSocialComment(index, item, options, position))
        .filter((item): item is NormalizedGeneratedComment => Boolean(item));

    if (items.length === 0) issues.push('no_valid_comments');

    const tones = uniqueDefined(items.map(item => item.tone));
    if (items.length > 1 && tones.length === 1) issues.push('tone_not_diverse');

    if (options.mode === 'comment' && items.length > 1 && items.every(isComfortComment)) {
        issues.push('all_comments_are_comfort');
    }

    if (
        options.mode === 'reply'
        && options.userContent
        && !replyAnchorsUserContent(items, options.userContent)
    ) {
        issues.push('reply_not_anchored_to_user_content');
    }

    return {
        items,
        shouldRetry: issues.length > 0,
        issues,
    };
}

export function normalizeGeneratedSocialPostsBatch(
    index: SocialIdentityIndex,
    rawItems: unknown,
    options: NormalizeGeneratedOptions,
): NormalizedGeneratedBatch<NormalizedGeneratedPost> {
    const source = Array.isArray(rawItems) ? rawItems : [];
    const items = source
        .map((item, position) => normalizeGeneratedSocialPost(index, item, options, position))
        .filter((item): item is NormalizedGeneratedPost => Boolean(item));
    const issues = items.length === 0 ? ['no_valid_posts'] : [];
    return {
        items,
        shouldRetry: issues.length > 0,
        issues,
    };
}

export function buildSparkIdentityBoundaryPrompt(input: {
    userName: string;
    userSparkId?: string;
}): string {
    const sparkIdLine = input.userSparkId ? `- 当前 Spark ID: "${input.userSparkId}"。` : '- 当前 Spark ID 未设置或不可用。';
    return `【Spark 身份边界协议】
- 当前用户只有一个：Spark 用户 "${input.userName}"。
${sparkIdLine}
- 角色档案里的 “User/用户/你/宝宝/主人” 只描述该角色与当前用户的私聊关系，不能自动套用到 Spark 中的其他发帖人。
- 当帖子作者是 character 或 npc 时，他/她就是独立发帖人，不是当前用户。
- 只有帖子或评论明确提到 "${input.userName}"、当前 Spark ID，或字段 targetType === "user_comment" / targetType === "user" 时，才能把内容理解为指向当前用户。
- 女 char 发帖时，男 char 必须把她当作该女 char，而不是当作 user。
- 路人评论/回复只能用 npc 身份，不能顶着角色名字。
- 角色马甲只能用于该角色本人发言，且必须符合角色设定、语气和上下文。
- 模型不得生成当前用户署名的帖子、评论或回复。`;
}

export function buildSocialCommentQualityPrompt(): string {
    return `【评论质量规则】
- 每条评论必须锚定帖子标题、正文、楼主身份、用户刚发的评论中的至少一个具体信息点。
- 不要输出万能安慰句、空泛祝福句、无上下文鸡汤。
- 禁用高频模板句，除非原帖语境明确需要：“抱抱你”“慢慢来”“时间会治愈一切”“大家都会好起来”“交给时间吧”“别想太多”。
- 路人评论要像真实网友：可以短，可以偏题，可以玩梗，可以锐评，可以追问，但必须和当前帖子/评论有关。
- 角色评论要体现角色自己的语气、关系边界和马甲用途；不要把私聊中对 user 的称呼套给其他发帖人。
- 每批输出中不要连续生成相同句式。
- tone 字段要有变化，不要整批都输出“共情”或同一种语气。
- targetType 必须按真实指向填写；如果 post 作者不是 user，不要默认把 targetType 写成 user_comment。`;
}

export function buildSocialMessages(systemPrompt: string, taskPrompt: string, preferSystemRole = true): SocialChatMessage[] {
    if (!preferSystemRole) {
        return [{ role: 'user', content: `${systemPrompt}\n\n${taskPrompt}` }];
    }
    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: taskPrompt },
    ];
}
