/**
 * Difference hash. Pure and unit tested: no DOM, no canvas, no Electron.
 *
 * The caller downscales a frame to 9x8 and hands over the pixels; comparing
 * each pixel with its right-hand neighbour yields 64 bits that survive
 * compression noise and cursor movement but change when the content does.
 */

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;
export const HASH_BITS = (HASH_WIDTH - 1) * HASH_HEIGHT;

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n.toString(2).match(/1/g) ?? []).length);

/** Rec. 601 luma, which is what the eye (and JPEG) weights. */
export function toGrayscale(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0; i < out.length; i += 1) {
    const p = i << 2;
    out[i] = (0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!) | 0;
  }
  return out;
}

export function dhashFromGrayscale(
  gray: ArrayLike<number>,
  width: number = HASH_WIDTH,
  height: number = HASH_HEIGHT,
): string {
  if (gray.length < width * height) {
    throw new Error(`dhash needs ${width * height} samples, got ${gray.length}`);
  }
  let hex = '';
  let nibble = 0;
  let filled = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const bit = gray[y * width + x]! < gray[y * width + x + 1]! ? 1 : 0;
      nibble = (nibble << 1) | bit;
      filled += 1;
      if (filled === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        filled = 0;
      }
    }
  }
  if (filled > 0) hex += (nibble << (4 - filled)).toString(16);
  return hex;
}

export function dhash(rgba: ArrayLike<number>, width?: number, height?: number): string {
  return dhashFromGrayscale(toGrayscale(rgba), width, height);
}

/** Bits that differ. Unequal-length hashes count the missing nibbles as zero. */
export function hammingDistance(a: string, b: string): number {
  const length = Math.max(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < length; i += 1) {
    const left = Number.parseInt(a[i] ?? '0', 16) || 0;
    const right = Number.parseInt(b[i] ?? '0', 16) || 0;
    distance += POPCOUNT[left ^ right]!;
  }
  return distance;
}
