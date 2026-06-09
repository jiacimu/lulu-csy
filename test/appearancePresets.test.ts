import { describe,expect,it } from 'vitest';
import JSZip from 'jszip';
import {
    APPEARANCE_PRESET_FILE_TYPE,
    createAppearancePreset,
    exportAppearancePresetBlob,
    importAppearancePresetFromFile,
    replaceAppearancePresetAssets,
    sanitizeAppearanceTheme,
    stripAppearanceThemeForLocalStorage,
} from '../utils/appearancePresets';
import type { AppearancePreset,ChatTheme,OSTheme } from '../types';

const imageData = 'data:image/png;base64,aW1n';
const fontData = 'data:font/woff2;base64,Zm9udA==';
const chatTheme: ChatTheme = {
    id: 'chat-theme-moon',
    name: '月色气泡',
    type: 'custom',
    user: {
        textColor: '#ffffff',
        backgroundColor: '#111827',
        borderRadius: 18,
        opacity: 1,
    },
    ai: {
        textColor: '#111827',
        backgroundColor: '#f8fafc',
        borderRadius: 18,
        opacity: 1,
    },
};

const makeTheme = (overrides: Partial<OSTheme> = {}): OSTheme => ({
    hue: 245,
    saturation: 25,
    lightness: 65,
    wallpaper: 'linear-gradient(135deg, #fff, #eee)',
    darkMode: false,
    contentColor: '#ffffff',
    fontScale: 1,
    systemTextColor: '#334155',
    ...overrides,
});

const makePreset = (overrides: Partial<AppearancePreset> = {}): AppearancePreset => ({
    id: 'preset-a',
    name: '夜色',
    createdAt: 123,
    theme: makeTheme(),
    customIcons: { Browser: imageData },
    ...overrides,
});

