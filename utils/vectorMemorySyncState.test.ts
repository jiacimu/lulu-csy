import { describe, expect, it } from 'vitest';
import type { VectorMemory } from '../types';
import {
    rebaseImportedVectorMemories,
    rebaseImportedVectorMemory,
} from './vectorMemorySyncState';

function makeMemory(overrides: Partial<VectorMemory> = {}): VectorMemory {
    return {
        id: 'mem-1',
        charId: 'char-1',
        title: 'Memory',
        content: 'Remembered detail',
        importance: 5,
        mentionCount: 0,
        lastMentioned: 0,
        createdAt: 1,
        vector: [0.1, 0.2],
        source: 'sync',
        syncState: 'backend_generated',
        cloudSynced: true,
        ...overrides,
    };
}

describe('vectorMemorySyncState import rebasing', () => {
    it('rebases imported backup memories to pending_sync when a cloud target exists', () => {
        const result = rebaseImportedVectorMemory(makeMemory(), true);

        expect(result).toMatchObject({
            source: 'import',
            syncState: 'pending_sync',
            cloudSynced: false,
        });
    });

    it('rebases imported backup memories to local_only when no cloud target exists', () => {
        const result = rebaseImportedVectorMemory(makeMemory(), false);

        expect(result).toMatchObject({
            source: 'import',
            syncState: 'local_only',
            cloudSynced: false,
        });
    });

    it('rebases arrays without dropping records', () => {
        const result = rebaseImportedVectorMemories([
            makeMemory({ id: 'mem-1' }),
            makeMemory({ id: 'mem-2', source: 'import' }),
        ], true);

        expect(result).toHaveLength(2);
        expect(result.map((memory) => memory.id)).toEqual(['mem-1', 'mem-2']);
        expect(result.every((memory) => memory.syncState === 'pending_sync')).toBe(true);
    });
});
