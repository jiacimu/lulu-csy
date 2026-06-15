import {
    ChatTheme,
    ThemeBox,
    ThemePaint,
    ThemeTypography,
} from '../../types';

type CssDeclaration = string | false | null | undefined;

const important = (value: string) => `${value} !important`;
const px = (value?: number) => (typeof value === 'number' ? `${value}px` : undefined);
const opacityValue = (value?: number) => (typeof value === 'number' ? String(Math.max(0, Math.min(1, value))) : undefined);

const decl = (property: string, value?: string | number, forceImportant = true): CssDeclaration => {
    if (value === undefined || value === null || value === '') return undefined;
    const cssValue = String(value);
    return `  ${property}: ${forceImportant ? important(cssValue) : cssValue};`;
};

const rule = (selector: string, declarations: CssDeclaration[]) => {
    const body = declarations.filter(Boolean).join('\n');
    return body ? `${selector} {\n${body}\n}` : '';
};

const paintBackground = (paint?: ThemePaint) => {
    if (!paint) return undefined;
    if (paint.gradient) {
        return `linear-gradient(${paint.gradient.direction}deg, ${paint.gradient.from}, ${paint.gradient.to})`;
    }
    return paint.background;
};

const paintDeclarations = (paint?: ThemePaint, options: { includeBackground?: boolean; includeColor?: boolean; includeBorder?: boolean; includeRadius?: boolean; includeShadow?: boolean; includeBlur?: boolean; includeOpacity?: boolean } = {}) => {
    if (!paint) return [];
    const {
        includeBackground = true,
        includeColor = true,
        includeBorder = true,
        includeRadius = true,
        includeShadow = true,
        includeBlur = true,
        includeOpacity = true,
    } = options;

    const border = typeof paint.borderWidth === 'number'
        ? `${paint.borderWidth}px solid ${paint.borderColor || 'transparent'}`
        : undefined;

    return [
        includeBackground && decl('background', paintBackground(paint)),
        includeColor && decl('color', paint.color),
        includeBorder && decl('border', border),
        includeRadius && decl('border-radius', px(paint.radius)),
        includeShadow && decl('box-shadow', paint.shadow),
        includeBlur && typeof paint.blur === 'number' && decl('backdrop-filter', `blur(${paint.blur}px)`),
        includeBlur && typeof paint.blur === 'number' && decl('-webkit-backdrop-filter', `blur(${paint.blur}px)`),
        includeOpacity && decl('opacity', opacityValue(paint.opacity)),
    ];
};

const boxDeclarations = (box?: ThemeBox, options: { includePadding?: boolean; includeSize?: boolean; includeGap?: boolean; includeMaxWidth?: boolean } = {}) => {
    if (!box) return [];
    const {
        includePadding = true,
        includeSize = true,
        includeGap = true,
        includeMaxWidth = true,
    } = options;

    return [
        includePadding && decl('padding-left', px(box.paddingX)),
        includePadding && decl('padding-right', px(box.paddingX)),
        includePadding && decl('padding-top', px(box.paddingY)),
        includePadding && decl('padding-bottom', px(box.paddingY)),
        includeGap && decl('gap', px(box.gap)),
        includeSize && decl('width', px(box.width)),
        includeSize && decl('height', px(box.height)),
        includeSize && decl('min-height', px(box.height)),
        includeMaxWidth && decl('max-width', px(box.maxWidth)),
    ];
};

const typographyDeclarations = (typography?: ThemeTypography & ThemePaint) => {
    if (!typography) return [];
    return [
        decl('color', typography.color),
        decl('font-size', px(typography.fontSize)),
        decl('font-weight', typography.fontWeight),
        decl('line-height', typography.lineHeight),
        decl('letter-spacing', px(typography.letterSpacing)),
        decl('text-shadow', typography.textShadow),
    ];
};

const tokenDeclarations = (theme: ChatTheme) => [
    decl('--sully-theme-accent', theme.tokens?.accent, false),
    decl('--sully-theme-accent-text', theme.tokens?.accentText, false),
    decl('--sully-theme-page-bg', theme.tokens?.pageBackground, false),
    decl('--sully-theme-surface', theme.tokens?.surface, false),
    decl('--sully-theme-text', theme.tokens?.text, false),
    decl('--sully-theme-muted-text', theme.tokens?.mutedText, false),
    decl('--sully-theme-border', theme.tokens?.border, false),
    decl('--sully-theme-radius', px(theme.tokens?.radius), false),
    decl('--sully-theme-shadow', theme.tokens?.shadow, false),
];

