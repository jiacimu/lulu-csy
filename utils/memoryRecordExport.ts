import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { MemoryRecordAudio } from '../types';
import type { MemoryRecordPlayable } from '../types/music';
import { DB } from './db';

export type MemoryRecordMp3ExportMethod = 'native-share' | 'web-share' | 'download';

export interface MemoryRecordMp3ExportResult {
    fileName: string;
    method: MemoryRecordMp3ExportMethod;
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1F]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DEFAULT_MP3_FILE_NAME = 'Emo Cloud 本地歌曲.mp3';
const MAX_FILE_NAME_BASE_LENGTH = 96;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isShareCancelled(error: unknown): boolean {
    const name = typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';
    const message = getErrorMessage(error).toLowerCase();

    return name === 'AbortError'
        || message.includes('cancel')
        || message.includes('abort')
        || message.includes('取消');
}

function sanitizeFileSegment(value: string): string {
    return value
        .replace(INVALID_FILENAME_CHARS, '')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();
}

export function sanitizeMemoryRecordMp3FileName(title: string, artistName: string): string {
    const parts = [sanitizeFileSegment(title), sanitizeFileSegment(artistName)].filter(Boolean);
    let baseName = parts.join(' - ') || DEFAULT_MP3_FILE_NAME.replace(/\.mp3$/i, '');

    if (WINDOWS_RESERVED_NAMES.test(baseName)) {
        baseName = `${baseName} song`;
    }

    if (baseName.length > MAX_FILE_NAME_BASE_LENGTH) {
        baseName = baseName.slice(0, MAX_FILE_NAME_BASE_LENGTH).replace(/[. ]+$/g, '').trim();
    }

    return `${baseName || 'Emo Cloud 本地歌曲'}.mp3`;
}

async function readCandidateAudioEntry(candidateIds: string[]): Promise<MemoryRecordAudio | null> {
    for (const id of candidateIds) {
        const entry = await DB.getMemoryRecordAudioEntry(id);
        if (entry?.blob) return entry;
    }

    return null;
}

async function resolveExportAudio(playable: MemoryRecordPlayable): Promise<MemoryRecordAudio> {
    const record = await DB.getMemoryRecordById(playable.recordId);
    if (!record) {
        throw new Error('没有找到这首本地生成歌');
    }

    const candidateIds: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (id?: string) => {
        const trimmed = id?.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        candidateIds.push(trimmed);
    };

    addCandidate(record.masterAudioId);
    addCandidate(record.musicAudioId);
    addCandidate(playable.audioId);

    const directEntry = await readCandidateAudioEntry(candidateIds);
    if (directEntry) return directEntry;

    const recordAudio = await DB.getMemoryRecordAudioByRecordId(playable.recordId);
    const fallbackEntry = recordAudio.find((entry) => entry.kind === 'master' && entry.blob)
        || recordAudio.find((entry) => entry.kind === 'music' && entry.blob);

    if (!fallbackEntry) {
        throw new Error('没有找到可导出的音频');
    }

    return fallbackEntry;
}

function ensureMp3Blob(blob: Blob): Blob {
    if (blob.type === 'audio/mpeg' || blob.type === 'audio/mp3') {
        return blob;
    }

    return new Blob([blob], { type: 'audio/mpeg' });
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('音频读取失败'));
        };
        reader.onerror = () => reject(reader.error || new Error('音频读取失败'));
        reader.readAsDataURL(blob);
    });
}

async function tryNativeShare(blob: Blob, fileName: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
        const dataUrl = await blobToDataUrl(blob);
        await Filesystem.writeFile({
            path: fileName,
            data: dataUrl,
            directory: Directory.Cache,
        });
        const uriResult = await Filesystem.getUri({
            directory: Directory.Cache,
            path: fileName,
        });
        await Share.share({
            title: fileName,
            files: [uriResult.uri],
        });
        return true;
    } catch (error) {
        if (isShareCancelled(error)) {
            throw new Error('分享已取消');
        }
        console.warn('[MemoryRecordExport] Native share failed, falling back to download:', error);
        return false;
    }
}

async function tryWebShare(blob: Blob, fileName: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File === 'undefined') {
        return false;
    }

    const file = new File([blob], fileName, { type: 'audio/mpeg' });
    const shareData: ShareData = {
        title: fileName,
        files: [file],
    };

    if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
        return false;
    }

    try {
        await navigator.share(shareData);
        return true;
    } catch (error) {
        if (isShareCancelled(error)) {
            throw new Error('分享已取消');
        }
        console.warn('[MemoryRecordExport] Web share failed, falling back to download:', error);
        return false;
    }
}

export async function exportMemoryRecordMp3(playable: MemoryRecordPlayable): Promise<MemoryRecordMp3ExportResult> {
    const audioEntry = await resolveExportAudio(playable);
    const mp3Blob = ensureMp3Blob(audioEntry.blob);
    const fileName = sanitizeMemoryRecordMp3FileName(playable.name, playable.artistName);

    if (await tryNativeShare(mp3Blob, fileName)) {
        return { fileName, method: 'native-share' };
    }

    if (await tryWebShare(mp3Blob, fileName)) {
        return { fileName, method: 'web-share' };
    }

    triggerBrowserDownload(mp3Blob, fileName);
    return { fileName, method: 'download' };
}
