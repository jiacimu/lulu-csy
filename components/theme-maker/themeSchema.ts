import {
    BubbleStyle,
    ChatTheme,
    ChatThemePreviewSettings,
    ChatThemeSurfaces,
    ChatThemeTokens,
} from '../../types';

export const CHAT_THEME_SCHEMA_VERSION = 2 as const;

export const DEFAULT_BUBBLE_STYLE: BubbleStyle = {
    textColor: '#334155',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    opacity: 1,
    backgroundImageOpacity: 0.5,
    decorationX: 90,
    decorationY: -10,
    decorationScale: 1,
    decorationRotate: 0,
    hideTail: false,
    avatarDecorationX: 50,
    avatarDecorationY: 50,
    avatarDecorationScale: 1,
    avatarDecorationRotate: 0,
};

export const DEFAULT_USER_BUBBLE_STYLE: BubbleStyle = {
    ...DEFAULT_BUBBLE_STYLE,
    textColor: '#ffffff',
    backgroundColor: '#6366f1',
};

export const DEFAULT_AI_BUBBLE_STYLE: BubbleStyle = {
    ...DEFAULT_BUBBLE_STYLE,
};

export const DEFAULT_CHAT_THEME_TOKENS: ChatThemeTokens = {
    accent: '#6366f1',
    accentText: '#ffffff',
    pageBackground: '#f1f5f9',
    surface: '#ffffff',
    text: '#334155',
    mutedText: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.35)',
    radius: 20,
    shadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    motionScale: 'normal',
};

