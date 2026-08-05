# FORGE console — recorded product tour

`record-tour.js` drives the console at `../index.html` in headless Chromium and
records the session to WebM. It is a real browser session, not an animation —
every number on screen is rendered by the console itself.

The script injects three things the console does not have, purely for the
recording: a caption strip (top — the bottom is where video players draw their
controls), a synthetic cursor that moves and pulses on click, and the opening
and closing title cards.

## Run

```bash
NODE_PATH=$(npm root -g) node record-tour.js
```

Output: `video/<hash>.webm` at 1440×900, roughly 4m50s, about 27 MB.
Requires Playwright with Chromium at `/opt/pw-browsers/chromium`.

Takes about five minutes of wall clock — the tour waits for each runnable flow
(routing simulator, netting, policy evaluator, recovery, scoring engine) to
finish on its own timers rather than skipping ahead.

## Coverage

All 36 routes, with these flows driven live: the end-to-end run, the routing
simulator, checkout, a netting run, the yield sweep, a custody approval, the
policy evaluator (OFAC block path), wallet recovery, agent verification and the
scoring engine — plus six detail drawers.

## Editing the tour

Beats are sequential in the `── the tour ──` block. Each is `go(route)`,
`cap(kicker, title, subtitle)`, then dwell and interaction. Timings are tuned so
a viewer can read each page before it moves on; if you shorten them, shorten the
dwell rather than the waits that follow a `tap()` on a runnable flow.
