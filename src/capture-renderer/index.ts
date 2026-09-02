/**
 * The capture renderer owns the desktop MediaStream and nothing else. It grabs
 * frames at 2fps, hashes them, and tells main when the screen has settled.
 * It knows nothing about modes, the AI, or the UI (SPEC 2.1).
 *
 * Only a 64-bit hash crosses IPC per frame; a JPEG crosses on settle, or when
 * main explicitly asks for one.
 */

import { TUNING } from '../shared/constants';
import type { CaptureCommand, HaloCaptureApi } from '../shared/ipc';
import type { Rect } from '../shared/types';
import { dhash, HASH_HEIGHT, HASH_WIDTH } from './dhash';
import { SettleDetector } from './settle';

declare global {
  interface Window {
    haloCapture: HaloCaptureApi;
  }
}

const api = window.haloCapture;
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

const hashCanvas = document.createElement('canvas');
hashCanvas.width = HASH_WIDTH;
hashCanvas.height = HASH_HEIGHT;
const hashCtx = hashCanvas.getContext('2d', { willReadFrequently: true })!;

const grabCanvas = document.createElement('canvas');
const grabCtx = grabCanvas.getContext('2d')!;

const detector = new SettleDetector();
let stream: MediaStream | null = null;
let ticker: number | null = null;

function stop(): void {
  if (ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
  detector.reset();
}

async function start(sourceId: string): Promise<void> {
  stop();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: TUNING.capture.fps,
      },
    },
  } as unknown as MediaStreamConstraints);

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    api.send({ type: 'streamEnded', reason: 'track ended' });
    stop();
  });

  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) resolve();
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });

  ticker = window.setInterval(tick, Math.round(1000 / TUNING.capture.fps));
}

function tick(): void {
  if (!stream || video.videoWidth === 0) return;
  hashCtx.drawImage(video, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const pixels = hashCtx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT).data;
  const hash = dhash(pixels);
  const now = Date.now();
  const decision = detector.push(hash, now);
  api.send({ type: 'hash', hash, distance: decision.distance, at: now });
  if (!decision.settled) return;
  api.send({
    type: 'settled',
    hash,
    thumbnail: encode(TUNING.capture.classifyMaxEdge, TUNING.capture.classifyQuality),
    settledAt: now,
  });
}

/** Crop first, then scale (SPEC 7): cropping after scaling throws away detail. */
function encode(maxEdge: number, quality: number, region?: Rect): string {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  const crop = region
    ? {
        x: Math.max(0, Math.round(region.x * sw)),
        y: Math.max(0, Math.round(region.y * sh)),
        width: Math.max(1, Math.round(region.width * sw)),
        height: Math.max(1, Math.round(region.height * sh)),
      }
    : { x: 0, y: 0, width: sw, height: sh };

  const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
  grabCanvas.width = Math.max(1, Math.round(crop.width * scale));
  grabCanvas.height = Math.max(1, Math.round(crop.height * scale));
  grabCtx.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    grabCanvas.width,
    grabCanvas.height,
  );
  return grabCanvas.toDataURL('image/jpeg', quality / 100).split(',')[1] ?? '';
}

async function handle(command: CaptureCommand): Promise<void> {
  switch (command.type) {
    case 'start':
      await start(command.sourceId);
      api.send({ type: 'ok', requestId: command.requestId });
      return;
    case 'stop':
      stop();
      api.send({ type: 'ok', requestId: command.requestId });
      return;
    case 'grab': {
      if (!stream || video.videoWidth === 0) throw new Error('capture is not running');
      api.send({
        type: 'frame',
        requestId: command.requestId,
        jpegBase64: encode(command.maxEdge, command.quality, command.region),
        width: grabCanvas.width,
        height: grabCanvas.height,
        capturedAt: Date.now(),
      });
      return;
    }
    default: {
      const exhaustive: never = command;
      void exhaustive;
    }
  }
}

api.onCommand((command) => {
  handle(command).catch((error: unknown) => {
    api.send({
      type: 'failed',
      requestId: command.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