export const DEFAULT_CHAT_THEME_SURFACES: ChatThemeSurfaces = {
    container: {
        background: '#f1f5f9',
    },
    messageList: {
        paddingX: 20,
        paddingY: 24,
        gap: 12,
        density: 'normal',
    },
    header: {
        shell: {
            background: 'rgba(255, 255, 255, 0.8)',
            borderColor: 'rgba(226, 232, 240, 0.6)',
            borderWidth: 1,
            blur: 16,
            shadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
            height: 96,
            paddingX: 20,
            paddingY: 16,
        },
        avatar: {
            width: 40,
            height: 40,
            radius: 12,
            shadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
        },
        title: {
            color: '#1e293b',
            fontSize: 16,
            fontWeight: 700,
        },
        subtitle: {
            visible: true,
            color: '#94a3b8',
            fontSize: 10,
        },
        buttons: {
            color: '#64748b',
            background: 'transparent',
            radius: 999,
            width: 36,
            height: 36,
        },
    },
    bubbles: {
        user: DEFAULT_USER_BUBBLE_STYLE,
        ai: DEFAULT_AI_BUBBLE_STYLE,
    },
    voice: {
        user: {
            color: '#ffffff',
            background: '#6366f1',
            radius: 20,
            height: 36,
        },
        ai: {
            color: '#334155',
            background: '#ffffff',
            radius: 20,
            height: 36,
        },
    },
    image: {
        radius: 16,
        borderColor: 'rgba(0, 0, 0, 0.05)',
        borderWidth: 1,
        shadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
        maxWidth: 200,
    },
    emoji: {
        maxWidth: 160,
        shadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
    },
    timestamp: {
        visible: false,
        intervalMs: 180000,
        color: '#9ca3af',
        fontSize: 11,
        paddingY: 8,
    },
    systemPill: {
        background: 'rgba(226, 232, 240, 0.4)',
        color: '#64748b',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        radius: 999,
        fontSize: 10,
        paddingX: 12,
        paddingY: 4,
    },
    interactionPill: {
        background: 'rgba(226, 232, 240, 0.5)',
        color: '#64748b',
        borderColor: 'rgba(255, 255, 255, 0.4)',
        borderWidth: 1,
        radius: 999,
        fontSize: 11,
        paddingX: 16,
        paddingY: 6,
    },
    transferCard: {
        background: '#3b82f6',
        radius: 12,
        maxWidth: 220,
        shadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
    },
    card: {
        background: '#ffffff',
        color: '#334155',
        mutedColor: '#94a3b8',
        borderColor: '#f1f5f9',
        borderWidth: 1,
        radius: 16,
        shadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
        maxWidth: 256,
        followBrandColor: true,
    },
    input: {
        shell: {
            background: 'rgba(255, 255, 255, 0.9)',
            borderColor: 'rgba(226, 232, 240, 0.5)',
            borderWidth: 1,
            blur: 24,
            shadow: '0 -5px 15px rgba(0, 0, 0, 0.02)',
            paddingX: 16,
            paddingY: 12,
        },
        textBox: {
            background: '#f1f5f9',
            color: '#334155',
            mutedColor: '#94a3b8',
            radius: 24,
            fontSize: 15,
            paddingX: 16,
            paddingY: 12,
        },
        iconButton: {
            background: '#f1f5f9',
            color: '#64748b',
            radius: 999,
            width: 44,
            height: 44,
        },
        sendButton: {
            background: '#6366f1',
            color: '#ffffff',
            radius: 999,
            width: 44,
            height: 44,
        },
        panels: {
            background: '#f8fafc',
            borderColor: 'rgba(226, 232, 240, 0.6)',
            borderWidth: 1,
            height: 288,
        },
        panelTabs: {
            background: '#ffffff',
            color: '#64748b',
            radius: 999,
            fontSize: 11,
            fontWeight: 700,
            paddingX: 12,
            paddingY: 6,
        },
        panelItem: {
            background: '#ffffff',
            color: '#475569',
            borderColor: '#f1f5f9',
            borderWidth: 1,
            radius: 16,
            shadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
            fontSize: 12,
        },
        suggestionPanel: {
            background: 'rgba(255, 255, 255, 0.85)',
            color: '#64748b',
            borderColor: 'rgba(255, 255, 255, 0.5)',
            borderWidth: 1,
            radius: 16,
            blur: 16,
            shadow: '0 24px 50px rgba(15, 23, 42, 0.16)',
        },
        recordingOverlay: {
            background: 'rgba(0, 0, 0, 0.55)',
            color: '#ffffff',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            radius: 24,
            blur: 14,
            shadow: '0 24px 60px rgba(0, 0, 0, 0.28)',
            fontSize: 14,
            paddingX: 28,
            paddingY: 20,
            maxWidth: 280,
        },
        selectionBar: {
            background: 'rgba(255, 255, 255, 0.5)',
            blur: 12,
            paddingX: 12,
            paddingY: 12,
            gap: 8,
        },
        selectionButton: {
            background: '#6366f1',
            color: '#ffffff',
            radius: 16,
            fontSize: 14,
            fontWeight: 700,
            paddingY: 12,
            shadow: '0 10px 22px rgba(99, 102, 241, 0.22)',
        },
        dangerButton: {
            background: '#ef4444',
            color: '#ffffff',
            radius: 16,
            fontSize: 14,
            fontWeight: 700,
            paddingY: 12,
            shadow: '0 10px 22px rgba(239, 68, 68, 0.22)',
        },
    },
    overlays: {
        backdrop: {
            background: 'rgba(15, 23, 42, 0.35)',
            blur: 8,
        },
        modal: {
            background: '#ffffff',
            radius: 24,
            shadow: '0 24px 60px rgba(15, 23, 42, 0.2)',
        },
        primaryButton: {
            background: '#6366f1',
            color: '#ffffff',
            radius: 16,
        },
        secondaryButton: {
            background: '#f1f5f9',
            color: '#475569',
            radius: 16,
        },
    },
};

export const DEFAULT_CHAT_THEME_PREVIEW_SETTINGS: ChatThemePreviewSettings = {
    activePage: 'overview',
    cardPage: 0,
};

