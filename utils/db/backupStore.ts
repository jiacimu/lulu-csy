import { CharacterProfile,CollectionWallAsset,FullBackupData,MemoryRecordAudio,SerializedCollectionWallAsset,SerializedMemoryRecordAudio,SerializedVoiceAudio } from '../../types';
import {
  openDB,STORE_CHARACTERS,STORE_MESSAGES,STORE_THEMES,STORE_EMOJIS,
  STORE_EMOJI_CATEGORIES,STORE_ASSETS,STORE_GALLERY,STORE_USER,
  STORE_DIARIES,STORE_TASKS,STORE_ANNIVERSARIES,STORE_ROOM_TODOS,
  STORE_ROOM_NOTES,STORE_GROUPS,STORE_JOURNAL_STICKERS,STORE_SOCIAL_POSTS,
  STORE_COURSES,STORE_GAMES,STORE_WORLDBOOKS,STORE_NOVELS,
  STORE_BANK_TX,STORE_BANK_DATA,STORE_XHS_ACTIVITIES,STORE_XHS_STOCK,
  STORE_VECTOR_MEMORIES,STORE_MEMORY_RECORDS,STORE_MEMORY_RECORD_AUDIO,
  STORE_SCHEDULED,STORE_LETTERS,STORE_VOICE_AUDIO,STORE_YESTERDAY_NEWSPAPERS,STORE_VIBE_REFERENCES,
  STORE_NIANNIAN_SESSIONS,STORE_COLLECTION_BOOKS,STORE_COLLECTION_WALLS,STORE_COLLECTION_WALL_ITEMS,STORE_COLLECTION_WALL_ASSETS,
  DB_NAME_CONST
} from './core';

export const deleteDB = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME_CONST);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => console.warn('Delete blocked');
    });
};

export const getRawStoreData = async (storeName: string): Promise<any[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return [];
    return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    if (typeof FileReader !== 'undefined') {
        try {
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        } catch {
            // Cross-realm Blobs from fake-indexeddb can fail FileReader conversion.
        }
    }

    if (typeof blob.arrayBuffer !== 'function') {
        throw new TypeError('Unsupported Blob-like object');
    }
    const buffer = await blob.arrayBuffer();
    const mime = blob.type || 'application/octet-stream';
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const response = await fetch(dataUrl);
    return response.blob();
};

const serializeMemoryRecordAudio = async (items: MemoryRecordAudio[]): Promise<SerializedMemoryRecordAudio[]> => {
    return Promise.all(items.map(async (item) => {
        const { blob, ...rest } = item;
        return {
            ...rest,
            dataUrl: blob ? await blobToDataUrl(blob) : undefined,
        };
    }));
};

type VoiceAudioRecord = {
    msgId: string | number;
    blob?: Blob;
    createdAt?: number;
    mimeType?: string;
};

const serializeVoiceAudio = async (items: VoiceAudioRecord[]): Promise<SerializedVoiceAudio[]> => {
    return Promise.all(items.map(async (item) => ({
        msgId: item.msgId,
        createdAt: item.createdAt,
        mimeType: item.mimeType || item.blob?.type,
        dataUrl: item.blob ? await blobToDataUrl(item.blob) : undefined,
    })));
};

const serializeCollectionWallAssets = async (items: CollectionWallAsset[]): Promise<SerializedCollectionWallAsset[]> => {
    return Promise.all(items.map(async (item) => {
        const { blob, ...rest } = item;
        const fallbackDataUrl = typeof (item as any).dataUrl === 'string' ? (item as any).dataUrl : undefined;
        const dataUrl = blob
            ? await blobToDataUrl(blob).catch(() => fallbackDataUrl || '')
            : fallbackDataUrl;
        return {
            ...rest,
            dataUrl: dataUrl || undefined,
        };
    }));
};

const deserializeMemoryRecordAudio = async (items?: SerializedMemoryRecordAudio[]): Promise<MemoryRecordAudio[]> => {
    if (!Array.isArray(items)) return [];

    const restored: MemoryRecordAudio[] = [];
    let index = 0;
    for (const item of items) {
        if (!item.dataUrl) continue;
        restored.push({
            ...item,
            blob: await dataUrlToBlob(item.dataUrl),
        });
        index += 1;
        if (index % 10 === 0) await waitForBrowserTurn();
    }
    return restored;
};

