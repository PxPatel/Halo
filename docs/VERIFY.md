# Release verification

Halo's entire premise is that you trust it while your attention is elsewhere. Nothing below is
automated, and nothing below is optional. Run the whole list on the target machine before every
release, on a build produced by `npm run build` — not in `npm run dev`.

Record the Windows build number (`winver`) with the results. `WDA_EXCLUDEFROMCAPTURE` behaviour
differs between builds, so a pass on one build is not a pass on another.

## Invisibility (SPEC 6)

Two mechanisms are being tested, and they fail independently. Content protection hides Halo's
*pixels*; the tool-window style hides Halo's *entry* from window lists. A build can pass every
pixel test and still show up by name in Zoom's picker.

- [ ] Zoom — share entire screen. Halo is invisible to the other participant.
- [ ] Zoom — share a single window. Halo is invisible.
- [ ] Zoom — open the share picker. Halo is **not listed** among the windows.
- [ ] Google Meet in Chrome — entire screen, window, and tab share. Halo is invisible in all three.
- [ ] Microsoft Teams — screen share. Halo is invisible.
- [ ] OBS — display capture. Halo is invisible.
- [ ] OBS — window capture. Halo is **not listed** as a capturable window.
- [ ] `Win+Shift+S` snip over the HUD. The snip contains the desktop behind Halo, not Halo.
- [ ] Xbox Game Bar (`Win+G`) capture. Halo is invisible in the recording.
- [ ] Alt-Tab. Halo does not appear.
- [ ] A fullscreen browser is focused. Halo appears above it and does **not** steal focus: typing
      continues to reach the browser.

## Startup self-check (SPEC 6, SPEC 12)

- [ ] On a Windows build below 19041, Halo refuses to start with a dialog that names the reason.
- [ ] With content protection forced to fail, the HUD shows the persistent red banner and keeps
      working. It never silently pretends to be hidden.
- [ ] With no API key stored, the HUD opens directly to settings.

## Operability without a mouse (SPEC 9, SPEC 10)

Unplug the mouse. Every row must be reachable.

- [ ] `Ctrl+\` shows and hides the HUD.
- [ ] `Ctrl+Enter` captures and answers.
- [ ] `Ctrl+Shift+Enter` opens the prompt bar and it takes keyboard focus.
- [ ] Escape closes the prompt bar and click-through is restored (clicks land on the app behind).
- [ ] `Ctrl+Shift+A` cycles Off → Manual → Auto, and the mode dot follows.
- [ ] `Ctrl+Shift+R` reveals a held result instantly, with no visible generation.
- [ ] `Ctrl+Shift+D` dismisses the card.
- [ ] `Ctrl+Shift+S` shushes for five minutes; the pill shows the remaining time.
- [ ] `Ctrl+Alt+arrows` move the HUD; the position survives a restart.
- [ ] `Ctrl+Alt+[` and `]` change opacity; the value survives a restart.
- [ ] `Ctrl+Shift+C` copies the active code block while the HUD is unfocused.
- [ ] `Ctrl+Shift+1/2/3` jump to Code / Notes / Say.
- [ ] `Ctrl+Shift+L` toggles the debug overlay and its numbers move.
- [ ] A binding held by another app is marked in settings, and the rest of the app still works.

## Accessibility (SPEC 9)

- [ ] Base font size 20px: the card is legible and nothing overflows or clips.
- [ ] Tab reaches the card body, tabs and footer buttons while the prompt bar is open.
- [ ] With `prefers-reduced-motion: reduce`, the mode dot does not pulse.
- [ ] A screen reader announces the answer when streaming finishes.

## Pipeline behaviour (SPEC 9, SPEC 14)

- [ ] Manual mode, `Ctrl+Enter` on a coding problem: first token in under two seconds.
- [ ] Auto mode, navigate to a new problem: a result is held within three seconds, with no card
      appearing until `Ctrl+Shift+R`.
- [ ] Auto mode, browse unrelated pages for five minutes: zero cards.
- [ ] Auto mode with a card on screen: navigating elsewhere never replaces the undismissed card.
- [ ] Re-trigger on an unchanged screen: the answer returns instantly and no request is made.
- [ ] Shush suppresses auto triggers, and `Ctrl+Enter` still answers.

## Error matrix (SPEC 12)

Induce each one; the app must behave as the row says and must not crash.

- [ ] Wrong API key → red dot, "check your key", settings reachable.
- [ ] Rate limit (429) → two backed-off retries, then a retryable error card.
- [ ] Network off mid-stream → error card with retry, partial text is not presented as complete.
- [ ] Request timeout → aborted at 30s with an error card.
- [ ] Classifier returns junk → treated as not actionable, logged, no card, no crash.
- [ ] Sleep and resume, or unplug the display → capture restarts by itself.
- [ ] Disconnect the configured display → falls back to primary and updates settings.

## Privacy (SPEC 1, SPEC 11, SPEC 12)

- [ ] `%APPDATA%/halo` contains no screenshots and no generated answers.
- [ ] The log file contains no API key, no image data, and no answer text.
