/**
 * The vocabulary of the entire app (SPEC 4). Everything else is plumbing
 * around these types. No Node, no Electron, no runtime dependencies.
 */

export type Mode = 'off' | 'manual' | 'auto';

export type Category =
  | 'coding_problem'
  | 'system_design'
  | 'behavioral_question'
  | 'data_analysis'
  | 'document'
  | 'none';

export const CATEGORIES: readonly Category[] = [
  'coding_problem',
  'system_design',
  'behavioral_question',
  'data_analysis',
  'document',
  'none',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  coding_problem: 'Coding problem',
  system_design: 'System design',
  behavioral_question: 'Behavioral',
  data_analysis: 'Data analysis',
  document: 'Document',
  none: 'Answer',
};

/**
 * A rectangle in *normalized* frame coordinates: x/y/width/height are
 * fractions of the frame's width and height, in 0..1. Normalized rather than
 * pixel coordinates because the classifier sees a 512px thumbnail while the
 * crop happens against the full-resolution frame.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Frame {
  jpegBase64: string;
  width: number;
  height: number;
  capturedAt: number;
}

export interface SettleEvent {
  /** 64-bit dHash, hex. */
  hash: string;
  /** Small JPEG (base64, no data: prefix) for classification. */
  thumbnail: string;
  settledAt: number;
}

export type TriggerReason = 'screen_settled' | 'manual' | 'prompt';

export interface TriggerRequest {
  triggerId: string;
  reason: TriggerReason;
  userPrompt?: string;
  hash?: string;
}

export interface Classification {
  actionable: boolean;
  category: Category;
  /** 0..1 */
  confidence: number;
  /** Area of interest, in normalized frame coordinates. */
  region?: Rect;
}

export type SectionKey = 'code' | 'notes' | 'say';

export const SECTION_KEYS: readonly SectionKey[] = ['code', 'notes', 'say'];

export type Sections = Partial<Record<SectionKey, string>>;

export interface AssistanceResult {
  id: string;
  category: Category;
  sections: Sections;
  raw: string;
  createdAt: number;
  fromCache: boolean;
}

export type PipelineStateName =
  | 'idle'
  | 'settling'
  | 'classifying'
  | 'generating'
  | 'held'
  | 'presented'
  | 'error'
  | 'shushed';

export interface HudSettings {
  opacity: number;
  fontSize: number;
  position: { x: number; y: number };
}

export interface Settings {
  mode: Mode;
  displayId: string | null;
  /** Markdown file injected into the cached system prompt. */
  scriptPath: string | null;
  hotkeys: Record<string, string>;
  hud: HudSettings;
  models: { classify: string; generate: string };
}

/** A frame turned into model input by a ContextExtractor (SPEC 2.3). */
export interface ExtractedContext {
  extractorId: string;
  image?: { base64: string; mediaType: 'image/jpeg' };
  text?: string;
  capturedAt: number;
}

export type Unsubscribe = () => void;
