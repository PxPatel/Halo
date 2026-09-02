# Halo — V1 Specification

A capture-invisible desktop assistant for Windows. Halo watches the screen, understands what
you're looking at, and puts a concise answer in a floating card that does not appear in screen
shares or recordings.

This document is the source of truth for V1. If the code and this document disagree, one of them
is a bug.

---

## 1. Scope

### In scope for V1

- Frameless always-on-top overlay window, excluded from OS-level screen capture.
- Screen capture and change detection.
- Two-tier AI pipeline: cheap classification, expensive generation.
- Three modes: `off`, `manual`, `auto`.
- Prompt bar with follow-up context and slash commands.
- Answer card with `Code` / `Notes` / `Say` tabs and streamed rendering.
- Full global hotkey layer; the app is operable without a mouse.
- Optional user context file ("script") injected into the cached system prompt.
- Settings persistence and secure API key storage.

### Explicitly out of scope for V1

Do not build these. Do not add abstractions "in preparation" for them beyond what §4 specifies.

- Audio capture, transcription, or any speech feature.
- Eye or gaze tracking.
- OCR and UI Automation text extraction.
- Conversation history or any persistence of screenshots or responses to disk.
- Auto-update, telemetry, crash reporting, analytics.
- Codebase indexing or retrieval.
- macOS or Linux support.
- Accounts, sync, licensing.
- Content-aware HUD placement.

### Platform

Windows 10 build 19041 (version 2004) or later. Hard requirement — `WDA_EXCLUDEFROMCAPTURE`
does not exist below this. Fail loudly at startup on older builds.

---

## 2. Architecture

### 2.1 Three execution contexts

Electron gives us three places code can run. Each has exactly one job. Violating this boundary is
the main way this codebase would rot.

| Context | Job | Must never |
|---|---|---|
| **Main** | OS integration, orchestration, AI calls, secrets, hotkeys, settings | Contain view logic or render anything |
| **Capture renderer** (hidden `BrowserWindow`, `show: false`) | Owns the desktop `MediaStream`, grabs frames, computes hashes | Call the AI, know about modes or UI |
| **HUD renderer** (visible overlay) | Renders state. Nothing else. | Access Node, hold the API key, own capture, contain pipeline logic |

The capture stream lives in its own hidden window, not in the HUD renderer. This keeps capture
alive when the HUD is hidden and prevents UI lifecycle from disturbing the frame pipeline.

### 2.2 Data flow

```
Capture renderer          Main                              HUD renderer
─────────────────         ────────────────────              ─────────────
2fps frame grab
  │
  ├─ dHash
  ├─ settle timer
  │
  └─ "settled" ────────►  ScreenTrigger
     (+ small JPEG)         │
                            ├─ Pipeline.dispatch(event)
                            │    │
                            │    ├─ Classifier  (Haiku)
                            │    ├─ Generator   (Sonnet, streamed)
                            │    └─ ResultCache
                            │
                            └─ IPC events ──────────────►   Store → Components
                                                                  │
                            ◄───────────── IPC commands ──────────┘
```

Frame image data crosses IPC **only** when the pipeline needs it. The 2fps grab loop stays inside
the capture renderer; only a 64-bit hash and, on settle, a single small JPEG cross the boundary.

### 2.3 The four seams

These are the only interfaces V1 needs. They exist because we know what will change, not because
abstraction is generally virtuous. Do not add others.

**`CaptureSource`** — produces frames. V1 has one implementation backed by Electron's
`desktopCapturer`. A native Windows Graphics Capture helper may replace it later.

```ts
interface CaptureSource {
  start(displayId: string): Promise<void>;
  stop(): void;
  grab(opts: { region?: Rect; maxEdge: number; quality: number }): Promise<Frame>;
  onSettled(cb: (e: SettleEvent) => void): Unsubscribe;
}
```

**`Trigger`** — something that decides assistance is wanted right now. V1 has `ScreenTrigger` and
`ManualTrigger`. This seam is what makes an audio trigger additive later rather than a rewrite.

```ts
interface Trigger {
  readonly id: string;
  start(): void;
  stop(): void;
  onFire(cb: (req: TriggerRequest) => void): Unsubscribe;
}
```