const deserializeVoiceAudio = async (items?: SerializedVoiceAudio[]): Promise<VoiceAudioRecord[]> => {
    if (!Array.isArray(items)) return [];

    const restored: VoiceAudioRecord[] = [];
    let index = 0;
    for (const item of items) {
        if (!item.dataUrl) continue;
        const blob = await dataUrlToBlob(item.dataUrl);
        restored.push({
            msgId: item.msgId,
            createdAt: item.createdAt,
            mimeType: item.mimeType || blob.type,
            blob,
        });
        index += 1;
        if (index % 10 === 0) await waitForBrowserTurn();
    }
    return restored;
};

const deserializeCollectionWallAssets = async (items?: SerializedCollectionWallAsset[]): Promise<CollectionWallAsset[]> => {
    if (!Array.isArray(items)) return [];

    const restored: CollectionWallAsset[] = [];
    let index = 0;
    for (const item of items) {
        if (!item.dataUrl) continue;
        const blob = await dataUrlToBlob(item.dataUrl);
        restored.push({
            ...item,
            blob,
            mime: item.mime || blob.type || 'application/octet-stream',
            bytes: item.bytes || blob.size,
        });
        index += 1;
        if (index % 10 === 0) await waitForBrowserTurn();
    }
    return restored;
};

const hasTextContent = (value: unknown): value is string => (
    typeof value === 'string' && value.trim().length > 0
);

const hydrateMountedWorldbooksFromBackupLibrary = (data: FullBackupData): void => {
    if (!Array.isArray(data.characters) || data.characters.length === 0) return;
    if (!Array.isArray(data.worldbooks) || data.worldbooks.length === 0) return;

    const worldbookById = new Map<string, any>();
    for (const book of data.worldbooks) {
        if (book?.id) worldbookById.set(book.id, book);
    }
    if (worldbookById.size === 0) return;

    data.characters = data.characters.map(character => {
        if (!Array.isArray(character.mountedWorldbooks) || character.mountedWorldbooks.length === 0) {
            return character;
        }

        let changed = false;
        const mountedWorldbooks = character.mountedWorldbooks.map(mounted => {
            const source = mounted?.id ? worldbookById.get(mounted.id) : null;
            if (!source) return mounted;

            const next = {
                ...mounted,
                title: hasTextContent(mounted.title) ? mounted.title : source.title,
                content: hasTextContent(mounted.content) ? mounted.content : source.content,
                category: hasTextContent(mounted.category) ? mounted.category : source.category,
                position: mounted.position || source.position,
            };

            changed = changed || next.title !== mounted.title
                || next.content !== mounted.content
                || next.category !== mounted.category
                || next.position !== mounted.position;
            return next;
        });

        return changed ? { ...character, mountedWorldbooks } : character;
    });
};

