// @vitest-environment jsdom

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import MemoryCenter from './MemoryCenter';
import { DB } from '../../utils/db';
import { pullMemories,pushMemories } from '../../utils/backendClient';
import { runHormoneBackfillJobFlow } from './memoryCenterBackfill';
import { VectorMemoryExtractor } from '../../utils/vectorMemoryExtractor';

vi.mock('../../utils/db', () => ({
    DB: {
        getAllVectorMemories: vi.fn(),
        getMessagesByCharId: vi.fn(),
        getMessagesByIds: vi.fn(),
        getVectorMemoryById: vi.fn(),
        deleteVectorMemory: vi.fn(),
        clearVectorMemories: vi.fn(),
        saveVectorMemory: vi.fn(),
        replaceVectorMemories: vi.fn(),
    },
}));

vi.mock('../../utils/backendClient', () => ({
    clearCloudMemories: vi.fn(),
    deleteCloudMemory: vi.fn(),
    createHormoneBackfillJob: vi.fn(),
    getHormoneBackfillJob: vi.fn(),
    cancelHormoneBackfillJob: vi.fn(),
    pullMemories: vi.fn(),
    pushMemories: vi.fn(),
}));

vi.mock('./memoryCenterBackfill', () => ({
    runHormoneBackfillJobFlow: vi.fn(),
}));

vi.mock('../../utils/vectorMemoryExtractor', () => ({
    VectorMemoryExtractor: {
        backfillHormoneSnapshots: vi.fn(),
    },
}));

const mockedDB = vi.mocked(DB);
const mockedPullMemories = vi.mocked(pullMemories);
const mockedPushMemories = vi.mocked(pushMemories);
const mockedRunHormoneBackfillJobFlow = vi.mocked(runHormoneBackfillJobFlow);
const mockedBackfillHormoneSnapshots = vi.mocked(VectorMemoryExtractor.backfillHormoneSnapshots);

function makeMemory(overrides: Record<string, unknown> = {}) {
    return {
        id: 'vm-1',
        charId: 'char-1',
        title: 'Memory 1',
        content: 'A remembered moment',
        importance: 5,
        mentionCount: 1,
        lastMentioned: 0,
        createdAt: 100,
        sourceMessageIds: [11],
        ...overrides,
    };
}

function makeJob(status: 'processing' | 'completed' | 'failed', overrides: Record<string, unknown> = {}) {
    return {
        id: 'job-1',
        userId: 'user-1',
        type: 'hormone-backfill',
        status,
        totalItems: 1,
        queuedItems: status === 'processing' ? 0 : 0,
        processingItems: status === 'processing' ? 1 : 0,
        completedItems: status === 'completed' ? 1 : 0,
        failedItems: status === 'failed' ? 1 : 0,
        cancelledItems: 0,
        createdAt: 1,
        updatedAt: 2,
        ...overrides,
    };
}

function findButtonByClassFragments(...fragments: string[]): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll('button')).find(
        (candidate): candidate is HTMLButtonElement => (
            candidate instanceof HTMLButtonElement
            && fragments.every((fragment) => candidate.className.includes(fragment))
        ),
    );
    if (!button) {
        throw new Error(`Could not find button containing class fragments: ${fragments.join(', ')}`);
    }
    return button;
}

function renderMemoryCenter(addToast = vi.fn()) {
    return {
        addToast,
        ...render(
            <MemoryCenter
                memories={[]}
                refinedMemories={{}}
                activeMemoryMonths={[]}
                charName="Sully"
                userName="Tester"
                onRefine={vi.fn(async () => undefined)}
                onDeleteMemories={vi.fn()}
                onUpdateMemory={vi.fn()}
                onToggleActiveMonth={vi.fn()}
                onUpdateRefinedMemory={vi.fn()}
                onDeleteRefinedMemory={vi.fn()}
                formData={{ id: 'char-1', name: 'Sully', vectorMemoryEnabled: true } as any}
                handleChange={vi.fn()}
                addToast={addToast}
                apiConfig={{ apiKey: 'main-key' }}
            />,
        ),
    };
}

async function openVectorTabAndStartBackfill() {
    fireEvent.click(screen.getAllByRole('button')[1]);
    await waitFor(() => {
        expect(document.querySelectorAll('button').length).toBeGreaterThan(3);
    });
    fireEvent.click(findButtonByClassFragments('from-purple-500', 'to-indigo-500'));
}

