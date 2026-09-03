# Halo

A capture-invisible desktop assistant for Windows. Halo watches the screen, understands what
you're looking at, and puts a concise answer in a floating card that does not appear in screen
shares or recordings.

`docs/SPEC.md` is the source of truth. `CLAUDE.md` is how to work in the repo. `docs/VERIFY.md` is
the manual checklist that has to pass before a release.

## Requirements

- Windows 10 build 19041 (version 2004) or later. Halo refuses to start below this: the API that
  hides the window from screen capture does not exist on older builds.
- Node 20+ for development.
- An Anthropic API key, entered in Halo's settings. It is stored with Electron's `safeStorage` and
  never leaves the main process.

## Getting started

```bash
npm install
npm run dev
```

On first launch the HUD opens to settings because no key is stored. Paste one and save, then
close settings with `Ctrl+Shift+O` (or Escape).

The HUD is click-through by design: it sits above everything and your clicks pass straight through
to the app behind it. It becomes clickable only while the settings pane or the prompt bar is open.
Everything else is driven by hotkeys:

| Chord | Action |
|---|---|
| `Ctrl+\` | Show / hide the HUD |
| `Ctrl+Enter` | Capture now and answer |
| `Ctrl+Shift+Enter` | Open the prompt bar |
| `Ctrl+Shift+A` | Cycle Off → Manual → Auto |
| `Ctrl+Shift+R` | Reveal a held result |
| `Ctrl+Shift+D` | Dismiss the card |
| `Ctrl+Shift+S` | Shush for five minutes |
| `Ctrl+Shift+O` | Open / close settings |
| `Ctrl+Alt+-` / `=` | Make the card narrower / wider |

Every binding is remappable in settings. The full list is in `docs/SPEC.md` §10.

## Modes

- **Off** — nothing is captured and nothing is sent.
- **Manual** — Halo answers only when you ask, and classification is skipped entirely.
- **Auto** — Halo watches for the screen to settle on something new, classifies it cheaply, and
  generates an answer it *holds* until you press reveal. At most one answer per 20 seconds, never
  over an undismissed card, and nothing at all while shushed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development, with hot reload for the renderers |
| `npm run build` | Typecheck and build into `out/` |
| `npm test` | Unit tests (reducer, dhash, sections, settle) |
| `npm run lint` | ESLint, including the import-boundary rules |
| `npm run typecheck` | TypeScript, no emit |

## Privacy

Screenshots and answers exist in memory only: nothing is written to disk but your settings, and
the log redacts the API key and never records image data or generated text. There is no telemetry,
no crash reporting and no auto-update.
