# RAVE NIGHTS

An interactive rave in the browser. A procedural EDM engine generates a set live; a simulated
lighting rig — moving-head beams, wash movers, LED walls, pixel bars, strobes, blinders and laser
projectors — plays it through volumetric haze in a real 3D room. You can watch, or you can take the
desk.

No dependencies at runtime. Everything is hand-written against the Web Audio API and WebGL2.

```bash
npm install
npm run dev          # http://localhost:5173
```

> **⚠ Photosensitivity warning.** This application contains sustained strobe lighting, rapid
> flashing and high-contrast flicker, which may trigger seizures in people with photosensitive
> epilepsy. A **REDUCE FLASHING** switch on the entry screen and in the console caps the strobe
> rate and flattens the contrast; it is enabled by default when your system requests reduced
> motion.

---

## What it actually does

### The music is generated, not sampled

Six subgenres, each defined by more than a tempo — a drum grid, a bass voice, a lead voice, a
scale and progression, a swing amount, and an arrangement shape:

| Genre | BPM | Feel | How the room looks |
|---|---|---|---|
| House | 124 | four-on-the-floor, swung hats, chord stabs | warm amber/magenta, slow washes |
| Techno | 132 | relentless, minimal, industrial | monochrome white/cyan, hard strobes, pencil beams |
| Trance | 138 | long builds, supersaw, real breakdowns | full-spectrum, wide fans, huge drop payoff |
| Dubstep | 140 | half-time, wobble bass | violent green/purple, strobe on every wob |
| Drum & Bass | 174 | two-step breaks, reese sub | fast blue/orange chases, rapid laser scans |
| Breakbeat | 132 | syncopated, no four-on-the-floor | punchy off-grid hits, ballyhoo movement |

Everything is phrase-aligned on 8/16/32 bars and moves through **intro → build → drop → breakdown
→ build → drop → outro**, the way dance music is actually written. Builds open the master filter,
double the snare-roll subdivision, and drop the kick out for the final bar.

### The lighting is operated, not reacted

`src/lighting/director.ts` is a simulated lighting operator. It holds four independent playbacks —
position, colour, dimmer effect, laser effect — and changes them at *different* cadences, because a
desk operator does not rewrite the whole look at once.

The move that matters is **arming**. Because the synth engine generates the music, it knows exactly
which bar the next drop lands on, so the director can snap the room to black on the last beat of
the build and detonate on the downbeat. That pre-drop blackout is the single most recognisable
gesture in club lighting and it is impossible to fake from spectrum analysis alone.

Cues use the real vocabulary: beam **fan**, **tunnel**, **cone**, **cross**, **ballyhoo**,
**figure-8**, and for lasers **fan**, **tunnel**, **cone**, **liquid sky**, **scan**, **grid**.

### Two audio sources, one interface

Both implement `MusicSource` (`src/core/types.ts`), so all lighting logic is written once:

- **SYNTH ENGINE** — generates the set. Ground-truth transport and section; `barsToNextSection()`
  returns a real number.
- **FILE / MIC** — drag in an audio file or listen through the microphone. Tempo is recovered by
  autocorrelating an onset-strength envelope, and the beat grid is phase-locked to detected kicks.
  It reports `confident: false` and `barsToNextSection() === -1`, and the director degrades to
  reactive cues rather than pretending it can see the future. **TAP** and **ALIGN** are there for
  when the tracker is wrong.

---

## Controls

Both panels stay on screen. You can seize any part of the show mid-set.

**DECK** — play/stop, audio source, genre, tempo, energy, DJ-style filter sweep, **DROP** and
**BREAKDOWN** triggers, and a seed (the same seed replays the same set).

**CONSOLE** — MANUAL OVERRIDE, momentary STROBE and BLINDER bashes, per-group faders (beams,
washes, lasers, LED bars, LED wall), colour palette, movement / dimmer / laser cue selectors,
strobe rate, haze, room, camera, quality, and REDUCE FLASHING.

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `Space` | strobe bash (hold) | | `D` | force a drop |
| `B` | blinder bash (hold) | | `X` | force a breakdown |
| `1`–`6` | laser cues | | `M` | toggle manual override |
| `Q` `W` `E` | rooms | | `P` | play / stop |
| `C` | camera cut | | `↑` `↓` | energy |
| `H` | haze burst | | `F` | fullscreen |
| `Tab` | hide the interface | | | |

