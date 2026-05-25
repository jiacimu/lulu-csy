import React from 'react';
import './PhoneSplashPoem.css';

type GlyphTone =
  | 'plain'
  | 'rose'
  | 'motion'
  | 'cloud'
  | 'sea'
  | 'forget'
  | 'loss'
  | 'every'
  | 'self'
  | 'punctuation';

interface ToneRange {
  start: number;
  end: number;
  tone: GlyphTone;
}

interface PoemLineConfig {
  id: 'first' | 'main' | 'closing';
  text: string;
  ranges: ToneRange[];
}

interface PoemGlyph {
  char: string;
  index: number;
  tone: GlyphTone;
  style: React.CSSProperties & Record<`--${string}`, string | number>;
}

interface PoemLine {
  id: PoemLineConfig['id'];
  text: string;
  glyphs: PoemGlyph[];
}

type DecorationPosition = Partial<Record<'top' | 'right' | 'bottom' | 'left', string>>;

export interface PhoneSplashDecorationConfig {
  decorationImage?: string;
  position?: DecorationPosition;
  size?: string;
  opacity?: number;
  blur?: number;
  blendMode?: React.CSSProperties['mixBlendMode'];
}

interface PhoneSplashPoemProps {
  decoration?: PhoneSplashDecorationConfig;
}

const POEM_LINE_CONFIGS: PoemLineConfig[] = [
  {
    id: 'first',
    text: '一朵玫瑰正马不停蹄地成为另一朵玫瑰',
    ranges: [
      { start: 2, end: 4, tone: 'rose' },
      { start: 5, end: 9, tone: 'motion' },
      { start: 15, end: 17, tone: 'rose' },
    ],
  },
  {
    id: 'main',
    text: '你是云、是海、是忘却',
    ranges: [
      { start: 2, end: 3, tone: 'cloud' },
      { start: 5, end: 6, tone: 'sea' },
      { start: 8, end: 10, tone: 'forget' },
    ],
  },
  {
    id: 'closing',
    text: '你也是你会失去的每一个自己',
    ranges: [
      { start: 5, end: 7, tone: 'loss' },
      { start: 8, end: 11, tone: 'every' },
      { start: 11, end: 13, tone: 'self' },
    ],
  },
];

const GLYPH_RHYTHM = [
  { y: -1.2, scale: 0.99, space: 0.002, alpha: 0.76 },
  { y: 0.9, scale: 1.01, space: 0.004, alpha: 0.8 },
  { y: -1.8, scale: 1.02, space: -0.004, alpha: 0.82 },
  { y: 1.8, scale: 0.98, space: 0.001, alpha: 0.72 },
  { y: -0.6, scale: 1.01, space: -0.002, alpha: 0.78 },
  { y: 2.4, scale: 0.99, space: 0.003, alpha: 0.7 },
  { y: -1.4, scale: 1.03, space: -0.003, alpha: 0.8 },
  { y: 1.2, scale: 1, space: 0.002, alpha: 0.74 },
];

const TONE_SCALE: Record<GlyphTone, number> = {
  plain: 0,
  rose: 0.05,
  motion: 0.02,
  cloud: 0.12,
  sea: 0.18,
  forget: 0.08,
  loss: 0.03,
  every: 0.02,
  self: 0.1,
  punctuation: -0.06,
};

const TONE_ALPHA: Partial<Record<GlyphTone, number>> = {
  plain: 0.92,
  rose: 1,
  motion: 0.9,
  cloud: 1,
  sea: 1,
  forget: 1,
  loss: 0.9,
  every: 0.92,
  self: 1,
  punctuation: 0.88,
};

const POEM_TEXT = POEM_LINE_CONFIGS.map(line => line.text).join('\n');

function getGlyphTone(index: number, ranges: ToneRange[], char: string): GlyphTone {
  if (char === '、') return 'punctuation';

  const matchedRange = [...ranges].reverse().find(range => index >= range.start && index < range.end);
  return matchedRange?.tone || 'plain';
}

function buildPoemLines(): PoemLine[] {
  let order = 0;

  return POEM_LINE_CONFIGS.map((line, lineIndex) => ({
    id: line.id,
    text: line.text,
    glyphs: Array.from(line.text).map((char, index) => {
      const tone = getGlyphTone(index, line.ranges, char);
      const rhythm = GLYPH_RHYTHM[(order + lineIndex * 2) % GLYPH_RHYTHM.length];
      const scale = Math.min(1.21, rhythm.scale + TONE_SCALE[tone]);
      const alpha = TONE_ALPHA[tone] ?? rhythm.alpha;
      const style: PoemGlyph['style'] = {
        '--phone-splash-poem-delay': `${180 + order * 34}ms`,
        '--phone-splash-poem-shift-y': `${rhythm.y}px`,
        '--phone-splash-poem-scale': scale.toFixed(2),
        '--phone-splash-poem-space': `${rhythm.space}em`,
        '--phone-splash-poem-alpha': alpha.toFixed(2),
      };

      order += 1;

      return {
        char,
        index,
        tone,
        style,
      };
    }),
  }));
}

const POEM_LINES = buildPoemLines();

function clampDecorationOpacity(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.06;
  return Math.min(0.12, Math.max(0, value));
}

function buildDecorationStyle(decoration: PhoneSplashDecorationConfig): React.CSSProperties {
  const opacity = clampDecorationOpacity(decoration.opacity);
  const blur = typeof decoration.blur === 'number' ? `${decoration.blur}px` : '0px';

  return {
    ...decoration.position,
    width: decoration.size || '42%',
    opacity,
    filter: `blur(${blur})`,
    mixBlendMode: decoration.blendMode || 'screen',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}

const PhoneSplashPoem: React.FC<PhoneSplashPoemProps> = ({ decoration }) => {
  const decorationImage = decoration?.decorationImage?.trim();

  return (
    <div className="phone-splash-poem" aria-label={POEM_TEXT}>
      {decorationImage ? (
        <div className="phone-splash-poem__decorations" aria-hidden="true">
          <img
            className="phone-splash-poem__decoration-image"
            src={decorationImage}
            alt=""
            draggable={false}
            style={buildDecorationStyle(decoration ?? {})}
          />
        </div>
      ) : null}

      <div className="phone-splash-poem__body">
        {POEM_LINES.map(line => (
          <div
            key={line.id}
            className={`phone-splash-poem__line phone-splash-poem__line--${line.id}`}
            aria-label={line.text}
          >
            {line.glyphs.map(glyph => (
              <span
                key={`${line.id}-${glyph.index}-${glyph.char}`}
                aria-hidden="true"
                className={`phone-splash-poem__char phone-splash-poem__char--${glyph.tone}`}
                data-char={glyph.char}
                style={glyph.style}
              >
                {glyph.char}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PhoneSplashPoem;