**`ContextExtractor`** — turns a raw frame into model input. V1 has `VisionExtractor` only
(the frame, cropped and scaled). OCR and UIA extractors slot in behind this later and compose.

```ts
interface ContextExtractor {
  readonly id: string;
  extract(frame: Frame): Promise<ExtractedContext>;
}
```

**`ModelProvider`** — wraps the Anthropic SDK. Centralizes streaming, prompt caching, abort, and
retry so those concerns never leak into pipeline code.

```ts
interface ModelProvider {
  classify(input: ClassifyInput, signal: AbortSignal): Promise<Classification>;
  generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<GenerateChunk>;
}
```

### 2.4 The pipeline is a pure reducer

The hardest part of this app is the interaction between modes, triggers, rate limits, in-flight
requests, and the shush timer. Implemented as scattered booleans it becomes unmaintainable within
weeks. Implement it as a pure state machine with an effects runner:

```ts
function pipelineReducer(
  state: PipelineState,
  event: PipelineEvent
): [PipelineState, Effect[]];
```

`pipelineReducer` is pure — no I/O, no timers, no Electron imports. `PipelineRunner` executes the
returned effects and feeds results back in as new events. This makes every mode transition,
cancellation path, and rate-limit guard unit-testable with no mocking.

**States:** `idle` → `settling` → `classifying` → `generating` → `held` → `presented`, plus
`error` and `shushed`.

**Events:** `MODE_CHANGED`, `SCREEN_SETTLED`, `MANUAL_TRIGGER`, `PROMPT_SUBMITTED`,
`CLASSIFIED`, `CHUNK`, `GENERATED`, `REVEAL`, `DISMISS`, `SHUSH`, `SHUSH_EXPIRED`, `ABORT`,
`ERROR`.

**Effects:** `RunClassify`, `RunGenerate`, `AbortInFlight`, `EmitToRenderer`, `StartTimer`,
`CacheResult`.

Rate limiting and the confidence floor are **guards inside the reducer**, not separate systems
that other code has to remember to consult.

---

## 3. Repository layout

```
halo/
├─ CLAUDE.md                       # working agreements for Claude Code
├─ docs/
│  └─ SPEC.md                      # this file
├─ src/
│  ├─ shared/                      # imported by all three contexts. No Node, no Electron.
│  │  ├─ types.ts                  # domain types (§4)
│  │  ├─ ipc.ts                    # the IPC contract (§5)
│  │  ├─ sections.ts               # streamed markdown section parser
│  │  └─ constants.ts              # tunables (§8)
│  │
│  ├─ main/
│  │  ├─ index.ts                  # app lifecycle, wiring only
│  │  ├─ window/
│  │  │  ├─ HaloWindow.ts          # BrowserWindow construction + OS flags
│  │  │  ├─ protection.ts          # content protection, WS_EX flags, self-check
│  │  │  └─ placement.ts           # move, opacity, click-through, focus toggling
│  │  ├─ capture/
│  │  │  ├─ CaptureSource.ts       # interface + types
│  │  │  └─ ElectronCaptureSource.ts
│  │  ├─ trigger/
│  │  │  ├─ Trigger.ts
│  │  │  ├─ ScreenTrigger.ts
│  │  │  └─ ManualTrigger.ts
│  │  ├─ pipeline/
│  │  │  ├─ reducer.ts             # PURE. no imports outside shared/.
│  │  │  ├─ runner.ts              # executes effects
│  │  │  └─ cache.ts               # ResultCache
│  │  ├─ ai/
│  │  │  ├─ ModelProvider.ts
│  │  │  ├─ AnthropicProvider.ts
│  │  │  ├─ extractors/
│  │  │  │  └─ VisionExtractor.ts
│  │  │  └─ prompts/
│  │  │     ├─ classify.md
│  │  │     ├─ system.md
│  │  │     └─ index.ts            # loads + interpolates, no inline prompt strings
│  │  ├─ hotkeys/registry.ts
│  │  ├─ settings/store.ts         # zod-validated, electron-store backed
│  │  ├─ secrets/keyStore.ts       # safeStorage wrapper
│  │  └─ ipc/bridge.ts             # single place main talks to renderers
│  │
│  ├─ preload/
│  │  └─ index.ts                  # contextBridge, exposes typed command/event API only
│  │
│  ├─ capture-renderer/
│  │  ├─ index.ts                  # stream ownership, grab loop
│  │  └─ dhash.ts                  # PURE. unit tested.
│  │
│  └─ hud/
│     ├─ App.tsx
│     ├─ store.ts                  # zustand; mirrors main, holds zero business logic
│     ├─ components/
│     │  ├─ Pill.tsx
│     │  ├─ Card.tsx
│     │  ├─ Tabs.tsx
│     │  ├─ CodeBlock.tsx
│     │  ├─ PromptBar.tsx
│     │  ├─ ModeDot.tsx
│     │  └─ Settings.tsx
│     └─ styles/
│
└─ tests/
   ├─ reducer.test.ts
   ├─ dhash.test.ts
   ├─ sections.test.ts
   └─ settle.test.ts
```

