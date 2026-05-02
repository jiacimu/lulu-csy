import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DB } from '../utils/db';
import { DB_NAME_CONST, STORE_VOICE_AUDIO } from '../utils/db/core';
import {
    exportSystemData,
    importSystemData,
    SYSTEM_BACKUP_ALWAYS_STORES,
    SYSTEM_BACKUP_CONDITIONAL_STORES,
    SYSTEM_BACKUP_EXCLUDED_STORES,
    type ExportStateSnapshot,
    type ImportCallbacks,
} from '../utils/systemBackup';
import {
    DEFAULT_RUNTIME_REALTIME_CONFIG,
} from '../utils/runtimeConfig';
import {
    DEFAULT_STT_CONFIG,
    DEFAULT_TTS_CONFIG,
    type CharacterProfile,
    type FullBackupData,
} from '../types';

const noopProgress = () => {};

const makeStateSnapshot = (): ExportStateSnapshot => ({
    apiConfig: { baseUrl: '', apiKey: '', model: '' },
    apiPresets: [],
    availableModels: [],
    realtimeConfig: DEFAULT_RUNTIME_REALTIME_CONFIG,
    ttsConfig: DEFAULT_TTS_CONFIG,
    sttConfig: DEFAULT_STT_CONFIG,
    theme: {
        hue: 245,
        saturation: 25,
        lightness: 65,
        wallpaper: 'linear-gradient(135deg, #fff, #eee)',
        darkMode: false,
        contentColor: '#ffffff',
    },
});

const makeCallbacks = (): ImportCallbacks => ({
    updateTheme: vi.fn(),
    updateApiConfig: vi.fn(),
    saveModels: vi.fn(),
    savePresets: vi.fn(),
    updateRealtimeConfig: vi.fn(),
    setCharacters: vi.fn(),
    setGroups: vi.fn(),
    setCustomThemes: vi.fn(),
    setUserProfile: vi.fn(),
    setWorldbooks: vi.fn(),
    setNovels: vi.fn(),
    setCustomIcons: vi.fn(),
    addToast: vi.fn(),
});

async function readBackupData(blob: Blob): Promise<FullBackupData> {
    const zip = await JSZip.loadAsync(blob);
    const dataFile = zip.file('data.json');
    if (!dataFile) throw new Error('missing data.json');
    return JSON.parse(await dataFile.async('string')) as FullBackupData;
}

function resetIndexedDb() {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
}

