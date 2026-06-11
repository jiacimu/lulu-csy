import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
    addPendingEvent,
    cleanupExpiredEvents,
    getPendingEvents,
    TEMPORAL_EVENT_EXPIRY_BUFFER_MS,
    TEMPORAL_EVENTS_STORAGE_KEY,
    TEMPORAL_MAX_EVENTS_PER_CHAR,
    type PendingEvent,
} from './temporalContext';

const NOW = Date.parse('2026-06-10T08:00:00.000Z');

function makeEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
    const createdAt = overrides.createdAt ?? NOW;
    return {
        id: overrides.id ?? `evt-${createdAt}`,
        charId: overrides.charId ?? 'char-a',
        event: overrides.event ?? 'delivery',
        estimatedMinutes: overrides.estimatedMinutes ?? 15,
        confidence: overrides.confidence ?? 'medium',
        createdAt,
        dueAt: overrides.dueAt ?? createdAt + 15 * 60 * 1000,
    };
}

function readStoredEvents(): PendingEvent[] {
    return JSON.parse(localStorage.getItem(TEMPORAL_EVENTS_STORAGE_KEY) || '[]') as PendingEvent[];
}

describe('temporalContext event cache', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('cleans expired events across characters before saving a new event', () => {
        localStorage.setItem(TEMPORAL_EVENTS_STORAGE_KEY, JSON.stringify([
            makeEvent({
                id: 'expired-other-char',
                charId: 'char-b',
                createdAt: NOW - 3 * 60 * 60 * 1000,
                dueAt: NOW - TEMPORAL_EVENT_EXPIRY_BUFFER_MS - 1000,
            }),
            makeEvent({ id: 'fresh-a', charId: 'char-a', createdAt: NOW - 1000 }),
        ]));

        addPendingEvent(makeEvent({ id: 'fresh-c', charId: 'char-c', createdAt: NOW + 1000 }));

        expect(readStoredEvents().map(event => event.id)).toEqual(['fresh-a', 'fresh-c']);
        expect(getPendingEvents('char-b')).toEqual([]);
    });

    it('keeps only the newest bounded events per character', () => {
        for (let index = 0; index < TEMPORAL_MAX_EVENTS_PER_CHAR + 5; index += 1) {
            addPendingEvent(makeEvent({
                id: `event-${index}`,
                createdAt: NOW - (TEMPORAL_MAX_EVENTS_PER_CHAR + 5 - index) * 1000,
            }));
        }

        const pending = getPendingEvents('char-a');

        expect(pending).toHaveLength(TEMPORAL_MAX_EVENTS_PER_CHAR);
        expect(pending[0].id).toBe('event-5');
        expect(pending[pending.length - 1].id).toBe(`event-${TEMPORAL_MAX_EVENTS_PER_CHAR + 4}`);
    });

    it('compacts the cache instead of throwing when localStorage quota is exceeded', () => {
        const originalSetItem = Storage.prototype.setItem;
        let eventCacheWrites = 0;

        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key: string, value: string) {
            if (key === TEMPORAL_EVENTS_STORAGE_KEY && eventCacheWrites === 0) {
                eventCacheWrites += 1;
                throw new DOMException('quota full', 'QuotaExceededError');
            }
            eventCacheWrites += key === TEMPORAL_EVENTS_STORAGE_KEY ? 1 : 0;
            return originalSetItem.call(this, key, value);
        });

        expect(() => addPendingEvent(makeEvent({ id: 'quota-safe-event' }))).not.toThrow();
        expect(readStoredEvents().map(event => event.id)).toEqual(['quota-safe-event']);
    });

    it('cleanupExpiredEvents enforces cache limits even without adding a new event', () => {
        localStorage.setItem(TEMPORAL_EVENTS_STORAGE_KEY, JSON.stringify(
            Array.from({ length: TEMPORAL_MAX_EVENTS_PER_CHAR + 2 }, (_, index) => makeEvent({
                id: `stored-${index}`,
                createdAt: NOW - (TEMPORAL_MAX_EVENTS_PER_CHAR + 2 - index) * 1000,
            })),
        ));

        cleanupExpiredEvents('char-a');

        expect(readStoredEvents()).toHaveLength(TEMPORAL_MAX_EVENTS_PER_CHAR);
        expect(readStoredEvents()[0].id).toBe('stored-2');
    });
});
