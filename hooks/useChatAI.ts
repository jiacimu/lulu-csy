
import { useState,useRef,useCallback } from 'react';
import { CharacterProfile,UserProfile,Message,Emoji,EmojiCategory,GroupProfile,RealtimeConfig } from '../types';
import { DB } from '../utils/db';
import { ChatPrompts } from '../utils/chatPrompts';
import { ChatParser,BILINGUAL_MARKER } from '../utils/chatParser';
import { safeFetchJson } from '../utils/safeApi';
import { haptic,playThemeNotification } from '../utils/haptics';
import { THEME_PLUGINS } from '../components/chat/ThemeRegistry';
import { VectorMemoryExtractor } from '../utils/vectorMemoryExtractor';
import { MindSnapshotExtractor } from '../utils/mindSnapshotExtractor';
import { EventExtractor } from '../utils/eventExtractor';
import { extractThinking } from '../utils/thinkingExtractor';
import { getEmbeddingConfig,getSecondaryApiConfig } from '../utils/runtimeConfig';
import type { HandlerContext } from './handlers/types';
import { handleRecall } from './handlers/handleRecall';
import { handleSearch } from './handlers/handleSearch';
import { handleWeiboSearch } from './handlers/handleWeiboSearch';
import { handleDiaryWrite } from './handlers/handleDiaryWrite';
import { handleDiaryRead } from './handlers/handleDiaryRead';
import { handleFeishuDiary } from './handlers/handleFeishuDiary';
import { handleFeishuDiaryRead } from './handlers/handleFeishuDiaryRead';
import { handleXhsActions } from './handlers/handleXhsActions';
import type { SongCardMetadata } from '../types/music';
import { searchSongs } from '../utils/musicService';
import { getCurrentPlayback } from './useAudioPlayer';
import {
    getPlaybackLyricKey,
    getPlaybackLyricSnapshot,
    shouldInjectPlaybackLyricSnapshot,
} from '../utils/playbackLyricsRuntime';

interface UseChatAIProps {
    char: CharacterProfile | undefined;
    userProfile: UserProfile;
    apiConfig: any;
    groups: GroupProfile[];
    emojis: Emoji[];
    categories: EmojiCategory[];
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    setMessages: (msgs: Message[]) => void; // Callback to update UI messages
    realtimeConfig?: RealtimeConfig; // 新增：实时配置
    translationConfig?: { enabled: boolean; sourceLang: string; targetLang: string };
    autoVoice?: boolean; // 开启后向 AI 注入语音消息格式指引
    onVoiceMessageSaved?: (msgId: number, text: string) => void; // 语音消息保存后的回调（用于触发 TTS）
    autoCall?: boolean; // 开启后向 AI 注入主动来电指引
    onIncomingCall?: (mode: string, callReason: string) => void; // AI 触发来电时的回调
    autoShareSong?: boolean; // 开启后向 AI 注入歌曲分享指引
    injectPlaybackContext?: boolean; // 开启后向 AI 注入当前播放歌曲上下文
    onMoodUpdate?: (charId: string, moodState: any, statusCardData?: any) => void; // MindSnapshot / CreativeCard 完成后回调
}