Drag to look around, scroll to zoom. Dragging takes the camera out of auto mode.

### Rooms

- **Festival Mainstage** — 12-beam arc, huge LED wall, wide fans. Best with trance and house.
- **Laser Cathedral** — eight projectors ringing thick haze; the lasers are the instrument.
  Best with techno and drum & bass.
- **Intimate Club Room** — low ceiling, pixel bars framing the booth. Best with house and breaks.

---

## How it renders

Six passes, in this order and for these reasons:

1. **Scene** — room geometry into an HDR target with depth. One draw call.
2. **Crowd** — instanced billboards, rim-lit by the rig. Bodies are almost pure black; all the
   readable detail is the edge the fixtures carve out of them.
3. **Lasers** — camera-facing quads, additive, depth-tested so beams stop at walls. They are
   *geometry rather than raymarched* because a real laser is near-zero-radius: a 32-step march
   would step straight past it and the beam would flicker as the camera moved.
4. **Volumetric** — single-scattering raymarch at reduced resolution, reading scene depth to know
   where to stop. Dithered step offsets keep a low step count from banding.
5. **Bloom** — Karis 13-tap downsample chain, tent upsample, optional anamorphic streak.
6. **Composite** — ACES tonemap, vignette, grain, and a chromatic-aberration punch on drops.

Two details do most of the work:

- **Haze is one function.** `hazeDensity()` in `shaders/common.glsl` is sampled by both the
  volumetric march and the laser quads, so a laser never appears to cut through clear air in the
  middle of a thick patch of fog.
- **Beams and washes scatter differently.** In-scattering is driven by radiance — flux per unit
  solid angle — not total flux. A wash spreads the same lamp over a cone two orders of magnitude
  wider than a beam, so per steradian it is far dimmer. That is why a beam carves a hard shaft and
  a wash only tints the air. Weighting them equally fills the room with milk and the beams stop
  reading entirely. Surface lighting deliberately ignores this, because illuminance on a wall
  *does* depend on total flux — which is what a wash is for.

Beam falloff is cone-dependent for the same reason: a pencil beam stays collimated and holds its
brightness across the room, while a wide wash obeys inverse-square.

Quality steps itself down (`Low`/`Medium`/`High`/`Ultra`) before frames start dropping; the
`ADAPTIVE` switch turns that off.

### Timing

The renderer derives its transport position from `AudioContext.currentTime`, never from
`requestAnimationFrame` deltas — that is what keeps the lights locked to the music instead of to
whatever the frame rate is doing. Notes are scheduled ahead of the playhead with the standard
lookahead pattern, but anything the *visuals* need is queued with its audio timestamp and released
only when the playhead reaches it. Without that split, every light would fire 100ms early.

---

## Layout

```
src/
  core/       clock, transport maths, event bus, seeded RNG, vec/mat helpers
  audio/      engine, scheduler, voices, genres, arrangement, analysis, file/mic input
  lighting/   fixture model, cue library, the director
  gfx/        WebGL2 renderer, mesh builder, camera, GLSL
  scenes/     three rooms: fixture patch + geometry + palette bias
  ui/         entry gate, deck + console panels, keyboard map
tests/        vitest — 168 tests over the logic that is easy to get subtly wrong
scripts/      screenshot runner
```

## Verifying

```bash
npm test          # 168 unit tests
npm run typecheck
npm run build
npm run shots     # drives the built app in Chromium, captures every room and genre
```

`npm run shots` is the only check that proves the shaders compile and the rig renders — the unit
tests cover the logic but never touch WebGL. It writes to `shots/` and exits non-zero on any
console error.

For tuning the look, `renderer.debugView` (`0` normal, `1` scene, `2` volumetric, `3` bloom)
isolates a single pass, and `renderer.scatter` / `hazeScale` / `fixtureGain` / `laserGain` /
`bloomAmount` are live from the console. The shipped values were chosen by measuring rendered
frames, not by eye.

Requires WebGL2. Falls back to 8-bit render targets where `EXT_color_buffer_float` is unavailable.