const densityToGap = (density?: 'compact' | 'normal' | 'spacious', fallback?: number) => {
    if (typeof fallback === 'number') return fallback;
    if (density === 'compact') return 8;
    if (density === 'spacious') return 18;
    return 12;
};

export const buildThemeSurfacesCss = (theme: ChatTheme): string => {
    const surfaces = theme.surfaces;
    if (!surfaces) return '';

    const messageGap = densityToGap(surfaces.messageList?.density, surfaces.messageList?.gap);
    const cardFollowsBrand = surfaces.card?.followBrandColor !== false;
    const cardForcesTheme = !cardFollowsBrand;
    const blocks = [
        '/* Generated by Bubble Workshop visual controls. Advanced CSS is injected after this block. */',
        rule('.sully-chat-container', [
            ...tokenDeclarations(theme),
            ...paintDeclarations(surfaces.container, { includeColor: false, includeBorder: false }),
        ]),
        theme.tokens?.motionScale === 'off' && rule('.sully-chat-container *, .sully-chat-container *::before, .sully-chat-container *::after', [
            decl('animation-duration', '0ms'),
            decl('transition-duration', '0ms'),
        ]),
        rule('.sully-chat-messages', [
            ...boxDeclarations(surfaces.messageList, { includeSize: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-messages > [data-chat-message-id]', [
            decl('margin-top', px(messageGap)),
        ]),
        rule('.sully-chat-messages > [data-chat-message-id]:first-of-type', [
            decl('margin-top', '0'),
        ]),
        rule('.sully-chat-preview-list > *', [
            decl('margin-top', px(messageGap)),
        ]),
        rule('.sully-chat-preview-list > *:first-child', [
            decl('margin-top', '0'),
        ]),
        rule('.sully-chat-header', [
            ...paintDeclarations(surfaces.header?.shell),
            ...boxDeclarations(surfaces.header?.shell, { includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-header-avatar', [
            ...paintDeclarations(surfaces.header?.avatar, { includeBackground: false, includeColor: false, includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.header?.avatar, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-header-title', [
            ...typographyDeclarations(surfaces.header?.title),
        ]),
        rule('.sully-chat-header-subtitle', [
            ...typographyDeclarations(surfaces.header?.subtitle),
            surfaces.header?.subtitle?.visible === false && decl('display', 'none'),
        ]),
        rule('.sully-chat-header-button', [
            decl('display', 'inline-flex'),
            decl('align-items', 'center'),
            decl('justify-content', 'center'),
            ...paintDeclarations(surfaces.header?.buttons, { includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.header?.buttons, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-header-summary', [
            ...paintDeclarations(surfaces.header?.summarizingBar),
            ...typographyDeclarations(surfaces.header?.summarizingBar),
        ]),
        rule('.sully-chat-input', [
            ...paintDeclarations(surfaces.input?.shell),
        ]),
        rule('.sully-chat-input-main', [
            ...boxDeclarations(surfaces.input?.shell, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            decl('gap', px(surfaces.input?.shell?.gap)),
        ]),
        rule('.sully-chat-input-textbox', [
            ...paintDeclarations(surfaces.input?.textBox, { includeShadow: false, includeBlur: false, includeOpacity: false }),
            decl('padding-left', px(surfaces.input?.textBox?.paddingX)),
            decl('padding-right', px(surfaces.input?.textBox?.paddingX)),
        ]),
        rule('.sully-chat-input-textarea, .sully-chat-input-placeholder', [
            ...typographyDeclarations(surfaces.input?.textBox),
            decl('padding-top', px(surfaces.input?.textBox?.paddingY)),
            decl('padding-bottom', px(surfaces.input?.textBox?.paddingY)),
        ]),
        rule('.sully-chat-input-textarea::placeholder', [
            decl('color', surfaces.input?.textBox?.mutedColor),
        ]),
        rule('.sully-chat-input-placeholder', [
            decl('color', surfaces.input?.textBox?.mutedColor),
        ]),
        rule('.sully-chat-input-icon-button', [
            decl('display', 'inline-flex'),
            decl('align-items', 'center'),
            decl('justify-content', 'center'),
            ...paintDeclarations(surfaces.input?.iconButton, { includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.iconButton, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-input-emoji-button', [
            decl('background', paintBackground(surfaces.input?.iconButton)),
            decl('color', surfaces.input?.iconButton?.color),
            decl('border-radius', px(surfaces.input?.iconButton?.radius)),
        ]),
        rule('.sully-chat-input-icon-button svg [stroke], .sully-chat-input-emoji-button svg [stroke], .sully-chat-input-send-button svg [stroke]', [
            decl('stroke', 'currentColor'),
        ]),
        rule('.sully-chat-input-icon-button svg [fill]:not([fill="none"]), .sully-chat-input-emoji-button svg [fill]:not([fill="none"]), .sully-chat-input-send-button svg [fill]:not([fill="none"])', [
            decl('fill', 'currentColor'),
        ]),
        rule('.sully-chat-input-send-button', [
            decl('display', 'inline-flex'),
            decl('align-items', 'center'),
            decl('justify-content', 'center'),
            ...paintDeclarations(surfaces.input?.sendButton, { includeBorder: false, includeShadow: true, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.sendButton, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-input-panel', [
            ...paintDeclarations(surfaces.input?.panels, { includeColor: false, includeRadius: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.panels, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-input-suggestion-panel', [
            ...paintDeclarations(surfaces.input?.suggestionPanel),
            ...boxDeclarations(surfaces.input?.suggestionPanel, { includeSize: false, includeGap: false }),
            ...typographyDeclarations(surfaces.input?.suggestionPanel),
        ]),
        rule('.sully-chat-input-panel-tab', [
            ...paintDeclarations(surfaces.input?.panelTabs, { includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.panelTabs, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.input?.panelTabs),
        ]),
        rule('.sully-chat-input-panel-item', [
            ...paintDeclarations(surfaces.input?.panelItem, { includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.panelItem, { includePadding: false, includeGap: false }),
            ...typographyDeclarations(surfaces.input?.panelItem),
        ]),
        rule('.sully-chat-input-panel-action', [
            decl('color', surfaces.input?.panelItem?.color),
            decl('font-size', px(surfaces.input?.panelItem?.fontSize)),
            decl('font-weight', surfaces.input?.panelItem?.fontWeight),
        ]),
        rule('.sully-recording-overlay', [
            decl('background', paintBackground(surfaces.input?.recordingOverlay)),
            decl('color', surfaces.input?.recordingOverlay?.color),
            typeof surfaces.input?.recordingOverlay?.blur === 'number' && decl('backdrop-filter', `blur(${surfaces.input.recordingOverlay.blur}px)`),
            typeof surfaces.input?.recordingOverlay?.blur === 'number' && decl('-webkit-backdrop-filter', `blur(${surfaces.input.recordingOverlay.blur}px)`),
        ]),
        rule('.sully-recording-bubble', [
            ...paintDeclarations(surfaces.input?.recordingOverlay, { includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.recordingOverlay, { includeGap: false }),
            ...typographyDeclarations(surfaces.input?.recordingOverlay),
        ]),
        rule('.sully-recording-cancel-label, .sully-recording-convert-label, .sully-recording-send-label, .sully-recording-duration', [
            ...typographyDeclarations(surfaces.input?.recordingOverlay),
        ]),
        rule('.sully-chat-selection-bar', [
            ...paintDeclarations(surfaces.input?.selectionBar, { includeColor: false, includeBorder: false, includeRadius: false, includeShadow: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.selectionBar, { includeSize: false, includeMaxWidth: false }),
        ]),
        rule('.sully-chat-selection-button', [
            ...paintDeclarations(surfaces.input?.selectionButton, { includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.selectionButton, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.input?.selectionButton),
        ]),
        rule('.sully-chat-selection-danger', [
            ...paintDeclarations(surfaces.input?.dangerButton, { includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.dangerButton, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.input?.dangerButton),
        ]),
        rule('.sully-message-selection-checkbox', [
            ...paintDeclarations(surfaces.input?.selectionButton, { includeShadow: true, includeBlur: false, includeOpacity: false }),
        ]),
        rule('.sully-message-selection-checkbox.is-selected', [
            decl('background', theme.tokens?.accent),
            decl('border-color', theme.tokens?.accent),
        ]),
        rule('.sully-message-avatar-image', [
            ...paintDeclarations(surfaces.header?.avatar, { includeBackground: false, includeColor: false, includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.header?.avatar, { includePadding: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-message-avatar-badge', [
            decl('display', 'inline-flex'),
            decl('align-items', 'center'),
            decl('justify-content', 'center'),
            ...paintDeclarations(surfaces.input?.sendButton, { includeBorder: false, includeShadow: true, includeBlur: false, includeOpacity: false }),
        ]),
        rule('.sully-message-avatar-loading', [
            decl('border-top-color', surfaces.input?.sendButton?.background || theme.tokens?.accent),
        ]),
        rule('.sully-message-action-modal', [
            decl('gap', px(surfaces.input?.selectionBar?.gap)),
        ]),
        rule('.sully-message-action-button', [
            ...paintDeclarations(surfaces.input?.selectionButton, { includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.selectionButton, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.input?.selectionButton),
        ]),
        rule('.sully-message-action-danger', [
            ...paintDeclarations(surfaces.input?.dangerButton, { includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.input?.dangerButton, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.input?.dangerButton),
        ]),
        rule('.sully-msg-timestamp', [
            surfaces.timestamp?.visible === false && decl('display', 'none'),
            ...boxDeclarations(surfaces.timestamp, { includeSize: false, includeGap: false, includeMaxWidth: false }),
        ]),
        rule('.sully-msg-timestamp span, .sully-msg-timestamp', [
            ...typographyDeclarations(surfaces.timestamp),
            ...paintDeclarations(surfaces.timestamp, { includeColor: false, includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
        ]),
        rule('.sully-system-pill', [
            ...paintDeclarations(surfaces.systemPill),
            ...boxDeclarations(surfaces.systemPill, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.systemPill),
        ]),
        rule('.sully-interaction-pill', [
            ...paintDeclarations(surfaces.interactionPill),
            ...boxDeclarations(surfaces.interactionPill, { includeSize: false, includeGap: false, includeMaxWidth: false }),
            ...typographyDeclarations(surfaces.interactionPill),
        ]),
        rule('.sully-card-container', [
            decl('--card-bg', paintBackground(surfaces.card), false),
            decl('--card-text-primary', surfaces.card?.color, false),
            decl('--card-text-secondary', surfaces.card?.mutedColor || surfaces.card?.color, false),
            decl('--card-border', surfaces.card?.borderColor, false),
            ...paintDeclarations(surfaces.card, { includeBackground: !cardFollowsBrand, includeColor: !cardFollowsBrand }),
            ...boxDeclarations(surfaces.card, { includeSize: false, includeGap: false }),
            ...(cardFollowsBrand ? [decl('font-size', px(surfaces.card?.fontSize))] : typographyDeclarations(surfaces.card)),
        ]),
        rule('.sully-card-container:not(.sully-transfer-card) :where(h1, h2, h3, h4, p, span, small, strong, b, em, button)', [
            cardForcesTheme && decl('color', 'var(--card-text-primary)'),
        ]),
        rule('.sully-card-container:not(.sully-transfer-card) :where([class*="text-slate-3"], [class*="text-slate-4"], [class*="text-slate-5"], [class*="text-gray-3"], [class*="text-gray-4"], [class*="text-gray-5"], [class*="text-stone-3"], [class*="text-stone-4"], [class*="text-stone-5"], [class*="text-neutral-3"], [class*="text-neutral-4"], [class*="text-neutral-5"])', [
            cardForcesTheme && decl('color', 'var(--card-text-secondary)'),
        ]),
        rule('.sully-card-container:not(.sully-transfer-card) :where([class*="border-slate-"], [class*="border-gray-"], [class*="border-stone-"], [class*="border-neutral-"], [class*="border-white"])', [
            cardForcesTheme && decl('border-color', 'var(--card-border)'),
        ]),
        rule('.sully-newspaper-card', [
            cardForcesTheme && decl('--yn-paper', surfaces.card?.background, false),
            cardForcesTheme && decl('--yn-paper-2', surfaces.card?.background, false),
            cardForcesTheme && decl('--yn-ink', surfaces.card?.color, false),
            cardForcesTheme && decl('--yn-muted', surfaces.card?.mutedColor || surfaces.card?.color, false),
            cardForcesTheme && decl('--yn-line', surfaces.card?.borderColor, false),
            cardForcesTheme && decl('--yn-line-strong', surfaces.card?.borderColor, false),
            cardForcesTheme && decl('--yn-accent', theme.tokens?.accent || surfaces.card?.color, false),
            cardForcesTheme && decl('--yn-accent-2', surfaces.card?.mutedColor || theme.tokens?.accent, false),
        ]),
        rule('.sully-newspaper-delivery', [
            ...paintDeclarations(surfaces.card, { includeBackground: !cardFollowsBrand, includeColor: !cardFollowsBrand, includeBlur: false, includeOpacity: false }),
            ...typographyDeclarations(surfaces.card),
        ]),
        rule('.sully-newspaper-delivery-action', [
            ...paintDeclarations(surfaces.overlays?.primaryButton, { includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...typographyDeclarations(surfaces.overlays?.primaryButton),
        ]),
        rule('.sully-news-card-title', [
            cardForcesTheme && decl('color', 'var(--card-text-primary)'),
        ]),
        rule('.sully-news-card-desc, .sully-news-card-footer', [
            cardForcesTheme && decl('color', 'var(--card-text-secondary)'),
        ]),
        rule('.sully-news-card-action', [
            cardForcesTheme && decl('color', theme.tokens?.accent || 'var(--card-text-primary)'),
        ]),
        rule('.sully-transfer-card', [
            ...paintDeclarations(surfaces.transferCard),
            ...boxDeclarations(surfaces.transferCard, { includeSize: false, includeGap: false }),
        ]),
        rule('.sully-image-msg, .sully-image-msg-shell', [
            ...paintDeclarations(surfaces.image, { includeBackground: false, includeColor: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.image, { includePadding: false, includeGap: false }),
        ]),
        rule('.sully-emoji-msg', [
            ...paintDeclarations(surfaces.emoji, { includeBackground: false, includeColor: false, includeBorder: false, includeBlur: false, includeOpacity: false }),
            ...boxDeclarations(surfaces.emoji, { includePadding: false, includeGap: false }),
        ]),
        rule('.sully-voice-bubble', [
            ...paintDeclarations(surfaces.voice?.ai),
            ...boxDeclarations(surfaces.voice?.ai, { includePadding: false, includeGap: false }),
            ...typographyDeclarations(surfaces.voice?.ai),
        ]),
        rule('.sully-voice-bubble.sully-bubble-user', [
            ...paintDeclarations(surfaces.voice?.user),
            ...boxDeclarations(surfaces.voice?.user, { includePadding: false, includeGap: false }),
            ...typographyDeclarations(surfaces.voice?.user),
        ]),
        rule('.sully-theme-overlay-backdrop, .sully-image-preview-backdrop', [
            ...paintDeclarations(surfaces.overlays?.backdrop, { includeColor: false, includeBorder: false, includeRadius: false, includeShadow: false, includeOpacity: false }),
        ]),
        rule('.sully-theme-overlay-modal', [
            ...paintDeclarations(surfaces.overlays?.modal),
            ...boxDeclarations(surfaces.overlays?.modal, { includeGap: false }),
        ]),
        rule('.sully-theme-overlay-primary-button', [
            ...paintDeclarations(surfaces.overlays?.primaryButton, { includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...typographyDeclarations(surfaces.overlays?.primaryButton),
        ]),
        rule('.sully-theme-overlay-secondary-button', [
            ...paintDeclarations(surfaces.overlays?.secondaryButton, { includeBorder: false, includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...typographyDeclarations(surfaces.overlays?.secondaryButton),
        ]),
        rule('.sully-image-preview-action', [
            ...paintDeclarations(surfaces.overlays?.secondaryButton, { includeShadow: false, includeBlur: false, includeOpacity: false }),
            ...typographyDeclarations(surfaces.overlays?.secondaryButton),
        ]),
        rule('.sully-inner-voice-backdrop, .sully-afterglow-composer-backdrop', [
            ...paintDeclarations(surfaces.overlays?.backdrop, { includeColor: false, includeBorder: false, includeRadius: false, includeShadow: false, includeOpacity: false }),
        ]),
        rule('.sully-inner-voice-card, .sully-afterglow-composer-dialog', [
            ...paintDeclarations(surfaces.overlays?.modal),
            ...boxDeclarations(surfaces.overlays?.modal, { includeGap: false }),
        ]),
        rule('.sully-inner-voice-title, .sully-inner-voice-text, .sully-inner-voice-toggle', [
            ...typographyDeclarations(surfaces.card),
        ]),
    ];

    return blocks.filter(Boolean).join('\n\n');
};