export const useChatAI = ({
    char,
    userProfile,
    apiConfig,
    groups,
    emojis,
    categories,
    addToast,
    setMessages,
    realtimeConfig,  // 新增
    translationConfig,
    autoVoice,
    onVoiceMessageSaved,
    autoCall,
    onIncomingCall,
    autoShareSong,
    injectPlaybackContext,
    onMoodUpdate
}: UseChatAIProps) => {

    const [isTyping, setIsTyping] = useState(false);
    const [recallStatus, setRecallStatus] = useState<string>('');
    const [searchStatus, setSearchStatus] = useState<string>('');
    const [diaryStatus, setDiaryStatus] = useState<string>('');
    const [xhsStatus, setXhsStatus] = useState<string>('');
    const [weiboStatus, setWeiboStatus] = useState<string>('');
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [tokenBreakdown, setTokenBreakdown] = useState<{ prompt: number; completion: number; total: number; msgCount: number; pass: string } | null>(null);

    // MindSnapshot retry context
    const lastMindSnapshotCtx = useRef<{ char: any; aiContent: string; msgs: Message[]; config: any } | null>(null);

    // 跨消息持久化的 noteId→xsecToken 缓存，避免 lastXhsNotes 局部变量每次 triggerAI 都重置
    const xsecTokenCacheRef = useRef<Map<string, string>>(new Map());
    // noteId→title 缓存，用于 detail 失败时重新搜索拿新 token
    const noteTitleCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→userId 缓存，reply_comment 需要 user_id 帮助 MCP 服务端定位评论
    const commentUserIdCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→authorName 缓存，reply 降级为顶级评论时用 @authorName 让回复有上下文
    const commentAuthorNameCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→parentCommentId 缓存，供 reply_comment 传递 parent_comment_id（xiaohongshu-mcp PR#440+）
    const commentParentIdCacheRef = useRef<Map<string, string>>(new Map());
    const lastInjectedPlaybackLyricKeyRef = useRef<string | null>(null);



    const updateTokenUsage = (data: any, msgCount: number, pass: string) => {
        if (data.usage?.total_tokens) {
            setLastTokenUsage(data.usage.total_tokens);
            const breakdown = {
                prompt: data.usage.prompt_tokens || 0,
                completion: data.usage.completion_tokens || 0,
                total: data.usage.total_tokens,
                msgCount,
                pass
            };
            setTokenBreakdown(breakdown);
            console.log(`🔢 [Token Usage] pass=${pass} | prompt=${breakdown.prompt} completion=${breakdown.completion} total=${breakdown.total} | msgs_in_context=${msgCount}`);
        }
    };

    const triggerAI = async (currentMsgs: Message[]) => {
        if (isTyping || !char) return;
        if (!apiConfig.baseUrl) { alert("请先在设置中配置 API URL"); return; }

        setIsTyping(true);
        setRecallStatus('');

        try {
            const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}` };

            // 0. Internal State Layer: senseBefore (和下方 buildSystemPrompt 的 embedding/rerank 并行)
            const secondaryConfig = getSecondaryApiConfig() || apiConfig;

            // Run senseBefore in parallel with buildSystemPrompt
            const embeddingApiKey = getEmbeddingConfig().apiKey || undefined;
            const playbackContextPromise = injectPlaybackContext
                ? (async () => {
                    const playback = getCurrentPlayback();
                    if (!playback.currentSong || !playback.isPlaying) return null;

                    return {
                        playback,
                        lyricSnapshot: await getPlaybackLyricSnapshot(
                            playback.currentSong.id,
                            playback.currentTime,
                        ),
                    };
                })().catch((error) => {
                    console.error('🎵 [PlaybackContext] Snapshot error:', error);
                    return null;
                })
                : Promise.resolve(null);

            const [senseResult, systemPromptResult, playbackContext] = await Promise.all([
                secondaryConfig.apiKey
                    ? MindSnapshotExtractor.senseBefore(char, currentMsgs, secondaryConfig)
                        .catch(e => { console.error('💭 [Sense] Parallel error:', e); return null; })
                    : Promise.resolve(null),
                (async () => {
                    // If senseBefore finishes first and updates char.moodState (via DB persist),
                    // buildCoreContext will pick it up. But since they run in parallel,
                    // we also manually inject body signals after if needed.
                    return ChatPrompts.buildSystemPrompt(char, userProfile, groups, emojis, categories, currentMsgs, realtimeConfig, apiConfig, embeddingApiKey);
                })(),
                playbackContextPromise,
            ]);

            let systemPrompt = systemPromptResult;

            // If senseBefore returned a new state, update char in memory and notify UI
            if (senseResult && onMoodUpdate) {
                onMoodUpdate(char.id, senseResult);
                // Also update the local char ref so subsequent code sees the new state
                char.moodState = senseResult;
            }

            // 1.1 Inject voice message format instruction (only when autoVoice is enabled)
            if (autoVoice) {
                systemPrompt += `

[系统功能: 语音消息]
你现在可以发送语音消息。当你想发语音（比如叫名字、撒娇、说一句重要的话），请使用以下严格格式：
【语音消息：你说的话】

格式规则（必须遵守）：
- 必须用全角中文括号【】包裹，冒号为全角：
- 括号里只写你开口说的话，不写动作描述或"嗯""啊"等语气词
- 可以单独一条发，也可以出现在文字消息里
- 不是每次都要发语音，在合适时机偶尔使用即可
- 严禁写成 [语音消息] 或 (语音消息) 等其他形式

示例：
【语音消息：喂，你在吗？】
【语音消息：我刚下班，等一下啊。】`;
            }

            // 1.2 Inject incoming call instruction (only when autoCall is enabled)
            if (autoCall) {
                systemPrompt += `\n\n[系统功能: 主动来电]
你可以主动给用户打电话。当你觉得有必要用电话沟通时（比如想听声音、深夜关心、重要的话想当面说），
请单独起一行输出：[[CALL: mode]]
mode 可选值：
- daily（日常聊聊）
- confide（有心事想说）
- truth（想坦白什么）
- sleep（想陪用户入睡）
规则：
- 不要频繁打电话，在合适的情绪节点自然触发
- 输出 [[CALL: mode]] 后不要再写其他文字
- 严禁在同一条回复里既打电话又发消息`;
            }

            if (autoShareSong) {
                systemPrompt += `\n\n[系统功能: 分享歌曲]
当你想分享一首歌给${userProfile.name}时，使用以下严格格式：
[[SHARE_SONG: 歌名 | 歌手名 | 歌曲ID]]

规则：
- 只在聊到音乐、情绪、回忆、陪伴或推荐相关话题时自然使用，不需要每次都分享
- 如果知道真实歌曲 ID，优先填写真实 ID
- 如果暂时不知道歌曲 ID，可以写 0，系统仍会按歌名和歌手生成分享卡片

示例：
[[SHARE_SONG: 晴天 | 周杰伦 | 0]]`;
            }

            if (injectPlaybackContext) {
                const playback = playbackContext?.playback;
                if (playback?.currentSong && playback.isPlaying) {
                    const song = playback.currentSong;
                    const artistNames = song.artists.map((artist) => artist.name).join('/');

                    systemPrompt += `\n\n[情境补充：此刻你和${userProfile.name}耳边流着同一首歌，《${song.name}》- ${artistNames}。]`;
                    systemPrompt += `\n\n这首歌不需要被反复提起，它只是此刻安静流过你们对话的背景。你知道，${userProfile.name}此刻也听见了同样的旋律、同样的停顿，以及那些一闪而过、还没来得及说破的情绪。`;
                    systemPrompt += `\n\n你不用刻意聊歌，不用解释歌，也不用把这件事挂在嘴边。只要记住，你和${userProfile.name}现在正被同一首歌轻轻连着；这会自然影响你的语气、心情、停顿，和那些差一点就要说出口的话。`;

                    const lyricSnapshot = playbackContext?.lyricSnapshot ?? null;
                    if (shouldInjectPlaybackLyricSnapshot(
                        lyricSnapshot,
                        lastInjectedPlaybackLyricKeyRef.current,
                    )) {
                        const translationBlock = lyricSnapshot.currentTranslation
                            ? `\n${lyricSnapshot.currentTranslation}`
                            : '';
                        systemPrompt += `\n\n此刻歌里正好唱到：\n\n「${lyricSnapshot.currentText}」${translationBlock}\n\n这一句也落在你耳边。你不必说破，也不要复述或解释它；若它恰好碰到你此刻的心绪，就让那一点点余韵自然落进你的回复里。若没有，就让它留在背景。`;
                        lastInjectedPlaybackLyricKeyRef.current = getPlaybackLyricKey(lyricSnapshot);
                    }
                }
            }

            // 1.5 Inject bilingual output instruction when translation is enabled
            const bilingualActive = translationConfig?.enabled && translationConfig.sourceLang && translationConfig.targetLang;
            if (bilingualActive) {
                systemPrompt += `\n\n[CRITICAL: 双语输出模式 - 必须严格遵守]
你的每句话都必须用以下XML标签格式输出双语内容：
<翻译>
<原文>${translationConfig.sourceLang}内容</原文>
<译文>${translationConfig.targetLang}内容</译文>
</翻译>

规则：
- 每句话单独包裹一个<翻译>标签
- 多句话就输出多个<翻译>标签，一句一个
- <翻译>标签外不要写任何文字
- 表情包命令 [[SEND_EMOJI: ...]] 放在所有<翻译>标签外面

示例（${translationConfig.sourceLang}→${translationConfig.targetLang}）：
<翻译>
<原文>こんにちは！</原文>
<译文>你好！</译文>
</翻译>
<翻译>
<原文>今日は何する？</原文>
<译文>今天做什么？</译文>
</翻译>`;
            }

            // 2. Build Message History
            // CRITICAL: Load full message history from DB up to contextLimit,
            // not from React state which is capped at 200 for rendering performance
            const limit = char.contextLimit || 500;
            let contextMsgs = currentMsgs;
            if (limit > currentMsgs.length && char.id) {
                try {
                    const fullHistory = await DB.getRecentMessagesByCharId(char.id, limit);
                    if (fullHistory.length > currentMsgs.length) {
                        console.log(`📊 [Context] Loaded ${fullHistory.length} msgs from DB (React state had ${currentMsgs.length}, contextLimit=${limit})`);
                        contextMsgs = fullHistory;
                    }
                } catch (e) {
                    console.error('Failed to load full history from DB, using React state:', e);
                }
            }
            const { apiMessages, historySlice } = ChatPrompts.buildMessageHistory(contextMsgs, limit, char, userProfile, emojis);

            // 2.5 Strip translation content from previous messages to save tokens
            const cleanedApiMessages = apiMessages.map((msg: any) => {
                if (typeof msg.content !== 'string') return msg;
                let c = msg.content;
                // Strip old %%BILINGUAL%% format (both spaced and non-spaced variants)
                const biRe = /%%\s*BILINGUAL\s*%%/i;
                if (biRe.test(c)) {
                    const idx = c.search(biRe);
                    c = c.substring(0, idx).trim();
                }
                // Strip new XML tag format: keep only <原文> content
                if (c.includes('<翻译>')) {
                    c = c.replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1').trim();
                }
                return { ...msg, content: c };
            });

            const fullMessages = [{ role: 'system', content: systemPrompt }, ...cleanedApiMessages];

            // Find the true last user message to attach strict instructions to
            const lastUserIdx = fullMessages.map(m => m.role).lastIndexOf('user');
            
            // 2.55 Inject STT tolerance prompt if last user message is a voice recording
            if (lastUserIdx >= 0) {
                const lastUserMsg = fullMessages[lastUserIdx];
                if (typeof lastUserMsg.content === 'string' && lastUserMsg.content.includes('[🎤用户语音]')) {
                    lastUserMsg.content += '\n\n[系统提示：你刚才听到的语音消息部分文字由设备自动识别，可能存在同音字或漏字，请结合上下文理解原意包容回复]';
                }
            }

            // Debug: Log context composition
            const systemPromptLength = systemPrompt.length;
            const historyMsgCount = cleanedApiMessages.length;
            const historyTotalChars = cleanedApiMessages.reduce((sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
            console.log(`📊 [Context Debug] system_prompt_chars=${systemPromptLength} | history_msgs=${historyMsgCount} | history_chars=${historyTotalChars} | total_msgs_in_array=${fullMessages.length} | contextLimit=${limit}`);

            // 2.6 & 3.0: Attach mandatory format instructions directly to the last user message
            // This prevents "messages must end with user" validation errors on strict proxies
            // when the assistant prefill is disabled or removed during fallback.
            let trailingInstructions = '';
            
            if (bilingualActive) {
                trailingInstructions += `\n\n[Reminder: 每句话必须用 <翻译><原文>...</原文><译文>...</译文></翻译> 标签包裹。一句一个标签。绝对不能省略。]`;
            }

            trailingInstructions += `\n\n[思考链格式锁定]\n请严格遵循以下输出流程：\n1. 先在 <thinking>...</thinking> 中完成全部思考\n2. 思考完毕后，必须输出 </thinking> 闭合标签\n3. 闭合标签后，立即输出角色的正文回复（不要遗漏！）\n4. 正文中不得包含任何 <thinking> 标签或思考过程\n\n格式：\n<thinking>\n（你的思考过程）\n</thinking>\n（角色正文回复）\n\n严禁只输出思考而遗漏正文。思考链闭合后必须紧跟正文内容。\n\n━━━━━━━━━━━━━━━\n<!--\nif 首段不是<thinking>标签 then\n    立即回滚本轮并重写，直至首段为<thinking>…</thinking>\nend if\n-->\n━━━━━━━━━━━━━━━`;

            if (lastUserIdx >= 0 && typeof fullMessages[lastUserIdx].content === 'string') {
                fullMessages[lastUserIdx].content += trailingInstructions;
            } else {
                fullMessages.push({ role: 'user', content: `[系统执行指令]${trailingInstructions}` });
            }

            // 3.0a Prefill injection — force CoT <thinking> start
            // Controlled via settings to support buggy proxies that block prefill (and eat tokens)
            const usePrefill = !apiConfig.disablePrefill;
            if (usePrefill) {
                fullMessages.push({ role: 'assistant', content: '<thinking>' });
                console.log('🧩 [Prefill] Injected <thinking> prefill assistant message');
            }

            // Claude API 兼容：确保最后一条 assistant 消息无尾部空白
            const sanitizeLast = () => {
                const last = fullMessages[fullMessages.length - 1];
                if (last?.role === 'assistant' && typeof last.content === 'string') {
                    last.content = last.content.trimEnd();
                }
            };
            sanitizeLast();

            let requestBody: Record<string, any> = {
                model: apiConfig.model,
                messages: fullMessages,
                temperature: 0.85,
                stream: false,
            };

            let data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify(requestBody)
            });
            updateTokenUsage(data, historyMsgCount, 'initial');

            // 3.5 Check for empty API responses (e.g. content filters, max context limits)
            if (!data.choices || data.choices.length === 0) {
                const errMsg = data.error?.message || data.error || data.msg || JSON.stringify(data);
                throw new Error(`API 返回空结果或拦截: ${errMsg}`);
            }

            // 4. Initial Cleanup
            let aiContent = data.choices[0]?.message?.content || '';
            if (!aiContent.trim()) {
                const finishReason = data.choices[0]?.finish_reason;
                const hint = finishReason ? ` (Finish Reason: ${finishReason})` : '';
                throw new Error(`AI 生成了空白内容。可能是触发了风控拦截，或者超出了该模型的上下文窗口上限${hint}。请尝试清理聊天上下文或更换更大上下文的模型。`);
            }

            // 4.0 Extract thinking chain — try native Gemini thinking field first,
            // then fall back to <thinking>/<think> tag extraction for DeepSeek/Qwen3.
            // Gemini returns thinking in message.reasoning_content or via content_parts.
            const nativeThinking: string = (
                data.choices[0]?.message?.reasoning_content ||
                data.choices[0]?.message?.thinking ||
                ''
            );

            // 4.0a Prefill reconstruction — restore the <thinking> opening tag
            // ONLY if we used prefill AND the model didn't use the native reasoning channel.
            // (If nativeThinking exists, the text content is pure message, no need to pollute it)
            if (usePrefill && !nativeThinking && !aiContent.includes('<thinking>') && !aiContent.includes('<think>')) {
                aiContent = '<thinking>\n' + aiContent;
                console.log('🧩 [Prefill] Reconstructed <thinking> tag onto response (Fallback mode)');
            }

            console.log(`🧠 [ThinkingDebug] useGeminiJailbreak=${apiConfig.useGeminiJailbreak} | raw length=${aiContent.length} | nativeThinking length=${nativeThinking.length} | has <thinking>=${aiContent.includes('<thinking>')} | has <think>=${aiContent.includes('<think>')}`);
            console.log(`🧠 [ThinkingDebug] RAW AI OUTPUT (first 500 chars):`, aiContent.substring(0, 500));

            // Extract embedded text thinking if present
            const extracted = extractThinking(aiContent);
            // Prefer native thinking field; fall back to text-embedded tags
            const thinkingContent = nativeThinking.trim() || extracted.thinking || '';
            
            // ALWAYS use the extracted content, which safely strips all thinking tags.
            // This prevents the tag leak when nativeThinking is true, and fixes unclosed tag leaks.
            aiContent = extracted.content;

            // 4.1 FORMAT VALIDATION — Thinking Chain Lock enforcement
            // If we got thinking but NO actual content, the model "dropped" the format.
            // Auto-retry once without prefill to recover.
            if (thinkingContent && !aiContent.trim()) {
                console.warn('🔒 [ChainLock] Format drop detected! Got thinking but no content. Retrying without prefill...');
                try {
                    // Remove the prefill assistant message and thinking chain lock for retry
                    const retryMessages = fullMessages.filter(m => 
                        !(m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('<thinking>'))
                    );
                    
                    // The thinking chain lock was injected into the last user message, we need to remove it
                    const rLastUserIdx = retryMessages.map(m => m.role).lastIndexOf('user');
                    if (rLastUserIdx >= 0 && typeof retryMessages[rLastUserIdx].content === 'string') {
                        retryMessages[rLastUserIdx].content = retryMessages[rLastUserIdx].content.replace(/\[思考链格式锁定\][\s\S]*?━━━━━━━━━━━━━━━/, '');
                        // Add a direct instruction instead
                        retryMessages[rLastUserIdx].content += '\n\n[系统: 请直接输出角色的回复正文，不需要 <thinking> 标签。]';
                    } else {
                        retryMessages.push({ role: 'user', content: '[系统: 请直接输出角色的回复正文，不需要 <thinking> 标签。]' });
                    }
                    
                    const retryBody = { model: apiConfig.model, messages: retryMessages, temperature: 0.85, stream: false };
                    const retryData = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify(retryBody)
                    });
                    updateTokenUsage(retryData, historyMsgCount, 'chainlock-retry');
                    const retryContent = retryData.choices?.[0]?.message?.content || '';
                    if (retryContent.trim()) {
                        const retryExtracted = extractThinking(retryContent);
                        aiContent = retryExtracted.content || retryContent;
                        console.log('🔒 [ChainLock] Retry succeeded, recovered content length:', aiContent.length);
                    } else {
                        console.warn('🔒 [ChainLock] Retry also returned empty. Using thinking as fallback.');
                        aiContent = thinkingContent; // Last resort: show thinking as content
                    }
                } catch (retryErr) {
                    console.error('🔒 [ChainLock] Retry failed:', retryErr);
                    aiContent = thinkingContent; // Fallback
                }
            }

            // CLEAN UP prefixes and timestamps LAST, so the regex anchors correctly
            // at the start of the string (now that <thinking> is gone!)
            aiContent = ChatParser.cleanAiSecondPass(aiContent);

            console.log(`🧠 [ThinkingDebug] final thinkingContent length=${thinkingContent.length}, preview:`, thinkingContent.substring(0, 200));

            const hadSecondPassFallbackTrigger = /\[\[(?:SEARCH|READ_DIARY|FS_READ_DIARY):/.test(aiContent);

            const handlerContext: HandlerContext = {
                char,
                userProfile,
                apiConfig,
                realtimeConfig,
                fullMessages,
                historyMsgCount,
                baseUrl,
                headers,
                setMessages,
                updateTokenUsage,
                addToast,
                setRecallStatus,
                setSearchStatus,
                setDiaryStatus,
                setWeiboStatus,
                setXhsStatus,
                xsecTokenCache: xsecTokenCacheRef.current,
                noteTitleCache: noteTitleCacheRef.current,
                commentUserIdCache: commentUserIdCacheRef.current,
                commentAuthorNameCache: commentAuthorNameCacheRef.current,
                commentParentIdCache: commentParentIdCacheRef.current,
            };

            aiContent = await handleRecall(aiContent, handlerContext);

            aiContent = await handleSearch(aiContent, handlerContext);

            aiContent = await handleWeiboSearch(aiContent, handlerContext);

            aiContent = await handleDiaryWrite(aiContent, handlerContext);

            aiContent = await handleDiaryRead(aiContent, handlerContext);

            aiContent = await handleFeishuDiary(aiContent, handlerContext);

            aiContent = await handleFeishuDiaryRead(aiContent, handlerContext);

            aiContent = await handleXhsActions(aiContent, handlerContext);

            // 6.5 Detect AI-initiated incoming call [[CALL: mode]]
            const callMatch = aiContent.match(/\[\[CALL:\s*(\w+)\]\]/);
            if (callMatch) {
                const callMode = callMatch[1].trim();
                console.log(`📞 [IncomingCall] AI triggered call with mode: ${callMode}`);
                aiContent = aiContent.replace(/\[\[CALL:\s*\w+\]\]/g, '').trim();

                // 提取最近 3 轮对话作为来电理由（供语音通话 AI 开场白使用）
                const recentMsgs = currentMsgs
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .slice(-6); // 最多 6 条（约 3 轮对话）
                const callReason = recentMsgs.map(m => {
                    const sender = m.role === 'user' ? userProfile.name : char.name;
                    return `${sender}: ${m.content.substring(0, 200)}`;
                }).join('\n');
                console.log(`📞 [IncomingCall] callReason (${recentMsgs.length} msgs):\n${callReason.substring(0, 300)}`);

                onIncomingCall?.(callMode, callReason);
            }

            // 7. Handle Quote/Reply Logic (Robust: handles [[QUOTE:...]], [QUOTE:...], typos like QUATE/QOUTE, Chinese 引用, and [回复 "..."] format)
            const QUOTE_RE_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:]\s*([\s\S]*?)\]\]/;
            const QUOTE_RE_SINGLE = /\[(?:QU[OA]TE|引用)[：:]\s*([^\]]*)\]/;
            // Match [回复 "content"] or [回复 "content"]: (AI mimics history context format)
            const REPLY_RE_CN = /\[回复\s*[""\u201C]([^""\u201D]*?)[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/;
            const QUOTE_CLEAN_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g;
            const QUOTE_CLEAN_SINGLE = /\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g;
            const REPLY_CLEAN_CN = /\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g;
            let aiReplyTarget: { id: number, content: string, name: string } | undefined;
            const firstQuoteMatch = aiContent.match(QUOTE_RE_DOUBLE) || aiContent.match(QUOTE_RE_SINGLE) || aiContent.match(REPLY_RE_CN);
            if (firstQuoteMatch) {
                const quotedText = firstQuoteMatch[1].trim();
                if (quotedText) {
                    // Try exact include first, then fuzzy match (first 10 chars)
                    const targetMsg = historySlice.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                        || (quotedText.length > 10 ? historySlice.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
                    if (targetMsg) {
                        const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                        aiReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
                    }
                }
            }
            // Clean all quote tag variants from content
            aiContent = aiContent.replace(QUOTE_CLEAN_DOUBLE, '').replace(QUOTE_CLEAN_SINGLE, '').replace(REPLY_CLEAN_CN, '').trim();

            // 8. Split and Stream (Simulate Typing)
            // Note: SEND_EMOJI tags are preserved through sanitize so splitResponse can interleave them with text

            // Comprehensive AI output sanitization (strips name prefixes, headers, stray backticks, residual tags, etc.)
            aiContent = ChatParser.sanitize(aiContent);

            // Fallback: if second-pass API calls (search/diary) returned empty, provide a minimal response
            if (!aiContent.trim() && hadSecondPassFallbackTrigger) {
                aiContent = '嗯...';
            }
            if (aiContent) {

                // Check for <翻译> XML tags (new bilingual format)
                const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

                let globalMsgIndex = 0;
                let firstSavedMsgId: number | null = null;
                let notificationPlayed = false;
                const playFirstNotification = () => {
                    if (notificationPlayed) { haptic.light(); return; }
                    notificationPlayed = true;
                    haptic.medium();
                    const themeId = char.bubbleStyle || 'default';
                    // Only play notification sound if this specific theme has one registered
                    // (do NOT fall back to 'default' — that is WeChat-specific)
                    const themePlugin = THEME_PLUGINS[themeId];
                    if (themePlugin?.notificationSound) playThemeNotification(themePlugin.notificationSound);
                };

                // --- Voice Message Detection — shared helper for both bilingual and normal paths ---
                // Regex moved here so both branches can use them
                // Pattern A: duration-based tag followed by (optionally quoted) content
                // e.g. [语音消息: 8秒] "喏？喏？..." or [语音消息:8s]「内容」
                const VOICE_DURATION_RE = /[【\[]语音(?:消息)?[：:]\s*(\d+)\s*(?:秒|s|sec)?[】\]]\s*["\u201C\u201D「『]?([\s\S]*?)["\u201C\u201D」』]?\s*(?:$|(?=[\n【\[]))/;
                // Pattern B: content fully wrapped in brackets
                // e.g. 【语音消息：喏？喏？...】or [语音消息：内容]
                const VOICE_WRAP_RE = /^([\s\S]*?)[【\[]语音(?:消息)?[：:]\s*([\s\S]+?)\s*[】\]](.*)$/;
                // Pattern C: XML-style voice tags (原版 SillyTavern 兼容)
                // e.g. <语音>你好呀~</语音>
                const VOICE_XML_RE = /^([\s\S]*?)<语音>([\s\S]+?)<\/语音>([\s\S]*)$/;

                /**
                 * Save a text chunk — if it contains a voice tag, split into text + voice message;
                 * otherwise save as plain text. Returns how many messages were saved.
                 */
                const saveTextOrVoiceChunk = async (
                    cleanChunk: string,
                    replyData: { id: number; content: string; name: string } | undefined
                ): Promise<number> => {
                    let saved = 0;
                    const durMatch = cleanChunk.match(VOICE_DURATION_RE);
                    const wrapMatch = !durMatch ? cleanChunk.match(VOICE_WRAP_RE) : null;
                    const xmlMatch = !durMatch && !wrapMatch ? cleanChunk.match(VOICE_XML_RE) : null;

                    if (durMatch) {
                        const tagStart = cleanChunk.search(/[【\[]语音(?:消息)?[：:]\s*\d/);
                        const textBefore = tagStart > 0 ? cleanChunk.slice(0, tagStart).trim() : '';
                        const durationSecs = parseInt(durMatch[1], 10) || 5;
                        const voiceText = durMatch[2].trim();

                        if (textBefore) {
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: textBefore, replyTo: replyData });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            await new Promise(r => setTimeout(r, 500));
                        }
                        if (voiceText) {
                            const savedVoiceId = await DB.saveMessage({
                                charId: char.id, role: 'assistant', type: 'voice',
                                content: voiceText,
                                metadata: { duration: durationSecs, sourceText: voiceText, hasAudio: false },
                                replyTo: textBefore ? undefined : replyData,
                            });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            onVoiceMessageSaved?.(savedVoiceId, voiceText);
                        }
                    } else if (wrapMatch) {
                        const textBefore = wrapMatch[1].trim();
                        const voiceText = wrapMatch[2].trim();
                        const textAfter = wrapMatch[3].trim();
                        const estimatedDuration = Math.max(2, Math.ceil(voiceText.length / 4));

                        if (textBefore) {
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: textBefore, replyTo: replyData });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            await new Promise(r => setTimeout(r, 500));
                        }
                        if (voiceText) {
                            const savedVoiceId2 = await DB.saveMessage({
                                charId: char.id, role: 'assistant', type: 'voice',
                                content: voiceText,
                                metadata: { duration: estimatedDuration, sourceText: voiceText, hasAudio: false },
                                replyTo: textBefore ? undefined : replyData,
                            });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            onVoiceMessageSaved?.(savedVoiceId2, voiceText);
                        }
                        if (textAfter) {
                            await new Promise(r => setTimeout(r, 400));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: textAfter });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            saved++;
                        }
                    } else if (xmlMatch) {
                        // XML-style voice tag: <语音>内容</语音> (原版兼容)
                        const textBefore = xmlMatch[1].trim();
                        const voiceText = xmlMatch[2].trim();
                        const textAfter = xmlMatch[3].trim();
                        const estimatedDuration = Math.max(2, Math.ceil(voiceText.length / 4));

                        if (textBefore) {
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: textBefore, replyTo: replyData });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            await new Promise(r => setTimeout(r, 500));
                        }
                        if (voiceText) {
                            const savedVoiceId3 = await DB.saveMessage({
                                charId: char.id, role: 'assistant', type: 'voice',
                                content: voiceText,
                                metadata: { duration: estimatedDuration, sourceText: voiceText, hasAudio: false },
                                replyTo: textBefore ? undefined : replyData,
                            });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                            saved++;
                            onVoiceMessageSaved?.(savedVoiceId3, voiceText);
                        }
                        if (textAfter) {
                            await new Promise(r => setTimeout(r, 400));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: textAfter });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            saved++;
                        }
                    } else {
                        // Normal text message
                        const savedId = await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: cleanChunk, replyTo: replyData });
                        if (firstSavedMsgId === null) firstSavedMsgId = savedId;
                        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                        playFirstNotification();
                        saved++;
                    }
                    return saved;
                };

                const saveSongCard = async (
                    songCard: SongCardMetadata,
                    replyData: { id: number; content: string; name: string } | undefined,
                ): Promise<number> => {
                    // Auto-search: backfill real songId when AI outputs 0
                    if (songCard.songId === 0 && songCard.songName) {
                        try {
                            const query = songCard.artist
                                ? `${songCard.songName} ${songCard.artist}`
                                : songCard.songName;
                            const results = await searchSongs(query, 5);
                            if (results.songs && results.songs.length > 0) {
                                const match = results.songs[0];
                                songCard.songId = match.id;
                                songCard.artist = match.artists.map((a) => a.name).join('/');
                                songCard.albumName = match.album.name;
                                songCard.albumCover = match.album.picUrl;
                                songCard.duration = match.duration;
                            }
                        } catch (e) {
                            console.warn('[SongCard] Auto-search failed, keeping songId=0:', e);
                        }
                    }

                    const fallbackText = `分享了一首歌：${songCard.songName} - ${songCard.artist}`;
                    const savedId = await DB.saveMessage({
                        charId: char.id,
                        role: 'assistant',
                        type: 'text',
                        content: fallbackText,
                        metadata: songCard,
                        replyTo: replyData,
                    });
                    if (firstSavedMsgId === null) firstSavedMsgId = savedId;
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                    playFirstNotification();
                    return 1;
                };

                if (hasTranslationTags) {
                    // ─── New bilingual format: each <翻译> block = one bubble ───
                    // Extract emojis for bilingual path (splitResponse not used here)
                    const bilingualEmojis: string[] = [];
                    const bilingualSongs: SongCardMetadata[] = [];
                    let bEm;
                    const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                    while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                        const name = bEm[1].trim();
                        if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
                    }
                    let songMatch: RegExpExecArray | null;
                    const songPattern = /\[\[SHARE_SONG:\s*([\s\S]*?)\]\]/g;
                    while ((songMatch = songPattern.exec(aiContent)) !== null) {
                        const songCard = ChatParser.parseSongShareContent(songMatch[1]);
                        if (songCard) {
                            bilingualSongs.push({ type: 'song_card', ...songCard });
                        }
                    }
                    aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();
                    aiContent = aiContent.replace(/\[\[SHARE_SONG:\s*[\s\S]*?\]\]/g, '').trim();
                    const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
                    let lastIndex = 0;
                    let tagMatch;

                    while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                        // Save any plain text BEFORE this <翻译> block
                        const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                        if (textBefore) {
                            const cleaned = ChatParser.sanitize(textBefore);
                            if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                                const chunks = ChatParser.chunkText(cleaned);
                                for (const chunk of chunks) {
                                    if (!chunk) continue;
                                    const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                                    await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                    const saved = await saveTextOrVoiceChunk(chunk, replyData);
                                    globalMsgIndex += saved;
                                }
                            }
                        }

                        // Save the bilingual pair (stored as langA\n%%BILINGUAL%%\nlangB for renderer compatibility)
                        const originalText = ChatParser.sanitize(tagMatch[1].trim());
                        const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                        if (originalText || translatedText) {
                            const biContent = originalText && translatedText
                                ? `${originalText}\n${BILINGUAL_MARKER}\n${translatedText}`
                                : (originalText || translatedText);
                            const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                            await new Promise(r => setTimeout(r, Math.min(Math.max(biContent.length * 30, 400), 2000)));

                            if (onVoiceMessageSaved && originalText) {
                                // Auto-voice ON: save as voice, TTS uses original language only
                                const estimatedDuration = Math.max(2, Math.ceil(originalText.length / 4));
                                const savedVoiceId = await DB.saveMessage({
                                    charId: char.id, role: 'assistant', type: 'voice',
                                    content: originalText,
                                    metadata: { duration: estimatedDuration, sourceText: biContent, hasAudio: false },
                                    replyTo: replyData,
                                });
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                playFirstNotification();
                                globalMsgIndex++;
                                onVoiceMessageSaved(savedVoiceId, originalText);
                            } else {
                                // Auto-voice OFF: save as text with bilingual toggle
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: biContent, replyTo: replyData });
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                playFirstNotification();
                                globalMsgIndex++;
                            }
                        }

                        lastIndex = tagMatch.index + tagMatch[0].length;
                    }

                    // Save any remaining text AFTER last <翻译> block
                    const textAfter = aiContent.slice(lastIndex).trim();
                    if (textAfter) {
                        // Strip any stray translation tags
                        const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                        if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                            const chunks = ChatParser.chunkText(cleaned);
                            for (const chunk of chunks) {
                                if (!chunk) continue;
                                const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                const saved = await saveTextOrVoiceChunk(chunk, replyData);
                                globalMsgIndex += saved;
                            }
                        }
                    }

                    // Send extracted emojis after bilingual text
                    for (const emojiName of bilingualEmojis) {
                        const foundEmoji = emojis.find(e => e.name === emojiName);
                        if (foundEmoji) {
                            await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url });
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            playFirstNotification();
                        }
                    }

                    for (const songCard of bilingualSongs) {
                        await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                        const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                        const saved = await saveSongCard(songCard, replyData);
                        globalMsgIndex += saved;
                    }
                } else {
                    // ─── Normal text (no bilingual tags) ───
                    // Also handles legacy %%BILINGUAL%% format for backwards compatibility
                    const parts = ChatParser.splitResponse(aiContent);
                    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
                        const part = parts[partIndex];

                        if (part.type === 'emoji') {
                            const foundEmoji = emojis.find(e => e.name === part.content);
                            if (foundEmoji) {
                                await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url });
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                playFirstNotification();
                            }
                        } else if (part.type === 'song') {
                            await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                            const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                            const saved = await saveSongCard({ type: 'song_card', ...part.content }, replyData);
                            globalMsgIndex += saved;
                        } else {
                            // Split on --- separators first, then chunkText for fine-grained splitting
                            const rawBlocks = part.content.split(/^\s*---\s*$/m).filter(b => b.trim());
                            const allChunks: string[] = [];
                            for (const block of rawBlocks) {
                                allChunks.push(...ChatParser.chunkText(block.trim()));
                            }
                            if (allChunks.length === 0 && part.content.trim()) allChunks.push(part.content.trim());

                            for (let i = 0; i < allChunks.length; i++) {
                                let chunk = allChunks[i];
                                const delay = Math.min(Math.max(chunk.length * 50, 500), 2000);
                                await new Promise(r => setTimeout(r, delay));

                                let chunkReplyTarget: { id: number, content: string, name: string } | undefined;
                                const chunkQuoteMatch = chunk.match(QUOTE_RE_DOUBLE) || chunk.match(QUOTE_RE_SINGLE);
                                if (chunkQuoteMatch) {
                                    const quotedText = chunkQuoteMatch[1].trim();
                                    if (quotedText) {
                                        const targetMsg = historySlice.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                                            || (quotedText.length > 10 ? historySlice.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
                                        if (targetMsg) {
                                            const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                                            chunkReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
                                        }
                                    }
                                    chunk = chunk.replace(QUOTE_CLEAN_DOUBLE, '').replace(QUOTE_CLEAN_SINGLE, '').trim();
                                }

                                const replyData = chunkReplyTarget || (globalMsgIndex === 0 ? aiReplyTarget : undefined);

                                if (ChatParser.hasDisplayContent(chunk)) {
                                    const cleanChunk = ChatParser.sanitize(chunk);
                                    if (cleanChunk) {
                                        // Use shared voice detection helper
                                        const saved = await saveTextOrVoiceChunk(cleanChunk, replyData);
                                        globalMsgIndex += saved;
                                    }
                                }
                            }
                        }
                    }
                }

                // 9. Attach thinking chain metadata to the first saved message
                if (thinkingContent && firstSavedMsgId !== null) {
                    await DB.updateMessageMetadata(firstSavedMsgId, { thinking: thinkingContent });
                    // Refresh messages to pick up the updated metadata
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                }
            } else {
                // If content was empty (e.g. only actions), just refresh
                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
            }

            // ====== (secondaryConfig already built above for senseBefore) ======

            // ====== Vector Memory Extraction — fire-and-forget (success path only) ======
            if (char.vectorMemoryEnabled && char.vectorMemoryAutoExtract !== false) {
                const emKey = embeddingApiKey;
                if (emKey) {
                    const charSnapshot = { ...char };
                    VectorMemoryExtractor.maybeExtract(charSnapshot, secondaryConfig, emKey)
                        .catch(e => console.error('🧠 [VectorExtract] Background:', e));
                }
            }

            // ====== Inner Voice / Creative Card — fire-and-forget ======
            if (secondaryConfig?.apiKey && aiContent) {
                const charSnapshot = { ...char };
                lastMindSnapshotCtx.current = { char: charSnapshot, aiContent, msgs: currentMsgs, config: secondaryConfig };
                const statusMode = char.statusBarMode || 'classic';
                // Skip entirely if heart voice is off
                if (statusMode === 'off') { /* noop — bionic engine still runs */ }
                else {
                // Delay 2s to reduce resource contention on mobile
                setTimeout(() => {
                    if (statusMode === 'classic') {
                        // ── Classic inner voice ──
                        MindSnapshotExtractor.generateInnerVoice(charSnapshot, aiContent, currentMsgs, secondaryConfig,
                            (reason) => addToast(reason, 'error')
                        )
                            .then(newState => {
                                if (newState && char && onMoodUpdate) {
                                    onMoodUpdate(char.id, newState);
                                } else {
                                    console.warn('💭 [InnerVoice] Generation returned null — retry available via avatar button');
                                }
                            })
                            .catch(e => console.error('💭 [InnerVoice] Background:', e));
                    } else if (statusMode === 'freeform') {
                        // ── Freeform HTML card ──
                        MindSnapshotExtractor.generateFreeformCard(charSnapshot, aiContent, currentMsgs, secondaryConfig,
                            (reason) => addToast(reason, 'error'),
                        )
                            .then(cardData => {
                                if (cardData && char && onMoodUpdate) {
                                    onMoodUpdate(char.id, { ...(charSnapshot.moodState || {}), innerVoice: cardData.body }, cardData);
                                } else {
                                    console.warn('✨ [FreeformCard] Generation returned null');
                                }
                            })
                            .catch(e => console.error('✨ [FreeformCard] Background:', e));
                    } else if (statusMode === 'custom') {
                        // ── Custom user-defined template ──
                        const template = charSnapshot.customStatusTemplates?.find(
                            t => t.id === charSnapshot.activeCustomTemplateId,
                        ) || charSnapshot.customStatusTemplates?.[0];
                        if (template?.systemPrompt) {
                            MindSnapshotExtractor.generateCustomCard(charSnapshot, aiContent, currentMsgs, secondaryConfig,
                                template,
                                (reason) => addToast(reason, 'error'),
                            )
                                .then(cardData => {
                                    if (cardData && char && onMoodUpdate) {
                                        onMoodUpdate(char.id, { ...(charSnapshot.moodState || {}), innerVoice: cardData.body }, cardData);
                                    } else {
                                        console.warn('🎨 [CustomCard] Generation returned null');
                                    }
                                })
                                .catch(e => console.error('🎨 [CustomCard] Background:', e));
                        } else {
                            console.warn('🎨 [CustomCard] No template configured, skipping');
                        }
                    } else {
                        // ── Creative card ──
                        MindSnapshotExtractor.generateCreativeCard(charSnapshot, aiContent, currentMsgs, secondaryConfig,
                            (reason) => addToast(reason, 'error'),
                        )
                            .then(cardData => {
                                if (cardData && char && onMoodUpdate) {
                                    onMoodUpdate(char.id, { ...(charSnapshot.moodState || {}), innerVoice: cardData.body }, cardData);
                                } else {
                                    console.warn('🎴 [CreativeCard] Generation returned null');
                                }
                            })
                            .catch(e => console.error('🎴 [CreativeCard] Background:', e));
                    }
                }, 2000);
                } // end else (statusMode !== 'off')
            }

            // ====== Event Extractor (时间事件提取) — fire-and-forget ======
            if (secondaryConfig?.apiKey) {
                const lastUserMsg = currentMsgs.filter(m => m.role === 'user').pop();
                if (lastUserMsg && lastUserMsg.content) {
                    EventExtractor.extract(char.id, lastUserMsg.content, secondaryConfig)
                        .catch(e => console.error('⏰ [EventExtractor] Background:', e));
                }
            }

        } catch (e: any) {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[连接中断: ${e.message}]` });
            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
        } finally {
            setIsTyping(false);
            setRecallStatus('');
            setSearchStatus('');
            setDiaryStatus('');
            setXhsStatus('');
        }
    };

    const retryMindSnapshot = useCallback(() => {
        const ctx = lastMindSnapshotCtx.current;
        if (!ctx) { console.warn('💭 [InnerVoice] No context to retry'); return; }
        const statusMode = ctx.char.statusBarMode || 'classic';
        console.log(`💭 [InnerVoice] Manual retry triggered (mode: ${statusMode})`);
        if (statusMode === 'off') {
            addToast('心声已关闭，请先选择一个模式', 'info');
            return;
        }
        if (statusMode === 'classic') {
            MindSnapshotExtractor.generateInnerVoice(ctx.char, ctx.aiContent, ctx.msgs, ctx.config,
                (reason) => addToast(reason, 'error')
            )
                .then(newState => {
                    if (newState && ctx.char && onMoodUpdate) {
                        onMoodUpdate(ctx.char.id, newState);
                    }
                })
                .catch(e => console.error('💭 [InnerVoice] Retry failed:', e));
        } else if (statusMode === 'freeform') {
            MindSnapshotExtractor.generateFreeformCard(ctx.char, ctx.aiContent, ctx.msgs, ctx.config,
                (reason) => addToast(reason, 'error'),
            )
                .then(cardData => {
                    if (cardData && ctx.char && onMoodUpdate) {
                        onMoodUpdate(ctx.char.id, { ...(ctx.char.moodState || {}), innerVoice: cardData.body }, cardData);
                    }
                })
                .catch(e => console.error('✨ [FreeformCard] Retry failed:', e));
        } else if (statusMode === 'custom') {
            const template = ctx.char.customStatusTemplates?.find(
                (t: any) => t.id === ctx.char.activeCustomTemplateId,
            ) || ctx.char.customStatusTemplates?.[0];
            if (template?.systemPrompt) {
                MindSnapshotExtractor.generateCustomCard(ctx.char, ctx.aiContent, ctx.msgs, ctx.config,
                    template,
                    (reason) => addToast(reason, 'error'),
                )
                    .then(cardData => {
                        if (cardData && ctx.char && onMoodUpdate) {
                            onMoodUpdate(ctx.char.id, { ...(ctx.char.moodState || {}), innerVoice: cardData.body }, cardData);
                        }
                    })
                    .catch(e => console.error('🎨 [CustomCard] Retry failed:', e));
            }
        } else {
            MindSnapshotExtractor.generateCreativeCard(ctx.char, ctx.aiContent, ctx.msgs, ctx.config,
                (reason) => addToast(reason, 'error'),
            )
                .then(cardData => {
                    if (cardData && ctx.char && onMoodUpdate) {
                        onMoodUpdate(ctx.char.id, { ...(ctx.char.moodState || {}), innerVoice: cardData.body }, cardData);
                    }
                })
                .catch(e => console.error('🎴 [CreativeCard] Retry failed:', e));
        }
    }, [addToast, onMoodUpdate]);

    return {
        isTyping,
        recallStatus,
        searchStatus,
        diaryStatus,
        xhsStatus,
        weiboStatus,
        lastTokenUsage,
        tokenBreakdown,
        setLastTokenUsage,
        triggerAI,
        retryMindSnapshot
    };
};
