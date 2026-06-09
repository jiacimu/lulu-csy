import { describe,expect,it } from 'vitest';
import { formatMessagesForSummary } from '../utils/dateSummaryPrompts';
import type { Message } from '../types';

const makeMessage = (content: string): Message => ({
    id: 1,
    charId: 'char-1',
    role: 'assistant',
    type: 'text',
    content,
    timestamp: 1_000,
    metadata: { source: 'date' },
});

describe('date summary prompt bilingual content', () => {
    it('keeps only original text when formatting stored bilingual date messages', () => {
        const formatted = formatMessagesForSummary([
            makeMessage('[shy]<翻译><原文>「描いてた」</原文><译文>「我在画画」</译文></翻译>'),
        ], 'Sully', '小米');

        expect(formatted).toContain('Sully: [shy]「描いてた」');
        expect(formatted).not.toContain('<翻译>');
        expect(formatted).not.toContain('<译文>');
        expect(formatted).not.toContain('我在画画');
    });

    it('includes Date photo summaries without image payloads', () => {
        const formatted = formatMessagesForSummary([
            {
                id: 2,
                charId: 'char-1',
                role: 'assistant',
                type: 'image',
                content: 'data:image/png;base64,large-photo',
                timestamp: 2_000,
                metadata: {
                    source: 'date_photo',
                    hiddenFromUser: true,
                    isDatePhoto: true,
                    caption: '这张先留着。',
                    visualSummary: '天台夜风里，两个人肩并肩看城市灯光。',
                    photoMeta: {
                        continuity_summary: '天台的夜风让他们短暂安静下来。',
                    },
                },
            },
        ], 'Sully', '小米');

        expect(formatted).toContain('Sully: [见面照片]');
        expect(formatted).toContain('天台夜风');
        expect(formatted).not.toContain('data:image');
    });
});
