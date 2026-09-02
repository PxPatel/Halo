import { describe, expect, it } from 'vitest';
import {
  dhash,
  dhashFromGrayscale,
  hammingDistance,
  HASH_BITS,
  HASH_HEIGHT,
  HASH_WIDTH,
  toGrayscale,
} from '../src/capture-renderer/dhash';
import { TUNING } from '../src/shared/constants';

/** Build a 9x8 RGBA buffer from a luma function. */
function image(luma: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(HASH_WIDTH * HASH_HEIGHT * 4);
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH; x += 1) {
      const value = Math.max(0, Math.min(255, Math.round(luma(x, y))));
      const p = (y * HASH_WIDTH + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return data;
}

const ramp = image((x, y) => x * 24 + y * 2);

describe('dhash', () => {
  it('produces 64 bits as 16 hex characters', () => {
    expect(HASH_BITS).toBe(64);
    expect(dhash(ramp)).toHaveLength(16);
  });

  it('hashes identical images identically', () => {
    expect(dhash(ramp)).toBe(dhash(image((x, y) => x * 24 + y * 2)));
  });

  it('is unmoved by compression-scale noise', () => {
    const noisy = image((x, y) => x * 24 + y * 2 + ((x * 7 + y * 5) % 3) - 1);
    expect(hammingDistance(dhash(ramp), dhash(noisy))).toBeLessThanOrEqual(
      TUNING.perception.hashDistanceThreshold,
    );
  });

  it('keeps a small local change under the threshold', () => {
    const nudged = image((x, y) => (x === 3 && y === 0 ? 255 : x * 24 + y * 2));
    const distance = hammingDistance(dhash(ramp), dhash(nudged));
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(TUNING.perception.hashDistanceThreshold);
  });

  it('puts a different screen well over the threshold', () => {
    const mirrored = image((x, y) => (HASH_WIDTH - x) * 24 + y * 2);
    expect(hammingDistance(dhash(ramp), dhash(mirrored))).toBeGreaterThan(
      TUNING.perception.hashDistanceThreshold,
    );
  });

  it('weights channels as luma, not as a plain average', () => {
    const green = new Uint8ClampedArray([0, 255, 0, 255]);
    const blue = new Uint8ClampedArray([0, 0, 255, 255]);
    expect(toGrayscale(green)[0]).toBeGreaterThan(toGrayscale(blue)[0]!);
  });

  it('refuses a buffer that is too small', () => {
    expect(() => dhashFromGrayscale(new Uint8Array(10))).toThrow();
  });
});

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
  });

  it('treats missing nibbles as zero', () => {
    expect(hammingDistance('f', '')).toBe(4);
  });
});
