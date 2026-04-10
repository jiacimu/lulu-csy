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
});
