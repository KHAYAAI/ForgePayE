# FORGE Credit Bureau — launch film

`launch-film.html` is the complete film: a self-contained, single-file HTML page
with no external dependencies and no network calls. Open it in any browser.

- **Runtime:** 55 seconds, 7 scenes (`The problem` → `Close`).
- **Sound:** a score synthesised in the browser with the Web Audio API — 120bpm,
  A minor, arrangement keyed to the scene structure. It is generated, not loaded
  from a file, so it stays in sync when the timeline is scrubbed or replayed.
  The `Sound on` button in the transport mutes it.
- **Chapters:** the buttons under the transport jump to a composed frame of each
  scene (not the scene's first frame, which is mid-transition).

## Claims

Every figure on screen comes from the running system, not from the edit:
the $0.70 furnisher share and the $2.80 / $2.40 / $2.00 volume bands come from
the bureau's pricing module, and the transaction in the settlement scene is the
real Base Sepolia payout from the testnet rehearsal. Mainnet deployment was
still in progress when this was cut, and the film does not claim otherwise.
Keep it that way if the film is re-edited.

## Re-rendering the video and the audio

The film is the source of truth; the video and audio are derived from it.

Video is rendered deterministically — the page is stepped frame by frame via
its own `seek()` rather than screen-recorded, so there are no dropped frames and
the result is exactly 55.000s at 25fps, 1920x1080. Do **not** override the
stage's `font-size` when scaling to 1080p: the film sizes itself from the stage
width (`BASE = w/100`), and forcing a different font-size desynchronises the
type from the masks that clip it, which makes later scenes bleed through.
Set `.stage{width:1920px}`, then dispatch a `resize` event and let it resize.

The exported video has **no audio track**. Browser screen capture records no
audio, so the score is rendered separately by replaying the same event list
through an `OfflineAudioContext` and writing a WAV. Lay that WAV over the video
in an editor to produce a version with sound.