async function putExternalValue(
    dbName: string,
    storeName: string,
    value: unknown,
    key?: IDBValidKey,
    options?: IDBObjectStoreParameters,
): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(storeName)) {
                request.result.createObjectStore(storeName, options);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key !== undefined) store.put(value, key);
        else store.put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function putExistingDbValue(
    dbName: string,
    storeName: string,
    value: unknown,
    key?: IDBValidKey,
): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key !== undefined) store.put(value, key);
        else store.put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function getExternalValue(dbName: string, storeName: string, key: IDBValidKey): Promise<unknown> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function getExternalValues(dbName: string, storeName: string): Promise<any[]> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    try {
        return await new Promise((resolve: (items: any[]) => void, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function importWithoutReload(fileOrJson: File | string) {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
        await importSystemData(fileOrJson, noopProgress, makeCallbacks());
    } finally {
        timeoutSpy.mockRestore();
    }
}

describe('system backup coverage', () => {
    const graphImportBodies: any[] = [];
    const realFetch = globalThis.fetch?.bind(globalThis);

    beforeEach(() => {
        resetIndexedDb();
        localStorage.clear();
        graphImportBodies.length = 0;

        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/api/graph/export')) {
                return new Response(JSON.stringify({
                    ok: true,
                    relations: [{ id: 'rel-1' }],
                    l1Memories: [{ id: 'l1-1' }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/api/graph/import')) {
                graphImportBodies.push(JSON.parse(String(init?.body || '{}')));
                return new Response(JSON.stringify({ relationsImported: 1, l1MemoriesImported: 1 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.startsWith('data:') && realFetch) {
                return realFetch(input, init);
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('roundtrips character voice IDs, selected localStorage keys, and optional call audio', async () => {
        const char = {
            id: 'char-a',
            name: 'Sully',
            avatar: '',
            description: '',
            systemPrompt: '',
            memories: [],
            ttsVoiceId: 'voice-clone-123',
        } as CharacterProfile;
        await DB.saveCharacter(char);
        await putExistingDbValue(DB_NAME_CONST, STORE_VOICE_AUDIO, {
            msgId: 'call_1_0',
            createdAt: 1,
            mimeType: 'audio/webm',
            dataUrl: 'data:audio/webm;base64,dm9pY2UtZGF0YQ==',
        });

        localStorage.setItem('os_sub_api_config', '{"model":"flash"}');
        localStorage.setItem('character_refine_prompts', '["soft"]');
        localStorage.setItem('os_tts_presets', '[{"name":"voice"}]');
        localStorage.setItem('netease_music_cookie', 'MUSIC_U=secret');
        localStorage.setItem('chat_auto_tts_char-a', 'true');
        localStorage.setItem('csyos_backend_alive', '{"alive":true}');
        localStorage.setItem('vector_memory_batch_checkpoint:char-a', '{"cursor":1}');

        const noAudioData = await readBackupData(await exportSystemData('full', makeStateSnapshot(), noopProgress));
        expect(noAudioData.voiceAudio).toBeUndefined();

        const backupBlob = await exportSystemData('full', makeStateSnapshot(), noopProgress, { includeVoiceAudio: true });
        const data = await readBackupData(backupBlob);

        expect(data.version).toBe(3);
        expect(data.characters?.[0].ttsVoiceId).toBe('voice-clone-123');
        expect(data.voiceAudio?.[0].msgId).toBe('call_1_0');
        expect(data.voiceAudio?.[0].dataUrl).toContain('data:audio/webm');
        expect(data.extraLocalStorageConfig?.os_sub_api_config).toBe('{"model":"flash"}');
        expect(data.extraLocalStorageConfig?.character_refine_prompts).toBe('["soft"]');
        expect(data.extraLocalStorageConfig?.os_tts_presets).toBe('[{"name":"voice"}]');
        expect(data.extraLocalStorageConfig?.netease_music_cookie).toBe('MUSIC_U=secret');
        expect(data.extraLocalStorageConfig?.['chat_auto_tts_char-a']).toBe('true');
        expect(data.extraLocalStorageConfig?.csyos_backend_alive).toBeUndefined();
        expect(data.extraLocalStorageConfig?.['vector_memory_batch_checkpoint:char-a']).toBeUndefined();

        resetIndexedDb();
        localStorage.clear();
        await importWithoutReload(new File([backupBlob], 'backup.zip', { type: 'application/zip' }));

        const restoredChars = await DB.getAllCharacters();
        const restoredAudio = await DB.getVoiceAudio('call_1_0');
        expect(restoredChars[0].ttsVoiceId).toBe('voice-clone-123');
        expect(await restoredAudio?.text()).toBe('voice-data');
        expect(localStorage.getItem('os_sub_api_config')).toBe('{"model":"flash"}');
        expect(localStorage.getItem('chat_auto_tts_char-a')).toBe('true');
        expect(localStorage.getItem('csyos_backend_alive')).toBeNull();
    }, 15000);

    it('does not export or restore device identity localStorage keys', async () => {
        localStorage.setItem('csyos_user_id', 'csy-user-original');
        localStorage.setItem('csyos_client_id', 'csy-client-original');
        localStorage.setItem('os_sub_api_config', '{"model":"flash"}');
        await DB.saveAsset('csyos_user_id', 'existing-user-asset');

        const data = await readBackupData(await exportSystemData('full', makeStateSnapshot(), noopProgress));
        expect(data.extraLocalStorageConfig?.csyos_user_id).toBeUndefined();
        expect(data.extraLocalStorageConfig?.csyos_client_id).toBeUndefined();

        const pollutedIdentityBackup = {
            timestamp: Date.now(),
            version: 3,
            csyos_user_id: 'csy-user-from-top-level',
            csyosClientId: 'csy-client-from-top-level',
            assets: [
                { id: 'csyos_user_id', data: 'asset-user-from-backup' },
                { id: 'safe_asset', data: 'safe-value' },
            ],
            customIcons: {
                csyos_client_id: 'icon-client-from-backup',
                Calendar: 'calendar-icon',
            },
            appearancePresets: [
                { id: 'csyos_client_id', name: 'bad preset' },
                { id: 'preset-safe', name: 'safe preset' },
            ],
            extraLocalStorageConfig: {
                csyos_user_id: 'csy-user-from-backup',
                csyos_client_id: 'csy-client-from-backup',
                os_sub_api_config: '{"model":"restored"}',
            },
        };

        await importWithoutReload(JSON.stringify(pollutedIdentityBackup));

        expect(localStorage.getItem('csyos_user_id')).toBe('csy-user-original');
        expect(localStorage.getItem('csyos_client_id')).toBe('csy-client-original');
        expect(localStorage.getItem('os_sub_api_config')).toBe('{"model":"restored"}');
        expect(await DB.getAsset('csyos_user_id')).toBe('existing-user-asset');
        expect(await DB.getAsset('safe_asset')).toBe('safe-value');
        expect(await DB.getAsset('icon_csyos_client_id')).toBeNull();
        expect(await DB.getAsset('icon_Calendar')).toBe('calendar-icon');
        expect(await DB.getAsset('appearance_preset_csyos_client_id')).toBeNull();
        expect(await DB.getAsset('appearance_preset_preset-safe')).toContain('safe preset');

        const zip = new JSZip();
        zip.file('data.json', JSON.stringify({
            ...pollutedIdentityBackup,
            extraLocalStorageConfig: {
                csyos_user_id: 'csy-user-from-zip',
                csyos_client_id: 'csy-client-from-zip',
                os_sub_api_config: '{"model":"zip-restored"}',
            },
        }));
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        await importWithoutReload(new File([zipBlob], 'polluted-device-id.zip', { type: 'application/zip' }));

        expect(localStorage.getItem('csyos_user_id')).toBe('csy-user-original');
        expect(localStorage.getItem('csyos_client_id')).toBe('csy-client-original');
        expect(localStorage.getItem('os_sub_api_config')).toBe('{"model":"zip-restored"}');
    });

    it('restores the original device identity even when import fails', async () => {
        localStorage.setItem('csyos_user_id', 'csy-user-original');
        localStorage.setItem('csyos_client_id', 'csy-client-original');

        const importSpy = vi.spyOn(DB, 'importFullData').mockImplementation(async () => {
            localStorage.setItem('csyos_user_id', 'csy-user-during-import');
            localStorage.setItem('csyos_client_id', 'csy-client-during-import');
            throw new Error('import failed');
        });

        await expect(importWithoutReload(JSON.stringify({
            timestamp: Date.now(),
            version: 3,
            extraLocalStorageConfig: {
                csyos_user_id: 'csy-user-from-backup',
                csyos_client_id: 'csy-client-from-backup',
            },
        }))).rejects.toThrow('import failed');

        expect(localStorage.getItem('csyos_user_id')).toBe('csy-user-original');
        expect(localStorage.getItem('csyos_client_id')).toBe('csy-client-original');

        importSpy.mockRestore();
    });

    it('roundtrips music profile background and custom player skins', async () => {
        await putExternalValue(
            'music_profile_bg_db',
            'backgrounds',
            'data:image/png;base64,cHJvZmlsZS1iZw==',
            'custom_bg',
        );
        await putExternalValue(
            'music_custom_skins',
            'skins',
            { id: 'custom-skin-1', name: '雨夜', blob: 'data:image/jpeg;base64,c2tpbi1pbWFnZQ==' },
            undefined,
            { keyPath: 'id' },
        );
        localStorage.setItem('music_profile_bg_setting', '{"type":"custom"}');
        localStorage.setItem('music_player_skin', 'custom-skin-1');

        const backupBlob = await exportSystemData('media_only', makeStateSnapshot(), noopProgress);
        const data = await readBackupData(backupBlob);

        expect(data.musicAssets?.profileBackground?.dataUrl).toContain('data:image/png');
        expect(data.musicAssets?.customSkins?.[0]).toMatchObject({ id: 'custom-skin-1', name: '雨夜' });
        expect(data.extraLocalStorageConfig?.music_profile_bg_setting).toBe('{"type":"custom"}');
        expect(data.extraLocalStorageConfig?.music_player_skin).toBe('custom-skin-1');

        resetIndexedDb();
        localStorage.clear();
        await importWithoutReload(new File([backupBlob], 'backup.zip', { type: 'application/zip' }));

        const restoredBg = await getExternalValue('music_profile_bg_db', 'backgrounds', 'custom_bg');
        const restoredSkins = await getExternalValues('music_custom_skins', 'skins');

        expect(typeof (restoredBg as Blob).text).toBe('function');
        expect(await (restoredBg as Blob).text()).toBe('profile-bg');
        expect(restoredSkins).toHaveLength(1);
        expect(restoredSkins[0].id).toBe('custom-skin-1');
        expect(await restoredSkins[0].blob.text()).toBe('skin-image');
        expect(localStorage.getItem('music_profile_bg_setting')).toBe('{"type":"custom"}');
    });

    it('declares every primary IndexedDB store in the backup coverage map', () => {
        const coreSource = fs.readFileSync(path.join(process.cwd(), 'utils/db/core.ts'), 'utf8');
        const stores = [...coreSource.matchAll(/export const STORE_[A-Z0-9_]+ = '([^']+)'/g)].map(match => match[1]);
        const coveredStores = new Set([
            ...SYSTEM_BACKUP_ALWAYS_STORES,
            ...SYSTEM_BACKUP_CONDITIONAL_STORES,
            ...SYSTEM_BACKUP_EXCLUDED_STORES,
        ]);

        expect(stores.filter(store => !coveredStores.has(store))).toEqual([]);
    });

    it('restores graph relations and L1 memories through the backend import API', async () => {
        await importWithoutReload(JSON.stringify({
            timestamp: Date.now(),
            version: 3,
            graphData: {
                relations: [{ id: 'rel-a' }],
                l1Memories: [{ id: 'l1-a' }],
            },
        }));

        expect(graphImportBodies[graphImportBodies.length - 1]).toEqual({
            relations: [{ id: 'rel-a' }],
            l1Memories: [{ id: 'l1-a' }],
        });
    });

    it('roundtrips upstream SullyOS backup fields that do not have local stores', async () => {
        await importWithoutReload(JSON.stringify({
            timestamp: Date.now(),
            version: 3,
            customIcons: {
                Browser: 'data:image/png;base64,aWNvbg==',
            },
            appearancePresets: [
                { id: 'preset-a', name: '夜色', createdAt: 2, wallpaper: 'data:image/png;base64,cHJlc2V0' },
            ],
            memoryPalaceConfig: { enabled: true, digestInterval: 12 },
            studyApiConfig: { model: 'study-model' },
            studyTutorPresets: [{ id: 'tutor-a', name: '老师' }],
            cloudBackupConfig: { enabled: true, webdavUrl: 'https://dav.example', username: 'u', password: 'p', remotePath: '/SullyBackup/' },
            remoteVectorConfig: { enabled: true, supabaseUrl: 'https://supabase.example', supabaseAnonKey: 'anon', initialized: true },
            memoryPalaceHighWaterMarks: { 'char-a': 88 },
            memoryPalaceFlags: { 'mp_personality_tried_char-a': 'true' },
            chatTranslateSourceLang: 'ja',
            chatTranslateTargetLang: 'zh',
            chatTranslateEnabledByChar: { 'char-a': true },
            chatArchivePrompts: [{ id: 'archive-a' }],
            chatActiveArchivePromptId: 'archive-a',
            characterRefinePrompts: ['更细腻'],
            characterActiveRefinePromptId: 'refine-a',
            scheduleAppTheme: 'midnight',
            groupchatContextLimit: 13,
            browserConfig: { braveKey: 'brave-secret', useRealSearch: true },
            bm25Mode: 'hybrid',
            lastActiveCharId: 'char-a',
            eventNotifFlags: { sullyos_event_seen: '1' },
            songs: [{ id: 'song-a', title: '旧歌' }],
            quizSessions: [{ id: 'quiz-a' }],
            guidebookSessions: [{ id: 'guide-a' }],
            lifeSimState: { id: 'life-a' },
            memoryNodes: [{ id: 'node-a' }],
            memoryVectors: [{ id: 'vector-a' }],
            memoryLinks: [{ id: 'link-a' }],
            topicBoxes: [{ id: 'topic-a' }],
            anticipations: [{ id: 'anticipation-a' }],
            eventBoxes: [{ id: 'event-a' }],
            dailySchedules: [{ id: 'schedule-a' }],
            memoryBatches: [{ id: 'batch-a' }],
            pixelHomeAssets: [{ id: 'pixel-asset-a', image: 'data:image/png;base64,cGl4ZWw=' }],
            pixelHomeLayouts: [{ id: 'pixel-layout-a' }],
        }));

        expect(localStorage.getItem('os_memory_palace_config')).toBe('{"enabled":true,"digestInterval":12}');
        expect(localStorage.getItem('study_api_config')).toBe('{"model":"study-model"}');
        expect(localStorage.getItem('os_cloud_backup_config')).toContain('dav.example');
        expect(localStorage.getItem('mp_lastMsgId_char-a')).toBe('88');
        expect(localStorage.getItem('chat_translate_enabled_char-a')).toBe('true');
        expect(localStorage.getItem('browser_brave_key')).toBe('brave-secret');
        expect(localStorage.getItem('sullyos_event_seen')).toBe('1');
        expect(await DB.getAsset('icon_Browser')).toBe('data:image/png;base64,aWNvbg==');
        expect(await DB.getAsset('appearance_preset_preset-a')).toContain('夜色');

        const exported = await readBackupData(await exportSystemData('full', makeStateSnapshot(), noopProgress));

        expect(exported.customIcons?.Browser).toContain('assets/');
        expect(exported.appearancePresets?.[0].id).toBe('preset-a');
        expect(exported.memoryPalaceConfig).toEqual({ enabled: true, digestInterval: 12 });
        expect(exported.studyApiConfig).toEqual({ model: 'study-model' });
        expect(exported.cloudBackupConfig?.remotePath).toBe('/SullyBackup/');
        expect(exported.remoteVectorConfig?.initialized).toBe(true);
        expect(exported.memoryPalaceHighWaterMarks?.['char-a']).toBe(88);
        expect(exported.chatTranslateEnabledByChar?.['char-a']).toBe(true);
        expect(exported.browserConfig).toEqual({ braveKey: 'brave-secret', useRealSearch: true });
        expect(exported.eventNotifFlags?.sullyos_event_seen).toBe('1');
        expect(exported.songs?.[0].id).toBe('song-a');
        expect(exported.quizSessions?.[0].id).toBe('quiz-a');
        expect(exported.guidebookSessions?.[0].id).toBe('guide-a');
        expect(exported.lifeSimState?.id).toBe('life-a');
        expect(exported.memoryNodes?.[0].id).toBe('node-a');
        expect(exported.pixelHomeAssets?.[0].id).toBe('pixel-asset-a');
        expect(exported.pixelHomeLayouts?.[0].id).toBe('pixel-layout-a');
    });
});
