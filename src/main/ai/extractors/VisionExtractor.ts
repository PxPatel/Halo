/**
 * The context seam (SPEC 2.3). V1 turns a frame into model input by handing
 * over the (already cropped and scaled) JPEG. OCR and UI Automation extractors
 * slot in behind this interface later and compose with it.
 */

import type { ExtractedContext, Frame } from '../../../shared/types';

export interface ContextExtractor {
  readonly id: string;
  extract(frame: Frame): Promise<ExtractedContext>;
}

export class VisionExtractor implements ContextExtractor {
  readonly id = 'vision';

  async extract(frame: Frame): Promise<ExtractedContext> {
    return {
      extractorId: this.id,
      image: { base64: frame.jpegBase64, mediaType: 'image/jpeg' },
      capturedAt: frame.capturedAt,
    };
  }
}
