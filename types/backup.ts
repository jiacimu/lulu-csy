
import { OSTheme,APIConfig,ApiPreset,AppearancePreset } from './core';
import { RealtimeConfig } from './realtime';
import { CharacterProfile,GroupProfile,Worldbook } from './character';
import { ChatTheme,Message,Emoji,EmojiCategory,VectorMemory } from './chat';
import { MemoryRecord,SerializedMemoryRecordAudio } from './memoryRecord';
import { YesterdayNewspaperRecord } from './newspaper';
import { RoomTodo,RoomNote } from './room';
import {
  SocialPost,SubAccount,SocialAppProfile,GalleryImage,DiaryEntry,
  Task,Anniversary,StudyCourse,GameSession,NovelBook
} from './social';
import { BankFullState,BankTransaction,DollhouseState } from './bank';
import { XhsActivityRecord,XhsStockImage } from './xhs';
import { TtsConfig } from './tts';
import { SttConfig } from './stt';
import { ImageApiPreset, ImageGenerationConfig, PhotoStylePreset, SavedVibeReference } from './photo';

export interface SerializedVoiceAudio {
    msgId: string | number;
    createdAt?: number;
    mimeType?: string;
    dataUrl?: string;
}

export interface BackupMusicAssets {
    profileBackground?: {
        key: string;
        mimeType?: string;
        dataUrl: string;
    };
    customSkins?: {
        id: string;
        name: string;
        mimeType?: string;
        dataUrl: string;
    }[];
}

export interface BackupGraphData {
    relations?: any[];
    l1Memories?: any[];
}

export interface BackupExternalIndexedDbData {
    version: number;
    stores: Record<string, any[]>;
}

export interface FullBackupData {
    timestamp: number;
    version: number;
    theme?: OSTheme;
    apiConfig?: APIConfig;
    apiPresets?: ApiPreset[];
    availableModels?: string[];
    realtimeConfig?: RealtimeConfig;  // 实时感知配置（天气/新闻/Notion）
    ttsConfig?: TtsConfig;            // 语音合成配置
    sttConfig?: SttConfig;            // 语音识别配置
    imageGenerationConfig?: ImageGenerationConfig;
    imageGenerationDraftConfig?: ImageGenerationConfig;
    imageApiPresets?: ImageApiPreset[];
    photoStylePresets?: PhotoStylePreset[];
    memoryPalaceConfig?: any;         // Upstream SullyOS Memory Palace config
    customIcons?: Record<string, string>;
    appearancePresets?: AppearancePreset[];
    characters?: CharacterProfile[];
    groups?: GroupProfile[];
    messages?: Message[];
    customThemes?: ChatTheme[];
    savedEmojis?: Emoji[];
    emojiCategories?: EmojiCategory[];
    savedJournalStickers?: { name: string, url: string }[];
    assets?: { id: string, data: string }[];
    galleryImages?: GalleryImage[];
    userProfile?: { name: string; avatar: string; bio: string };
    diaries?: DiaryEntry[];
    tasks?: Task[];
    anniversaries?: Anniversary[];
    roomTodos?: RoomTodo[];
    roomNotes?: RoomNote[];
    socialPosts?: SocialPost[];
    courses?: StudyCourse[];
    games?: GameSession[];
    worldbooks?: Worldbook[];
    roomCustomAssets?: { id?: string; name: string; image: string; defaultScale: number; description?: string; visibility?: 'public' | 'character'; assignedCharIds?: string[] }[];

    novels?: NovelBook[];
    songs?: any[];                  // Songwriting app / upstream SullyOS songs

    // Bank Data
    bankState?: BankFullState;
    bankDollhouse?: DollhouseState;
    bankTransactions?: BankTransaction[];

    socialAppData?: {
        charHandles?: Record<string, SubAccount[]>;
        userProfile?: SocialAppProfile;
        userId?: string;
        userBg?: string;
    };

    mediaAssets?: {
        charId: string;
        avatar?: string;
        sprites?: Record<string, string>;
        roomItems?: Record<string, string>;
        backgrounds?: { chat?: string; date?: string; roomWall?: string; roomFloor?: string };
    }[];

    xhsActivities?: XhsActivityRecord[];
    xhsStockImages?: XhsStockImage[];

    // Vector Memory Data
    vectorMemories?: VectorMemory[];
    memoryRecords?: MemoryRecord[];
    memoryRecordAudio?: SerializedMemoryRecordAudio[];
    voiceAudio?: SerializedVoiceAudio[];
    yesterdayNewspapers?: YesterdayNewspaperRecord[];
    vibeReferences?: SavedVibeReference[];
    musicAssets?: BackupMusicAssets;
    halfSugarData?: BackupExternalIndexedDbData;

    // Upstream SullyOS Memory Palace / Pixel Home stores
    memoryNodes?: any[];
    memoryVectors?: any[];
    memoryLinks?: any[];
    topicBoxes?: any[];
    anticipations?: any[];
    eventBoxes?: any[];
    memoryPalaceHighWaterMarks?: Record<string, number>;
    memoryPalaceFlags?: Record<string, string>;
    dailySchedules?: any[];
    memoryBatches?: any[];
    pixelHomeAssets?: any[];
    pixelHomeLayouts?: any[];

    // Scheduled Messages (delayed send)
    scheduledMessages?: {
        id: string;
        charId: string;
        content: string;
        dueAt: number;
        createdAt: number;
        metadata?: any;
    }[];

    // Letters (信件)
    letters?: any[];

    // Extra localStorage config (sub API, embedding, agent, zhaixinglou, etc.)
    extraLocalStorageConfig?: Record<string, string>;
    graphData?: BackupGraphData;

    // ─── Original SullyOS compatibility fields ───
    studyApiConfig?: any;           // Study room API config
    studyTutorPresets?: any[];      // Study tutor presets
    quizSessions?: any[];           // Quiz / Practice book
    guidebookSessions?: any[];      // 攻略本 sessions
    lifeSimState?: any;             // 模拟人生 state
    cloudBackupConfig?: any;         // Upstream WebDAV cloud backup config
    remoteVectorConfig?: any;        // Upstream Supabase vector config
    chatTranslateSourceLang?: string;
    chatTranslateTargetLang?: string;
    chatTranslateEnabledByChar?: Record<string, boolean>;
    chatArchivePrompts?: any;
    chatActiveArchivePromptId?: string;
    characterRefinePrompts?: any;
    characterActiveRefinePromptId?: string;
    scheduleAppTheme?: string;
    groupchatContextLimit?: number;
    browserConfig?: { braveKey?: string; useRealSearch?: boolean };
    bm25Mode?: string;
    lastActiveCharId?: string;
    eventNotifFlags?: Record<string, string>;
}
