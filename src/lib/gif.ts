type GifFrame = { pixels: Uint8ClampedArray; width: number; height: number; delay: number };

const push = (out: number[], ...values: number[]) => out.push(...values);

const lzw = (indices: Uint8Array) => {
  const minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const emitted: Array<{ code: number; size: number }> = [];
  const table = new Map<string, number>();
  let next = end + 1;
  let codeSize = minCodeSize + 1;
  const emit = (code: number) => emitted.push({ code, size: codeSize });
  const reset = () => {
    table.clear();
    next = end + 1;
    codeSize = minCodeSize + 1;
  };

  emit(clear);
  if (indices.length) {
    let phrase = String(indices[0]);
    for (let i = 1; i < indices.length; i += 1) {
      const symbol = String(indices[i]);
      const combined = `${phrase},${symbol}`;
      if (table.has(combined)) {
        phrase = combined;
        continue;
      }

      emit(table.get(phrase) ?? Number(phrase));
      if (next < 4096) {
        table.set(combined, next);
        next += 1;
        if (next > (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        emit(clear);
        reset();
      }
      phrase = symbol;
    }
    emit(table.get(phrase) ?? Number(phrase));
  }
  emit(end);

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const { code, size } of emitted) {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(buffer & 255);
      buffer >>= 8;
      bits -= 8;
    }
  }
  if (bits) bytes.push(buffer & 255);

  const blocks: number[] = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return [minCodeSize, ...blocks];
};

export const encodeGif = (frames: GifFrame[]) => {
  if (!frames.length) throw new Error('GIF nemá žádné snímky.');
  const { width, height } = frames[0];
  const out: number[] = [71, 73, 70, 56, 57, 97, width & 255, width >> 8, height & 255, height >> 8, 0xf7, 0, 0];
  for (let i = 0; i < 256; i += 1) out.push((i >> 5) * 255 / 7, ((i >> 2) & 7) * 255 / 7, (i & 3) * 255 / 3);
  push(out, 33, 255, 11, ...Array.from(new TextEncoder().encode('NETSCAPE2.0')), 3, 1, 0, 0, 0);
  frames.forEach((frame, frameIndex) => {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i += 1) {
      const p = i * 4; indices[i] = ((frame.pixels[p] * 7 / 255) << 5) | ((frame.pixels[p + 1] * 7 / 255) << 2) | (frame.pixels[p + 2] * 3 / 255);
    }
    const delay = Math.max(2, Math.round(frame.delay / 10));
    push(out, 33, 249, 4, 0, delay & 255, delay >> 8, 0, 0);
    const compressedImageData = lzw(indices);
    push(out, 44, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
    for (const byte of compressedImageData) out.push(byte);
    if (frameIndex === frames.length - 1) push(out, 59);
  });
  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
};
