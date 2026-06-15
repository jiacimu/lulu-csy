import { describe,expect,it } from 'vitest';
import {
    GROUP_MEMORY_BUFFER,
    GROUP_MEMORY_STRIDE,
    GROUP_MEMORY_WINDOW,
    getDueGroupMemoryWindows,
} from './groupChatMemory';

describe('group chat memory windows', () => {
    it('starts after a 200-message window plus 30-message buffer', () => {
        expect(GROUP_MEMORY_WINDOW).toBe(200);
        expect(GROUP_MEMORY_BUFFER).toBe(30);
        expect(GROUP_MEMORY_STRIDE).toBe(170);

        expect(getDueGroupMemoryWindows(229, 0)).toEqual([]);
        expect(getDueGroupMemoryWindows(230, 0)).toEqual([{ start: 0, end: 200 }]);
    });

    it('advances by 170 with 30-message overlap', () => {
        expect(getDueGroupMemoryWindows(399, 170)).toEqual([]);
        expect(getDueGroupMemoryWindows(400, 170)).toEqual([{ start: 170, end: 370 }]);
        expect(getDueGroupMemoryWindows(570, 340)).toEqual([{ start: 340, end: 540 }]);
    });

    it('returns multiple due windows if the queue fell behind', () => {
        expect(getDueGroupMemoryWindows(570, 0)).toEqual([
            { start: 0, end: 200 },
            { start: 170, end: 370 },
            { start: 340, end: 540 },
        ]);
    });
});