**Rules this layout enforces:**

- `shared/` has zero runtime dependencies on Node or Electron. If it can't run in a browser, it
  doesn't belong there.
- `pipeline/reducer.ts` imports only from `shared/`. Enforced by an ESLint boundary rule.
- Prompts are files, not string literals. They will be edited constantly and need to diff cleanly.
- `main/index.ts` contains wiring and nothing else. If it grows past ~150 lines, something is in
  the wrong place.

---

## 4. Domain types

These live in `shared/types.ts` and are the vocabulary of the entire app. Everything else is
plumbing around them.

```ts
type Mode = 'off' | 'manual' | 'auto';

type Category =
  | 'coding_problem'
  | 'system_design'
  | 'behavioral_question'
  | 'data_analysis'
  | 'document'
  | 'none';

interface Frame {
  jpegBase64: string;
  width: number;
  height: number;
  capturedAt: number;
}

interface SettleEvent {
  hash: string;          // 64-bit dHash, hex
  thumbnail: string;     // small JPEG for classification
  settledAt: number;
}

interface TriggerRequest {
  triggerId: string;
  reason: 'screen_settled' | 'manual' | 'prompt';
  userPrompt?: string;
  hash?: string;
}

interface Classification {
  actionable: boolean;
  category: Category;
  confidence: number;    // 0..1
  region?: Rect;         // area of interest, in frame coordinates
}

interface AssistanceResult {
  id: string;
  category: Category;
  sections: { code?: string; notes?: string; say?: string };
  raw: string;
  createdAt: number;
  fromCache: boolean;
}
```

`AssistanceResult` is what the HUD renders. The HUD knows nothing about frames, hashes,
classifications, or models.

### Section streaming

Structured JSON output delays the first token and complicates streaming. Instead the generation
model returns markdown with three fixed headers:

```
## Code
## Notes
## Say
```

`shared/sections.ts` exposes `parseSections(partial: string): Sections` which is incremental and
tolerant of truncation, so the renderer can re-parse on every chunk. Sections may be absent —
a behavioral question has no `Code` section, and the tab is hidden rather than empty.

---

## 5. IPC contract

One file, `shared/ipc.ts`, defines two discriminated unions. Both sides import it. No untyped
`ipcRenderer.send` anywhere in the codebase.

**Commands (renderer → main).** Renderers request; they never act.

```ts
type Command =
  | { type: 'setMode'; mode: Mode }
  | { type: 'trigger' }
  | { type: 'submitPrompt'; text: string }
  | { type: 'reveal' }
  | { type: 'dismiss' }
  | { type: 'shush'; minutes: number }
  | { type: 'setOpacity'; value: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'setPromptBarOpen'; open: boolean }
  | { type: 'updateSettings'; patch: Partial<Settings> };
```

**Events (main → renderer).** Main is authoritative for all state.

```ts
type Event =
  | { type: 'state'; mode: Mode; pipeline: PipelineStateName; shushUntil: number | null }
  | { type: 'assistStart'; id: string; category: Category }
  | { type: 'assistChunk'; id: string; text: string }
  | { type: 'assistDone'; result: AssistanceResult }
  | { type: 'assistError'; id: string; message: string; retryable: boolean }
  | { type: 'settings'; settings: Settings }
  | { type: 'diagnostics'; protectionVerified: boolean; captureActive: boolean };
```

