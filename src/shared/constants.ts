/**
 * Every tunable in the app. Nothing here may be duplicated at a call site:
 * if a number matters, it lives here.
 */

export const MODELS = {
  classify: 'claude-haiku-4-5-20251001',
  generate: 'claude-sonnet-5',
} as const;

export const TUNING = {
  capture: {
    fps: 2,
    classifyMaxEdge: 512,
    classifyQuality: 70,
    generateMaxEdge: 1400,
    generateQuality: 80,
  },
  perception: {
    hashDistanceThreshold: 8, // of 64 bits
    settleMs: 700,
  },
  pipeline: {
    autoMinIntervalMs: 20_000,
    confidenceFloor: 0.7,
    shushDefaultMs: 5 * 60_000,
    requestTimeoutMs: 30_000,
  },
  hud: {
    cardWidth: 420,
    maxCardHeightPct: 0.55,
    idleOpacity: 0.7,
    activeOpacity: 1.0,
    fadeAfterMs: 6_000,
  },
} as const;

/** Tier-1 and tier-2 request shaping that is not a user-facing tunable. */
export const AI = {
  classifyMaxTokens: 200,
  generateMaxTokens: 2000,
  /** 5% padding around the classifier's region of interest, per SPEC 7. */
  regionPaddingPct: 0.05,
  /** Retries for 429/529 responses, on top of the initial attempt. */
  retries: 2,
  retryBaseMs: 1_000,
  cacheTtl: '1h',
} as const;

/**
 * Capture transport behaviour. Not user-facing tunables, so they live outside
 * TUNING, but they are still in one place.
 */
export const CAPTURE = {
  /** A grab is a canvas draw and an encode: fast, or something is wrong. */
  requestTimeoutMs: 5_000,
  /** A start is getUserMedia plus first frame, which is slow on a 4K display. */
  startTimeoutMs: 15_000,
  retryBaseMs: 2_000,
  retryMaxMs: 30_000,
} as const;

/** LRU cap for the in-memory result cache. */
export const RESULT_CACHE_SIZE = 50;

/** Windows 10 2004. WDA_EXCLUDEFROMCAPTURE does not exist below this. */
export const MIN_WINDOWS_BUILD = 19041;

export const PILL_SIZE = { width: 180, height: 36 } as const;

export const DEFAULT_HOTKEYS: Record<string, string> = {
  toggleHud: 'Control+\\',
  captureNow: 'Control+Return',
  openPrompt: 'Control+Shift+Return',
  cycleMode: 'Control+Shift+A',
  reveal: 'Control+Shift+R',
  dismiss: 'Control+Shift+D',
  shush: 'Control+Shift+S',
  moveUp: 'Control+Alt+Up',
  moveDown: 'Control+Alt+Down',
  moveLeft: 'Control+Alt+Left',
  moveRight: 'Control+Alt+Right',
  opacityDown: 'Control+Alt+[',
  opacityUp: 'Control+Alt+]',
  copyCode: 'Control+Shift+C',
  tabCode: 'Control+Shift+1',
  tabNotes: 'Control+Shift+2',
  tabSay: 'Control+Shift+3',
  debug: 'Control+Shift+L',
  settings: 'Control+Shift+O',
};
