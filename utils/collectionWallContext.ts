type PendingWallContext = {
    text: string;
    createdAt: number;
};

const STORAGE_PREFIX = 'collection_wall_pending_context';
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_ITEMS = 5;

const storageKey = (charId: string): string => `${STORAGE_PREFIX}_${charId}`;

const readQueue = (charId: string): PendingWallContext[] => {
    try {
        const raw = localStorage.getItem(storageKey(charId));
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed
            .filter(item => typeof item?.text === 'string' && now - Number(item.createdAt || 0) <= MAX_AGE_MS)
            .slice(-MAX_ITEMS);
    } catch {
        return [];
    }
};

const writeQueue = (charId: string, queue: PendingWallContext[]): void => {
    try {
        localStorage.setItem(storageKey(charId), JSON.stringify(queue.slice(-MAX_ITEMS)));
    } catch {
        // best effort only
    }
};

export function addCollectionWallPendingContext(charId: string, text: string): void {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!charId || !trimmed) return;
    const queue = readQueue(charId);
    queue.push({ text: trimmed.slice(0, 180), createdAt: Date.now() });
    writeQueue(charId, queue);
}

export function consumeCollectionWallPendingContext(charId: string): string[] {
    const queue = readQueue(charId);
    writeQueue(charId, []);
    return queue.map(item => item.text);
}