describe('appearance preset utilities', () => {
    it('exports a zip with preset.json payload', async () => {
        const blob = await exportAppearancePresetBlob(makePreset({ chatThemes: [chatTheme] }));
        const zip = await JSZip.loadAsync(blob);
        const payload = JSON.parse(await zip.file('preset.json')!.async('string'));

        expect(payload.type).toBe(APPEARANCE_PRESET_FILE_TYPE);
        expect(payload.version).toBe(1);
        expect(payload.name).toBe('夜色');
        expect(payload.customIcons.Browser).toBe(imageData);
        expect(payload.chatThemes).toEqual([chatTheme]);
    });

    it('creates presets with custom chat themes', () => {
        const preset = createAppearancePreset('聊天主题预设', makeTheme(), {}, [chatTheme]);

        expect(preset.chatThemes).toEqual([chatTheme]);
        expect(preset.customIcons).toBeUndefined();
    });

    it('imports zip and legacy json files with fresh local IDs', async () => {
        const zip = new JSZip();
        const chatLayout = { id: 'layout-a', name: '旧版布局', bubbleThemeId: chatTheme.id };
        zip.file('preset.json', JSON.stringify({
            type: APPEARANCE_PRESET_FILE_TYPE,
            id: 'remote-id',
            name: '远端预设',
            createdAt: 1,
            theme: makeTheme({ launcherWidgetImage: imageData, launcherWidgets: { tl: imageData, dsq: imageData, bl: imageData } as any }),
            customIcons: { Settings: imageData },
            chatThemes: [chatTheme, { id: 'broken', name: '坏主题' }],
            chatLayout,
        }));
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const fromZip = await importAppearancePresetFromFile(new File([zipBlob], 'preset.zip', { type: 'application/zip' }));
        const fromJson = await importAppearancePresetFromFile(new File([JSON.stringify({
            type: APPEARANCE_PRESET_FILE_TYPE,
            name: '旧版 JSON',
            theme: makeTheme(),
        })], 'preset.json', { type: 'application/json' }));

        expect(fromZip.id).not.toBe('remote-id');
        expect(fromZip.name).toBe('远端预设');
        expect(fromZip.theme.launcherWidgetImage).toBeUndefined();
        expect(fromZip.theme.launcherWidgets).toEqual({ tl: imageData, dsq: imageData });
        expect(fromZip.customIcons).toEqual({ Settings: imageData });
        expect(fromZip.chatThemes).toEqual([chatTheme]);
        expect(fromZip.chatLayout).toEqual(chatLayout);
        expect(fromJson.name).toBe('旧版 JSON');
    });

    it('rejects invalid, incomplete, and damaged files', async () => {
        await expect(importAppearancePresetFromFile(new File([JSON.stringify({ type: 'other', theme: makeTheme() })], 'bad.json'))).rejects.toThrow('无效的外观预设文件');
        await expect(importAppearancePresetFromFile(new File([JSON.stringify({ type: APPEARANCE_PRESET_FILE_TYPE })], 'missing.json'))).rejects.toThrow('外观预设缺少 theme');
        await expect(importAppearancePresetFromFile(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], 'broken.zip'))).rejects.toThrow();
    });

    it('strips legacy widgets and data URIs for localStorage', () => {
        const theme = sanitizeAppearanceTheme(makeTheme({
            wallpaper: imageData,
            customFont: fontData,
            fontScale: 2,
            systemTextColor: '#111827',
            launcherWidgetImage: imageData,
            launcherWidgets: { tl: imageData, tr: 'https://example.test/widget.png', bl: imageData } as any,
            desktopDecorations: [
                { id: 'deco-a', type: 'image', content: imageData, x: 1, y: 2, scale: 1, rotation: 0, opacity: 1, zIndex: 1 },
                { id: 'legacy-empty', type: 'image', content: '', x: 1, y: 2, scale: 1, rotation: 0, opacity: 1, zIndex: 1 },
            ],
        }));
        const localTheme = stripAppearanceThemeForLocalStorage(theme);

        expect(theme.launcherWidgetImage).toBeUndefined();
        expect(theme.fontScale).toBe(1.2);
        expect(theme.systemTextColor).toBe('#111827');
        expect(theme.launcherWidgets).toEqual({ tl: imageData, tr: 'https://example.test/widget.png' });
        expect(theme.desktopDecorations).toHaveLength(1);
        expect(localTheme.wallpaper).toBe('');
        expect(localTheme.launcherWidgets).toEqual({ tl: '', tr: 'https://example.test/widget.png' });
        expect(localTheme.desktopDecorations?.[0].content).toBe('');
        expect(localTheme.customFont).toBe('');
        expect(localTheme.fontScale).toBe(1.2);
        expect(localTheme.systemTextColor).toBe('#111827');
    });

    it('drops invalid global typography fields without breaking legacy themes', () => {
        const theme = sanitizeAppearanceTheme(makeTheme({
            fontScale: Number.NaN,
            systemTextColor: 'slate',
        }));

        expect(theme.fontScale).toBeUndefined();
        expect(theme.systemTextColor).toBeUndefined();
    });

    it('replaces old appearance assets before saving preset assets', async () => {
        const assets = new Map<string, string>([
            ['icon_Browser', 'old-icon'],
            ['widget_tl', 'old-widget'],
            ['deco_old', 'old-deco'],
            ['wallpaper', 'old-wallpaper'],
            ['custom_font_data', 'old-font'],
            ['appearance_preset_keep', 'stored-preset'],
            ['unrelated', 'keep'],
        ]);
        const store = {
            getAllAssets: async () => [...assets.entries()].map(([id, data]) => ({ id, data })),
            saveAsset: async (id: string, data: string) => { assets.set(id, data); },
            deleteAsset: async (id: string) => { assets.delete(id); },
        };

        await replaceAppearancePresetAssets(store, makePreset({
            theme: makeTheme({
                wallpaper: imageData,
                customFont: fontData,
                launcherWidgets: { tl: imageData, dsq: imageData },
                desktopDecorations: [
                    { id: 'deco-a', type: 'image', content: imageData, x: 1, y: 2, scale: 1, rotation: 0, opacity: 1, zIndex: 1 },
                    { id: 'deco-b', type: 'preset', content: 'data:image/svg+xml,star', x: 3, y: 4, scale: 1, rotation: 0, opacity: 1, zIndex: 2 },
                ],
            }),
            customIcons: undefined,
        }));

        expect(assets.get('icon_Browser')).toBeUndefined();
        expect(assets.get('widget_tl')).toBe(imageData);
        expect(assets.get('widget_dsq')).toBe(imageData);
        expect(assets.get('deco_a')).toBeUndefined();
        expect(assets.get('deco_deco-a')).toBe(imageData);
        expect(assets.get('deco_deco-b')).toBeUndefined();
        expect(assets.get('wallpaper')).toBe(imageData);
        expect(assets.get('custom_font_data')).toBe(fontData);
        expect(assets.get('appearance_preset_keep')).toBe('stored-preset');
        expect(assets.get('unrelated')).toBe('keep');
    });
});
