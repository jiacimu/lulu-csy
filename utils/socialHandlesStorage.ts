import type { SubAccount } from '../types';
import { DB } from './db';

export const SPARK_CHAR_HANDLES_STORAGE_KEY = 'spark_char_handles';

export type SparkCharHandles = Record<string, SubAccount[]>;

const parseHandles = (raw: string | null): SparkCharHandles | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as SparkCharHandles;
    } catch {
        return null;
    }
};

const hasHandles = (handles: SparkCharHandles | null): handles is SparkCharHandles => {
    return !!handles && Object.keys(handles).length > 0;
};

const getLocalStorage = (): Storage | null => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
};

const readLegacyLocalHandles = (): string | null => {
    try {
        return getLocalStorage()?.getItem(SPARK_CHAR_HANDLES_STORAGE_KEY) || null;
    } catch {
        return null;
    }
};

const removeLegacyLocalHandles = (): void => {
    try {
        getLocalStorage()?.removeItem(SPARK_CHAR_HANDLES_STORAGE_KEY);
    } catch {
        // Best-effort quota cleanup.
    }
};

export const loadSparkCharHandles = async (): Promise<SparkCharHandles> => {
    const dbRaw = await DB.getAsset(SPARK_CHAR_HANDLES_STORAGE_KEY).catch(() => null);
    const dbHandles = parseHandles(dbRaw);
    const legacyRaw = readLegacyLocalHandles();
    const legacyHandles = parseHandles(legacyRaw);

    if (hasHandles(dbHandles)) {
        if (legacyRaw) removeLegacyLocalHandles();
        return dbHandles;
    }

    if (hasHandles(legacyHandles) && legacyRaw) {
        try {
            await DB.saveAsset(SPARK_CHAR_HANDLES_STORAGE_KEY, legacyRaw);
            removeLegacyLocalHandles();
        } catch {
            // Keep legacy data if IndexedDB is unavailable, but callers must not write it back.
        }
        return legacyHandles;
    }

    if (legacyRaw) removeLegacyLocalHandles();
    return {};
};

export const saveSparkCharHandles = async (handles: SparkCharHandles): Promise<void> => {
    await DB.saveAsset(SPARK_CHAR_HANDLES_STORAGE_KEY, JSON.stringify(handles));
    removeLegacyLocalHandles();
};
