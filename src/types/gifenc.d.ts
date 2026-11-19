declare module 'gifenc' {
  export function quantize(rgba: Uint8ClampedArray, colors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(pixels: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number; repeat?: number; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
