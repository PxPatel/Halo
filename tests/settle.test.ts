import { describe, expect, it } from 'vitest';
import { SettleDetector } from '../src/capture-renderer/settle';
import { TUNING } from '../src/shared/constants';

const A = '0000000000000000';
const B = 'ffffffffffffffff';
const A_NUDGED = '0000000000000003'; // 2 bits from A: below the threshold

const options = {
  settleMs: TUNING.perception.settleMs,
  distanceThreshold: TUNING.perception.hashDistanceThreshold,
};

describe('SettleDetector', () => {
  it('fires once the screen has been stable for settleMs', () => {
    const detector = new SettleDetector(options);
    expect(detector.push(A, 0).settled).toBe(false);
    expect(detector.push(A, 500).settled).toBe(false);
    expect(detector.push(A, 700).settled).toBe(true);
  });

  it('fires only once per period of stability', () => {
    const detector = new SettleDetector(options);
    detector.push(A, 0);
    expect(detector.push(A, 800).settled).toBe(true);
    expect(detector.push(A, 1_000).settled).toBe(false);
    expect(detector.push(A, 5_000).settled).toBe(false);
  });

  it('resets the timer while the screen keeps changing', () => {
    const detector = new SettleDetector(options);
    let now = 0;
    let settled = false;
    for (let i = 0; i < 10; i += 1) {
      now += 500;
      settled = detector.push(i % 2 === 0 ? A : B, now).settled || settled;
    }
    expect(settled).toBe(false);
    expect(detector.push(B, now + 800).settled).toBe(true);
  });

  it('treats sub-threshold drift as stability', () => {
    const detector = new SettleDetector(options);
    detector.push(A, 0);
    detector.push(A_NUDGED, 400);
    expect(detector.push(A, 800).settled).toBe(true);
  });

  it('does not re-fire for content it already settled on', () => {
    const detector = new SettleDetector(options);
    detector.push(A, 0);
    expect(detector.push(A, 800).settled).toBe(true);
    detector.push(B, 1_000);
    expect(detector.push(B, 1_800).settled).toBe(true);
    detector.push(A, 2_000);
    expect(detector.push(A, 2_800).settled).toBe(true);
  });

  it('reports the distance from the previous frame', () => {
    const detector = new SettleDetector(options);
    detector.push(A, 0);
    expect(detector.push(B, 500).distance).toBe(64);
  });

  it('starts over after a reset', () => {
    const detector = new SettleDetector(options);
    detector.push(A, 0);
    expect(detector.push(A, 800).settled).toBe(true);
    detector.reset();
    detector.push(A, 900);
    expect(detector.push(A, 1_700).settled).toBe(true);
  });
});
