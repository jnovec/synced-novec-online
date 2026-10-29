import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeGif } from './gif.ts';

const makeFrame = (width, height, seed) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const expected = new Uint8Array(width * height);
  for (let i = 0; i < expected.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const red = seed >>> 29;
    const green = (seed >>> 26) & 7;
    const blue = (seed >>> 24) & 3;
    pixels[i * 4] = Math.round((red * 255) / 7);
    pixels[i * 4 + 1] = Math.round((green * 255) / 7);
    pixels[i * 4 + 2] = Math.round((blue * 255) / 3);
    pixels[i * 4 + 3] = 255;
    expected[i] = ((pixels[i * 4] * 7 / 255) << 5)
      | ((pixels[i * 4 + 1] * 7 / 255) << 2)
      | (pixels[i * 4 + 2] * 3 / 255);
  }
  return { frame: { pixels, width, height, delay: 125 }, expected };
};

const decodeLzw = (data, minCodeSize, expectedLength) => {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let bitOffset = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = end + 1;
  let dictionary;
  let previous = null;
  const output = [];
  const reset = () => {
    dictionary = Array.from({ length: clear }, (_, code) => [code]);
    codeSize = minCodeSize + 1;
    nextCode = end + 1;
    previous = null;
  };
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return null;
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const absoluteBit = bitOffset + bit;
      code |= ((data[absoluteBit >>> 3] >>> (absoluteBit & 7)) & 1) << bit;
    }
    bitOffset += codeSize;
    return code;
  };
  reset();
  while (output.length < expectedLength) {
    const code = readCode();
    if (code === null || code === end) break;
    if (code === clear) {
      reset();
      continue;
    }
    let entry = dictionary[code];
    if (!entry && code === nextCode && previous) entry = [...previous, previous[0]];
    assert.ok(entry, `invalid LZW code ${code} at bit ${bitOffset - codeSize}`);
    output.push(...entry);
    if (previous && nextCode < 4096) {
      dictionary[nextCode] = [...previous, entry[0]];
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }
  return Uint8Array.from(output);
};

const decodeGifFrames = (bytes) => {
  let offset = 13;
  const packed = bytes[10];
  if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
  const frames = [];
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset += 1;
      while (offset < bytes.length) {
        const blockLength = bytes[offset++];
        if (blockLength === 0) break;
        offset += blockLength;
      }
      continue;
    }
    assert.equal(marker, 0x2c, 'expected GIF image descriptor');
    const width = bytes[offset + 4] | (bytes[offset + 5] << 8);
    const height = bytes[offset + 6] | (bytes[offset + 7] << 8);
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 7) + 1));
    const minCodeSize = bytes[offset++];
    const compressed = [];
    while (offset < bytes.length) {
      const blockLength = bytes[offset++];
      if (blockLength === 0) break;
      for (let i = 0; i < blockLength; i += 1) compressed.push(bytes[offset++]);
    }
    frames.push(decodeLzw(Uint8Array.from(compressed), minCodeSize, width * height));
  }
  return frames;
};

test('encodes multi-frame GIFs with LZW code-width changes that decode to the source pixels', async () => {
  const width = 480;
  const height = 270;
  const first = makeFrame(width, height, 1);
  const second = makeFrame(width, height, 2);
  const blob = encodeGif([first.frame, second.frame]);
  const frames = decodeGifFrames(new Uint8Array(await blob.arrayBuffer()));

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], first.expected);
  assert.deepEqual(frames[1], second.expected);
});