const clonePlain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const normalizeBubbleStyle = (value: unknown, fallback: BubbleStyle): BubbleStyle => {
    if (!isRecord(value)) return { ...fallback };
    const source = value as Partial<BubbleStyle>;
    return {
        ...fallback,
        ...source,
        textColor: typeof source.textColor === 'string' ? source.textColor : fallback.textColor,
        backgroundColor: typeof source.backgroundColor === 'string' ? source.backgroundColor : fallback.backgroundColor,
        borderRadius: typeof source.borderRadius === 'number' ? source.borderRadius : fallback.borderRadius,
        opacity: typeof source.opacity === 'number' ? source.opacity : fallback.opacity,
        backgroundImageOpacity: typeof source.backgroundImageOpacity === 'number' ? source.backgroundImageOpacity : fallback.backgroundImageOpacity,
        hideTail: typeof source.hideTail === 'boolean' ? source.hideTail : fallback.hideTail,
    };
};

const normalizeTokens = (value: unknown): ChatThemeTokens => ({
    ...clonePlain(DEFAULT_CHAT_THEME_TOKENS),
    ...(isRecord(value) ? (value as Partial<ChatThemeTokens>) : {}),
});

const normalizePreviewSettings = (value: unknown): ChatThemePreviewSettings => ({
    ...clonePlain(DEFAULT_CHAT_THEME_PREVIEW_SETTINGS),
    ...(isRecord(value) ? (value as Partial<ChatThemePreviewSettings>) : {}),
});

const mergeSurfaceObject = <T extends object>(fallback: T | undefined, value: unknown): T => ({
    ...((fallback || {}) as T),
    ...(isRecord(value) ? value : {}),
});

const normalizeSurfaces = (value: unknown, user: BubbleStyle, ai: BubbleStyle): ChatThemeSurfaces => {
    const defaults = clonePlain(DEFAULT_CHAT_THEME_SURFACES);
    const source = isRecord(value) ? (value as Partial<ChatThemeSurfaces>) : {};
    const sourceHeader: Record<string, unknown> = isRecord(source.header) ? source.header : {};
    const sourceVoice: Record<string, unknown> = isRecord(source.voice) ? source.voice : {};
    const sourceInput: Record<string, unknown> = isRecord(source.input) ? source.input : {};
    const sourceOverlays: Record<string, unknown> = isRecord(source.overlays) ? source.overlays : {};
    return {
        ...defaults,
        ...source,
        container: mergeSurfaceObject(defaults.container, source.container),
        messageList: mergeSurfaceObject(defaults.messageList, source.messageList),
        header: {
            shell: mergeSurfaceObject(defaults.header?.shell, sourceHeader.shell),
            avatar: mergeSurfaceObject(defaults.header?.avatar, sourceHeader.avatar),
            title: mergeSurfaceObject(defaults.header?.title, sourceHeader.title),
            subtitle: mergeSurfaceObject(defaults.header?.subtitle, sourceHeader.subtitle),
            buttons: mergeSurfaceObject(defaults.header?.buttons, sourceHeader.buttons),
            summarizingBar: mergeSurfaceObject(defaults.header?.summarizingBar, sourceHeader.summarizingBar),
        },
        bubbles: {
            ...(defaults.bubbles || {}),
            ...(isRecord(source.bubbles) ? source.bubbles : {}),
            user,
            ai,
        },
        voice: {
            user: mergeSurfaceObject(defaults.voice?.user, sourceVoice.user),
            ai: mergeSurfaceObject(defaults.voice?.ai, sourceVoice.ai),
        },
        image: mergeSurfaceObject(defaults.image, source.image),
        emoji: mergeSurfaceObject(defaults.emoji, source.emoji),
        timestamp: mergeSurfaceObject(defaults.timestamp, source.timestamp),
        systemPill: mergeSurfaceObject(defaults.systemPill, source.systemPill),
        interactionPill: mergeSurfaceObject(defaults.interactionPill, source.interactionPill),
        transferCard: mergeSurfaceObject(defaults.transferCard, source.transferCard),
        card: mergeSurfaceObject(defaults.card, source.card),
        input: {
            shell: mergeSurfaceObject(defaults.input?.shell, sourceInput.shell),
            textBox: mergeSurfaceObject(defaults.input?.textBox, sourceInput.textBox),
            iconButton: mergeSurfaceObject(defaults.input?.iconButton, sourceInput.iconButton),
            sendButton: mergeSurfaceObject(defaults.input?.sendButton, sourceInput.sendButton),
            panels: mergeSurfaceObject(defaults.input?.panels, sourceInput.panels),
            panelTabs: mergeSurfaceObject(defaults.input?.panelTabs, sourceInput.panelTabs),
            panelItem: mergeSurfaceObject(defaults.input?.panelItem, sourceInput.panelItem),
            suggestionPanel: mergeSurfaceObject(defaults.input?.suggestionPanel, sourceInput.suggestionPanel),
            recordingOverlay: mergeSurfaceObject(defaults.input?.recordingOverlay, sourceInput.recordingOverlay),
            selectionBar: mergeSurfaceObject(defaults.input?.selectionBar, sourceInput.selectionBar),
            selectionButton: mergeSurfaceObject(defaults.input?.selectionButton, sourceInput.selectionButton),
            dangerButton: mergeSurfaceObject(defaults.input?.dangerButton, sourceInput.dangerButton),
        },
        overlays: {
            backdrop: mergeSurfaceObject(defaults.overlays?.backdrop, sourceOverlays.backdrop),
            modal: mergeSurfaceObject(defaults.overlays?.modal, sourceOverlays.modal),
            primaryButton: mergeSurfaceObject(defaults.overlays?.primaryButton, sourceOverlays.primaryButton),
            secondaryButton: mergeSurfaceObject(defaults.overlays?.secondaryButton, sourceOverlays.secondaryButton),
        },
    };
};

