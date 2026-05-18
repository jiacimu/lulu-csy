import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/db', () => ({
    DB: {
        getRecentMessagesByCharId: vi.fn(),
        saveAnniversary: vi.fn(),
        saveMessage: vi.fn(),
        saveScheduledMessage: vi.fn(),
        updateMessageMetadata: vi.fn(),
    },
}));

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        checkPermissions: vi.fn(),
        schedule: vi.fn(),
    },
}));

let typesModule: typeof import('../types');
let chatParserModule: typeof import('../utils/chatParser');

// Test the types barrel export — ensures all type modules resolve correctly
describe('Types barrel export', () => {
    beforeAll(async () => {
        typesModule = await import('../types');
    }, 20000);

    it('should export AppID enum', () => {
        expect(typesModule.AppID).toBeDefined();
        expect(typesModule.AppID.Chat).toBe('chat');
        expect(typesModule.AppID.Launcher).toBe('launcher');
    });

    it('should export all key interfaces as importable symbols', () => {
        // These are type-only exports, but the module should resolve without error
        expect(typesModule).toBeDefined();
    });
});

// Test pure utility: chatParser
describe('ChatParser', () => {
    beforeAll(async () => {
        chatParserModule = await import('../utils/chatParser');
    }, 20000);

    it('should be importable', () => {
        expect(chatParserModule.ChatParser).toBeDefined();
    });

    it('cleanAiSecondPass normalises all sticker tag variants', () => {
        const { ChatParser } = chatParserModule;
        // Standard (no change needed)
        expect(ChatParser.cleanAiSecondPass('[[SEND_EMOJI: 揉脸]]')).toContain('[[SEND_EMOJI: 揉脸]]');
        // With subject (original behavior)
        expect(ChatParser.cleanAiSecondPass('[你 发送了表情包: 揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        expect(ChatParser.cleanAiSecondPass('[用户 发送了表情包: 抱抱卡]')).toContain('[[SEND_EMOJI: 抱抱卡]]');
        // Without subject (NEW — was broken)
        expect(ChatParser.cleanAiSecondPass('[发送表情包: 揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        // Full-width colon
        expect(ChatParser.cleanAiSecondPass('[发送表情包：揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        // Chinese brackets
        expect(ChatParser.cleanAiSecondPass('【发送表情包: 揉脸】')).toContain('[[SEND_EMOJI: 揉脸]]');
        // Without 包
        expect(ChatParser.cleanAiSecondPass('[发送表情: 揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        // Subject 我
        expect(ChatParser.cleanAiSecondPass('[我发送了表情包: 揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        // Degraded weak-model logs with directional/traditional wording
        expect(ChatParser.cleanAiSecondPass('[{{char}}向你發送表情包：揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        expect(ChatParser.cleanAiSecondPass('[糯米向你发送表情包：揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
        expect(ChatParser.cleanAiSecondPass('[夏以昼发送了表情包: 酷_墨镜耍帅]')).toContain('[[SEND_EMOJI: 酷_墨镜耍帅]]');
        expect(ChatParser.cleanAiSecondPass('[发送貼圖：揉脸]')).toContain('[[SEND_EMOJI: 揉脸]]');
    });

    it('normalises degraded transfer action variants', async () => {
        const { ChatParser } = chatParserModule;
        const dbModule = await import('../utils/db');
        const saveMessage = dbModule.DB.saveMessage as any;

        expect(ChatParser.cleanAiSecondPass('[{{char}}向你轉帳：¥52.00]')).toContain('[[ACTION:TRANSFER:52.00]]');
        expect(ChatParser.cleanAiSecondPass('[糯米给你转账: 52]')).toContain('[[ACTION:TRANSFER:52]]');
        expect(ChatParser.cleanAiSecondPass('[{{char}}收取了你的轉帳]')).toContain('[[ACTION:RECEIVE_TRANSFER]]');
        expect(ChatParser.cleanAiSecondPass('[{{char}}退還了你的轉帳]')).toContain('[[ACTION:RETURN_TRANSFER]]');

        saveMessage.mockClear();
        await ChatParser.parseAndExecuteActions('[{{char}}向你轉帳：¥52.00]', 'char-1', '糯米', vi.fn());
        expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'char-1',
            role: 'assistant',
            type: 'transfer',
            metadata: { amount: '52.00', status: 'pending' },
        }));
    });

    it('normalises song share tags and removes bracket-only wrappers', () => {
        const { ChatParser } = chatParserModule;

        expect(ChatParser.cleanAiSecondPass('[SHARE_SONG：晴天｜周杰伦｜0]')).toBe('[[SHARE_SONG: 晴天｜周杰伦｜0]]');
        expect(ChatParser.cleanAiSecondPass('[\n[[SHARE_SONG: 晴天 | 周杰伦 | 0]]\n]')).toBe('[[SHARE_SONG: 晴天 | 周杰伦 | 0]]');

        const parts = ChatParser.splitResponse('[\n[SHARE_SONG：歌名：晴天｜歌手：周杰伦｜歌曲ID：0]\n]') as any[];
        expect(parts).toHaveLength(1);
        expect(parts[0]).toMatchObject({
            type: 'song',
            content: {
                songName: '晴天',
                artist: '周杰伦',
                songId: 0,
            },
        });
    });

    it('normalises JSON-wrapped replies and escaped newlines before saving', () => {
        const { ChatParser } = chatParserModule;

        expect(ChatParser.sanitize('"早安\\n想你了"')).toBe('早安\n想你了');
        expect(ChatParser.sanitize('{"content":"[2026-02-11 13:52] Sully: 早\\n安"}')).toBe('早\n安');
        expect(ChatParser.sanitize('```json\n{"message":{"content":"[13:52] Sully: 看到啦\\n马上来"}}\n```')).toBe('看到啦\n马上来');
        expect(ChatParser.sanitize('2026/02/11 13:52 Sully：第一句\\n[下午1:53] Sully: 第二句')).toBe('第一句\n第二句');
        expect(ChatParser.sanitize('12:30 我会到')).toBe('12:30 我会到');
    });

    it('strips leaked assistant voice history labels without breaking real voice tags', () => {
        const { ChatParser } = chatParserModule;

        expect(ChatParser.sanitize('[你上一条语音] 还有，人都躺在我怀里了。')).toBe('还有，人都躺在我怀里了。');
        expect(ChatParser.sanitize('【你上一条语音】凑过来点，bb。')).toBe('凑过来点，bb。');
        expect(ChatParser.cleanAiSecondPass('[你上一条语音（6秒）] 晚安。')).toBe('晚安。');
        expect(ChatParser.sanitize('【语音消息：晚安。】')).toBe('【语音消息：晚安。】');
    });

    it('keeps chat control markers while normalising escaped formatting', () => {
        const { ChatParser } = chatParserModule;

        expect(ChatParser.sanitize('原文\\n%%BILINGUAL%%\\nTranslation')).toBe('原文\n%%BILINGUAL%%\nTranslation');
        expect(ChatParser.cleanAiSecondPass('[[SEND_EMOJI: 揉脸]]\\n[[SHARE_SONG: 晴天 | 周杰伦 | 0]]')).toBe('[[SEND_EMOJI: 揉脸]]\n[[SHARE_SONG: 晴天 | 周杰伦 | 0]]');
    });
});
