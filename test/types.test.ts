import { describe,it,expect } from 'vitest';

// Test the types barrel export — ensures all type modules resolve correctly
describe('Types barrel export', () => {
    it('should export AppID enum', { timeout: 10000 }, async () => {
        const types = await import('../types');
        expect(types.AppID).toBeDefined();
        expect(types.AppID.Chat).toBe('chat');
        expect(types.AppID.Launcher).toBe('launcher');
    });

    it('should export all key interfaces as importable symbols', { timeout: 10000 }, async () => {
        // Dynamic import to verify module resolution
        const types = await import('../types');
        // These are type-only exports, but the module should resolve without error
        expect(types).toBeDefined();
    });
});

// Test pure utility: chatParser
describe('ChatParser', () => {
    it('should be importable', async () => {
        const { ChatParser } = await import('../utils/chatParser');
        expect(ChatParser).toBeDefined();
    });

    it('cleanAiSecondPass normalises all sticker tag variants', async () => {
        const { ChatParser } = await import('../utils/chatParser');
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
});