describe('MemoryCenter hormone backfill flow', () => {
    let localMemories: any[];
    let cloudMemories: any[];

    beforeEach(() => {
        vi.resetAllMocks();
        localStorage.clear();
        localStorage.setItem('sub_api_key', 'sub-key');
        localStorage.setItem('sub_api_base_url', 'https://llm.example.com');
        localStorage.setItem('sub_api_model', 'gpt-test');
        localStorage.setItem('csyos_backend_token', 'backend-token');
        localMemories = [makeMemory()];
        cloudMemories = [];

        mockedPullMemories.mockImplementation(async () => cloudMemories as any);
        mockedPushMemories.mockResolvedValue({ synced: 1, skipped: 0 });
        mockedBackfillHormoneSnapshots.mockImplementation(async () => {
            localMemories = [makeMemory({ hormoneSnapshot: { dopamine: 0.7 } })];
            return { success: 1, skipped: 0, failed: 0 };
        });
        mockedDB.replaceVectorMemories.mockImplementation(async (_charId, memories) => {
            localMemories = Array.isArray(memories) ? [...memories] : [];
        });
        mockedDB.getAllVectorMemories.mockImplementation(async () => localMemories as any);
        mockedDB.getMessagesByCharId.mockResolvedValue([]);
        mockedDB.getMessagesByIds.mockResolvedValue([
            { id: 11, role: 'user', content: 'hello there', timestamp: 1000, type: 'text' },
        ] as any);
    });

    it('reuses an existing hormone job and reports completion from the component flow', async () => {
        mockedRunHormoneBackfillJobFlow.mockImplementation(async (options) => {
            options.onJobAccepted?.({
                reused: true,
                job: makeJob('processing'),
            } as any);

            return {
                createResult: {
                    reused: true,
                    job: makeJob('processing'),
                },
                finalDetail: {
                    job: makeJob('completed'),
                    items: [],
                },
                cancelled: false,
            } as any;
        });

        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(mockedRunHormoneBackfillJobFlow).toHaveBeenCalledTimes(1);
            expect(addToast).toHaveBeenCalledWith('Emotion backfill completed: 1 memories updated', 'success');
        });
    });

    it('syncs cloud hormone progress before restarting and skips duplicate reruns when everything is already up to date', async () => {
        cloudMemories = [
            makeMemory({
                source: 'sync',
                vector: [],
                hormoneSnapshot: { dopamine: 0.7 },
            }),
        ];
        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(mockedRunHormoneBackfillJobFlow).not.toHaveBeenCalled();
            expect(addToast).toHaveBeenCalledWith(
                'All memories already have hormone snapshots',
                'info',
            );
        });
    });

    it('shows a clear timeout toast when the hormone job polling limit is exceeded', async () => {
        mockedRunHormoneBackfillJobFlow.mockRejectedValue(
            new Error('Hormone backfill job polling timed out after 600 polls'),
        );

        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(addToast).toHaveBeenCalledWith(
                'Emotion backfill failed: Hormone backfill job polling timed out after 600 polls',
                'error',
            );
        });
    });

    it('surfaces backend job errors when the hormone backfill job fails', async () => {
        mockedRunHormoneBackfillJobFlow.mockResolvedValue({
            createResult: {
                job: makeJob('processing'),
            },
            finalDetail: {
                job: makeJob('failed', {
                    totalItems: 152,
                    failedItems: 152,
                    error: 'Queue sendBatch failed: Payload Too Large',
                }),
                items: [],
            },
            cancelled: false,
        } as any);

        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(addToast).toHaveBeenCalledWith(
                'Emotion backfill failed: Queue sendBatch failed: Payload Too Large (0 completed, 152 failed)',
                'error',
            );
        });
    });

    it('recovers cloud hormone progress before needing to restart the job flow', async () => {
        mockedRunHormoneBackfillJobFlow.mockImplementation(async () => {
            cloudMemories = [
                makeMemory({
                    source: 'sync',
                    vector: [],
                    hormoneSnapshot: { dopamine: 0.7 },
                }),
            ];
            throw new Error('Failed to create hormone backfill job');
        });

        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(mockedRunHormoneBackfillJobFlow).toHaveBeenCalledTimes(1);
            expect(mockedDB.replaceVectorMemories).toHaveBeenCalled();
            expect(addToast).toHaveBeenCalledWith(
                'Recovered 1 hormone snapshots from cloud. All memories are already up to date',
                'info',
            );
        });
    });

    it('falls back to local hormone backfill when backend job creation fails', async () => {
        mockedRunHormoneBackfillJobFlow.mockRejectedValue(
            new Error('Failed to create hormone backfill job'),
        );

        const { addToast } = renderMemoryCenter();

        await openVectorTabAndStartBackfill();

        await waitFor(() => {
            expect(mockedRunHormoneBackfillJobFlow).toHaveBeenCalledTimes(1);
            expect(mockedBackfillHormoneSnapshots).toHaveBeenCalledWith(
                [expect.objectContaining({ id: 'vm-1' })],
                'Sully',
                expect.objectContaining({ apiKey: 'sub-key' }),
                expect.any(Function),
                expect.any(AbortSignal),
            );
            expect(addToast).toHaveBeenCalledWith(
                'Emotion backfill completed locally: 1 memories updated and synced to cloud',
                'success',
            );
        });
    });
});
