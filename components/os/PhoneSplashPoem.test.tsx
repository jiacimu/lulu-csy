import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PhoneSplashPoem from './PhoneSplashPoem';

describe('PhoneSplashPoem decoration layer', () => {
  it('does not render decoration artwork without a decorationImage', () => {
    const { container } = render(<PhoneSplashPoem />);

    expect(container.querySelector('.phone-splash-poem__decoration-image')).toBeNull();
  });

  it('renders configured decoration artwork as a passive low-opacity image layer', () => {
    const { container } = render(
      <PhoneSplashPoem
        decoration={{
          decorationImage: '/assets/deco/blue-rose-watercolor.jpg',
          position: { right: '-22%', bottom: '-18%' },
          size: '78%',
          opacity: 0.8,
          blur: 0.2,
          blendMode: 'screen',
        }}
      />,
    );

    const image = container.querySelector('.phone-splash-poem__decoration-image') as HTMLImageElement | null;
    const layer = container.querySelector('.phone-splash-poem__decorations') as HTMLDivElement | null;

    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('/assets/deco/blue-rose-watercolor.jpg');
    expect(image?.style.opacity).toBe('0.12');
    expect(image?.style.width).toBe('78%');
    expect(image?.style.right).toBe('-22%');
    expect(image?.style.bottom).toBe('-18%');
    expect(image?.style.pointerEvents).toBe('none');
    expect(layer).not.toBeNull();
  });
});
