/**
 * CaptureSource backed by the hidden capture renderer. Main never owns a
 * MediaStream: it resolves a desktopCapturer source id, hands it to the
 * capture window, and asks for frames when the pipeline actually needs one.
 */

import { desktopCapturer, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CaptureCommand, CaptureMessage } from '../../shared/ipc';
import type { Frame, SettleEvent, Unsubscribe } from '../../shared/types';
import { log } from '../log';
import type { CaptureSource, GrabOptions } from './CaptureSource';

export interface CaptureTransport {
  send(command: CaptureCommand): void;
  onMessage(cb: (message: CaptureMessage) => void): Unsubscribe;
}

interface Pending {
  resolve: (value: Frame | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 5_000;

export class ElectronCaptureSource implements CaptureSource {
  private readonly pending = new Map<string, Pending>();
  private readonly settledCbs = new Set<(e: SettleEvent) => void>();
  private readonly hashCbs = new Set<(hash: string, distance: number) => void>();
  private readonly streamEndedCbs = new Set<(reason: string) => void>();
  private hash: string | null = null;
  private running = false;

  constructor(private readonly transport: CaptureTransport) {
    this.transport.onMessage((message) => this.onMessage(message));
  }

  get lastHash(): string | null {
    return this.hash;
  }

  get active(): boolean {
    return this.running;
  }

  async start(displayId: string | null): Promise<void> {
    const sourceId = await this.resolveSourceId(displayId);
    await this.request({ type: 'start', requestId: randomUUID(), sourceId });
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.hash = null;
    this.transport.send({ type: 'stop', requestId: randomUUID() });
  }

  async grab(opts: GrabOptions): Promise<Frame> {
    const frame = await this.request({
      type: 'grab',
      requestId: randomUUID(),
      region: opts.region,
      maxEdge: opts.maxEdge,
      quality: opts.quality,
    });
    if (!frame) throw new Error('capture renderer returned no frame');
    return frame;
  }

  onSettled(cb: (e: SettleEvent) => void): Unsubscribe {
    this.settledCbs.add(cb);
    return () => this.settledCbs.delete(cb);
  }

  onHash(cb: (hash: string, distance: number) => void): Unsubscribe {
    this.hashCbs.add(cb);
    return () => this.hashCbs.delete(cb);
  }

  /** The stream can die on display change or resume from sleep (SPEC 12). */
  onStreamEnded(cb: (reason: string) => void): Unsubscribe {
    this.streamEndedCbs.add(cb);
    return () => this.streamEndedCbs.delete(cb);
  }

  private async resolveSourceId(displayId: string | null): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (sources.length === 0) throw new Error('no screen capture sources available');
    const wanted = displayId ? sources.find((s) => s.display_id === displayId) : undefined;
    if (displayId && !wanted) {
      // Display disconnected: fall back to primary (SPEC 12).
      const primary = String(screen.getPrimaryDisplay().id);
      log.warn('capture', `display ${displayId} not found, falling back to ${primary}`);
      const fallback = sources.find((s) => s.display_id === primary);
      return (fallback ?? sources[0]!).id;
    }
    return (wanted ?? sources[0]!).id;
  }

  private request(command: CaptureCommand): Promise<Frame | null> {
    return new Promise<Frame | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.requestId);
        reject(new Error(`capture request ${command.type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(command.requestId, { resolve, reject, timer });
      this.transport.send(command);
    });
  }

  private settle(requestId: string): Pending | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    return pending;
  }

  private onMessage(message: CaptureMessage): void {
    switch (message.type) {
      case 'hash':
        this.hash = message.hash;
        for (const cb of this.hashCbs) cb(message.hash, message.distance);
        return;
      case 'settled':
        for (const cb of this.settledCbs) {
          cb({ hash: message.hash, thumbnail: message.thumbnail, settledAt: message.settledAt });
        }
        return;
      case 'streamEnded':
        this.running = false;
        for (const cb of this.streamEndedCbs) cb(message.reason);
        return;
      case 'ok':
        this.settle(message.requestId)?.resolve(null);
        return;
      case 'frame': {
        this.settle(message.requestId)?.resolve({
          jpegBase64: message.jpegBase64,
          width: message.width,
          height: message.height,
          capturedAt: message.capturedAt,
        });
        return;
      }
      case 'failed':
        this.settle(message.requestId)?.reject(new Error(message.message));
        return;
      default: {
        const exhaustive: never = message;
        void exhaustive;
      }
    }
  }
}
