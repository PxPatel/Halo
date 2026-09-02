/**
 * The model seam (SPEC 2.3). Streaming, prompt caching, abort and retry live
 * behind this interface so those concerns never leak into pipeline code.
 */

import type { Classification } from '../../shared/types';

export interface ImageInput {
  base64: string;
  mediaType: 'image/jpeg';
}

export interface ClassifyInput {
  image: ImageInput;
}

export interface GenerateInput {
  image?: ImageInput;
  category?: string;
  userPrompt?: string;
  previousRaw?: string;
}

export type GenerateChunk =
  | { type: 'text'; text: string }
  | { type: 'done'; raw: string };

export interface ModelProvider {
  classify(input: ClassifyInput, signal: AbortSignal): Promise<Classification>;
  generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<GenerateChunk>;
  /**
   * Not in SPEC 2.3's sketch, but SPEC 7 requires a 1-token warmup at app
   * start so the first real request does not pay for TLS setup.
   */
  warmup(): Promise<void>;
}

export type ProviderErrorKind = 'auth' | 'rate' | 'overloaded' | 'timeout' | 'network' | 'unknown';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** What a classification failure degrades to: never a crash (SPEC 12). */
export const NOT_ACTIONABLE: Classification = {
  actionable: false,
  category: 'none',
  confidence: 0,
};
