// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { MemoryRecord } from '../types';
import type { MemoryRecordPlayable } from '../types/music';
import { DB } from './db';
import { exportMemoryRecordMp3 } from './memoryRecordExport';

let createObjectURLMock: ReturnType<typeof vi.fn>;

function buildRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
    return {
        id: 'record-1',
        charId: 'char-a',
        charName: 'Sully',
        userName: '我',
        mode: 'dream_mix',
        status: 'ready',
        title: '梦里回声',
        albumName: '回忆唱片匣',
        artistName: 'Sully',
        monologueText: '',
        lyrics: '[Verse]\n梦在转动',
        musicPrompt: 'dream pop',
        coverGradient: 'linear-gradient(135deg, #f7d6e0, #2d3142)',
        seedMemoryIds: [],
        createdAt: 100,
        updatedAt: 100,
        ...overrides,
    };
}

function buildPlayable(record: MemoryRecord): MemoryRecordPlayable {
    return {
        kind: 'memoryRecord',
        id: 850000001,
        recordId: record.id,
        name: record.title,
        artistName: record.artistName,
        albumName: record.albumName,
        duration: record.durationMs || 120000,
        lyrics: record.lyrics,
        audioId: record.masterAudioId || record.musicAudioId,
        requiresMasterAudio: true,
    };
}

async function saveAudio(recordId: string, id: string, kind: 'master' | 'music', text: string): Promise<void> {
    await DB.saveMemoryRecordAudio({
        id,
        recordId,
        kind,
        blob: new Blob([text], { type: 'audio/mpeg' }),
        mimeType: 'audio/mpeg',
        durationMs: 120000,
        createdAt: 100,
    });
}

describe('memoryRecordExport', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
        Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });

        createObjectURLMock = vi.fn(() => 'blob:memory-record-mp3');
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURLMock, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });

    it('exports master audio before music audio', async () => {
        const record = buildRecord({
            masterAudioId: 'record-1:master',
            musicAudioId: 'record-1:music',
        });
        await DB.saveMemoryRecord(record);
        await saveAudio(record.id, 'record-1:music', 'music', 'music-track');
        await saveAudio(record.id, 'record-1:master', 'master', 'master-track');
        const getAudioEntrySpy = vi.spyOn(DB, 'getMemoryRecordAudioEntry');

        const result = await exportMemoryRecordMp3(buildPlayable(record));

        expect(result.method).toBe('download');
        expect(result.fileName).toBe('梦里回声 - Sully.mp3');
        expect(getAudioEntrySpy).toHaveBeenCalledWith('record-1:master');
        expect(getAudioEntrySpy).not.toHaveBeenCalledWith('record-1:music');
        expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to music audio when master audio is missing', async () => {
        const record = buildRecord({
            masterAudioId: 'record-1:master',
            musicAudioId: 'record-1:music',
        });
        await DB.saveMemoryRecord(record);
        await saveAudio(record.id, 'record-1:music', 'music', 'music-track');
        const getAudioEntrySpy = vi.spyOn(DB, 'getMemoryRecordAudioEntry');

        await exportMemoryRecordMp3(buildPlayable(record));

        expect(getAudioEntrySpy).toHaveBeenNthCalledWith(1, 'record-1:master');
        expect(getAudioEntrySpy).toHaveBeenNthCalledWith(2, 'record-1:music');
        expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    it('throws a user-readable error when there is no audio blob', async () => {
        const record = buildRecord({
            masterAudioId: 'record-1:master',
            musicAudioId: 'record-1:music',
        });
        await DB.saveMemoryRecord(record);

        await expect(exportMemoryRecordMp3(buildPlayable(record))).rejects.toThrow('没有找到可导出的音频');
    });

    it('removes unsafe filename characters and keeps the mp3 extension', async () => {
        const record = buildRecord({
            title: '梦:里/回*声?',
            artistName: 'Sul<ly>|"A',
            musicAudioId: 'record-1:music',
        });
        await DB.saveMemoryRecord(record);
        await saveAudio(record.id, 'record-1:music', 'music', 'music-track');

        const result = await exportMemoryRecordMp3(buildPlayable(record));

        expect(result.fileName).toBe('梦里回声 - SullyA.mp3');
        expect(result.fileName).not.toMatch(/[\\/:*?"<>|]/);
    });
});
