import { describe,expect,it } from 'vitest';
import {
    buildDateDiaryMemoryPrompt,
    parseDateDiaryMemoryResponse,
    renderDateDiaryMemoryTemplate,
    toDateDiaryMemoryTemplate,
} from './dateDiaryMemory';

describe('dateDiaryMemory', () => {
    it('builds a prompt that requires literal name placeholders', () => {
        const prompt = buildDateDiaryMemoryPrompt('Sully', '初时雨', '2026-05-24 20:00', '他们分别前沉默了一会。');

        expect(prompt).toContain('提到用户时必须写字面量占位符 {userName}');
        expect(prompt).toContain('如必须提到角色名字，写字面量占位符 {charName}');
        expect(prompt).toContain('不要写真实名字“初时雨”');
        expect(prompt).toContain('不要写真实名字“Sully”');
    });

    it('parses diary memory JSON and clamps importance', () => {
        const result = parseDateDiaryMemoryResponse(`\`\`\`json
[
  {
    "title": "分别前的沉默",
    "content": "我记得 {userName} 快分别时忽然安静下来。那一瞬间我没有立刻说话，因为我怕自己把舍不得说得太明显。",
    "emotionalJourney": "舍不得、克制",
    "importance": 99
  }
]
\`\`\``);

        expect(result).toEqual([
            {
                title: '分别前的沉默',
                content: '我记得 {userName} 快分别时忽然安静下来。那一瞬间我没有立刻说话，因为我怕自己把舍不得说得太明显。',
                emotionalJourney: '舍不得、克制',
                importance: 10,
            },
        ]);
    });

    it('renders placeholders for embedding or prompt injection', () => {
        expect(renderDateDiaryMemoryTemplate(
            '我记得 {userName} 没有松开手，{charName} 也没有后退。',
            'Sully',
            '初时雨',
        )).toBe('我记得 初时雨 没有松开手，Sully 也没有后退。');
    });

    it('converts displayed names back to placeholders before saving', () => {
        expect(toDateDiaryMemoryTemplate(
            '我记得 初时雨 没有松开手，Sully 也没有后退。',
            'Sully',
            '初时雨',
        )).toBe('我记得 {userName} 没有松开手，{charName} 也没有后退。');
    });

    it('normalizes loose placeholder casing while rendering', () => {
        expect(renderDateDiaryMemoryTemplate(
            '我记得 ｛ username ｝ 递来的花。',
            'Sully',
            '初时雨',
        )).toBe('我记得 初时雨 递来的花。');
    });
});