export const createThemeMakerDraft = (id = `theme-${Date.now()}`): ChatTheme => {
    const user = { ...DEFAULT_USER_BUBBLE_STYLE };
    const ai = { ...DEFAULT_AI_BUBBLE_STYLE };
    return {
        id,
        name: 'New Theme',
        type: 'custom',
        version: CHAT_THEME_SCHEMA_VERSION,
        user,
        ai,
        customCss: '',
        generatedCss: '',
        tokens: clonePlain(DEFAULT_CHAT_THEME_TOKENS),
        surfaces: normalizeSurfaces(undefined, user, ai),
        previewSettings: clonePlain(DEFAULT_CHAT_THEME_PREVIEW_SETTINGS),
    };
};

export const migrateChatThemeToV2 = (theme: ChatTheme): ChatTheme => {
    const user = normalizeBubbleStyle(theme.user, DEFAULT_USER_BUBBLE_STYLE);
    const ai = normalizeBubbleStyle(theme.ai, DEFAULT_AI_BUBBLE_STYLE);
    return {
        ...theme,
        version: CHAT_THEME_SCHEMA_VERSION,
        user,
        ai,
        customCss: typeof theme.customCss === 'string' ? theme.customCss : '',
        generatedCss: typeof theme.generatedCss === 'string' ? theme.generatedCss : '',
        tokens: normalizeTokens(theme.tokens),
        surfaces: normalizeSurfaces(theme.surfaces, user, ai),
        previewSettings: normalizePreviewSettings(theme.previewSettings),
    };
};

export const parseImportedChatTheme = (rawText: string, currentId: string): ChatTheme => {
    const parsed: unknown = JSON.parse(rawText);
    if (!isRecord(parsed)) throw new Error('invalid');

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const type = parsed.type;
    if (!name || (type !== 'custom' && type !== 'preset')) throw new Error('invalid');

    const rawTheme = parsed as unknown as ChatTheme;
    return migrateChatThemeToV2({
        ...rawTheme,
        id: currentId,
        name,
        type: 'custom',
    });
};
