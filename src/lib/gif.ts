import * as gifenc from 'gifenc';

// Node exposes this package's CommonJS build under default; webpack uses ESM.
const { GIFEncoder, quantize, applyPalette } = 'GIFEncoder' in gifenc
  ? gifenc : (gifenc as { default: typeof gifenc }).default;

type GifFrame = { pixels: Uint8ClampedArray; width: number; height: number; delay: number };

// Encode each frame immediately, without retaining the whole loop in RGBA memory.
export const createGifEncoder = (paletteSource?: Uint8ClampedArray) => {
  const encoder = GIFEncoder();
  const palette = paletteSource ? quantize(paletteSource, 256, { format: 'rgb565' }) : undefined;
  let count = 0;
  return {
    add(frame: GifFrame) {
      const framePalette = palette ?? quantize(frame.pixels, 256, { format: 'rgb565' });
      encoder.writeFrame(applyPalette(frame.pixels, framePalette, 'rgb565'), frame.width, frame.height, {
        palette: framePalette, delay: frame.delay, repeat: 0, dispose: 1,
      });
      count += 1;
    },
    finish() {
      if (!count) throw new Error('GIF nemá žádné snímky.');
      encoder.finish();
      return new Blob([encoder.bytes()], { type: 'image/gif' });
    },
  };
};

export const encodeGif = (frames: GifFrame[]) => {
  const encoder = createGifEncoder();
  frames.forEach((frame) => encoder.add(frame));
  return encoder.finish();
};