export const exportFullData = async (): Promise<Partial<FullBackupData>> => {
    const db = await openDB();

    const getAllFromStore = (storeName: string): Promise<any[]> => {
        if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
        return new Promise((resolve) => {
            const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    };

    const [characters, messages, themes, emojis, emojiCategories, assets, galleryImages, userProfiles, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, journalStickers, socialPosts, courses, games, worldbooks, novels, bankTx, bankData, xhsActivities, xhsStockImages, vectorMemories, memoryRecords, memoryRecordAudioRaw, scheduledMessages, letters, voiceAudioRaw, yesterdayNewspapers, vibeReferences, nianNianSessions, collectionBooks, collectionWalls, collectionWallItems, collectionWallAssetsRaw] = await Promise.all([
        getAllFromStore(STORE_CHARACTERS), getAllFromStore(STORE_MESSAGES),
        getAllFromStore(STORE_THEMES), getAllFromStore(STORE_EMOJIS),
        getAllFromStore(STORE_EMOJI_CATEGORIES), getAllFromStore(STORE_ASSETS),
        getAllFromStore(STORE_GALLERY), getAllFromStore(STORE_USER),
        getAllFromStore(STORE_DIARIES), getAllFromStore(STORE_TASKS),
        getAllFromStore(STORE_ANNIVERSARIES), getAllFromStore(STORE_ROOM_TODOS),
        getAllFromStore(STORE_ROOM_NOTES), getAllFromStore(STORE_GROUPS),
        getAllFromStore(STORE_JOURNAL_STICKERS), getAllFromStore(STORE_SOCIAL_POSTS),
        getAllFromStore(STORE_COURSES), getAllFromStore(STORE_GAMES),
        getAllFromStore(STORE_WORLDBOOKS), getAllFromStore(STORE_NOVELS),
        getAllFromStore(STORE_BANK_TX), getAllFromStore(STORE_BANK_DATA),
        getAllFromStore(STORE_XHS_ACTIVITIES), getAllFromStore(STORE_XHS_STOCK),
        getAllFromStore(STORE_VECTOR_MEMORIES),
        getAllFromStore(STORE_MEMORY_RECORDS),
        getAllFromStore(STORE_MEMORY_RECORD_AUDIO),
        getAllFromStore(STORE_SCHEDULED), getAllFromStore(STORE_LETTERS),
        getAllFromStore(STORE_VOICE_AUDIO), getAllFromStore(STORE_YESTERDAY_NEWSPAPERS),
        getAllFromStore(STORE_VIBE_REFERENCES), getAllFromStore(STORE_NIANNIAN_SESSIONS),
        getAllFromStore(STORE_COLLECTION_BOOKS), getAllFromStore(STORE_COLLECTION_WALLS),
        getAllFromStore(STORE_COLLECTION_WALL_ITEMS), getAllFromStore(STORE_COLLECTION_WALL_ASSETS),
    ]);
    const memoryRecordAudio = await serializeMemoryRecordAudio(memoryRecordAudioRaw as MemoryRecordAudio[]);
    const voiceAudio = await serializeVoiceAudio(voiceAudioRaw as VoiceAudioRecord[]);
    const collectionWallAssets = await serializeCollectionWallAssets(collectionWallAssetsRaw as CollectionWallAsset[]);

    const userProfile = userProfiles.length > 0 ? { name: userProfiles[0].name, avatar: userProfiles[0].avatar, bio: userProfiles[0].bio } : undefined;
    const mainState = bankData.find((d: any) => d.id === 'main_state');
    const dollhouseRecord = bankData.find((d: any) => d.id === 'dollhouse_state');

    return {
        characters, messages, customThemes: themes, savedEmojis: emojis, emojiCategories, assets, galleryImages, userProfile, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, savedJournalStickers: journalStickers, socialPosts, courses, games, worldbooks, novels,
        bankState: mainState ? { ...mainState, id: undefined } : undefined,
        bankDollhouse: dollhouseRecord?.data || undefined,
        bankTransactions: bankTx,
        xhsActivities, xhsStockImages,
        vectorMemories,
        memoryRecords,
        memoryRecordAudio,
        voiceAudio,
        yesterdayNewspapers,
        vibeReferences,
        nianNianSessions,
        collectionBooks,
        collectionWalls,
        collectionWallItems,
        collectionWallAssets,
        scheduledMessages, letters
    };
};

export type ImportFullDataProgress = {
    label: string;
    stage: 'start' | 'items' | 'done';
    sectionDone: number;
    sectionTotal: number;
    itemDone?: number;
    itemTotal?: number;
    storeName?: string;
};

export type ImportFullDataOptions = {
    onProgress?: (progress: ImportFullDataProgress) => void;
    batchSize?: number;
    yieldMs?: number;
};

const DEFAULT_IMPORT_BATCH_SIZE = 50;

const waitForBrowserTurn = (ms = 0): Promise<void> => (
    new Promise(resolve => setTimeout(resolve, ms))
);

const waitForTransaction = (tx: IDBTransaction): Promise<void> => (
    new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    })
);

