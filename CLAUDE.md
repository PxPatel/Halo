# Working agreements

`docs/SPEC.md` is the source of truth for V1. If the code and that document disagree, one of them
is a bug — fix the one that is wrong, do not leave them out of step. This file covers how to work
in the repo and records every place the implementation knowingly departs from the spec.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | electron-vite dev server (Windows only in practice: capture needs a desktop) |
| `npm run build` | typecheck, then build main / preload / both renderers into `out/` |
| `npm run typecheck` | `tsc --noEmit` over the node and web projects |
| `npm run lint` | ESLint, including the import-boundary rules |
| `npm test` | Vitest: reducer, dhash, sections, settle |

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` all run on any platform. The
app itself only runs on Windows 10 build 19041+ (see SPEC §1).

## The invariants that matter

1. **Main owns all state.** The HUD's zustand store is a mirror updated only by `Event`s. A
   renderer that optimistically sets mode or pipeline state is a bug, not a shortcut.
2. **`pipeline/reducer.ts` is pure.** No I/O, no timers, no `Date.now()`, no Electron. Time
   arrives on events as `at`. Everything that touches the world lives in `runner.ts`.
3. **`shared/` runs in a browser.** No Node, no Electron, no imports from `main/`.
4. **The API key never leaves main.** Not over IPC, not into logs, not into `Settings`.
5. **Nothing is persisted but settings.** No screenshots, no answers, no history — memory only.
6. **Prompts are files.** `src/main/ai/prompts/*.md`. No inline prompt strings anywhere.
7. **Tunables live in `TUNING`.** If you are about to type a number twice, it belongs there.

ESLint enforces 3 and part of 2; the rest is on review.

## Where things live

Read SPEC §3 for the tree. Two rules of thumb when adding code:

- If it decides *whether* something happens, it belongs in the reducer, as a guard, with a test.
- If it decides *how* something happens, it belongs in the runner, a seam implementation, or a
  component — and it should be boring.

## Testing

`tests/reducer.test.ts` is the highest-value file in the repo: every guard in SPEC §9's restraint
rules is a test there. Add to it before touching the reducer, not after. `dhash`, `settle` and
`sections` are pure and need no mocking either. There is no E2E in V1 — `docs/VERIFY.md` is what
stands in for it, and it is a manual checklist for a human on Windows.

## Deviations from the spec

Each of these is deliberate. If you disagree with one, change the code and the spec together.

**Types and contracts**

- `Rect` is **normalized** (x/y/width/height as 0..1 fractions), not pixel "frame coordinates"
  (§4). The classifier sees a 512px thumbnail while the crop is applied to the full-resolution
  frame; normalized coordinates remove a whole class of scaling bugs.
- The `Command` union adds `setApiKey` (§11 and §12 require the HUD to be able to store a key that
  §11 forbids from travelling inside `Settings`) and `copyToClipboard` (§10's `Ctrl+Shift+C` has to
  work while the HUD is unfocused, where the renderer's clipboard API is not reliable).
- Both unions add `ready`: a renderer announces that its listener exists, and main answers with a
  full state push (HUD) or accepts commands (capture). `webContents.send` drops messages sent to a
  renderer that has not attached its listener yet — it does not queue them — so a push tied only to
  `did-finish-load` is a race, and losing it is how a HUD ends up showing stale state and a capture
  window ends up ignoring `start`.
- The `Event` union adds `ui` — a hotkey-driven, renderer-only instruction (tab jump, copy, prompt
  bar, debug overlay, settings). The HUD is deliberately unfocusable (§6), so keystrokes cannot
  reach it any other way.
- `state` carries `lowConfidence` (§9's pill badge has no other channel), `assistStart` carries
  `hold` (the HUD must know not to render a streaming *auto* answer, §9 prefetch-and-hold),
  `settings` carries `hasApiKey` (§11) and `hotkeyConflicts` (§10), and `diagnostics` carries the
  debug overlay's numbers (§12).
- `CaptureSource` gains `lastHash`, `onHash`, `active` and `onStreamEnded`: the result-cache key
  for a manual trigger needs the live hash, the debug overlay needs the last distance, and §12
  requires detecting a dead stream. `ModelProvider` gains `warmup()`, which §7 asks for.

**Structure**

- `settling` is used for a settle that arrived inside the rate-limit window: the pipeline holds it
  and a timer replays it when the window opens, so the newest screen is answered late rather than
  never. Exactly one auto run per `autoMinIntervalMs` still holds.
- Files not in §3's tree: `main/log.ts` (§12 asks for one log module), `capture-renderer/settle.ts`
  (§13 asks for `settle.test.ts`, which needs a pure module to test), `hud/main.tsx`,
  `hud/index.html`, `capture-renderer/index.html` (renderer entry points),
  `hud/components/Markdown.tsx` (renders model output as React elements rather than HTML, so
  model output can never inject markup) and `hud/components/Debug.tsx` (§12's overlay).
- One preload file serves both renderers and picks its surface from an `additionalArguments` flag.
  A second preload entry would make rollup emit a shared chunk, and a sandboxed preload cannot
  `require` one.
- Three files sit over §15's ~200-line signal: `pipeline/reducer.ts` (~480), `pipeline/runner.ts`
  (~290) and `main/index.ts` (~235, against §3's ~150). The reducer is one state machine and
  splitting its transitions across files would cost more in readability than the length does; the
  runner is the matching effect executor; `index.ts` is all wiring — construction, command
  dispatch and hotkey handlers — and moving it elsewhere would only make the wiring harder to
  find. Split them if they grow features, not to hit the number.

**Conventions**

- Non-null assertions appear outside tests, but only on indexed access under
  `noUncheckedIndexedAccess` (`lines[i]!` after a bounds check). §15 forbids them; keeping the
  stricter compiler flag is worth more than the letter of that rule.
- The AI layer throws a typed `ProviderError` and the runner converts it into an `assistError`
  event. Nothing throws across IPC, which is what §15 is protecting.
- Generation requests set `thinking: { type: 'disabled' }`: §14's M1 asks for first token in under
  two seconds, and thinking puts seconds in front of it. Classification sets `temperature: 0` as
  §7 requires; generation does not, because Sonnet 5 rejects sampling parameters.

## Status

Everything in the spec is implemented, but the app has **not been run on Windows**: it was built
and tested on Linux, where `WDA_EXCLUDEFROMCAPTURE`, `globalShortcut` and `desktopCapturer` cannot
be exercised. Typecheck, lint, unit tests and a production build all pass. `docs/VERIFY.md` — in
particular the M0 invisibility section — is unrun, and until it passes on real hardware the
central claim of the product is unverified.