There is exactly one state store in the app, and it lives in main. The renderer's zustand store is
a mirror, updated only by `Event`s. Never let the renderer optimistically mutate mode or pipeline
state.

`setPromptBarOpen` exists because the prompt bar needs keyboard focus. Main toggles
`setIgnoreMouseEvents(false)` and `setFocusable(true)` while it is open and restores click-through
on close. This is the only time the HUD is focusable.

---

## 6. Window and invisibility

`main/window/protection.ts` owns every OS-level flag. Nothing else touches window styles.

**Required configuration:**

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  resizable: false,
  skipTaskbar: true,
  focusable: false,
  alwaysOnTop: true,
  type: 'toolbar',
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
});

win.setContentProtection(true);              // → WDA_EXCLUDEFROMCAPTURE
win.setAlwaysOnTop(true, 'screen-saver');
win.setIgnoreMouseEvents(true, { forward: true });
win.setVisibleOnAllWorkspaces(true);
```

`type: 'toolbar'` maps to `WS_EX_TOOLWINDOW`, which is what keeps Halo out of Alt-Tab **and out of
Zoom's window-share picker**. Content protection hides the pixels; the tool-window style hides the
entry. Both are required. Missing the second is the most likely V1 failure.

**Startup self-check.** On launch, verify `os.release()` meets the build floor and that
`setContentProtection` did not throw. Report through the `diagnostics` event. If verification
fails, the HUD shows a persistent warning banner rather than silently pretending to be hidden.

**Manual verification checklist** (`docs/VERIFY.md`, run before every release):

- [ ] Zoom — share entire screen
- [ ] Zoom — share single window
- [ ] Zoom — the share picker's window list does not contain Halo
- [ ] Google Meet in Chrome — all three share modes
- [ ] Microsoft Teams — screen share
- [ ] OBS — display capture and window capture
- [ ] `Win+Shift+S` snip
- [ ] Xbox Game Bar capture
- [ ] Alt-Tab does not show Halo
- [ ] Halo does not steal focus from a running fullscreen browser

---

## 7. AI layer

### Models

Defined once in `shared/constants.ts`. Never hardcoded at call sites.

```ts
export const MODELS = {
  classify:  'claude-haiku-4-5-20251001',
  generate:  'claude-sonnet-5',
} as const;
```

Verify these strings against current Anthropic docs before first run; model identifiers change
and a stale one produces a confusing 404.

### Tier 1 — classification

- Input: settle thumbnail, 512px wide, JPEG q70.
- `temperature: 0`, `max_tokens: 200`.
- Output: strict JSON matching `Classification`, validated with zod. A parse failure is treated as
  `actionable: false`, never as a crash.
- Skipped entirely in `manual` mode.

### Tier 2 — generation

- Input: frame cropped to `Classification.region` (with 5% padding), longest edge capped at
  1400px, JPEG q80. Crop before scaling.
- Streamed via `client.messages.stream()`.
- `max_tokens: 2000`.

### Prompt caching

The system prompt and user script are static across a session, so they carry
`cache_control: { type: 'ephemeral' }` and must come **first** in the message array. Dynamic
content — the image, the user's prompt — comes last. Getting this order wrong silently disables
the cache.

Use the 1-hour TTL. Send a 1-token warmup request at app start so the first real request doesn't
pay TLS setup.

### Cancellation

Every request carries an `AbortSignal`. A new trigger aborts the in-flight one. This is a reducer
effect (`AbortInFlight`), not something call sites remember to do.

### Result cache

`Map` keyed on `${hash}:${mode}:${promptText}`, capped at 50 entries, LRU eviction, in-memory only.
Re-triggering on an unchanged screen must be free and instant.

---

## 8. Tunables

Single export in `shared/constants.ts`. Every one of these will be adjusted; none should be
searched for across the codebase.

```ts
export const TUNING = {
  capture: {
    fps: 2,
    classifyMaxEdge: 512,
    classifyQuality: 70,
    generateMaxEdge: 1400,
    generateQuality: 80,
  },
  perception: {
    hashDistanceThreshold: 8,   // of 64 bits
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
```

---

## 9. HUD

### States

**Pill** (collapsed) — 180×36. Mode dot plus a one-word status. Always visible when the app is on.

**Card** (expanded) — `cardWidth` wide, capped at 55% of screen height with internal scroll.

**Prompt bar** — slides up from the card's lower edge. The only focusable surface.

### Card anatomy

Header: category label, mode dot, dismiss affordance. Tabs: `Code` / `Notes` / `Say`, hiding any
tab whose section is absent. Body: streamed markdown, `shiki` for code blocks. Footer: copy button,
regenerate, elapsed time.

The `Say` tab is short declarative sentences meant to be read aloud while speaking. Constrain it in
the prompt to at most four bullets, no sentence longer than about fifteen words. It is the
highest-value surface in the product and the easiest to get wrong by letting it become prose.

### Visual language

Background `rgba(12, 12, 14, 0.82)` with `backdrop-filter: blur(20px)`. Border `1px solid
rgba(255,255,255,0.08)`. Radius 12px. No shadows, no gradients, no accent colors beyond the mode
dot. Monospace only inside code blocks.

### Mode dot

| Color | Meaning |
|---|---|
| Gray | Off |
| Blue | Manual |
| Amber, slow pulse | Auto, armed |
| Amber, solid | Result held and ready to reveal |
| Red | Error |

### Auto-mode restraint rules

Enforced in the reducer, not the UI:

- At most one card per `autoMinIntervalMs`.
- Never replace an undismissed card.
- Classifications below `confidenceFloor` set a subtle badge on the pill; they do not open a card.
- Shush suppresses all auto triggers; manual triggers still work.

### Prefetch and hold

In auto mode, generation starts as soon as classification succeeds, and the result is **held** —
not shown. The card appears on `reveal`, already complete. This moves latency into the window
where you are still reading the screen yourself, and is the single biggest contributor to the app
feeling instant.

### Accessibility

Non-negotiable, built in from the first commit rather than retrofitted:

- Every action reachable by hotkey; no mouse-only path exists.
- Card body fully navigable by Tab and arrow keys when the prompt bar is open.
- Base font size is a setting, not a constant. Layout must not break at 20px.
- Text contrast at or above 7:1 against the card background.
- All animation wrapped in `@media (prefers-reduced-motion: no-preference)`.
- `aria-live="polite"` on the streaming body so screen readers announce completion.

---

## 10. Hotkeys

Registered through `globalShortcut` in `main/hotkeys/registry.ts`. Every binding is remappable
from settings from day one.

| Chord | Action |
|---|---|
| `Ctrl+\` | Show / hide HUD |
| `Ctrl+Enter` | Capture now and answer |
| `Ctrl+Shift+Enter` | Open prompt bar |
| `Ctrl+Shift+A` | Cycle Off → Manual → Auto |
| `Ctrl+Shift+R` | Reveal held result |
| `Ctrl+Shift+D` | Dismiss card |
| `Ctrl+Shift+S` | Shush 5 minutes |
| `Ctrl+Alt+↑↓←→` | Move HUD |
| `Ctrl+Alt+[` / `]` | Opacity down / up |
| `Ctrl+Shift+C` | Copy active code block |
| `Ctrl+Shift+1/2/3` | Jump to Code / Notes / Say |

Registration can fail if another app holds the chord. Surface failures in settings with the
conflicting binding marked, rather than failing silently.

### Slash commands

Parsed in the prompt bar, dispatched as `submitPrompt` with a prefix the prompt template
understands: `/explain`, `/optimize`, `/edge`, `/shorter`, `/say`, `/again` (regenerate at full
resolution).

---

## 11. Settings and secrets

`Settings` is a zod schema; `settings/store.ts` validates on read and write and falls back to
defaults on corruption. Backed by `electron-store`.

```ts
interface Settings {
  mode: Mode;
  displayId: string | null;
  scriptPath: string | null;      // markdown file injected into cached system prompt
  hotkeys: Record<string, string>;
  hud: { opacity: number; fontSize: number; position: { x: number; y: number } };
  models: { classify: string; generate: string };
}
```

**The API key is never in `Settings`.** It lives in `secrets/keyStore.ts` behind Electron's
`safeStorage`, is read in main only, and is never sent over IPC or written to logs. The renderer
learns only whether a key is present.

**The script** is a single user-chosen markdown file — a resume, product notes, a style guide.
Read at session start, injected into the cached system prompt block. This is why prompt caching
matters: the script may be several thousand tokens and is identical on every request.

---

## 12. Errors and failure modes

Every one of these needs explicit, non-crashing handling. Silent failure is the worst outcome
because the entire premise of the app is that you trust it while your attention is elsewhere.

| Failure | Behavior |
|---|---|
| Windows build below 19041 | Refuse to start. Clear dialog explaining why. |
| `setContentProtection` fails | Persistent red banner. Do not silently continue. |
| No API key configured | HUD opens directly to settings. |
| API 401 | Red mode dot, "check your key", link to settings. |
| API 429 or 529 | Exponential backoff, two retries, then show retryable error. |
| Request timeout | Abort, show error card with retry. |
| Classification JSON unparseable | Treat as `actionable: false`. Log. Never crash. |
| Capture stream dies (display change, sleep) | Detect, restart, show transient pill state. |
| Hotkey registration conflict | Flag in settings. App remains usable. |
| Display disconnected | Fall back to primary, update settings. |

**Logging.** One `log` module writing to a rotating file in `app.getPath('userData')`. Redact the
API key and never log image data or generated content. A `Ctrl+Shift+L` debug overlay showing
current pipeline state, last hash distance, and last request timing will save hours.

---

## 13. Testing

The point of the reducer-plus-effects design is that the difficult logic is testable without
Electron, a display, or a network. Test these; do not chase coverage elsewhere.

- `reducer.test.ts` — every state transition, mode change mid-flight, rate limit guard, shush
  expiry, abort on new trigger, confidence floor. This is the highest-value test file in the repo.
- `dhash.test.ts` — identical images hash equal; small changes stay under threshold; large changes
  exceed it.
- `sections.test.ts` — incremental parsing, truncated input mid-header, absent sections.
- `settle.test.ts` — timer resets on continued change, fires once on stability.

Vitest. No E2E in V1; the manual verification checklist in §6 covers what matters.

---

## 14. Milestones

Each milestone is independently shippable and independently useful. Do not start the next until
the previous one's acceptance criteria pass.

### M0 — Prove invisibility

Blank overlay window with all flags from §6. No AI, no capture.

**Done when:** the entire §6 verification checklist passes on the target machine.

This is first because if content protection does not work on your hardware, nothing else matters.

### M1 — Manual loop

Hotkey → capture frame → Sonnet → streamed answer in an unstyled card. Key storage. Settings stub.

**Done when:** `Ctrl+Enter` on a LeetCode problem produces a correct streamed solution in under
two seconds to first token.

### M2 — HUD

Pill and card states, tabs, `shiki` highlighting, mode dot, full hotkey layer, focus toggling,
accessibility requirements from §9.

**Done when:** the app is fully operable with the mouse unplugged, and the card is legible at
20px base font.

### M3 — Prompt bar

Prompt bar, slash commands, follow-up context, regenerate.

**Done when:** you can ask a follow-up about the previous answer without re-capturing.

### M4 — Auto mode

Capture renderer grab loop, dHash, settle detection, `ScreenTrigger`, Tier 1 classifier, the full
reducer with rate limiting and shush, prefetch-and-hold.

**Done when:** navigating to a new LeetCode problem produces a held result within three seconds
with no input, and browsing unrelated pages for five minutes produces zero cards.

### M5 — Hardening

Result cache, prompt caching, warmup request, the full error matrix from §12, debug overlay,
the test suite from §13.

**Done when:** every row of §12 has been manually induced and behaves as specified.

---

## 15. Conventions

- TypeScript strict mode. No `any`. No non-null assertions outside tests.
- Named exports only. No default exports.
- No business logic in React components. Components take props and render. If a component contains
  an `if` about pipeline state, that logic belongs in main.
- No inline prompt strings. Prompts live in `main/ai/prompts/*.md`.
- No magic numbers. Everything tunable lives in `TUNING`.
- Errors are values at boundaries — return `Result`-shaped objects from the AI layer rather than
  throwing across IPC.
- One concern per file. A file over ~200 lines is a signal to split.
- ESLint `no-restricted-imports` enforces the boundaries: `shared/` imports nothing from `main/`,
  `pipeline/reducer.ts` imports nothing outside `shared/`, `hud/` imports nothing from `main/`.