export const importFullData = async (
    data: FullBackupData,
    options: ImportFullDataOptions = {},
): Promise<void> => {
    const db = await openDB();
    const batchSize = Math.max(1, Math.floor(options.batchSize || DEFAULT_IMPORT_BATCH_SIZE));
    const yieldMs = Math.max(0, Math.floor(options.yieldMs || 0));
    const importedMemoryRecordAudio = await deserializeMemoryRecordAudio(data.memoryRecordAudio);
    await waitForBrowserTurn(yieldMs);
    const importedVoiceAudio = await deserializeVoiceAudio(data.voiceAudio);
    await waitForBrowserTurn(yieldMs);
    const importedCollectionWallAssets = await deserializeCollectionWallAssets(data.collectionWallAssets);
    await waitForBrowserTurn(yieldMs);
    hydrateMountedWorldbooksFromBackupLibrary(data);

    const availableStores = [
        STORE_CHARACTERS, STORE_MESSAGES, STORE_THEMES, STORE_EMOJIS, STORE_EMOJI_CATEGORIES,
        STORE_ASSETS, STORE_GALLERY, STORE_USER, STORE_DIARIES,
        STORE_TASKS, STORE_ANNIVERSARIES, STORE_ROOM_TODOS, STORE_ROOM_NOTES,
        STORE_GROUPS, STORE_JOURNAL_STICKERS, STORE_SOCIAL_POSTS, STORE_COURSES, STORE_GAMES, STORE_WORLDBOOKS, STORE_NOVELS,
        STORE_BANK_TX, STORE_BANK_DATA,
        STORE_XHS_ACTIVITIES, STORE_XHS_STOCK,
        STORE_VECTOR_MEMORIES,
        STORE_MEMORY_RECORDS, STORE_MEMORY_RECORD_AUDIO,
        STORE_SCHEDULED, STORE_LETTERS, STORE_VOICE_AUDIO, STORE_YESTERDAY_NEWSPAPERS, STORE_VIBE_REFERENCES,
        STORE_NIANNIAN_SESSIONS, STORE_COLLECTION_BOOKS, STORE_COLLECTION_WALLS, STORE_COLLECTION_WALL_ITEMS,
        STORE_COLLECTION_WALL_ASSETS
    ].filter(name => db.objectStoreNames.contains(name));

    const hasStore = (storeName: string): boolean => availableStores.includes(storeName);

    const plannedSections = [
        data.characters !== undefined || data.mediaAssets !== undefined,
        data.messages !== undefined,
        data.customThemes !== undefined,
        data.savedEmojis !== undefined,
        data.emojiCategories !== undefined,
        data.assets !== undefined,
        data.savedJournalStickers !== undefined,
        data.galleryImages !== undefined,
        data.diaries !== undefined,
        data.tasks !== undefined,
        data.anniversaries !== undefined,
        data.roomTodos !== undefined,
        data.roomNotes !== undefined,
        data.groups !== undefined,
        data.socialPosts !== undefined,
        data.courses !== undefined,
        data.games !== undefined,
        data.worldbooks !== undefined,
        data.novels !== undefined,
        data.bankTransactions !== undefined,
        data.xhsActivities !== undefined,
        data.xhsStockImages !== undefined,
        data.vectorMemories !== undefined || data.characters !== undefined,
        data.memoryRecords !== undefined || data.characters !== undefined,
        data.memoryRecordAudio !== undefined,
        data.voiceAudio !== undefined,
        data.yesterdayNewspapers !== undefined,
        data.vibeReferences !== undefined,
        data.nianNianSessions !== undefined,
        data.collectionBooks !== undefined,
        data.collectionWalls !== undefined,
        data.collectionWallItems !== undefined,
        data.collectionWallAssets !== undefined,
        data.scheduledMessages !== undefined,
        data.letters !== undefined,
        data.userProfile !== undefined,
        data.bankState !== undefined || data.bankDollhouse !== undefined,
    ];
    const sectionTotal = Math.max(1, plannedSections.filter(Boolean).length);
    let sectionDone = 0;

    const report = (
        label: string,
        stage: ImportFullDataProgress['stage'],
        itemDone?: number,
        itemTotal?: number,
        storeName?: string,
    ) => {
        options.onProgress?.({
            label,
            stage,
            sectionDone,
            sectionTotal,
            itemDone,
            itemTotal,
            storeName,
        });
    };

    const runSection = async (
        label: string,
        present: boolean,
        work: () => Promise<void>,
        itemTotal?: number,
        storeName?: string,
    ) => {
        if (!present) return;
        report(label, 'start', 0, itemTotal, storeName);
        await work();
        sectionDone += 1;
        report(label, 'done', itemTotal, itemTotal, storeName);
        await waitForBrowserTurn(yieldMs);
    };

    const withStore = async (storeName: string, writer: (store: IDBObjectStore) => void): Promise<void> => {
        if (!hasStore(storeName)) return;
        const tx = db.transaction(storeName, 'readwrite');
        try {
            writer(tx.objectStore(storeName));
        } catch (error) {
            try { tx.abort(); } catch { /* ignore */ }
            throw error;
        }
        await waitForTransaction(tx);
    };

    const getAllFromStore = async <T,>(storeName: string): Promise<T[]> => {
        if (!hasStore(storeName)) return [];
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result as T[] || []);
            req.onerror = () => reject(req.error || tx.error);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB read failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB read aborted'));
        });
    };

    const clearStore = async (storeName: string): Promise<void> => {
        await withStore(storeName, store => {
            store.clear();
        });
        await waitForBrowserTurn(yieldMs);
    };

    const putItems = async (
        storeName: string,
        items: any[] | undefined | null,
        label: string,
    ): Promise<void> => {
        if (!hasStore(storeName) || !Array.isArray(items) || items.length === 0) return;

        const total = items.length;
        for (let i = 0; i < total; i += batchSize) {
            const end = Math.min(i + batchSize, total);
            const chunk = items.slice(i, end).filter(item => item && typeof item === 'object');
            if (chunk.length > 0) {
                await withStore(storeName, store => {
                    chunk.forEach(item => store.put(item));
                });
            }
            for (let j = i; j < end; j++) {
                items[j] = undefined;
            }
            report(label, 'items', end, total, storeName);
            await waitForBrowserTurn(yieldMs);
        }
    };

    const clearAndAdd = async (
        storeName: string,
        items: any[] | undefined | null,
        label: string,
    ): Promise<void> => {
        if (!hasStore(storeName) || items === undefined || items === null) return;
        await clearStore(storeName);
        await putItems(storeName, items, label);
    };

    const mergeStore = async (
        storeName: string,
        items: any[] | undefined | null,
        label: string,
    ): Promise<void> => {
        if (!hasStore(storeName) || !Array.isArray(items) || items.length === 0) return;
        await putItems(storeName, items, label);
    };

    const applyMediaToChar = (
        character: CharacterProfile,
        mediaByCharId: Map<string, NonNullable<FullBackupData['mediaAssets']>[number]>,
    ): CharacterProfile => {
        const media = mediaByCharId.get(character.id);
        if (!media) return character;
        return {
            ...character,
            avatar: media.avatar || character.avatar,
            sprites: media.sprites || character.sprites,
            chatBackground: media.backgrounds?.chat || character.chatBackground,
            dateBackground: media.backgrounds?.date || character.dateBackground,
            roomConfig: character.roomConfig ? {
                ...character.roomConfig,
                wallImage: media.backgrounds?.roomWall || character.roomConfig.wallImage,
                floorImage: media.backgrounds?.roomFloor || character.roomConfig.floorImage,
                items: character.roomConfig.items.map(item => {
                    const img = media.roomItems?.[item.id];
                    return img ? { ...item, image: img } : item;
                })
            } : character.roomConfig
        } as CharacterProfile;
    };

    const hasCharacterBackup = Array.isArray(data.characters);

    await runSection('角色资料', data.characters !== undefined || data.mediaAssets !== undefined, async () => {
        if (data.characters) {
            if (data.mediaAssets) {
                const mediaByCharId = new Map(data.mediaAssets.map(media => [media.charId, media]));
                data.characters = data.characters.map(character => applyMediaToChar(character, mediaByCharId));
            }
            await clearAndAdd(STORE_CHARACTERS, data.characters, '角色资料');
        } else if (data.mediaAssets && hasStore(STORE_CHARACTERS)) {
            const mediaByCharId = new Map(data.mediaAssets.map(media => [media.charId, media]));
            const existingChars = await getAllFromStore<CharacterProfile>(STORE_CHARACTERS);
            if (existingChars.length > 0) {
                const updatedChars = existingChars.map(character => applyMediaToChar(character, mediaByCharId));
                await putItems(STORE_CHARACTERS, updatedChars, '角色资料');
            }
        }
        data.characters = undefined as any;
        data.mediaAssets = undefined as any;
    }, data.characters?.length || data.mediaAssets?.length || 0, STORE_CHARACTERS);

    await runSection('聊天记录', data.messages !== undefined, async () => {
        if (!hasStore(STORE_MESSAGES)) return;
        if (hasCharacterBackup) {
            await clearStore(STORE_MESSAGES);
        }
        await putItems(STORE_MESSAGES, data.messages || [], '聊天记录');
        data.messages = undefined as any;
    }, data.messages?.length || 0, STORE_MESSAGES);

    await runSection('聊天主题', data.customThemes !== undefined, async () => {
        await mergeStore(STORE_THEMES, data.customThemes, '聊天主题');
        data.customThemes = undefined as any;
    }, data.customThemes?.length || 0, STORE_THEMES);
    await runSection('表情包', data.savedEmojis !== undefined, async () => {
        await mergeStore(STORE_EMOJIS, data.savedEmojis, '表情包');
        data.savedEmojis = undefined as any;
    }, data.savedEmojis?.length || 0, STORE_EMOJIS);
    await runSection('表情分类', data.emojiCategories !== undefined, async () => {
        await mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories, '表情分类');
        data.emojiCategories = undefined as any;
    }, data.emojiCategories?.length || 0, STORE_EMOJI_CATEGORIES);
    await runSection('系统资源', data.assets !== undefined, async () => {
        await mergeStore(STORE_ASSETS, data.assets, '系统资源');
        data.assets = undefined as any;
    }, data.assets?.length || 0, STORE_ASSETS);
    await runSection('日记贴纸', data.savedJournalStickers !== undefined, async () => {
        await mergeStore(STORE_JOURNAL_STICKERS, data.savedJournalStickers, '日记贴纸');
        data.savedJournalStickers = undefined as any;
    }, data.savedJournalStickers?.length || 0, STORE_JOURNAL_STICKERS);

    await runSection('相册图片', data.galleryImages !== undefined, async () => {
        await clearAndAdd(STORE_GALLERY, data.galleryImages, '相册图片');
        data.galleryImages = undefined as any;
    }, data.galleryImages?.length || 0, STORE_GALLERY);
    await runSection('日记', data.diaries !== undefined, async () => {
        await clearAndAdd(STORE_DIARIES, data.diaries, '日记');
        data.diaries = undefined as any;
    }, data.diaries?.length || 0, STORE_DIARIES);
    await runSection('任务', data.tasks !== undefined, async () => {
        await clearAndAdd(STORE_TASKS, data.tasks, '任务');
        data.tasks = undefined as any;
    }, data.tasks?.length || 0, STORE_TASKS);
    await runSection('纪念日', data.anniversaries !== undefined, async () => {
        await clearAndAdd(STORE_ANNIVERSARIES, data.anniversaries, '纪念日');
        data.anniversaries = undefined as any;
    }, data.anniversaries?.length || 0, STORE_ANNIVERSARIES);
    await runSection('房间待办', data.roomTodos !== undefined, async () => {
        await clearAndAdd(STORE_ROOM_TODOS, data.roomTodos, '房间待办');
        data.roomTodos = undefined as any;
    }, data.roomTodos?.length || 0, STORE_ROOM_TODOS);
    await runSection('房间便签', data.roomNotes !== undefined, async () => {
        await clearAndAdd(STORE_ROOM_NOTES, data.roomNotes, '房间便签');
        data.roomNotes = undefined as any;
    }, data.roomNotes?.length || 0, STORE_ROOM_NOTES);
    await runSection('群聊资料', data.groups !== undefined, async () => {
        await clearAndAdd(STORE_GROUPS, data.groups, '群聊资料');
        data.groups = undefined as any;
    }, data.groups?.length || 0, STORE_GROUPS);
    await runSection('动态帖子', data.socialPosts !== undefined, async () => {
        await clearAndAdd(STORE_SOCIAL_POSTS, data.socialPosts, '动态帖子');
        data.socialPosts = undefined as any;
    }, data.socialPosts?.length || 0, STORE_SOCIAL_POSTS);
    await runSection('学习课程', data.courses !== undefined, async () => {
        await clearAndAdd(STORE_COURSES, data.courses, '学习课程');
        data.courses = undefined as any;
    }, data.courses?.length || 0, STORE_COURSES);
    await runSection('游戏记录', data.games !== undefined, async () => {
        await clearAndAdd(STORE_GAMES, data.games, '游戏记录');
        data.games = undefined as any;
    }, data.games?.length || 0, STORE_GAMES);
    await runSection('世界书', data.worldbooks !== undefined, async () => {
        await clearAndAdd(STORE_WORLDBOOKS, data.worldbooks, '世界书');
        data.worldbooks = undefined as any;
    }, data.worldbooks?.length || 0, STORE_WORLDBOOKS);
    await runSection('小说', data.novels !== undefined, async () => {
        await clearAndAdd(STORE_NOVELS, data.novels, '小说');
        data.novels = undefined as any;
    }, data.novels?.length || 0, STORE_NOVELS);
    await runSection('银行流水', data.bankTransactions !== undefined, async () => {
        await clearAndAdd(STORE_BANK_TX, data.bankTransactions, '银行流水');
        data.bankTransactions = undefined as any;
    }, data.bankTransactions?.length || 0, STORE_BANK_TX);
    await runSection('小红书活动', data.xhsActivities !== undefined, async () => {
        await clearAndAdd(STORE_XHS_ACTIVITIES, data.xhsActivities, '小红书活动');
        data.xhsActivities = undefined as any;
    }, data.xhsActivities?.length || 0, STORE_XHS_ACTIVITIES);
    await runSection('小红书图库', data.xhsStockImages !== undefined, async () => {
        await clearAndAdd(STORE_XHS_STOCK, data.xhsStockImages, '小红书图库');
        data.xhsStockImages = undefined as any;
    }, data.xhsStockImages?.length || 0, STORE_XHS_STOCK);

    await runSection('向量记忆', data.vectorMemories !== undefined || hasCharacterBackup, async () => {
        if (data.vectorMemories) {
            await clearAndAdd(STORE_VECTOR_MEMORIES, data.vectorMemories, '向量记忆');
        } else if (hasCharacterBackup) {
            await clearStore(STORE_VECTOR_MEMORIES);
        }
        data.vectorMemories = undefined as any;
    }, data.vectorMemories?.length || 0, STORE_VECTOR_MEMORIES);
    await runSection('记忆记录', data.memoryRecords !== undefined || hasCharacterBackup, async () => {
        if (data.memoryRecords) {
            await clearAndAdd(STORE_MEMORY_RECORDS, data.memoryRecords, '记忆记录');
        } else if (hasCharacterBackup) {
            await clearStore(STORE_MEMORY_RECORDS);
        }
        data.memoryRecords = undefined as any;
    }, data.memoryRecords?.length || 0, STORE_MEMORY_RECORDS);
    await runSection('记忆音频', data.memoryRecordAudio !== undefined, async () => {
        await clearAndAdd(STORE_MEMORY_RECORD_AUDIO, importedMemoryRecordAudio, '记忆音频');
        data.memoryRecordAudio = undefined as any;
        importedMemoryRecordAudio.length = 0;
    }, importedMemoryRecordAudio.length, STORE_MEMORY_RECORD_AUDIO);
    await runSection('语音消息音频', data.voiceAudio !== undefined, async () => {
        await clearAndAdd(STORE_VOICE_AUDIO, importedVoiceAudio, '语音消息音频');
        data.voiceAudio = undefined as any;
        importedVoiceAudio.length = 0;
    }, importedVoiceAudio.length, STORE_VOICE_AUDIO);
    await runSection('昨日小报', data.yesterdayNewspapers !== undefined, async () => {
        await clearAndAdd(STORE_YESTERDAY_NEWSPAPERS, data.yesterdayNewspapers, '昨日小报');
        data.yesterdayNewspapers = undefined as any;
    }, data.yesterdayNewspapers?.length || 0, STORE_YESTERDAY_NEWSPAPERS);
    await runSection('Vibe 参考图', data.vibeReferences !== undefined, async () => {
        await clearAndAdd(STORE_VIBE_REFERENCES, data.vibeReferences, 'Vibe 参考图');
        data.vibeReferences = undefined as any;
    }, data.vibeReferences?.length || 0, STORE_VIBE_REFERENCES);
    await runSection('念念浮生', data.nianNianSessions !== undefined, async () => {
        await clearAndAdd(STORE_NIANNIAN_SESSIONS, data.nianNianSessions, '念念浮生');
        data.nianNianSessions = undefined as any;
    }, data.nianNianSessions?.length || 0, STORE_NIANNIAN_SESSIONS);
    await runSection('典藏书籍', data.collectionBooks !== undefined, async () => {
        await clearAndAdd(STORE_COLLECTION_BOOKS, data.collectionBooks, '典藏书籍');
        data.collectionBooks = undefined as any;
    }, data.collectionBooks?.length || 0, STORE_COLLECTION_BOOKS);
    await runSection('典藏墙', data.collectionWalls !== undefined, async () => {
        await clearAndAdd(STORE_COLLECTION_WALLS, data.collectionWalls, '典藏墙');
        data.collectionWalls = undefined as any;
    }, data.collectionWalls?.length || 0, STORE_COLLECTION_WALLS);
    await runSection('典藏墙项目', data.collectionWallItems !== undefined, async () => {
        await clearAndAdd(STORE_COLLECTION_WALL_ITEMS, data.collectionWallItems, '典藏墙项目');
        data.collectionWallItems = undefined as any;
    }, data.collectionWallItems?.length || 0, STORE_COLLECTION_WALL_ITEMS);
    await runSection('典藏墙素材', data.collectionWallAssets !== undefined, async () => {
        await clearAndAdd(STORE_COLLECTION_WALL_ASSETS, importedCollectionWallAssets, '典藏墙素材');
        data.collectionWallAssets = undefined as any;
        importedCollectionWallAssets.length = 0;
    }, importedCollectionWallAssets.length, STORE_COLLECTION_WALL_ASSETS);
    await runSection('定时消息', data.scheduledMessages !== undefined, async () => {
        await clearAndAdd(STORE_SCHEDULED, data.scheduledMessages, '定时消息');
        data.scheduledMessages = undefined as any;
    }, data.scheduledMessages?.length || 0, STORE_SCHEDULED);
    await runSection('信件', data.letters !== undefined, async () => {
        await clearAndAdd(STORE_LETTERS, data.letters, '信件');
        data.letters = undefined as any;
    }, data.letters?.length || 0, STORE_LETTERS);

    await runSection('用户资料', data.userProfile !== undefined, async () => {
        if (!hasStore(STORE_USER)) return;
        await withStore(STORE_USER, store => {
            store.clear();
            if (data.userProfile) store.put({ ...data.userProfile, id: 'me' });
        });
    }, data.userProfile ? 1 : 0, STORE_USER);

    await runSection('银行状态', data.bankState !== undefined || data.bankDollhouse !== undefined, async () => {
        if (!hasStore(STORE_BANK_DATA)) return;
        await withStore(STORE_BANK_DATA, store => {
            store.clear();
            if (data.bankState) store.put({ ...data.bankState, id: 'main_state' });
            if (data.bankDollhouse) store.put({ id: 'dollhouse_state', data: data.bankDollhouse });
        });
        data.bankState = undefined as any;
        data.bankDollhouse = undefined as any;
    }, (data.bankState ? 1 : 0) + (data.bankDollhouse ? 1 : 0), STORE_BANK_DATA);
};
