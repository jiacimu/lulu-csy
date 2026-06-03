import { describe, expect, it } from 'vitest';
import {
    NIANNIAN_MAX_COMPLETION_TOKENS,
    appendNianNianFrozenSegment,
    applyNianNianAssistantOutput,
    applyNianNianStatusPatch,
    buildNianNianTurnPlan,
    createNianNianSession,
    createInitialNianNianStatus,
    createEmptyWorldBible,
    formatNianNianUserInput,
    parseNianNianStatusBlock,
} from './niannianEngine';

describe('niannianEngine', () => {
    it('formats option plus separated action and speech beats', () => {
        const formatted = formatNianNianUserInput({
            selectedOption: { id: 'choice-1', label: '靠近一步' },
            beats: [
                { kind: 'action', text: '把伞往他那边偏了偏' },
                { kind: 'speech', text: '你淋湿了。' },
            ],
        });

        expect(formatted).toBe('【选项】靠近一步\n【动作】把伞往他那边偏了偏\n【台词】你淋湿了。');
    });

    it('parses the fixed status block contract', () => {
        const parsed = parseNianNianStatusBlock(`剧情正文
<<<STATUS>>>
{
  "ta": { "好感_delta": 5, "心情": "动摇" },
  "scene": { "地点": "廊下" }
}
<<<END>>>`);

        expect(parsed?.statusPatch.ta.好感_delta).toBe(5);
        expect(parsed?.statusPatch.scene.地点).toBe('廊下');
    });

    it('applies numeric deltas with clamps and qualitative overwrites', () => {
        const world = createEmptyWorldBible();
        const previous = createInitialNianNianStatus(world);
        const next = applyNianNianStatusPatch(previous, {
            ta: { 好感_delta: 150, 心情: '雀跃', 暧昧度_delta: 8 },
            me: { 体力_delta: -130, 名声_delta: -9 },
            scene: { 地点: '灯会' },
            npcs: [{ name: '林公子', mood: '不悦' }],
        });

        expect(next.ta.好感).toBe(100);
        expect(next.ta.心情).toBe('雀跃');
        expect(next.ta.暧昧度).toBe(8);
        expect(next.me.体力).toBe(0);
        expect(next.me.名声).toBe(-9);
        expect(next.scene.地点).toBe('灯会');
        expect(next.npcsOnScene).toEqual([{ name: '林公子', mood: '不悦' }]);
    });

    it('builds dual-model turn requests with the maximum token budget', () => {
        const world = createEmptyWorldBible();
        const session = createNianNianSession({
            charId: 'char-1',
            charName: '念念',
            userName: '测试用户',
            world,
            now: 1700000000000,
        });
        const plan = buildNianNianTurnPlan(session, '【台词】你在想什么？');

        expect(plan.mainRequest.lane).toBe('main');
        expect(plan.directorRequest.lane).toBe('director');
        expect(plan.mainRequest.max_tokens).toBe(NIANNIAN_MAX_COMPLETION_TOKENS);
        expect(plan.directorRequest.max_tokens).toBe(NIANNIAN_MAX_COMPLETION_TOKENS);
        expect(plan.mainRequest.metadata.statusDelimiter).toEqual(['<<<STATUS>>>', '<<<END>>>']);
        expect(plan.mainRequest.messages[0].content).toContain('TODO(人工)');
    });

    it('keeps frozen segments append-only and applies assistant status output', () => {
        const session = createNianNianSession({
            charId: 'char-1',
            charName: '念念',
            userName: '测试用户',
            world: createEmptyWorldBible(),
            now: 1700000000000,
        });
        const withSegment = appendNianNianFrozenSegment(session, {
            summary: 'TODO(人工)：压缩摘要',
            turnRange: [0, 20],
            now: 1700000001000,
        });
        const applied = applyNianNianAssistantOutput(withSegment, `他垂眸看了你一眼。
<<<STATUS>>>
{ "ta": { "好感_delta": 7, "心情": "动摇" } }
<<<END>>>`, 1700000002000);

        expect(session.segments).toHaveLength(0);
        expect(withSegment.segments).toEqual([{
            idx: 0,
            turnRange: [0, 20],
            summary: 'TODO(人工)：压缩摘要',
        }]);
        expect(applied.parsedStatus?.statusPatch.ta.好感_delta).toBe(7);
        expect(applied.session.status.ta.好感).toBe(7);
        expect(applied.session.rawBuffer[0].content).toBe('他垂眸看了你一眼。');
    });
});
